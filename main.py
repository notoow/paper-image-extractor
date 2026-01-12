from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn
import os

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

# Data Models
class DoiRequest(BaseModel):
    doi: str

# --- Routes (KISS: Only Routing Logic) ---

@app.post("/api/process")
async def process_doi(request: DoiRequest):
    print(f"Processing DOI: {request.doi}")
    
    # get_pdf_from_scihub_advanced returns: 
    # (pdf_bytes, title) for success 
    # (None, url) for manual link
    # (None, error_msg) for failure
    result, info = get_pdf_from_scihub_advanced(request.doi)
    
    # Case 1: Success (PDF bytes received)
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
            
    # Case 2: Manual Link (URL received)
    if info and info.startswith('http'):
        return {
            "status": "manual_link",
            "doi": request.doi,
            "pdf_url": info,
            "message": "Server blocked. Please download manually."
        }
    
    # Case 3: Error
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

# Frontend Routes
@app.get("/")
async def read_index():
    # Cache-busting hack: serve home.html instead of index.html
    # Check if home.html exists (it was created earlier), if not fallback to index.html
    if os.path.exists("static/home.html"):
        return FileResponse('static/home.html')
    return FileResponse('static/index.html')

app.mount("/", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=7860, reload=True)
