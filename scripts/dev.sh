#!/bin/bash
# prodtracker - lancement en mode developpement
set -e
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo "Node.js requis : https://nodejs.org"; exit 1; }
npm install --silent 2>&1 | grep -v "^npm warn" || true
npm run dev
