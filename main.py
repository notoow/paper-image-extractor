from fastapi import FastAPI, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn
import os
import base64
from typing import List, Dict

# Import business logic from utils (Seperation of Concerns)
from utils import extract_images_from_pdf_bytes, get_pdf_from_scihub_advanced, sanitize_filename, sanitize_and_compress_pdf

import sqlite3
import os
from contextlib import asynccontextmanager
from apscheduler.schedulers.background import BackgroundScheduler
from huggingface_hub import HfApi, hf_hub_download

# --- Configuration ---
DB_FILE = "/tmp/paper_war.db"
REPO_ID = "notoow/paper-prism-db" # Dataset ID to store DB
HF_TOKEN = os.environ.get("HF_TOKEN") # Auto-injected in Spaces

scheduler = BackgroundScheduler()

# --- Sync Logic ---
def sync_db_to_hub():
    """Uploads the local DB to Hugging Face Hub"""
    if not HF_TOKEN:
        return
    try:
        api = HfApi(token=HF_TOKEN)
        # Check/Create Repo
        try:
            api.repo_info(repo_id=REPO_ID, repo_type="dataset")
        except:
            # Silent attempt to create
            try:
                api.create_repo(repo_id=REPO_ID, repo_type="dataset", private=True, exist_ok=True)
            except Exception as e:
                print(f"Repo create failed: {e}")
                return

        print("Syncing DB to Hub...")
        api.upload_file(
            path_or_fileobj=DB_FILE,
            path_in_repo="paper_war.db",
            repo_id=REPO_ID,
            repo_type="dataset",
            commit_message="Sync DB: Auto-backup"
        )
    except Exception as e:
        print(f"Sync failed (Non-critical): {e}")

def init_db():
    """Initialize DB"""
    # 1. Try Restore
    if HF_TOKEN:
        try:
            print("Attempting to restore DB from Hub...")
            hf_hub_download(
                repo_id=REPO_ID,
                filename="paper_war.db",
                repo_type="dataset",
                local_dir="/tmp",
                token=HF_TOKEN
            )
            print("DB Restored.")
        except Exception as e:
            print(f"Restore skipped: {e}")

    # 2. Ensure Table Exists (Critical)
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS scores
                     (country TEXT PRIMARY KEY, score INTEGER)''')
        # Create Chat Table
        c.execute('''CREATE TABLE IF NOT EXISTS chats
                     (id INTEGER PRIMARY KEY AUTOINCREMENT, country TEXT, msg TEXT, type TEXT, time TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"CRITICAL: DB Init Failed: {e}")

# --- Lifespan ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    try:
        init_db()
        scheduler.add_job(sync_db_to_hub, 'interval', minutes=1)
        scheduler.start()
        print("Scheduler started.")
    except Exception as e:
        print(f"Scheduler failed to start: {e}")
    
    yield
    
    # Shutdown
    try:
        scheduler.shutdown()
        sync_db_to_hub()
    except:
        pass

# Initialize App
app = FastAPI(lifespan=lifespan)

@app.get("/health")
async def health_check():
    return {"status": "ok", "db": os.path.exists(DB_FILE)}

# CORS Config
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("static", exist_ok=True)



from collections import deque

