#!/usr/bin/env bash
# Starts the full local stack: DynamoDB Local, .NET API, and Vite dev server.
# Prerequisites: Docker Desktop, .NET 8 SDK, Node.js 20+
set -euo pipefail

command -v docker >/dev/null 2>&1 || { echo "Error: Docker is not installed."; exit 1; }
command -v dotnet >/dev/null 2>&1 || { echo "Error: .NET 8 SDK is not installed."; exit 1; }
command -v node   >/dev/null 2>&1 || { echo "Error: Node.js is not installed."; exit 1; }

# Create frontend env file if missing
if [ ! -f web/.env.local ]; then
  cp web/.env.local.example web/.env.local
  echo "Created web/.env.local from example."
fi

# Install frontend dependencies if missing
if [ ! -d web/node_modules ]; then
  echo "Installing frontend dependencies..."
  npm --prefix web install
fi

# Start DynamoDB Local and create tables
echo "Starting DynamoDB Local..."
docker compose up -d
echo "Waiting for tables to be ready..."
docker compose wait dynamodb-init 2>/dev/null || sleep 5

# Start .NET API (env vars come from src/Api/Properties/launchSettings.json)
echo "Starting .NET API on http://localhost:5000..."
dotnet run --project src/Api/Api.csproj &
API_PID=$!

# Start Vite dev server
echo "Starting frontend on http://localhost:5173..."
npm --prefix web run dev &
VITE_PID=$!

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$API_PID"  2>/dev/null || true
  kill "$VITE_PID" 2>/dev/null || true
  docker compose stop
}
trap cleanup EXIT INT TERM

echo ""
echo "  Frontend  →  http://localhost:5173"
echo "  API       →  http://localhost:5000"
echo "  DynamoDB  →  http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop all services."
wait "$API_PID" "$VITE_PID"
