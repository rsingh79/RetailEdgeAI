#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$REPO_DIR/client"
SERVER_DIR="$REPO_DIR/server"

echo "==> Installing server dependencies..."
cd "$SERVER_DIR" && npm install --silent

echo "==> Installing client dependencies..."
cd "$CLIENT_DIR" && npm install --silent

echo "==> Running database migrations..."
cd "$SERVER_DIR" && npx prisma migrate deploy

echo "==> Building client..."
cd "$CLIENT_DIR" && npm run build

echo "==> Restarting server..."
pm2 restart retailedge-api --update-env

echo "==> Done. App is live."
