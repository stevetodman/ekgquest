#!/bin/bash
# Start the EKGQuest Digitization Service

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install/upgrade dependencies
echo "Checking dependencies..."
pip install -q -r requirements.txt

# Start the server
echo ""
python -m digitize_service.app
