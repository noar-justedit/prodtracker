#!/bin/bash
# ╔══════════════════════════════════════════════════════════════╗
# ║   prodtracker — Build macOS (.dmg signe + notarise Apple)    ║
# ╚══════════════════════════════════════════════════════════════╝
#
#   ./scripts/build-mac.sh              tout : build, signature, notarisation
#   ./scripts/build-mac.sh --no-sign    build brut sans signature (test rapide)
#   ./scripts/build-mac.sh --check      verifie le dernier .dmg, sans rebuild
#
# Depuis le Finder : double-cliquer build-mac.command a la racine du projet.
#
# Rien d'autre a preparer. Au premier lancement, le script demande les
# identifiants Apple s'ils manquent et les enregistre dans le trousseau ;
# les fois suivantes il ne demande plus rien.
#
set -e
GREEN='\033[0;32m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; DIM='\033[2m'; BOLD='\033[1m'; NC='\033[0m'
cd "$(dirname "$0")/.."

PROFILE="${APPLE_KEYCHAIN_PROFILE:-prodtracker-notarization}"
KEYCHAIN_SERVICE="com.apple.gke.notary.tool.saved-creds"
SIGN=1
[ "$1" = "--no-sign" ] && SIGN=0
START=$SECONDS

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
die()  { echo -e "\n${RED}✗ $1${NC}"; exit 1; }
step() { echo -e "\n${BLUE}[$1/6]${NC} ${BOLD}$2${NC}"; }

# Verifie qu'un .dmg est bien signe, notarise et agrafe — c'est-a-dire qu'il
# s'ouvrira sans avertissement chez quelqu'un qui vient de le telecharger.
verify_dmg() {
  local dmg="$1" bad=0
  local auth out mp app_in

  # ── 1. l'image disque elle-meme
  if codesign --verify --strict "$dmg" 2>/dev/null; then
    auth=$(codesign -dv --verbose=2 "$dmg" 2>&1 | grep -m1 "^Authority=" | cut -d= -f2-)
    ok "dmg signe${auth:+ — $auth}"
  else
    warn "dmg NON signe (electron-builder ne signe pas l'image disque : dmg.sign vaut false)"; bad=1
  fi
  if xcrun stapler validate "$dmg" >/dev/null 2>&1; then
    ok "dmg notarise et agrafe"
  else
    warn "dmg NON notarise (ou ticket non agrafe)"; bad=1
  fi

  # ── 2. ce que macOS fera vraiment : monter l'image et evaluer l'app dedans.
  #    C'est le test qui compte — celui que subit l'utilisateur au double-clic.
  mp=$(mktemp -d)
  if printf 'Y\n' | hdiutil attach "$dmg" -nobrowse -readonly -noautoopen -mountpoint "$mp" >/dev/null 2>&1; then
    app_in=$(ls -d "$mp"/*.app 2>/dev/null | head -1)
    if [ -n "$app_in" ]; then
      out=$(spctl -a -vvv -t exec "$app_in" 2>&1 || true)
      if echo "$out" | grep -q "accepted"; then
        ok "app dans le dmg : $(echo "$out" | grep -m1 "source=" | sed 's/^ *//')"
      else
        warn "app dans le dmg REFUSEE par Gatekeeper :"
        echo "$out" | sed 's/^/    /'
        bad=1
      fi
      xcrun stapler validate "$app_in" >/dev/null 2>&1 \
        && ok "app dans le dmg : ticket agrafe" \
        || { warn "app dans le dmg : ticket absent"; bad=1; }
    else
      warn "aucune .app trouvee dans l'image montee"
    fi
    hdiutil detach "$mp" -quiet >/dev/null 2>&1 || hdiutil detach "$mp" -force -quiet >/dev/null 2>&1 || true
  else
    warn "impossible de monter le dmg pour verification (verifier a la main)"
  fi
  rmdir "$mp" 2>/dev/null || true

  # ── 3. evaluation de l'image disque par Gatekeeper. Informatif seulement :
  #    spctl -t open est capricieux sur une image fraichement construite, sans
  #    attribut de quarantaine. Les tests ci-dessus font foi.
  out=$(spctl -a -t open --context context:primary-signature -vvv "$dmg" 2>&1 || true)
  if echo "$out" | grep -q "accepted"; then
    ok "Gatekeeper : dmg accepte"
  else
    warn "spctl sur le dmg (informatif) :"
    echo "$out" | sed 's/^/    /'
  fi

  [ "$bad" = "0" ] || die "Ce .dmg n'est pas distribuable en l'etat — ne pas le publier."
}

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "?")

# --check : verifier un .dmg deja construit, sans rien rebuild.
if [ "$1" = "--check" ]; then
  echo -e "${BOLD}${CYAN}  prodtracker — verification du dernier .dmg${NC}\n"
  DMG=$(ls -t dist/*.dmg 2>/dev/null | head -1)
  [ -n "$DMG" ] || die "Aucun .dmg dans dist/."
  echo -e "  $DMG\n"
  verify_dmg "$DMG"
  echo -e "\n${BOLD}${GREEN}  Verification terminee.${NC}\n"
  exit 0
fi

echo -e "${BOLD}${CYAN}  prodtracker ${VERSION} — build macOS${NC}"

# ─────────────────────────────────────────────────────────── 1. outils
step 1 "Outils"
command -v node >/dev/null || die "Node.js requis : https://nodejs.org"
ok "node $(node --version)"
if [ "$SIGN" = "1" ]; then
  xcrun notarytool --help >/dev/null 2>&1 || die "Outils Xcode manquants. Lancer : xcode-select --install"
  ok "outils Xcode"
fi

# ─────────────────────────────────────────────────────────── 2. dependances
step 2 "Dependances"
npm install --silent 2>&1 | grep -v "^npm warn" || true
ok "a jour"

# ─────────────────────────────────────────────────────────── 3. certificat
step 3 "Certificat de signature"
IDENTITY=""; TEAM_ID=""
if [ "$SIGN" = "1" ]; then
  IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null \
    | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/' || true)
fi
if [ -n "$IDENTITY" ]; then
  # "Developer ID Application: Just Edit (ABCDE12345)" → ABCDE12345
  TEAM_ID=$(echo "$IDENTITY" | sed -n 's/.*(\([A-Z0-9]*\))$/\1/p')
  ok "$IDENTITY"
  [ -n "$TEAM_ID" ] && echo -e "  ${DIM}Team ID : $TEAM_ID${NC}"
elif [ "$SIGN" = "1" ]; then
  SIGN=0
  warn "aucun certificat \"Developer ID Application\" dans le trousseau."
  echo -e "  ${DIM}developer.apple.com → Certificates → Developer ID Application,"
  echo -e "  telecharger le .cer et double-cliquer. Build non signe en attendant.${NC}"
fi

# ─────────────────────────────────────────────────────────── 4. identifiants
step 4 "Identifiants de notarisation"
if [ "$SIGN" = "1" ]; then
  if security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$PROFILE" >/dev/null 2>&1; then
    ok "profil trousseau \"$PROFILE\""
  elif [ -t 0 ]; then
    # Premier lancement : on enregistre les identifiants une bonne fois.
    warn "profil \"$PROFILE\" absent — enregistrement (une seule fois)."
    echo -e "  ${DIM}Mot de passe applicatif a creer sur appleid.apple.com →"
    echo -e "  Connexion et securite → Mots de passe pour applications.${NC}\n"
    read -r -p "  Apple ID (email) : " IN_APPLE_ID
    read -r -p "  Team ID [$TEAM_ID] : " IN_TEAM; IN_TEAM="${IN_TEAM:-$TEAM_ID}"
    read -r -s -p "  Mot de passe applicatif : " IN_PW; echo ""
    [ -n "$IN_APPLE_ID" ] && [ -n "$IN_TEAM" ] && [ -n "$IN_PW" ] || die "Identifiants incomplets."
    xcrun notarytool store-credentials "$PROFILE" \
      --apple-id "$IN_APPLE_ID" --team-id "$IN_TEAM" --password "$IN_PW" \
      || die "Enregistrement refuse par Apple (verifier l'Apple ID, le Team ID et le mot de passe applicatif)."
    unset IN_PW
    ok "profil \"$PROFILE\" enregistre dans le trousseau"
  else
    die "Profil \"$PROFILE\" absent et terminal non interactif. Le creer avec :
  xcrun notarytool store-credentials \"$PROFILE\" --apple-id \"...\" --team-id \"$TEAM_ID\" --password \"...\""
  fi
  # C'est la presence de cette variable qui declenche la notarisation de l'app
  # par electron-builder (il ne l'active par aucune cle de configuration).
  export APPLE_KEYCHAIN_PROFILE="$PROFILE"
else
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  warn "ignore (build non signe)"
fi

# ─────────────────────────────────────────────────────────── 5. build
step 5 "Build arm64"
[ "$SIGN" = "1" ] && echo -e "  ${DIM}Signature + notarisation de l'app par Apple : compter quelques minutes.${NC}"
npm run build || die "Build echoue (erreur ci-dessus)."
DMG=$(ls -t dist/*.dmg 2>/dev/null | head -1)
[ -n "$DMG" ] || die "Aucun .dmg produit dans dist/."
ok "$DMG"

# ─────────────────────────────────────────────────────────── 6. dmg + verifs
step 6 "Signature et notarisation du .dmg"
if [ "$SIGN" = "1" ]; then
  # electron-builder signe, notarise et agrafe l'app, mais laisse l'image disque
  # qui la contient non signee (option dmg.sign, false par defaut) et ne l'envoie
  # jamais a Apple. Resultat sans les trois etapes ci-dessous : l'app est propre,
  # mais macOS avertit quand meme a l'ouverture du .dmg telecharge.
  #
  # --timestamp est indispensable : Apple refuse de notariser une signature sans
  # horodatage securise. C'est pour ca qu'on signe ici plutot que de laisser
  # electron-builder le faire, lui ne le passe pas.
  if codesign --verify --strict "$DMG" 2>/dev/null; then
    ok "dmg deja signe"
  else
    codesign --sign "$IDENTITY" --timestamp "$DMG" 2>&1 | grep -v "^$" || true
    codesign --verify --strict "$DMG" 2>/dev/null || die "Signature du .dmg impossible."
    ok "dmg signe"
  fi

  OUT=$(mktemp)
  xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait 2>&1 | tee "$OUT" || true
  SUB_ID=$(grep -m1 -E "^ *id: " "$OUT" | awk '{print $2}')
  if ! grep -qE "status: *Accepted" "$OUT"; then
    echo ""
    if [ -n "$SUB_ID" ]; then
      echo -e "${YELLOW}Rapport Apple :${NC}"
      xcrun notarytool log "$SUB_ID" --keychain-profile "$PROFILE" 2>&1 | head -40 || true
    fi
    rm -f "$OUT"; die "Notarisation du .dmg refusee."
  fi
  rm -f "$OUT"
  xcrun stapler staple "$DMG" >/dev/null || die "Agrafage du .dmg impossible."
  verify_dmg "$DMG"
else
  warn "ignore (build non signe)"
fi

# ─────────────────────────────────────────────────────────── fin
MIN=$(( (SECONDS - START) / 60 )); SEC=$(( (SECONDS - START) % 60 ))
echo -e "\n${BOLD}${GREEN}  prodtracker ${VERSION} — termine en ${MIN}m${SEC}s${NC}"
echo -e "  ${GREEN}→${NC} $DMG  ($(du -sh "$DMG" | cut -f1))"
if [ "$SIGN" = "1" ]; then
  echo -e "\n  ${CYAN}Signe et notarise :${NC} double-clic direct chez l'utilisateur, aucun avertissement."
  echo -e "  ${DIM}Prochaine etape : joindre ce .dmg a la release GitHub v${VERSION},"
  echo -e "  puis pousser version.json une fois la release en ligne.${NC}"
else
  echo -e "\n  ${YELLOW}Non signe :${NC} clic droit sur l'app → Ouvrir → Ouvrir au 1er lancement."
fi
command -v open >/dev/null && open dist 2>/dev/null || true
echo ""
