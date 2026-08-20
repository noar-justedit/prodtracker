#!/bin/bash
# ╔══════════════════════════════════════════════════════════════╗
# ║        prodtracker — Build macOS (.dmg, Apple Silicon)      ║
# ╚══════════════════════════════════════════════════════════════╝
set -e
GREEN='\033[0;32m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
cd "$(dirname "$0")/.."

echo -e "${BOLD}${CYAN}  prodtracker — build macOS${NC}\n"

echo -e "${BLUE}[1/3]${NC} Node.js…"
command -v node >/dev/null || { echo -e "${RED}✗ Node.js requis : https://nodejs.org${NC}"; exit 1; }
echo -e "${GREEN}✓ $(node --version)${NC}"

echo -e "${BLUE}[2/3]${NC} Dependances…"
npm install --silent 2>&1 | grep -v "^npm warn" || true
echo -e "${GREEN}✓ ok${NC}"

echo -e "${BLUE}[3/3]${NC} Build (arm64)…"
npm run build || { echo -e "\n${RED}✗ Build echoue (voir l'erreur ci-dessus).${NC}"; exit 1; }

# ls -t : le plus recent d'abord, pour ne pas annoncer un vieux .dmg reste dans dist/
DMG=$(ls -t dist/*.dmg 2>/dev/null | head -1)
if [ -z "$DMG" ]; then
  echo -e "\n${RED}✗ Aucun .dmg produit dans dist/.${NC}"; exit 1
fi
echo ""
echo -e "${BOLD}${GREEN}  Build termine.${NC}"
echo -e "  ${GREEN}→${NC} $DMG  ($(du -sh "$DMG" | cut -f1))"
echo ""
echo -e "${YELLOW}Note :${NC} l'app n'est pas signee. Au 1er lancement macOS :"
echo -e "  clic droit sur l'app → Ouvrir → Ouvrir."
