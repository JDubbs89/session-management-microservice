#!/bin/bash

echo "🔧 Switching to development environment..."

# Copy or symlink development .env file
cp .env.development .env

# Clean and rebuild
docker-compose down -v
docker-compose up --build