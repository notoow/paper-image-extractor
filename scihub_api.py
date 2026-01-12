import requests
from bs4 import BeautifulSoup
import random
import time

class SciHub:
    def __init__(self):
        self.mirrors = [
            'https://sci-hub.se',
            'https://sci-hub.st',
            'https://sci-hub.ru',
            'https://sci-hub.ee',
            'https://sci-hub.ren',
            'https://sci-hub.yncjkj.com'
        ]
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }

    def _get_pdf_url(self, html_content, base_url):
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Method 1: Check for iframe
        iframe = soup.find('iframe', {'id': 'pdf'})
        if iframe and iframe.get('src'):
            src = iframe.get('src')
            if src.startswith('//'):
                return 'https:' + src
            if src.startswith('/'):
                return base_url + src
            return src

        # Method 2: Check for embed
        embed = soup.find('embed', {'type': 'application/pdf'})
        if embed and embed.get('src'):
            src = embed.get('src')
            if src.startswith('//'):
                return 'https:' + src
            if src.startswith('/'):
                return base_url + src
            return src
            
        # Method 3: Check for object tag (common in other mirrors)
        obj = soup.find('object', {'type': 'application/pdf'})
        if obj and obj.get('data'):
            src = obj.get('data')
            if src.startswith('//'):
                return 'https:' + src
            if src.startswith('/'):
                return base_url + src
            return src
            
        # Method 4: Check for download link (div class="download" -> a href)
        download_div = soup.find('div', {'class': 'download'})
        if download_div:
            link = download_div.find('a')
            if link and link.get('href'):
                src = link.get('href')
                if src.startswith('//'):
                    return 'https:' + src
                if src.startswith('/'):
                    return base_url + src
                return src

        # Method 5: specific button (onclick location.href)
        buttons = soup.find_all('button')
        for btn in buttons:
            onclick = btn.get('onclick')
            if onclick and 'location.href' in onclick:
                try:
                    start_quote = onclick.find("'")
                    end_quote = onclick.find("'", start_quote + 1)
                    if start_quote != -1 and end_quote != -1:
                        src = onclick[start_quote+1:end_quote]
                        if src.startswith('//'):
                            return 'https:' + src
                        if src.startswith('/'):
                            return base_url + src
                        return src
                except:
                    continue
        
        return None

    def fetch_pdf(self, doi):
        """
        Attempts to find and download the PDF for a given DOI.
        Returns: (pdf_content_bytes, pdf_filename) or (None, error_message)
        """
        # Clean DOI more robustly
        doi = doi.strip()
        
        # Remove common prefixes/URL parts
        if 'doi.org/' in doi:
            doi = doi.split('doi.org/')[-1]
        elif 'doi:' in doi.lower():
            doi = doi.lower().split('doi:')[-1].strip()
            
        # Ensure it starts with 10. (standard DOI prefix)
        # If the user pasted a full citation that contains a DOI, try to extract it
        if '10.' in doi and not doi.startswith('10.'):
            start_index = doi.find('10.')
            # Extract from 10. to the end, or try to be smart about spaces
            doi = doi[start_index:]
            # If there are spaces after the DOI, cut them off (simple heuristic)
            if ' ' in doi:
                doi = doi.split(' ')[0]
        
        doi = doi.strip()

        for mirror in self.mirrors:
            try:
                target_url = f"{mirror}/{doi}"
                print(f"Trying {target_url}...")
                
                # Added verify=False to handle some mirrors with bad SSL certs
                # In production, be careful, but for scraping often needed.
                response = requests.get(target_url, headers=self.headers, timeout=20, verify=False)
                
                if response.status_code != 200:
                    continue

                pdf_url = self._get_pdf_url(response.text, mirror)
                
                if not pdf_url:
                    print(f"PDF URL not found on {mirror}")
                    continue

                print(f"Found PDF URL: {pdf_url}")
                pdf_response = requests.get(pdf_url, headers=self.headers, timeout=30, verify=False)
                
                if pdf_response.status_code == 200 and 'application/pdf' in pdf_response.headers.get('Content-Type', ''):
                    filename = f"{doi.replace('/', '_')}.pdf"
                    return pdf_response.content, filename
                else:
                    print(f"Failed to retrieve PDF content from {pdf_url}")

            except Exception as e:
                print(f"Error connecting to {mirror}: {e}")
                continue
        
        return None, "All mirrors failed or paper not found."
