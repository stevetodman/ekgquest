#!/bin/bash
# Start the EKGQuest Digitization Service
# Run from project root: ./start-digitizer.sh

cd "$(dirname "$0")"

# Check Python version
if ! command -v python3 &> /dev/null; then
    echo "Error: python3 not found. Please install Python 3.8+"
    exit 1
fi

# Check if virtual environment exists
VENV_DIR="python/digitize_service/venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# Activate and install
echo "Setting up environment..."
source "$VENV_DIR/bin/activate"
pip install -q -r python/digitize_service/requirements.txt

# Start server
echo ""
cd python
python -m digitize_service.app
