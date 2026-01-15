
import os
import shutil
import base64
import asyncio
import logging
from typing import List, Dict
from collections import Counter, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Form, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.concurrency import run_in_threadpool

import fitz  # PyMuPDF
from supabase import create_client, Client

# --- Configuration ---
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

# Fallback for local testing if env vars missing (Warn user)
if not SUPABASE_URL or not SUPABASE_KEY:
    print("WARNING: Supabase credentials not found. DB features will not persist.")

# Initialize Supabase Client
try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None
except Exception as e:
    print(f"Failed to init Supabase: {e}")
    supabase = None

from apscheduler.schedulers.asyncio import AsyncIOScheduler

# --- Scheduler for Cleanup ---
scheduler = AsyncIOScheduler()

async def cleanup_old_data():
    """Janitor: Keeps DB clean & within quota."""
    if not supabase: return
    try:
        print("🧹 Janitor: Cleaning up old chats...")
        # Policy: Keep last 10,000 messages.
        # 1. Get ID of the 10,000th newest message
        res = supabase.table("chats").select("id").order("id", desc=True).range(10000, 10000).limit(1).execute()
        
        if res.data:
            cutoff_id = res.data[0]['id']
            # 2. Delete everything older than that ID
            supabase.table("chats").delete().lt("id", cutoff_id).execute()
            print(f"🧹 Janitor: Deleted chats older than ID {cutoff_id}")
        else:
            print("🧹 Janitor: Chat count under limit.")
            
    except Exception as e:
        print(f"Janitor Error: {e}")

# --- Lifespan ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("Server Started. Connected to Supabase." if supabase else "Server Started (No DB).")
    
    # Start Janitor Scheduler (Run every hour)
    scheduler.add_job(cleanup_old_data, 'interval', hours=1)
    scheduler.start()
    
    yield
    
    # Shutdown
    print("Server Shutting Down.")
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan)

# --- Middleware: Rate Limiting ---
import time
RATE_LIMIT_DATA = {}
RATE_LIMIT_WINDOW = 60  # 1 minute
RATE_LIMIT_MAX_REQUESTS = 30 

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        forwarded = request.headers.get("X-Forwarded-For")
        client_ip = forwarded.split(",")[0] if forwarded else request.client.host
        now = time.time()
        
        if client_ip not in RATE_LIMIT_DATA:
            RATE_LIMIT_DATA[client_ip] = []
        
        history = [t for t in RATE_LIMIT_DATA[client_ip] if now - t < RATE_LIMIT_WINDOW]
        RATE_LIMIT_DATA[client_ip] = history
        
        if len(history) >= RATE_LIMIT_MAX_REQUESTS:
             return JSONResponse(
                 status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                 content={"status": "error", "detail": "Rate limit exceeded. Slow down."}
             )
        RATE_LIMIT_DATA[client_ip].append(now)

    response = await call_next(request)
    return response

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("static", exist_ok=True)

