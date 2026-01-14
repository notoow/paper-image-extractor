from fastapi import FastAPI, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn
import os
from typing import List, Dict

# Import business logic from utils (Seperation of Concerns)
from utils import extract_images_from_pdf_bytes, get_pdf_from_scihub_advanced, sanitize_filename

app = FastAPI()

# CORS Config
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("static", exist_ok=True)

import sqlite3

# --- Database Setup (SQLite) ---
# Use /tmp for write permissions on HF Spaces (Ephemeral but works)
DB_FILE = "/tmp/paper_war.db"

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS scores
                 (country TEXT PRIMARY KEY, score INTEGER)''')
    conn.commit()
    conn.close()

# Initialize DB immediately
init_db()

# --- WebSocket & Chat Manager ---
class ConnectionManager:
    # ... (init and load_leaderboard same) ...
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.leaderboard: Dict[str, int] = self._load_leaderboard()

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
        # Send init data with online count
        await websocket.send_json({
            "type": "init", 
            "leaderboard": self.leaderboard,
            "online": len(self.active_connections)
        })
        # Broadcast new user count
        await self.broadcast_online_count()

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        # Don't await broadcast here to avoid error loop, just schedule it or ignore if loop closing
        
    async def broadcast_online_count(self):
        await self.broadcast({
            "type": "online_count", 
            "count": len(self.active_connections)
        })

    async def broadcast(self, message: dict):
        # ... (same cleanup logic) ...
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
            images = extract_images_from_pdf_bytes(result)
            return {
                "status": "success",
                "doi": request.doi,
                "title": info, 
                "filename": f"{info}.pdf",
                "image_count": len(images),
                "images": images
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
        
        images = extract_images_from_pdf_bytes(pdf_bytes)
        
        return {
            "status": "success",
            "doi": "uploaded_file",
            "title": paper_title, 
            "filename": file.filename,
            "image_count": len(images),
            "images": images
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {str(e)}")

# --- WebSocket Chat Endpoint ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            # Expected: { "country": "KR", "msg": "Hello", "type": "chat" }
            
            msg_type = data.get("type", "chat")
            country = data.get("country", "UNKNOWN")
            
            if msg_type == "chat":
                msg = data.get("msg", "").strip()
                if msg:
                    # Update Score on chat (Activity)
                    manager.update_score(country)
                    # Broadcast
                    await manager.broadcast({
                        "type": "chat",
                        "country": country,
                        "msg": msg,
                        "leaderboard": manager.leaderboard
                    })
            elif msg_type == "score":
                # Just update score (e.g. on Download)
                manager.update_score(country)
                await manager.broadcast({
                    "type": "update_score",
                    "leaderboard": manager.leaderboard
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
