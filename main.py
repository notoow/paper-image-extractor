
import os
import shutil
import base64
import asyncio
import logging
import json
import hashlib
import time
import re
from typing import List, Dict, Optional
from collections import Counter, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Form, Request, status, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.exception_handlers import http_exception_handler
from fastapi.staticfiles import StaticFiles

from pydantic import BaseModel, Field, field_validator


import fitz  # PyMuPDF
from supabase import create_client, Client
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from utils import sanitize_and_compress_pdf, get_pdf_from_scihub_advanced

# --- 1. CONFIGURATION & SECRETS (Secret Management) ---
# --- 1. CONFIGURATION & SECRETS (Secret Management) ---
class Settings:
    def __init__(self):
        self.supabase_url = os.getenv("SUPABASE_URL")
        self.supabase_key = os.getenv("SUPABASE_KEY")
        # Security: CORS & Host defaults
        self.allowed_hosts = ["*"]  # Allow all for HF Spaces / Cloud
        self.allowed_origins = ["*"] # Adjust in production!
        self.current_env = os.getenv("CURRENT_ENV", "production")

settings = Settings()

from fastapi.exceptions import RequestValidationError # Import this

# Setup Logging (Stdout for Cloud Logs)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()] # Output to console
)
logger = logging.getLogger("security_audit")

# Initialize Supabase
supabase: Optional[Client] = None
if settings.supabase_url and settings.supabase_key:
    try:
        supabase = create_client(settings.supabase_url, settings.supabase_key)
        logger.info("Supabase connected.")
    except Exception as e:
        logger.error(f"Supabase init failed: {e}")
        print(f"Supabase Init Error: {e}")
else:
    logger.warning("Supabase credentials missing.")

# --- 2. VOTE MANAGER (IP-Based Deduplication / Anti-Abuse) ---
class VoteManager:
    def __init__(self, filename="votes.json"):
        self.filename = filename
        self.votes = self._load() # Structure: { "image_id_str": ["hash_ip1", "hash_ip2"] }

    def _load(self):
        if os.path.exists(self.filename):
            try:
                with open(self.filename, 'r') as f:
                    return json.load(f)
            except:
                return {}
        return {}

    def _save(self):
        try:
            with open(self.filename, 'w') as f:
                json.dump(self.votes, f)
        except Exception as e:
            logger.error(f"Vote Save Error: {e}")

    def hash_ip(self, ip: str) -> str:
        # PII Protection: Hash IP before storage
        return hashlib.sha256(ip.encode()).hexdigest()[:16]

    def has_voted(self, image_id: str, ip: str) -> bool:
        img_key = str(image_id)
        if img_key not in self.votes:
            return False
        ip_hash = self.hash_ip(ip)
        return ip_hash in self.votes[img_key]

    def register_vote(self, image_id: str, ip: str):
        img_key = str(image_id)
        ip_hash = self.hash_ip(ip)
        
        if img_key not in self.votes:
            self.votes[img_key] = []
        
        if ip_hash not in self.votes[img_key]:
            self.votes[img_key].append(ip_hash)
            self._save()
            return True
        return False

vote_manager = VoteManager()

# --- 3. INPUT VALIDATION MODELS (Pydantic) ---
class DoiRequest(BaseModel):
    doi: str

    @field_validator('doi')
    def validate_doi(cls, v):
        v = v.strip()
        if not v:
            raise ValueError('DOI cannot be empty')
        # Strip common DOI URL prefixes (normalize)
        for prefix in ['https://doi.org/', 'http://doi.org/', 'https://dx.doi.org/', 'http://dx.doi.org/', 'doi.org/', 'dx.doi.org/', 'doi:']:
            if v.lower().startswith(prefix):
                v = v[len(prefix):]
                break
        # Basic sanity check: should contain at least one '/' for DOI format
        # But be permissive - let Sci-Hub decide if it's valid
        return v

class VoteRequest(BaseModel):
    id: int # or str depending on DB, assumed int

# --- 4. LIFESPAN & SCHEDULER ---
scheduler = AsyncIOScheduler()

