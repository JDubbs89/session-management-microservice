# Use a lightweight Python image
FROM python:3.11-slim

# Set working directory in container
WORKDIR /app

# Copy and install dependencies
COPY . /app
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

# Run FastAPI server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]