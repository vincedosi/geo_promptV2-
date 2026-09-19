#!/usr/bin/env bash
# Restaure les trois tables RADIO depuis la production vers la base LOCALE.
#
# ── POURQUOI CE SCRIPT EXISTE ────────────────────────────────────────────────
#
# Mesure du 2026-09-19, production contre local :
#
#     emetteur_radio_stations   569 698   contre    40 496   (-93 %)
#     emetteurs_radio            11 836   contre    12 630   (local en AVANCE)
#     radios                      1 175   contre     1 175   (identiques)
#
# Le local a PLUS d'emetteurs et 93 % de liaisons en MOINS. La cause est dans
# `lib/radio/radio-matcher.ts:46-51` : le matching Arcom **reconstruit
# integralement** `emetteur_radio_stations` — il efface tout, puis re-matche.
# Une execution locale a donc detruit les 569 698 liaisons de la prod et n'en a
# re-cree que 40 496.
#
# `emetteur_radio_stations` est decrite dans ARCHITECTURE.md comme « la SEULE
# liaison exploitable » entre emetteurs et radios (`emetteurs_radio.radio_id`
# est NULL partout). Sans elle, la fonctionnalite radio ne rend rien.
#
# ARCHITECTURE.md affirmait une parite verifiee une a une le 2026-09-17, cette
# table comprise. La parite a donc ete perdue DEPUIS, en local, sans que rien
# ne le signale — c'est le genre d'ecart qu'aucun ecran ne montre.
#
# ── POURQUOI UPSERT ET NON TRUNCATE ──────────────────────────────────────────
#
# `radios` et `emetteurs_radio` sont **completees**, jamais videes : le local
# porte 794 emetteurs que la prod n'a pas, et les detruire serait une perte
# symetrique de celle qu'on repare. Seules les LIAISONS sont remplacees, parce
# qu'elles sont le produit d'un calcul et non une saisie.
#
# TRUNCATE serait d'ailleurs dangereux ici : `emetteurs_radio_archive` pointe
# vers `radios`, et un TRUNCATE CASCADE l'emporterait en entier.
#
# ── POURQUOI PASSER PAR POSTGREST ────────────────────────────────────────────
#
# `pg_dump` demanderait un acces Postgres direct. `SUPABASE_DB_URL` est VIDE
# dans `.env.local` (incident de cles perdues de juillet) et
# `SUPABASE_DB_PASSWORD` est refuse par le pooler. PostgREST avec la cle
# `service_role` est le seul chemin disponible.
#
# La geometrie des emetteurs traverse en hexadecimal EWKB, que PostGIS relit
# tel quel a l'insertion — aucune conversion, aucune perte de precision.
set -euo pipefail
cd "$(dirname "$0")/../.."

exec node scripts/local/rapatrier-radio.mjs "$@"
