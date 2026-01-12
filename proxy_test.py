import requests
import random

# List of open proxies (updated frequently, but unreliable)
# Sourced from Free Proxy List (HTTPS) - purely for testing
FREE_PROXIES = [
    # Format: "ip:port"
    # These need to be fresh to work.
]

def fetch_with_proxy(url):
    print(f"Direct connection to {url}")
    try:
        # 1. Try DIRECT first
        resp = requests.get(url, timeout=10)
        print(f"Direct status: {resp.status_code}")
        return resp
    except Exception as e:
        print(f"Direct failed: {e}")

    # 2. Try with Proxies (Experimental)
    # We will use a library 'duckduckgo_search' or similar if installed, 
    # but for now, let's try a Rotating User Agent + known open mirror strictly.
    pass

if __name__ == "__main__":
    fetch_with_proxy("https://sci-hub.se")
