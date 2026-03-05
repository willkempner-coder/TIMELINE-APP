#!/bin/bash
# Double-click this file to launch the Timeline App in your browser.

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "Starting Timeline App..."
echo "Opening http://localhost:4173 in a moment..."
echo ""

# Open browser after a short delay
(sleep 3 && open "http://localhost:4173") &

# Start the dev server
npm run dev
