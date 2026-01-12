from scihub_api import SciHub
import os

def test_extraction():
    doi = "10.1111/j.1468-3083.2008.02677.x"
    print(f"Testing extraction for DOI: {doi}")
    
    sh = SciHub()
    pdf_bytes, filename = sh.fetch_pdf(doi)
    
    if pdf_bytes:
        print(f"SUCCESS: PDF downloaded ({len(pdf_bytes)} bytes)")
        print(f"Filename: {filename}")
        
        # Verify it's a valid PDF by magic number
        if pdf_bytes.startswith(b'%PDF'):
            print("Verified valid PDF signature.")
        else:
            print("WARNING: Content does NOT look like a PDF.")
            print(f"First 100 bytes: {pdf_bytes[:100]}")
    else:
        print(f"FAILURE: {filename}")

if __name__ == "__main__":
    test_extraction()
