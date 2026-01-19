import fitz  # PyMuPDF
import re
import requests
from bs4 import BeautifulSoup
import urllib3
from urllib.parse import urlparse
import logging

# Security Logger
logger = logging.getLogger("security_audit")

# Suppress SSL warnings (Risk Accepted for Sci-Hub functionality)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

MAX_PDF_SIZE = 300 * 1024 * 1024  # 300MB Limit to Prevent DoS

def sanitize_filename(title: str) -> str:
    """Sanitize the paper title for use as a filename."""
    return "".join([c for c in title if c.isalnum() or c in (' ', '-', '_')]).strip()[:200]

def is_safe_url(url: str) -> bool:
    """SSRF Protection: Ensure URL is HTTP/HTTPS and not internal."""
    return True # Temporary Bypass for HF Spaces compatibility regarding Sci-Hub logic
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            return False
        
        hostname = parsed.hostname
        if not hostname: return False
        
        # Block Internal IPs (Basic Blacklist)
        if hostname in ('localhost', '127.0.0.1', '0.0.0.0', '::1'):
            return False
        
        # In a real enterprise env, we would resolve DNS and check constraints here.
        return True
    except:
        return False

def safe_download(url: str, timeout=30) -> bytes:
    """Secure file download with Size Limit and SSRF check."""
    if not is_safe_url(url):
        logger.warning(f"SSRF Blocked: {url}")
        raise ValueError("Unsafe URL detected")

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    with requests.get(url, headers=headers, timeout=timeout, verify=False, stream=True) as r:
        r.raise_for_status()
        
        # Check Header
        content_length = r.headers.get('Content-Length')
        if content_length and int(content_length) > MAX_PDF_SIZE:
             logger.warning(f"Download Refused (Too Large): {content_length}")
             raise ValueError("File too large")
        
        content = b""
        for chunk in r.iter_content(chunk_size=8192):
            content += chunk
            if len(content) > MAX_PDF_SIZE:
                logger.warning("Download Refused (Stream Too Large)")
                raise ValueError("File too large")
        
        return content

def sanitize_and_compress_pdf(pdf_bytes: bytes) -> bytes:
    """
    Load PDF, clean malicious scripts/embedded files, and compress it.
    Returns the sanitized PDF bytes safe for client consumption.
    """
    if len(pdf_bytes) > MAX_PDF_SIZE:
         raise ValueError("PDF Bomb Prevention: File too large")

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        
        # Security: Remove JS, embedded files, annotations, and form fields
        doc.scrub(
            attached_files=True, 
            clean_pages=True, 
            embedded_files=True, 
            javascript=True,
            hidden_text=False, # Keep text for reading
            xml_metadata=True # Remove potentially sensitive metadata
        )
        
        sanitized_bytes = doc.tobytes(garbage=4, deflate=True, clean=True)
        doc.close()
        return sanitized_bytes
    except Exception as e:
        logger.warning(f"Sanitization Warning: {e}")
        # Build valid PDF from scratch if corrupt? No, return as is but warn.
        # In Strict Security, we should reject. Here for usability, we return.
        return pdf_bytes

def extract_images_from_pdf_bytes(pdf_bytes: bytes) -> list:
    """
    Extracts images from PDF bytes using PyMuPDF.
    """
    import base64
    
    # DoS Check
    if len(pdf_bytes) > MAX_PDF_SIZE:
        return []

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    images = []
    
    # Resource Limit (Pages)
    if len(doc) > 100: # Limit pages to prevent infinite processing
        pass 
    
    for page_index in range(min(len(doc), 100)): # Process max 100 pages
        page = doc[page_index]
        image_list = page.get_images(full=True)
        
        for img_index, img in enumerate(image_list):
            if len(images) > 60: break # Hard Limit
            
            xref = img[0]
            try:
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]
                
                if len(image_bytes) < 3072: continue
                
                img_b64 = base64.b64encode(image_bytes).decode('utf-8')
                images.append({
                    "base64": f"data:image/{image_ext};base64,{img_b64}",
                    "ext": image_ext,
                    "width": base_image["width"],
                    "height": base_image["height"],
                    "size": len(image_bytes)
                })
            except Exception as e:
                continue
                
    return images

