#!/bin/bash
# prodtracker — build Windows (.exe) depuis le Mac
# Double-cliquer ce fichier depuis le Finder. Rien d'autre a faire.
cd "$(dirname "$0")" || exit 1
bash scripts/build-win-from-mac.sh "$@"
STATUS=$?
echo ""
if [ $STATUS -ne 0 ]; then
  echo "  Build interrompu (code $STATUS). Le detail de l'erreur est au-dessus."
fi
read -n 1 -s -r -p "  Appuyer sur une touche pour fermer cette fenetre…"
echo ""
exit $STATUS
