import requests

def dump_html():
    doi = "10.1111/j.1468-3083.2008.02677.x"
    mirrors = ['https://sci-hub.se', 'https://sci-hub.st', 'https://sci-hub.ru']
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    }

    for mirror in mirrors:
        url = f"{mirror}/{doi}"
        try:
            print(f"Fetching {url}...")
            r = requests.get(url, headers=headers, timeout=15)
            if r.status_code == 200:
                filename = f"debug_{mirror.split('//')[1]}.html"
                with open(filename, "w", encoding="utf-8") as f:
                    f.write(r.text)
                print(f"Saved HTML to {filename}")
        except Exception as e:
            print(f"Error {mirror}: {e}")

if __name__ == "__main__":
    dump_html()
