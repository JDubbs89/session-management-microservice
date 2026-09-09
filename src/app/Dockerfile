# Use a lightweight Python image
FROM python:3.12-slim

# Set working directory in container
WORKDIR /app

# Copy and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --require-hashes -r requirements.txt

# Copy application source code
COPY . .

# Run FastAPI server
CMD ["sh", "-c", "python migrate.py && exec uvicorn main:app --host 0.0.0.0 --port 8000 --no-proxy-headers --no-access-log --timeout-graceful-shutdown 30"]
