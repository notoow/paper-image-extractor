import requests
from bs4 import BeautifulSoup

def debug_scihub(doi):
    mirrors = [
        'https://sci-hub.se',
        'https://sci-hub.st',
        'https://sci-hub.ru'
    ]
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    }

    print(f"DTOI: {doi}")
    
    for mirror in mirrors:
        url = f"{mirror}/{doi}"
        print(f"\nTesting {url}...")
        try:
            r = requests.get(url, headers=headers, timeout=15)
            print(f"Status Code: {r.status_code}")
            
            if r.status_code == 200:
                soup = BeautifulSoup(r.text, 'html.parser')
                
                # specific check for 'article not found' text
                if "article not found" in r.text.lower():
                    print("Page says: Article not found")
                    continue
                
                iframe = soup.find('iframe', {'id': 'pdf'})
                embed = soup.find('embed', {'type': 'application/pdf'})
                
                if iframe:
                    print(f"Found iframe src: {iframe.get('src')}")
                elif embed:
                    print(f"Found embed src: {embed.get('src')}")
                else:
                    print("No iframe or embed found. Dumping first 500 chars of HTML:")
                    print(r.text[:500])
                    
                    # Check for buttons
                    buttons = soup.find_all('button')
                    for b in buttons:
                        print(f"Button found: {b.get('onclick')} | {b.text}")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    debug_scihub("10.1111/j.1468-3083.2008.02677.x")
