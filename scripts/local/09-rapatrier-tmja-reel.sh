#!/usr/bin/env bash
# Rapatrie les VRAIS comptages routiers de la production — et EUX SEULS.
#
# ── LE CHOIX, ET POURQUOI IL N'EST PAS UNE PERTE ─────────────────────────────
#
# `comptages_routiers` porte 408 030 lignes en production, et deux jeux de
# donnees qui n'ont rien a voir (mesure du 2026-09-19, colonne `source`) :
#
#     tmja_rrn_national     1 100 lignes   857 valeurs distinctes   3 267 a 174 771
#     osm_highway_proxy   406 930 lignes    11 valeurs distinctes     800 a  30 000
#
# Les 1 100 premieres sont des COMPTAGES MESURES sur le reseau routier
# national. Elles sont irremplacables : si la production disparait sans qu'on
# les ait copiees, elles sont perdues.
#
# Les 406 930 autres sont un PROXY calcule a partir du type de voie OSM — onze
# valeurs forfaitaires recopiees sur des centaines de milliers de troncons.
# Ce n'est pas du trafic mesure, et c'est la dette documentee depuis le
# 2026-09-13 (`docs/` et memoire projet) : 99,7 % d'un calque intitule « flux
# routier » n'est pas du flux routier.
#
# On ne les rapatrie PAS, et ce n'est pas une perte : elles sont DERIVEES
# d'OpenStreetMap, donc reproductibles a volonte par
# `scripts/import_osm_roads.py`. Copier 701 Mo de donnees regenerables pour
# conserver un melange que personne ne veut, c'est importer la dette au lieu de
# la solder.
#
# ⚠ CONSEQUENCE ASSUMEE : le calque « flux routier » de la carte n'affichera
# plus que 1 100 troncons au lieu de 408 030. C'est le comportement correct —
# il montrera ce qui est mesure. L'arbitrage produit reste ouvert : regenerer
# le proxy, ou retirer le calque.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node scripts/local/rapatrier-tmja-reel.mjs "$@"
