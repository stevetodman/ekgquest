#!/bin/bash
# Start EKGQuest in Import Mode
# Runs dev server + import watcher

cd "$(dirname "$0")/.."

echo "🚀 Starting EKGQuest Import Mode"
echo ""

# Check for OpenCV
if ! python3 -c "import cv2" 2>/dev/null; then
    echo "⚠️  OpenCV not installed. Installing..."
    pip3 install opencv-python numpy --quiet
fi

# Start dev server in background
echo "Starting dev server..."
npm start &
SERVER_PID=$!

# Wait for server to be ready
sleep 2

# Open browser
open http://localhost:8000

# Start watcher
echo ""
python3 tools/ecg-import-watcher.py

# Cleanup on exit
kill $SERVER_PID 2>/dev/null