# --- WebSocket & Chat Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.connection_countries: Dict[WebSocket, str] = {}
        
        # In-memory caches for speed (Sync with DB in background)
        self.chat_history = deque(maxlen=50) 
        self.leaderboard_cache = [] # List of dicts
        
        # Initial Load
        if supabase:
            self._load_data_from_supabase()

    def _load_data_from_supabase(self):
        try:
            # 1. Load Last 50 Chats
            response = supabase.table("chats").select("*").order("created_at", desc=True).limit(50).execute()
            # Reverse to show oldest first
            for row in reversed(response.data):
                self.chat_history.append({
                    "country": row.get("country", "Unknown"),
                    "msg": row.get("msg", ""),
                    "type": "chat"
                })
                
            # 2. Load Leaderboard (Aggregate from DB or use a view)
            # For simplicity, we assume a 'leaderboard' table exists that we update
            self._update_leaderboard_cache()
            
        except Exception as e:
            print(f"DB Load Error: {e}")

    def _update_leaderboard_cache(self):
        try:
            if not supabase: return
            # Assume 'leaderboard' table: country, score, chat_count
            res = supabase.table("leaderboard").select("*").order("score", desc=True).limit(50).execute()
            self.leaderboard_cache = res.data
        except Exception as e:
            print(f"Leaderboard Update Error: {e}")

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_countries[websocket] = "Unknown"
        
        # Send Init Data
        await websocket.send_json({
            "type": "init", 
            "online": len(self.active_connections),
            "leaderboard": self.leaderboard_cache,
            "history": list(self.chat_history)
        })
        await self.broadcast_online_count()

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        if websocket in self.connection_countries:
            del self.connection_countries[websocket]
        # We don't await broadcast here to avoid error loops, self-corrects next tick

    async def set_country(self, websocket: WebSocket, country: str):
        if websocket not in self.connection_countries: return
        if self.connection_countries[websocket] != country:
            self.connection_countries[websocket] = country
            await self.broadcast_online_count()

    async def broadcast_online_count(self):
        dist = Counter(self.connection_countries.values())
        dist_str = ", ".join([f"{k}: {v}" for k, v in dist.items() if k != "Unknown"])
        if not dist_str: dist_str = "Unknown"

        await self.broadcast_internal({
            "type": "online_count", 
            "count": len(self.active_connections),
            "distribution": dist_str
        })

    async def broadcast(self, message: dict):
        # 1. Send to all WS
        await self.broadcast_internal(message)

        # 2. Persist to DB (Async)
        if supabase:
            await run_in_threadpool(self._persist_message, message)

    async def broadcast_internal(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass # Dead connection

    def _persist_message(self, message: dict):
        try:
            msg_type = message.get("type")
            country = message.get("country", "Unknown")
            
            if msg_type == "chat":
                msg = message.get("msg")
                # Insert Chat
                supabase.table("chats").insert({"country": country, "msg": msg}).execute()
                # Update Leaderboard (Chat Count)
                self._upsert_stats(country, chat_inc=1)
                
                # Update Local Cache
                self.chat_history.append(message)

            elif msg_type == "update_score":
                # Update Leaderboard (Score)
                self._upsert_stats(country, score_inc=1)
                
            # Refresh Cache
            self._update_leaderboard_cache()

        except Exception as e:
            print(f"Persist Error: {e}")

    def _upsert_stats(self, country, score_inc=0, chat_inc=0):
        # Safe Upsert RPC or Check-then-Update
        # Ideally use RPC: create function increment_stats(c text, s int, ch int)
        # Fallback logic:
        try:
            res = supabase.table("leaderboard").select("*").eq("country", country).execute()
            if res.data:
                curr = res.data[0]
                new_score = curr['score'] + score_inc
                new_chats = curr['chat_count'] + chat_inc
                supabase.table("leaderboard").update({"score": new_score, "chat_count": new_chats}).eq("country", country).execute()
            else:
                supabase.table("leaderboard").insert({"country": country, "score": score_inc, "chat_count": chat_inc}).execute()
        except:
            pass

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    
    # Anti-Spam
    last_msg_time = 0
    msg_burst_count = 0
    burst_window_start = time.time()

    try:
        while True:
            data = await websocket.receive_json()
            
            # Rate Limit
            now = time.time()
            if now - last_msg_time < 0.1: continue
            if now - burst_window_start > 3.0:
                msg_burst_count = 0
                burst_window_start = now
            msg_burst_count += 1
            if msg_burst_count > 10:
                await websocket.send_json({"type": "chat", "country": "System", "msg": "🛑 Too fast!"})
                continue
            last_msg_time = now
            
            # Process
            msg_type = data.get("type", "chat")
            country = data.get("country", "UNKNOWN")
            
            if country and country != "UNKNOWN":
                await manager.set_country(websocket, country)
            
            if msg_type == "chat":
                msg = data.get("msg", "").strip()
                if msg:
                     # Broadcast updates cache & DB, then sends to all
                    await manager.broadcast({
                        "type": "chat",
                        "country": country,
                        "msg": msg,
                        "leaderboard": manager.leaderboard_cache # Send optimistic/cached
                    })
            elif msg_type == "score":
                # Score update request (e.g. download)
                # We handle DB update in broadcast wrapper
                await manager.broadcast({
                    "type": "update_score",
                    "country": country,
                    # We don't send leaderboard here, manager will fetch fresh one next time or we can trigger it
                    "leaderboard": manager.leaderboard_cache 
                })

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast_online_count()


# --- Logic: PDF Image Extraction ---
from utils import sanitize_and_compress_pdf, get_scihub_pdf_url, extract_images_from_pdf

@app.post("/api/like")
async def like_image(
    file: UploadFile = File(...),
    doi: str = Form(...),
    country: str = Form("Unknown")
):
    """
    Smart Like System:
    - Saves image to Supabase Storage.
    - Limits to MAX 50 images total (Rolling Buffer).
    - If image already exists (Hash Collision) -> Update timestamp (Refresh) & Increment Likes.
    - If new & limit reached -> Delete Oldest (Natural Selection).
    """
    if not supabase:
        return JSONResponse({"status": "error", "detail": "DB not connected"}, status_code=503)
        
    try:
        # 1. Calculate Hash (Deduplication)
        content = await file.read()
        import hashlib
        img_hash = hashlib.sha256(content).hexdigest()
        
        # 2. Check if exists
        res = supabase.table("images").select("*").eq("image_hash", img_hash).execute()
        
        if res.data:
            # [HIT] Image exists -> Refresh Life & Increment
            row_id = res.data[0]['id']
            new_likes = res.data[0]['likes'] + 1
            supabase.table("images").update({
                "likes": new_likes, 
                "created_at": "now()" # Reset expiration timer
            }).eq("id", row_id).execute()
            
            return {"status": "success", "msg": "Image bumped up!", "likes": new_likes}
        
        else:
            # [MISS] New Image
            # 3. Check Limit & Cleanup Oldest
            # Warning: accurate count might be slow on huge tables, but for 50 it's instant.
            # Using simple query to check size is fine. 
            # We fetch IDs to count or use head=True if supported by lib, but select count is standardized.
            # Supabase-py select with count="exact" is best.
            count_res = supabase.table("images").select("id", count="exact").execute()
            current_count = count_res.count if count_res.count is not None else len(count_res.data)

            if current_count >= 50:
                # Find Oldest (Natural Selection)
                oldest_res = supabase.table("images").select("id", "storage_path").order("created_at", desc=False).limit(1).execute()
                if oldest_res.data:
                    old_node = oldest_res.data[0]
                    # Delete from Storage
                    try:
                        supabase.storage.from_("paper_images").remove([old_node['storage_path']])
                    except: 
                        pass # Ignore storage error (maybe already gone)
                    # Delete from DB
                    supabase.table("images").delete().eq("id", old_node['id']).execute()
            
            # 4. Upload New
            file_ext = file.filename.split('.')[-1] if '.' in file.filename else "png"
            storage_path = f"{img_hash}.{file_ext}"
            
            # Upload to Storage 'paper_images' bucket
            supabase.storage.from_("paper_images").upload(
                path=storage_path,
                file=content,
                file_options={"content-type": file.content_type or "image/png"}
            )
            
            # Insert DB
            supabase.table("images").insert({
                "doi": doi,
                "image_hash": img_hash,
                "storage_path": storage_path,
                "country": country,
                "likes": 1
            }).execute()
            
            return {"status": "success", "msg": "Image saved to Hall of Fame"}

    except Exception as e:
        print(f"Like Error: {e}")
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=500)