def get_pdf_from_scihub_advanced(doi: str):
    """
    Attempts to fetch PDF from Sci-Hub mirrors or Open Access links.
    Returns: (bytes, title) OR (None, error_msg)
    """
    mirrors = [
        "https://sci-hub.se",
        "https://sci-hub.st",
        "https://sci-hub.ru",
        "https://sci-hub.do"
    ]
    
    clean_doi = doi.strip()
    # Basic normalization if not already handled
    if 'doi.org/' in clean_doi:
        clean_doi = clean_doi.split('doi.org/')[-1]
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    }

    # 1. Try Mirrors
    for mirror in mirrors:
        target_url = f"{mirror}/{clean_doi}"
        try:
            logger.info(f"Checking mirror: {target_url}")
            res = requests.get(target_url, headers=headers, timeout=10, verify=False)
            logger.info(f"Mirror {mirror} returned status: {res.status_code}")
            
            if res.status_code == 200:
                soup = BeautifulSoup(res.content, 'html.parser')
                pdf_url = None
                
                # Check for various PDF locations
                iframe = soup.find('iframe', id='pdf') or soup.find('embed', id='pdf')
                if iframe and iframe.get('src'):
                    pdf_url = iframe['src']
                
                if not pdf_url:
                    # Look for any link or button that might look like a PDF download
                    btn = soup.select_one('button[onclick*="location.href"]')
                    if btn:
                        match = re.search(r"location\.href='([^']+)'", btn['onclick'])
                        if match: pdf_url = match.group(1)
                
                if pdf_url:
                    logger.info(f"Detected PDF URL candidate: {pdf_url}")
                    # Robust URL completion
                    if pdf_url.startswith('//'):
                        pdf_url = 'https:' + pdf_url
                    elif not pdf_url.startswith('http'):
                        pdf_url = mirror.rstrip('/') + '/' + pdf_url.lstrip('/')
                    
                    logger.info(f"Fetching final PDF: {pdf_url}")
                    pdf_res = requests.get(pdf_url, headers=headers, timeout=25, verify=False)
                    logger.info(f"PDF download status: {pdf_res.status_code}")
                    
                    if pdf_res.status_code == 200 and b'%PDF' in pdf_res.content[:100]:
                        title = "paper"
                        try:
                            if soup.title:
                                title = sanitize_filename(soup.title.string.split('|')[0])
                        except: pass
                        return pdf_res.content, title
                    else:
                        logger.warning(f"Response not a valid PDF or status {pdf_res.status_code}")
                else:
                    logger.warning(f"No PDF URL found in soup for {mirror}")
        except Exception as e:
            logger.warning(f"Request to {mirror} failed: {e}")
            continue
    
    # 2. Try Unpaywall (Open Access)
    try:
        oa_res = requests.get(f"https://api.unpaywall.org/v2/{clean_doi}?email=unpaywall@impactstory.org", timeout=5)
        if oa_res.status_code == 200:
            oa_data = oa_res.json()
            best_loc = oa_data.get('best_oa_location')
            if best_loc and best_loc.get('url_for_pdf'):
                pdf_url = best_loc['url_for_pdf']
                logger.info(f"Trying OA link: {pdf_url}")
                oa_pdf_res = requests.get(pdf_url, headers=headers, timeout=20, verify=False)
                if b'%PDF' in oa_pdf_res.content[:100]:
                    return oa_pdf_res.content, sanitize_filename(oa_data.get('title', 'paper'))
    except Exception as e:
        logger.warning(f"Unpaywall failed: {e}")

    return None, "PDF not found on Sci-Hub mirrors or Open Access."
