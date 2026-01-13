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

# --- WebSocket & Chat Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.leaderboard: Dict[str, int] = {} 

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Send current leaderboard on connect
        await websocket.send_json({"type": "init", "leaderboard": self.leaderboard})

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass
                
    def update_score(self, country: str):
        if not country: return
        self.leaderboard[country] = self.leaderboard.get(country, 0) + 1

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

app.mount("/", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=7860, reload=True)
