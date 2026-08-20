#!/bin/bash
# ╔══════════════════════════════════════════════════════════════╗
# ║      prodtracker — Build Windows (.exe) depuis macOS        ║
# ║      Installeur NSIS 64-bit                                   ║
# ╚══════════════════════════════════════════════════════════════╝
set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
cd "$(dirname "$0")/.."

echo -e "${BOLD}${CYAN}  prodtracker — build Windows depuis macOS${NC}\n"

echo -e "${BLUE}[1/5]${NC} Node.js…"
command -v node >/dev/null || { echo -e "${RED}✗ Node.js requis : https://nodejs.org${NC}"; exit 1; }
echo -e "${GREEN}✓ $(node --version)${NC}"

echo -e "${BLUE}[2/5]${NC} Wine (optionnel)…"
if command -v wine >/dev/null; then
  echo -e "${GREEN}✓ $(wine --version 2>/dev/null | head -1)${NC}"
else
  echo -e "${YELLOW}⚠ Wine absent — non requis pour NSIS. Si le build echoue :${NC}"
  echo -e "  ${CYAN}brew install --cask wine-stable${NC}"
fi

echo -e "${BLUE}[3/5]${NC} Icone Windows…"
[ -f build-resources/icon.ico ] && echo -e "${GREEN}✓ icon.ico${NC}" || echo -e "${YELLOW}⚠ icon.ico absent — icone par defaut${NC}"

echo -e "${BLUE}[4/5]${NC} Dependances…"
npm install --silent 2>&1 | grep -v "^npm warn" || true
echo -e "${GREEN}✓ ok${NC}"

echo -e "${BLUE}[5/5]${NC} Build Windows (x64)…"
echo -e "${YELLOW}  electron-builder telecharge le binaire Electron Windows (~100 Mo) au 1er run.${NC}\n"
# Pas de pipe ici : "npm run build:win | tail" renvoyait le code de sortie de tail,
# donc un build echoue s'affichait quand meme comme un succes.
npm run build:win || {
  echo -e "\n${RED}✗ Build echoue.${NC} En cas de souci reseau, reessayer avec :"
  echo -e "  ${CYAN}ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run build:win${NC}"
  exit 1
}

EXE=$(ls -t dist/*.exe 2>/dev/null | head -1)
if [ -z "$EXE" ]; then
  echo -e "\n${RED}✗ Aucun .exe produit dans dist/.${NC}"; exit 1
fi
echo -e "\n${BOLD}${GREEN}  Build termine.${NC}"
echo -e "  ${GREEN}→${NC} $EXE  ($(du -sh "$EXE" | cut -f1))"
echo ""
echo -e "${CYAN}Sur Windows :${NC} le .exe n'est pas signe."
echo -e "  Au 1er lancement, SmartScreen affiche \"Editeur inconnu\" :"
echo -e "  Informations complementaires → Executer quand meme."