async def cleanup_old_data():
    """Janitor: High Watermark Strategy."""
    if not supabase: return
    try:
        count_res = supabase.table("chats").select("id", count="exact", head=True).execute()
        current_count = count_res.count
        limit = 500000
        shrink_target = 250000
        
        if current_count > limit:
            logger.info("Janitor running cleanup")
            res = supabase.table("chats").select("id").order("id", desc=True).range(shrink_target, shrink_target).limit(1).execute()
            if res.data:
                cutoff_id = res.data[0]['id']
                supabase.table("chats").delete().lt("id", cutoff_id).execute()
    except Exception as e:
        logger.error(f"Janitor Error: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    scheduler.add_job(cleanup_old_data, 'interval', minutes=10)
    scheduler.start()
    yield
    # Shutdown
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan, 
              docs_url=None if settings.current_env == "production" else "/docs",  # Hide docs in prod
              redoc_url=None)

# --- 5. MIDDLEWARE: SECURITY HEADERS & RATE LIMIT ---
# Security Headers (HSTS, CSP, Frames, No-Sniff)
# TrustedHostMiddleware removed to prevent HF Space connectivity issues
# @app.middleware("http")
# async def add_security_headers(request: Request, call_next):
#     try:
#         response = await call_next(request)
#         # response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
#         response.headers["X-Content-Type-Options"] = "nosniff"
#         response.headers["X-Frame-Options"] = "DENY" # Prevent Clickjacking
#         response.headers["X-XSS-Protection"] = "1; mode=block"
#         # CSP: Strict rules. Allow scripts from 'self', fontawesome, and specific CDNs safely.
#         response.headers["Content-Security-Policy"] = (
#             "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;"
#             #"default-src 'self'; "
#             #"img-src 'self' data: https://flagcdn.com https://*.supabase.co blob:; "
#             #"script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
#             #"style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; "
#             #"font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com; "
#             #"connect-src 'self' https://ipapi.co https://*.supabase.co wss: ws:;"
#         )
#         return response
#     except Exception as e:
#         # Fallback error response
#         logger.error(f"Middleware Error: {e}")
#         return JSONResponse({"status": "error", "detail": "Internal Server Error"}, status_code=500)

# Rate Limiting
RATE_LIMIT_DATA = {}
RATE_LIMIT_WINDOW = 60 # 1 minute
RATE_LIMIT_MAX_REQUESTS = 60 # Increased slightly for UX

# @app.middleware("http")
# async def rate_limit_middleware(request: Request, call_next):
#     if request.url.path.startswith("/api/"):
#         forwarded = request.headers.get("X-Forwarded-For")
#         client_ip = forwarded.split(",")[0] if forwarded else request.client.host
#         now = time.time()
        
#         if client_ip not in RATE_LIMIT_DATA:
#             RATE_LIMIT_DATA[client_ip] = []
        
#         # Filter old requests
#         history = [t for t in RATE_LIMIT_DATA[client_ip] if now - t < RATE_LIMIT_WINDOW]
#         RATE_LIMIT_DATA[client_ip] = history
        
#         if len(history) >= RATE_LIMIT_MAX_REQUESTS:
#              logger.warning(f"Rate Limit Exceeded: {client_ip}")
#              return JSONResponse(
#                  status_code=status.HTTP_429_TOO_MANY_REQUESTS,
#                  content={"status": "error", "detail": "Too many requests. Please wait."}
#              )
#         RATE_LIMIT_DATA[client_ip].append(now)

#     return await call_next(request)

# Trusted Host (Prevents Host Header Poisoning)
# app.add_middleware(
#     TrustedHostMiddleware, 
#     allowed_hosts=settings.allowed_hosts
# )

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Explicitly wildcard
    allow_credentials=False, # Must be False when using wildcard origins
    allow_methods=["*"], # Allow all methods (including OPTIONS)
    allow_headers=["*"],
)

# --- 6. ERROR HANDLERS (No Information Leakage) ---
@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={"status": "error", "detail": exc.detail},
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    logger.error(f"Validation Error: {exc} - Body: {exc.body}")
    # User-friendly message
    return JSONResponse(
        status_code=422,
        content={"status": "error", "detail": "Invalid input. Please check your DOI format and try again."},
    )

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Global Error: {exc} - URL: {request.url}")
    # Don't show stack trace to user
    return JSONResponse(
        status_code=500,
        content={"status": "error", "detail": "An unexpected server error occurred."},
    )


