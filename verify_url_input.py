from scihub_api import SciHub

def verify_full_url_input():
    # User input scenario: Full URL
    input_doi = "https://doi.org/10.1111/j.1468-3083.2008.02677.x"
    print(f"Testing with input: '{input_doi}'")
    
    sh = SciHub()
    # The cleaning logic happens inside fetch_pdf now
    pdf_bytes, filename = sh.fetch_pdf(input_doi)
    
    if pdf_bytes:
        print(f"SUCCESS! Downloaded PDF: {filename} ({len(pdf_bytes)} bytes)")
    else:
        print(f"FAIL: {filename}")

if __name__ == "__main__":
    verify_full_url_input()
