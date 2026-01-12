from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import os
import requests
from bs4 import BeautifulSoup
from img_extractor import extract_images_from_pdf_bytes

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("static", exist_ok=True)

class DoiRequest(BaseModel):
    doi: str

def get_pdf_from_scihub_advanced(doi):
    """
    Advanced Sci-Hub fetcher with better headers and mirror rotation.
    Inspired by 'scidownl' and 'scihub.py' libraries.
    """
    doi = doi.strip()
    
    # Pre-cleaning
    if 'doi.org' in doi:
        doi = doi.split('doi.org/')[-1]
    if 'doi:' in doi.lower():
        doi = doi.lower().split('doi:')[-1].strip()
    doi = doi.strip()
        
    mirrors = [
        "https://sci-hub.se",
        "https://sci-hub.st",
        "https://sci-hub.ru",
        "https://sci-hub.ee",
        "https://sci-hub.ren",
        "https://sci-hub.yncjkj.com",
        "https://sci-hub.mksa.top",
        "https://sci-hub.now.sh"
    ]
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
    }

    for mirror in mirrors:
        try:
            target_url = f"{mirror}/{doi}"
            print(f"Trying mirror: {target_url}")
            
            # Phase 1: Get the Page
            try:
                # verify=False is crucial for some blocked/bad-cert mirrors
                res = requests.get(target_url, headers=headers, timeout=15, verify=False)
            except:
                continue
                
            if res.status_code != 200:
                continue
                
            soup = BeautifulSoup(res.text, 'html.parser')
            pdf_url = None
            
            # Logic 1: Iframe
            iframe = soup.find('iframe', {'id': 'pdf'})
            if iframe: pdf_url = iframe.get('src')
            
            # Logic 2: Embed
            if not pdf_url:
                embed = soup.find('embed', {'type': 'application/pdf'})
                if embed: pdf_url = embed.get('src')

            # Logic 3: Object
            if not pdf_url:
                obj = soup.find('object', {'type': 'application/pdf'})
                if obj: pdf_url = obj.get('data')
                
            # Logic 4: Button click (location.href)
            if not pdf_url:
                # Look for the exact button onclick pattern
                # onclick="location.href='...'"
                for btn in soup.find_all('button'):
                    onclick = btn.get('onclick', '')
                    if 'location.href' in onclick:
                        # Extract between single quotes
                        parts = onclick.split("'")
                        for part in parts:
                            if '//' in part or '.pdf' in part:
                                pdf_url = part
                                break
            
            # Logic 5: Download div with link
            if not pdf_url:
                div = soup.find('div', {'id': 'buttons'})
                if div:
                    # check for simple buttons/links inside
                    link = div.find('a', href=True)
                    if link: 
                        onclick = link.get('onclick') # sometimes link has onclick logic too
                        pdf_url = link.get('href')

            if not pdf_url:
                # Last resort: find any link ending in .pdf?? (Risky but helpful)
                pass

            if pdf_url:
                # Fix URL format
                if pdf_url.startswith('//'):
                    pdf_url = 'https:' + pdf_url
                elif pdf_url.startswith('/'):
                    pdf_url = mirror + pdf_url
                
                # Phase 2: Download the PDF
                print(f"Found PDF URL: {pdf_url}")
                
                # IMPORTANT: Use same headers for PDF download, referer is key
                pdf_headers = headers.copy()
                pdf_headers['Referer'] = target_url
                
                pdf_res = requests.get(pdf_url, headers=pdf_headers, timeout=30, verify=False)
                
                if pdf_res.status_code == 200:
                    # Validate PDF
                    if b'%PDF' in pdf_res.content[:20] or 'application/pdf' in pdf_res.headers.get('Content-Type', ''):
                         # Extract title if possible
                         paper_title = "paper"
                         try:
                             if soup.title and soup.title.string:
                                 paper_title = soup.title.string.split('|')[0].strip() # Clean Sci-Hub suffix
                                 # Remove invalid filename chars
                                 paper_title = "".join([c for c in paper_title if c.isalnum() or c in (' ', '-', '_')]).strip()
                         except:
                             pass
                             
                         return pdf_res.content, paper_title
        except Exception as e:
            print(f"Error on {mirror}: {e}")
            continue

    return None, "Cloud blocked or Paper not found."


@app.post("/api/process")
async def process_doi(request: DoiRequest):
    print(f"Processing DOI: {request.doi}")
    
    pdf_bytes, paper_title_or_error = get_pdf_from_scihub_advanced(request.doi)
    
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail=paper_title_or_error)
    
    try:
        images = extract_images_from_pdf_bytes(pdf_bytes)
        return {
            "status": "success",
            "doi": request.doi,
            "title": paper_title_or_error, # Return the title
            "filename": f"{paper_title_or_error}.pdf",
            "image_count": len(images),
            "images": images
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract images: {str(e)}")

app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=7860, reload=True)
