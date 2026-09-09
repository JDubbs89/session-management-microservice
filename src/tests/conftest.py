"""Allow each regression module to run independently of collection order."""
import os
import sys
from pathlib import Path

os.environ.setdefault('DATABASE_URL', 'postgresql+psycopg2://test:test@127.0.0.1/test')
os.environ.setdefault('SECRET_KEY', 'test-secret-only-at-least-32-characters')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
