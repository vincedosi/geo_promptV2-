#!/usr/bin/env bash
# Demarre le moteur Docker et attend que le daemon reponde.
#
# ⚠ HISTOIRE DE CE FICHIER, a lire avant de "simplifier" (2026-09-17).
# Ce poste tournait sur le backend **Hyper-V**, et Hyper-V PRE-ALLOUE la
# totalite de la RAM de la VM : avec 15,5 Go dont ~10 pris par Chrome, Teams,
# Outlook et les agents corporate, meme une VM de 768 Mo refusait de demarrer
# (`0x800705AA`, « ressources systeme insuffisantes ») — et Docker Desktop
# restait affiche « starting » sans jamais dire pourquoi. Baisser l'allocation
# ne sert a RIEN dans ce cas : 6 Go, 4, 3, 2 et 0,75 Go ont tous echoue.
# La sortie a ete d'installer WSL2 (les fonctionnalites Windows etaient deja
# activees) : WSL2 n'alloue pas son plafond d'avance, il grandit a la demande
# et `autoMemoryReclaim` rend la memoire a Windows quand la base est au repos.
# C'est ce qui permet au stack de coexister avec le navigateur de test.
#
# Donc : si ce script signale le backend Hyper-V, ce n'est pas un detail de
# configuration, c'est la panne elle-meme. Plafond WSL2 : ~/.wslconfig.
set -euo pipefail

SETTINGS="$APPDATA/Docker/settings-store.json"
DOCKER_EXE="/c/Program Files/Docker/Docker/Docker Desktop.exe"

wsl_actif=$(powershell -NoProfile -Command "(Get-Content '$(cygpath -w "$SETTINGS")' -Raw | ConvertFrom-Json).WslEngineEnabled" | tr -d '\r')
if [ "$wsl_actif" != "True" ]; then
  echo "⚠ Docker est sur le backend Hyper-V (WslEngineEnabled = $wsl_actif)."
  echo "  Sur ce poste, Hyper-V ne demarre pas faute de RAM contigue — voir l'en-tete"
  echo "  de ce script. Basculer sur WSL2 : Docker Desktop > Settings > General >"
  echo "  « Use the WSL 2 based engine »."
fi

if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  powershell -NoProfile -Command "Start-Process '$(cygpath -w "$DOCKER_EXE")'" >/dev/null
  echo -n "demarrage du daemon"
  for _ in $(seq 1 60); do
    if docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then echo; break; fi
    echo -n "."; sleep 5
  done
fi

docker version --format 'daemon OK — engine {{.Server.Version}}'
powershell -NoProfile -Command "
  Get-Process -Name 'vmmem*' -ErrorAction SilentlyContinue | ForEach-Object { 'VM WSL2 : ' + [math]::Round(\$_.WorkingSet64/1MB) + ' Mo' }
  \$os = Get-CimInstance Win32_OperatingSystem
  'RAM libre sur l hote : ' + [math]::Round(\$os.FreePhysicalMemory/1KB) + ' Mo'
" | tr -d '\r'
