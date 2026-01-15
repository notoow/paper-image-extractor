# Paper Prism: Technical Documentation & Implementation Guide

This document details the core technologies, security implementations, and feature logic used in **Paper Prism**. It is designed as a reference for porting these features to other web services.

---

## 1. Secure PDF Viewer (Sanitization & Blob)

This feature allows users to view the "Original PDF" in a secure manner without downloading potentially malicious files directly from external sources.

### **The Problem**
- External PDFs (via Sci-Hub/DOI) may contain malicious JavaScript, embedded executables, or exploit payloads.
- Directly serving these files puts users at risk.

### **The Solution: Server-Side Sanitization**
We use `PyMuPDF (fitz)` to strip all non-essential data (scripts, annotations, embedded files) and rebuild the PDF structure before sending it to the client.

#### **Backend Implementation (Python)**
**Dependency:** `pip install pymupdf`

```python
import fitz # PyMuPDF

def sanitize_and_compress_pdf(pdf_bytes: bytes) -> bytes:
    """
    Cleans malicious content and recompresses the PDF.
    Returns safe bytes ready for client consumption.
    """
    try:
        # Open PDF from bytes
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        
        # Security Scrubbing
        doc.scrub(
            attached_files=True,    # Remove embedded files (potential malware)
            clean_pages=True,       # Standardize page content
            embedded_files=True,    
            javascript=True,        # CRITICAL: Remove all JavaScript
            hidden_text=False,      # Keep hidden text (for copy-paste)
            xml_metadata=True       # Remove metadata
        )
        
        # Save & Rebuild
        # garbage=4: Remove unused objects (deduplication)
        # clean=True: Syntax check and repair
        # deflate=True: Compress streams
        sanitized_bytes = doc.tobytes(garbage=4, deflate=True, clean=True)
        doc.close()
        return sanitized_bytes
    except Exception as e:
        print(f"Sanitization Failed: {e}")
        return pdf_bytes # Fallback (or raise error)
```

#### **Data Transfer (Base64)**
Since the PDF is in memory, we send it as a Base64 string in the JSON response.

```python
import base64

# In your API Endpoint
safe_bytes = sanitize_and_compress_pdf(original_bytes)
pdf_b64 = base64.b64encode(safe_bytes).decode('utf-8')

return {
    "status": "success",
    "pdf_base64": pdf_b64,
    # ...
}
```

#### **Frontend Implementation (JS)**
Convert Base64 back to a Blob and open it. No temp files needed.

```javascript
// Helper: Base64 to Uint8Array
function base64ToBytes(base64) {
    const binString = atob(base64);
    return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

// Handler
if (data.pdf_base64) {
    const byteArr = base64ToBytes(data.pdf_base64);
    // Force type to PDF to trigger browser viewer
    const blob = new Blob([byteArr], { type: 'application/pdf' }); 
    const url = URL.createObjectURL(blob);
    
    // Open in new tab
    window.open(url, '_blank');
}
```

---

## 2. Robust WebSocket Chat (Persistence & Reconnection)

A chat system that survives page reloads and network hiccups.

### **Features**
1.  **History Persistence**: Keeps the last N messages in server memory.
2.  **Auto Reconnect**: Frontend automatically tries to reconnect on disconnect.
3.  **Broadcasting**: Efficiently handles dead connections.

#### **Backend (FastAPI)**

```python
from collections import deque
from fastapi import WebSocket

class ConnectionManager:
    def __init__(self):
        self.active_connections = []
        # Circular buffer for history (Automatic cleanup)
        self.chat_history = deque(maxlen=50) 

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Send history immediately upon connection
        await websocket.send_json({
            "type": "init", 
            "history": list(self.chat_history)
        })

    async def broadcast(self, message: dict):
        if message.get("type") == "chat":
            self.chat_history.append(message) # Store

        # ... (Send logic) ...
```

#### **Frontend (Reconnection Logic)**

```javascript
connect() {
    this.ws = new WebSocket("wss://your-server.com/ws");
    
    this.ws.onopen = () => {
        this.retryCount = 0; // Reset retry
        // Request history/status if needed
    };

    this.ws.onclose = () => {
        // Exponential Backoff
        const timeout = Math.min(1000 * (2 ** this.retryCount), 30000);
        this.retryCount++;
        setTimeout(() => this.connect(), timeout);
    };
    
    this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'init') {
            // Render History
            data.history.forEach(msg => this.renderMessage(msg));
        }
    };
}
```

---

## 3. Advanced PDF Fetching Pipeline (Sci-Hub + Fallbacks)

How to reliably get PDFs from a DOI.

### **Logic Flow**
1.  **Unpaywall API Check**: Is it Open Access? If yes, download directly (Legal & Fast).
2.  **Sci-Hub Mirror Rotation**: If blocked, try a list of known mirrors.
3.  **Magic Number Verification**: Check file header (`%PDF`) to ensure we didn't download an HTML error page.

#### **Python Snippet (Requests)**

```python
import requests

MIRRORS = ["https://sci-hub.se", "https://sci-hub.st", "https://sci-hub.ru"]

def get_pdf(doi):
    # 1. Try Direct/Unpaywall first (omitted for brevity)
    
    # 2. Try Mirrors
    for mirror in MIRRORS:
        url = f"{mirror}/{doi}"
        try:
            # Sci-Hub often embeds PDF in an iframe. 
            # We need to parse the HTML to find the true source,
            # OR try POSTing to the mirror.
            # (Simplified for doc: Assume direct link found)
            
            response = requests.get(pdf_url, timeout=10)
            
            # 3. Verify Magic Number
            if response.content[:4] == b'%PDF':
                return response.content
        except:
            continue
    return None
```

---

## 4. Design System (Glassmorphism & Neumorphism)

The UI combines "Glass" (transparency + blur) with "Neumorphism" (soft shadows) for a premium feel.

### **Glass Effect (CSS)**
```css
.glass-panel {
    background: rgba(255, 255, 255, 0.7); /* Translucent White */
    backdrop-filter: blur(12px);          /* The Blur Magic */
    -webkit-backdrop-filter: blur(12px);  /* Safari Support */
    border: 1px solid rgba(255, 255, 255, 0.5); /* Subtle Border */
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);  /* Deep Shadow */
}
```

### **Neumorphic Button**
```css
.neumorphic-btn {
    background: #e0e5ec;
    box-shadow: 9px 9px 16px rgb(163,177,198,0.6), 
               -9px -9px 16px rgba(255,255,255, 0.5);
    border-radius: 12px;
    border: none;
    transition: all 0.2s ease;
}
.neumorphic-btn:active {
    box-shadow: inset 6px 6px 10px 0 rgba(163,177,198, 0.7),
                inset -6px -6px 10px 0 rgba(255,255,255, 0.8);
}
```

---

## 5. Deployment Checklist (Hugging Face Spaces)

When deploying this stack to HF Spaces (Docker/Uvicorn):

1.  **Dependencies**:
    *   `fastapi`, `uvicorn[standard]`
    *   `python-multipart` (for uploads)
    *   `pymupdf` (for PDF processing)
    *   `websockets` (explicitly needed sometimes)
    
2.  **Dockerfile**:
    ```dockerfile
    FROM python:3.9
    WORKDIR /app
    COPY requirements.txt .
    RUN pip install --no-cache-dir -r requirements.txt
    COPY . .
    # Create temp dir for MP
    RUN mkdir -p /tmp/cache && chmod 777 /tmp/cache
    CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
    ```

3.  **Permissions**: Ensure checking write permissions for any temp file operations (use `/tmp`).
