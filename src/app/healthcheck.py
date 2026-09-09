"""Use the same readiness contract as operators and container orchestration."""
import json
from urllib.request import urlopen

if __name__ == '__main__':
    with urlopen('http://127.0.0.1:8000/health/ready', timeout=5) as response:
        if json.load(response).get('status') != 'ok':
            raise SystemExit('API is not ready')