# --- WebSocket & Chat Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        # DB is initialized in lifespan, safe to load
        self.leaderboard: Dict[str, int] = self._load_leaderboard()
        # Keep last 50 chat messages in memory, loaded from DB
        self.chat_history = deque(maxlen=50)
        self._load_history()
        # Track countries for online users {ws: "Unknown"}
        self.connection_countries: Dict[WebSocket, str] = {}
        # Track chat counts from DB
        self.chat_counts: Counter = self._load_chat_counts()
    
    def _load_chat_counts(self):
        from collections import Counter
        try:
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT country, COUNT(*) FROM chats GROUP BY country")
            counts = Counter(dict(c.fetchall()))
            conn.close()
            return counts
        except Exception as e:
            print(f"Failed to load chat counts: {e}")
            return Counter()

    def _load_history(self):
        try:
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            # Get last 50 messages
            c.execute("SELECT country, msg, type FROM chats ORDER BY id DESC LIMIT 50")
            rows = c.fetchall()
            # Rows are in DESC order (newest first), we need to append them in ASC order (oldest first)
            for row in reversed(rows):
                self.chat_history.append(dict(row))
            conn.close()
        except Exception as e:
            print(f"Failed to load chat history: {e}")

    def _load_leaderboard(self) -> Dict[str, int]:
        try:
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT country, score FROM scores")
            data = {row[0]: row[1] for row in c.fetchall()}
            conn.close()
            return data
        except Exception:
            return {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_countries[websocket] = "Unknown" # Default
        # Send init data with online count and history
        await websocket.send_json({
            "type": "init", 
            "online": len(self.active_connections),
            "leaderboard": self.get_rich_leaderboard(),
            "history": list(self.chat_history)
        })
        await self.broadcast_online_count()

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        if websocket in self.connection_countries:
            del self.connection_countries[websocket]
        # Don't await broadcast here to avoid error loop, just schedule it or ignore if loop closing
        
    async def broadcast_online_count(self):
        # Calculate distribution
        from collections import Counter
        dist = Counter(self.connection_countries.values())
        # Format as string for tooltip: "KR: 2, US: 1"
        dist_str = ", ".join([f"{k}: {v}" for k, v in dist.items() if k != "Unknown"])
        if not dist_str: dist_str = "Unknown"

        await self.broadcast({
            "type": "online_count", 
            "count": len(self.active_connections),
            "distribution": dist_str
        })

    async def set_country(self, websocket: WebSocket, country: str):
        if websocket not in self.connection_countries: return
        
        # Only update and broadcast if changed
        if self.connection_countries[websocket] != country:
            self.connection_countries[websocket] = country
            await self.broadcast_online_count()

    def get_rich_leaderboard(self):
        # Combine scores and chat counts
        all_countries = set(self.leaderboard.keys()) | set(self.chat_counts.keys())
        rich_data = []
        for c in all_countries:
            rich_data.append({
                "country": c,
                "score": self.leaderboard.get(c, 0),
                "chats": self.chat_counts.get(c, 0)
            })
        # Sort by Score DESC, then Chats DESC
        rich_data.sort(key=lambda x: (x['score'], x['chats']), reverse=True)
        return rich_data

    async def broadcast(self, message: dict):
        # Save chat to history if it's a chat message
        if message.get("type") == "chat":
            # Update country for this connection
            country = message.get("country")
            if country:
                self.chat_counts[country] += 1

            self.chat_history.append(message)
            # Persist to DB
            try:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute("INSERT INTO chats (country, msg, type) VALUES (?, ?, ?)", 
                          (message.get("country"), message.get("msg"), "chat"))
                conn.commit()
                conn.close()
            except Exception as e:
                print(f"Chat Save Error: {e}")

        # Clean up dead connections during broadcast
        to_remove = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                to_remove.append(connection)
        
        for conn in to_remove:
            if conn in self.active_connections:
                self.active_connections.remove(conn)
                
    def update_score(self, country: str):
        if not country: return
        
        try:
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("""
                INSERT INTO scores (country, score) VALUES (?, 1)
                ON CONFLICT(country) DO UPDATE SET score = score + 1
            """, (country,))
            conn.commit()
            
            c.execute("SELECT score FROM scores WHERE country = ?", (country,))
            row = c.fetchone()
            if row:
                self.leaderboard[country] = row[0]
            conn.close()
        except Exception as e:
            print(f"DB Error: {e}")

    # ... (rest same) ...

manager = ConnectionManager()


# Data Models
class DoiRequest(BaseModel):
    doi: str

# --- Routes (KISS: Only Routing Logic) ---

@app.post("/api/process")
async def process_doi(request: DoiRequest):
    print(f"Processing DOI: {request.doi}")
    
    result, info = get_pdf_from_scihub_advanced(request.doi)
    
    if result is not None:
        try:
            # 1. Sanitize PDF for Security
            safe_pdf_bytes = sanitize_and_compress_pdf(result)
            pdf_b64 = base64.b64encode(safe_pdf_bytes).decode('utf-8')

            # 2. Extract Images
            images = extract_images_from_pdf_bytes(safe_pdf_bytes)
            
            return {
                "status": "success",
                "doi": request.doi,
                "title": info, 
                "filename": f"{info}.pdf",
                "image_count": len(images),
                "images": images,
                "pdf_base64": pdf_b64 # Safe PDF Data
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to extract images: {str(e)}")
            
    if info and info.startswith('http'):
        return {
            "status": "manual_link",
            "doi": request.doi,
            "pdf_url": info,
            "message": "Server blocked. Please download manually."
        }
    
    raise HTTPException(status_code=404, detail=info)

@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    print(f"Processing uploaded file: {file.filename}")
    
    try:
        pdf_bytes = await file.read()
        paper_title = os.path.splitext(file.filename)[0]
        paper_title = sanitize_filename(paper_title)
        
        # 1. Sanitize PDF for Security
        safe_pdf_bytes = sanitize_and_compress_pdf(pdf_bytes)
        pdf_b64 = base64.b64encode(safe_pdf_bytes).decode('utf-8')
        
        # 2. Extract Images
        images = extract_images_from_pdf_bytes(safe_pdf_bytes)
        
        return {
            "status": "success",
            "doi": "uploaded_file",
            "title": paper_title, 
            "filename": file.filename,
            "image_count": len(images),
            "images": images,
            "pdf_base64": pdf_b64
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {str(e)}")

# --- WebSocket Chat Endpoint ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    
    # Rate Limiting State
    import time
    last_msg_time = 0
    msg_burst_count = 0
    burst_window_start = time.time()

    try:
        while True:
            data = await websocket.receive_json()
            
            # --- Rate Limiting Check ---
            now = time.time()
            
            # Rule 1: Min Interval 0.1s (Machine speed check)
            if now - last_msg_time < 0.1:
                continue # Silently drop

            # Rule 2: Burst Check (Max 10 msgs in 3 seconds)
            if now - burst_window_start > 3.0:
                # Reset window
                msg_burst_count = 0
                burst_window_start = now
            
            msg_burst_count += 1
            
            if msg_burst_count > 10:
                # Warn user and drop
                await websocket.send_json({
                    "type": "chat",
                    "country": "System",
                    "msg": "🛑 Slow down! You are sending messages too quickly."
                })
                continue

            last_msg_time = now
            # ---------------------------

            # Expected: { "country": "KR", "msg": "Hello", "type": "chat" }
            
            msg_type = data.get("type", "chat")
            country = data.get("country", "UNKNOWN")
            
            # Update connection country info if available
            if country and country != "UNKNOWN":
                await manager.set_country(websocket, country)
            
            if msg_type == "chat":
                msg = data.get("msg", "").strip()
                if msg:
                    # Broadcast chat only (Score updated via 'score' type)
                    await manager.broadcast({
                        "type": "chat",
                        "country": country,
                        "msg": msg,
                        "leaderboard": manager.get_rich_leaderboard()
                    })
            elif msg_type == "score":
                # Just update score (e.g. on Download)
                manager.update_score(country)
                await manager.broadcast({
                    "type": "update_score",
                    "leaderboard": manager.get_rich_leaderboard()
                })

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"WS Error: {e}")
        manager.disconnect(websocket)


# Frontend Routes
@app.get("/")
async def read_index():
    return FileResponse('static/index.html')

app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=7860, reload=True)
