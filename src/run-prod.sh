#!/bin/bash

echo "🛡️ Switching to production environment..."

# Copy or symlink production .env file
cp .env.production .env

# Clean and rebuild
docker-compose down -v
docker-compose up --build