# --- 7. WEBSOCKET MANAGER ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.connection_countries: Dict[WebSocket, str] = {}
        self.chat_history = deque(maxlen=50) 
        self.leaderboard_cache = [] 
        
        if supabase:
            self._load_data_from_supabase()

    def _load_data_from_supabase(self):
        try:
            response = supabase.table("chats").select("*").order("created_at", desc=True).limit(50).execute()
            for row in reversed(response.data):
                self.chat_history.append({
                    "country": row.get("country", "Unknown"),
                    "msg": row.get("msg", ""), # Sanitize on render
                    "type": "chat"
                })
            self._update_leaderboard_cache()
        except Exception:
            pass

    def _update_leaderboard_cache(self):
        try:
            if not supabase: return
            res = supabase.table("leaderboard").select("*").order("score", desc=True).limit(50).execute()
            self.leaderboard_cache = [
                {
                    "country": row.get("country"),
                    "score": row.get("score", 0),
                    "chats": row.get("chat_count", 0)
                }
                for row in res.data
            ]
        except Exception:
            pass

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_countries[websocket] = "Unknown"
        # Validate message sizes? handled by FastAPI default buffer limits usually
        
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

    async def set_country(self, websocket: WebSocket, country: str):
        if websocket not in self.connection_countries: return
        # Basic validation of country code
        if not re.match(r'^[A-Z]{2}$', country) and country != "UNKNOWN":
            return # Ignore invalid country codes
        
        if self.connection_countries[websocket] != country:
            self.connection_countries[websocket] = country
            await self.broadcast_online_count()

    async def broadcast_online_count(self):
        dist = Counter(self.connection_countries.values())
        dist_str = ", ".join([f"{k}: {v}" for k, v in dist.items() if k != "Unknown"])
        if not dist_str: dist_str = "Unknown"
        await self.broadcast_internal({ "type": "online_count",  "count": len(self.active_connections), "distribution": dist_str })

    def _update_cache_optimistically(self, country, score_inc=0, chat_inc=0):
        found = False
        for item in self.leaderboard_cache:
            if item["country"] == country:
                item["score"] += score_inc
                item["chats"] += chat_inc
                found = True
                break
        if not found:
            self.leaderboard_cache.append({ "country": country, "score": score_inc, "chats": chat_inc })
        self.leaderboard_cache.sort(key=lambda x: x["score"], reverse=True)

    async def broadcast(self, message: dict):
        await self.broadcast_internal(message)
        if supabase:
            await run_in_threadpool(self._persist_message, message)

    async def broadcast_internal(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

    def _persist_message(self, message: dict):
        try:
            msg_type = message.get("type")
            country = message.get("country", "Unknown")
            
            if msg_type == "chat":
                msg = message.get("msg")
                if len(msg) > 500: msg = msg[:500] # Truncate long messages
                supabase.table("chats").insert({"country": country, "msg": msg}).execute()
                self._upsert_stats(country, chat_inc=1)
                self.chat_history.append(message)

            elif msg_type == "update_score":
                self._upsert_stats(country, score_inc=1)
                
            self._update_leaderboard_cache()
        except Exception as e:
            logger.error(f"Persist Error: {e}")

    def _upsert_stats(self, country, score_inc=0, chat_inc=0):
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

# --- 8. ROUTES ---

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    last_msg_time = 0
    msg_burst_count = 0
    burst_window_start = time.time()
    
    try:
        while True:
            data = await websocket.receive_json()
            now = time.time()
            
            # Rate Limit (WebSocket)
            if now - last_msg_time < 0.2: continue # 200ms debounce
            if now - burst_window_start > 5.0:
                msg_burst_count = 0
                burst_window_start = now
            msg_burst_count += 1
            if msg_burst_count > 10:
                await websocket.send_json({"type": "chat", "country": "System", "msg": "🛑 Slow down!"})
                continue
            last_msg_time = now
            
            # Input Sanitization
            msg_type = data.get("type", "chat")
            country = data.get("country", "UNKNOWN")
            
            if country and len(country) <= 3 and country != "UNKNOWN":
                await manager.set_country(websocket, country)
            
            if msg_type == "chat":
                msg = str(data.get("msg", "")).strip()
                if msg:
                    # Basic Content Filter? (Optional)
                    manager._update_cache_optimistically(country, chat_inc=1)
                    await manager.broadcast({
                        "type": "chat",
                        "country": country,
                        "msg": msg[:300], # Max 300 chars
                        "leaderboard": manager.leaderboard_cache
                    })
            elif msg_type == "score":
                manager._update_cache_optimistically(country, score_inc=1)
                await manager.broadcast({
                    "type": "update_score",
                    "country": country,
                    "leaderboard": manager.leaderboard_cache
                })

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast_online_count()
    except Exception as e:
        logger.error(f"WS Error: {e}")
        try:
             await websocket.close()
        except: pass

@app.post("/api/process")
async def process_doi(req: DoiRequest): # Validated by Pydantic
    try:
        logger.info(f"Processing DOI: {req.doi}") # Audit
        logger.info("Starting Sci-Hub download...")
        pdf_bytes, result_msg = await run_in_threadpool(get_pdf_from_scihub_advanced, req.doi)
        logger.info(f"Download Finished. Result: {result_msg[:50]}...")
        
        if not pdf_bytes:
             logger.warning(f"PDF Not Found: {req.doi}")
             raise HTTPException(status_code=404, detail=result_msg)
        
        logger.info(f"PDF Downloaded ({len(pdf_bytes)} bytes). Starting extraction...")
        result = await run_in_threadpool(extract_from_bytes, pdf_bytes)
        logger.info(f"Extraction Finished. Status: {result.get('status')}")
        
        if result["status"] == "success":
            result["doi"] = req.doi
            result["pdf_base64"] = base64.b64encode(pdf_bytes).decode('utf-8')
            return result
        else:
            raise HTTPException(status_code=400, detail=result.get("detail", "Processing failed"))

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Process Error: {e}")
        raise HTTPException(status_code=500, detail="Processing error")

@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    # Validate Extension
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files allowed")
    
    # Validate MIME type
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Invalid Content-Type")

    try:
        contents = await file.read()
        # Size limit check? (FastAPI limits strictly config based, but explicit check good)
        if len(contents) > 300 * 1024 * 1024: # 300MB
             raise HTTPException(status_code=413, detail="File too large (Max 300MB)")

        result = await run_in_threadpool(extract_from_bytes, contents)
        return result
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Upload Error: {e}")
        raise HTTPException(status_code=500, detail="Server error")

@app.post("/api/like")
async def like_image(
    request: Request,
    file: UploadFile = File(...),
    doi: str = Form(...),
    country: str = Form("Unknown")
):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")

    forwarded = request.headers.get("X-Forwarded-For")
    client_ip = forwarded.split(",")[0] if forwarded else request.client.host

    try:
        # Validate File
        if not file.content_type.startswith("image/"):
             raise HTTPException(status_code=400, detail="Invalid image file")

        content = await file.read()
        import hashlib
        img_hash = hashlib.sha256(content).hexdigest()
        
        # Check DB
        res = supabase.table("images").select("*").eq("image_hash", img_hash).execute()
        
        if res.data:
            row_id = res.data[0]['id']
            if vote_manager.has_voted(row_id, client_ip):
                 # Return success state but normalized to act like nothing happened
                 return {"status": "success", "msg": "Already in Hall of Fame!", "likes": res.data[0]['likes'], "id": row_id}

            new_likes = res.data[0]['likes'] + 1
            supabase.table("images").update({ "likes": new_likes, "created_at": "now()" }).eq("id", row_id).execute()
            vote_manager.register_vote(row_id, client_ip)
            logger.info(f"Image Liked (Bump): {row_id} by {client_ip}") # Audit
            return {"status": "success", "msg": "Image bumped up!", "likes": new_likes, "id": row_id}
        
        else:
            # Check Limits (50)
            count_res = supabase.table("images").select("id", count="exact").execute()
            current_count = count_res.count if count_res.count is not None else len(count_res.data)

            if current_count >= 50:
                oldest_res = supabase.table("images").select("id", "storage_path").order("created_at", desc=False).limit(1).execute()
                if oldest_res.data:
                    old_node = oldest_res.data[0]
                    try: supabase.storage.from_("paper_images").remove([old_node['storage_path']])
                    except: pass
                    supabase.table("images").delete().eq("id", old_node['id']).execute()

            # Upload
            file_ext = file.filename.split('.')[-1].lower() if '.' in file.filename else "png"
            if file_ext not in ['png', 'jpg', 'jpeg', 'gif', 'webp']: file_ext = 'png' # Whitelist
            storage_path = f"{img_hash}.{file_ext}" # Predictable, collision-safe name? Uses hash, so yes.
            
            supabase.storage.from_("paper_images").upload(
                path=storage_path,
                file=content,
                file_options={"content-type": file.content_type}
            )
            
            res = supabase.table("images").insert({
                "doi": doi[:200], # Length Limit
                "image_hash": img_hash,
                "storage_path": storage_path,
                "country": country[:10],
                "likes": 1
            }).execute()
            
            new_id = res.data[0]['id'] if res.data else None
            if new_id:
                vote_manager.register_vote(new_id, client_ip)
                logger.info(f"Image Uploaded: {new_id} by {client_ip}")

            return {"status": "success", "msg": "Image saved to Hall of Fame", "id": new_id, "likes": 1}

    except Exception as e:
        logger.error(f"Like Error: {e}")
        raise HTTPException(status_code=500, detail="Internal Error")

@app.post("/api/vote")
async def vote_image(request: Request, vote: VoteRequest): # Pydantic Modeled
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")

    forwarded = request.headers.get("X-Forwarded-For")
    client_ip = forwarded.split(",")[0] if forwarded else request.client.host
    
    if vote_manager.has_voted(vote.id, client_ip):
         raise HTTPException(status_code=403, detail="Duplicate vote")
    
    try:
        res = supabase.table("images").select("likes").eq("id", vote.id).execute()
        if res.data:
            new_likes = res.data[0]['likes'] + 1
            supabase.table("images").update({"likes": new_likes}).eq("id", vote.id).execute()
            vote_manager.register_vote(vote.id, client_ip)
            logger.info(f"Vote Cast: {vote.id} by {client_ip}")
            return {"status": "success", "likes": new_likes}
        
        raise HTTPException(status_code=404, detail="Image not found")
    except HTTPException as e: raise e
    except Exception as e:
        logger.error(f"Vote Error: {e}")
        raise HTTPException(status_code=500, detail="Server Error")

@app.get("/api/trending")
async def get_trending(period: str = "all"):
    if period not in ["all", "year", "month", "week"]: period = "all" # Validation

    if not supabase:
        return {"status": "error", "images": []}
        
    try:
        query = supabase.table("images").select("id, likes, storage_path, created_at, width, height, doi").order("likes", desc=True).limit(50)
        import datetime
        now = datetime.datetime.utcnow()
        if period == "week": query = query.gte("created_at", (now - datetime.timedelta(days=7)).isoformat())
        elif period == "month": query = query.gte("created_at", (now - datetime.timedelta(days=30)).isoformat())
        elif period == "year": query = query.gte("created_at", (now - datetime.timedelta(days=365)).isoformat())
            
        res = query.execute()
        images = []
        for row in res.data:
            # No path traversal possibility here as it comes from DB
            row['url'] = f"{settings.supabase_url}/storage/v1/object/public/paper_images/{row['storage_path']}"
            # Ensure DOI is passed
            if 'doi' not in row: row['doi'] = ""
            images.append(row)
        return {"status": "success", "images": images}
    except Exception as e:
        logger.error(f"Trending Error: {e}")
        return {"status": "error", "images": []}

# Logic Extractor
def extract_from_bytes(pdf_bytes):
    try:
        safe_pdf = sanitize_and_compress_pdf(pdf_bytes)
        doc = fitz.open(stream=safe_pdf, filetype="pdf")
        images = []
        for i in range(len(doc)):
            if len(images) > 50: break
            for img in doc.get_page_images(i):
                if len(images) > 50: break
                try:
                    xref = img[0]
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image["image"]
                    b64 = base64.b64encode(image_bytes).decode("utf-8")
                    mime = base_image["ext"]
                    if mime.lower() not in ['png', 'jpeg', 'jpg', 'gif', 'webp']: continue # Mime Whitelist
                    
                    images.append({
                        "base64": f"data:image/{mime};base64,{b64}",
                        "width": base_image["width"],
                        "height": base_image["height"],
                        "size": len(image_bytes),
                        "ext": mime
                    })
                except: continue
        return {"status": "success", "images": images, "count": len(images)}
    except Exception as e:
        return {"status": "error", "detail": "Extraction failed"}

# Static Files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_root():
    from fastapi.responses import FileResponse
    return FileResponse("static/index.html")
