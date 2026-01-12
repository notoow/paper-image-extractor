import fitz  # PyMuPDF
import io
import base64

def extract_images_from_pdf_bytes(pdf_bytes):
    """
    Extracts images from PDF bytes.
    Returns a list of dictionaries: [{'page': int, 'index': int, 'base64': str, 'ext': str}]
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    images_data = []

    for page_index in range(len(doc)):
        page = doc[page_index]
        image_list = page.get_images()

        if image_list:
            for img_index, img in enumerate(image_list):
                xref = img[0]
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]
                
                # Convert to base64 for frontend display
                img_base64 = base64.b64encode(image_bytes).decode('utf-8')
                
                images_data.append({
                    "page": page_index + 1,
                    "index": img_index,
                    "base64": f"data:image/{image_ext};base64,{img_base64}",
                    "ext": image_ext,
                    "width": base_image.get("width"),
                    "height": base_image.get("height")
                })
    
    return images_data