@app.post("/api/process")
async def process_doi(request: Request):
    data = await request.json()
    doi = data.get("doi")
    
    if not doi:
        return JSONResponse({"status": "error", "detail": "DOI required"}, status_code=400)

    try:
        # 1. Get PDF URL
        pdf_url = get_scihub_pdf_url(doi)
        if not pdf_url:
             return JSONResponse({"status": "error", "detail": "PDF not found on Sci-Hub"}, status_code=404)
        
        # 2. Extract Images (Heavy Task)
        # Use threadpool
        result = await run_in_threadpool(extract_logic, pdf_url)
        
        if result["status"] == "success":
            result["doi"] = doi # Echo DOI
            return result
        else:
            return JSONResponse(result, status_code=400)

    except Exception as e:
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=500)

@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        # Process from bytes
        result = await run_in_threadpool(extract_from_bytes, contents)
        return result
    except Exception as e:
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=500)

# --- Helper Functions (Sync) ---
def extract_logic(pdf_url):
    import requests
    try:
        # Download
        # Check URL validity first?
        if not pdf_url.startswith("http"): return {"status": "error", "detail": "Invalid URL"}
        
        r = requests.get(pdf_url, timeout=30, verify=False) # Verify False for SciHub often needed
        if r.status_code != 200:
            # Handle "Direct Link" failure, maybe try scraping logic?
            # For now return manual link suggestion
            return {"status": "manual_link", "url": pdf_url}
            
        return extract_from_bytes(r.content)
    except Exception as e:
        return {"status": "error", "detail": f"Download failed: {e}"}

def extract_from_bytes(pdf_bytes):
    try:
        # 1. Sanitize (Security)
        safe_pdf = sanitize_and_compress_pdf(pdf_bytes)
        
        # 2. Extract
        import fitz
        doc = fitz.open(stream=safe_pdf, filetype="pdf")
        images = []
        
        for i in range(len(doc)):
            for img in doc.get_page_images(i):
                xref = img[0]
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                
                # Convert to base64
                b64 = base64.b64encode(image_bytes).decode("utf-8")
                mime = base_image["ext"]
                images.append(f"data:image/{mime};base64,{b64}")
                
                if len(images) > 50: break # Safety limit
            if len(images) > 50: break
            
        return {"status": "success", "images": images, "count": len(images)}
    except Exception as e:
        return {"status": "error", "detail": f"Extraction error: {e}"}

from fastapi.staticfiles import StaticFiles
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_root():
    from fastapi.responses import FileResponse
    return FileResponse("static/index.html")
