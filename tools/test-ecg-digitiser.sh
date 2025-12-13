#!/bin/bash
# ECG-Digitiser Installation Test for macOS
# Run: bash tools/test-ecg-digitiser.sh

set -e

echo "============================================"
echo "ECG-Digitiser Mac Compatibility Test"
echo "============================================"
echo ""

# Check system
echo "[1/7] Checking system..."
echo "  macOS: $(sw_vers -productVersion)"
echo "  Chip:  $(uname -m)"
if [[ $(uname -m) == "arm64" ]]; then
    echo "  Type:  Apple Silicon (M1/M2/M3/M4)"
else
    echo "  Type:  Intel"
fi
echo ""

# Check Python
echo "[2/7] Checking Python..."
if command -v python3 &> /dev/null; then
    PYVER=$(python3 --version)
    echo "  Found: $PYVER"
else
    echo "  ERROR: Python3 not found. Install from python.org"
    exit 1
fi
echo ""

# Check git-lfs
echo "[3/7] Checking git-lfs (needed for model weights)..."
if command -v git-lfs &> /dev/null; then
    echo "  Found: $(git-lfs --version)"
else
    echo "  Not found. Installing via Homebrew..."
    if command -v brew &> /dev/null; then
        brew install git-lfs
        git lfs install
    else
        echo "  ERROR: Homebrew not found. Install git-lfs manually:"
        echo "         brew install git-lfs"
        exit 1
    fi
fi
echo ""

# Create test environment
echo "[4/7] Creating isolated test environment..."
TEST_DIR="/tmp/ecg-digitiser-test"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip --quiet
echo "  Created: $TEST_DIR/venv"
echo ""

# Clone repo (shallow, no weights yet)
echo "[5/7] Cloning ECG-Digitiser (without weights)..."
git clone --depth 1 https://github.com/felixkrones/ECG-Digitiser.git repo 2>&1 | grep -v "^remote:"
cd repo
echo "  Cloned to: $TEST_DIR/repo"
echo ""

# Test dependency installation
echo "[6/7] Installing dependencies (this takes 5-10 minutes)..."
echo "  This will download ~2-3GB of packages."
echo ""
pip install -r requirements.txt 2>&1 | tail -20
echo ""

# Verify imports
echo "[7/7] Verifying core imports..."
python3 -c "
import sys
print('  Testing imports...')
try:
    import torch
    print(f'    torch {torch.__version__} - OK')
    if torch.backends.mps.is_available():
        print('    MPS (Apple GPU) - AVAILABLE')
    else:
        print('    MPS (Apple GPU) - not available (will use CPU)')
except Exception as e:
    print(f'    torch - FAILED: {e}')
    sys.exit(1)

try:
    import tensorflow as tf
    print(f'    tensorflow {tf.__version__} - OK')
except Exception as e:
    print(f'    tensorflow - FAILED: {e}')

try:
    import cv2
    print(f'    opencv {cv2.__version__} - OK')
except Exception as e:
    print(f'    opencv - FAILED: {e}')

try:
    import numpy as np
    import scipy
    import sklearn
    print('    numpy, scipy, sklearn - OK')
except Exception as e:
    print(f'    FAILED: {e}')

print('')
print('  All core dependencies working!')
"

echo ""
echo "============================================"
echo "SUCCESS! ECG-Digitiser can run on your Mac."
echo "============================================"
echo ""
echo "Next steps to complete setup:"
echo "  cd $TEST_DIR/repo"
echo "  source ../venv/bin/activate"
echo "  git lfs pull   # Downloads ~500MB model weights"
echo ""
echo "Test environment location: $TEST_DIR"
echo "To remove: rm -rf $TEST_DIR"
echo ""
