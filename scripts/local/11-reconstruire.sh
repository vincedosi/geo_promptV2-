#!/usr/bin/env bash
# Reconstruit TOUT ce qu'une sauvegarde ne contient pas, dans le bon ordre.
#
# ── POURQUOI CE SCRIPT EXISTE ────────────────────────────────────────────────
#
# Le 2026-09-22, Docker Desktop s'est retrouvé vide : zéro image, zéro
# conteneur, zéro volume. Le stack local étant le seul environnement du projet
# depuis la coupure du 19/09, c'était toute la base. La reprise a pris ~2 h,
# dont l'essentiel à RETROUVER L'ORDRE : quelles tables se reconstruisent,
# depuis quoi, et dans quel enchaînement.
#
# Cet ordre n'était écrit nulle part. Il l'est ici, exécutable, parce qu'une
# procédure de reprise qu'on rédige pendant la panne est une procédure qu'on
# rédige mal — deux erreurs ont été commises ce jour-là, toutes deux corrigées
# et commentées plus bas.
#
# ── CE QUE LA SAUVEGARDE NE PORTE PAS, ET POURQUOI ──────────────────────────
#
# `10-sauvegarder.sh` exclut délibérément les tables régénérables :
# `carreaux_filosofi` (2,3 M lignes) et `couverture_rayon_risque`. S'y ajoute
# tout ce qui a été calculé APRÈS la dernière sauvegarde. Ce script rejoue les
# deux cas de la même façon, parce qu'ils se distinguent mal dans l'urgence.
#
# ── ORDRE IMPOSÉ PAR LES DÉPENDANCES ────────────────────────────────────────
#
#   carreaux INSEE                 (aucun prérequis, ~11 min)
#     └─ carreau_risque_distance   (a besoin des carreaux ET de leurs index)
#          └─ carreau_risque_nature
#          └─ unite_population_totale
#          └─ couverture_rayon_risque
#
# `zones_risque_cache` n'y figure pas : l'application la construit seule au
# premier affichage d'un profil (~2,8 s), et la préconstruire ici ferait payer
# un calcul dont on ne sait pas s'il servira.
#
# Usage :
#   bash scripts/local/11-reconstruire.sh            # reprend ce qui manque
#   bash scripts/local/11-reconstruire.sh --sans-sauvegarde
set -uo pipefail
cd "$(dirname "$0")/../.."

SANS_SAUVEGARDE=0
[ "${1:-}" = "--sans-sauvegarde" ] && SANS_SAUVEGARDE=1

CONT=$(docker ps --filter "name=supabase_db_" --format '{{.Names}}' | head -1)
if [ -z "$CONT" ]; then
  echo "ARRÊT : conteneur de base introuvable — lancer scripts/local/01-supabase-up.sh" >&2
  exit 1
fi

sql() { MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres "$CONT" \
          psql -U postgres -d postgres -tAc "$1"; }
n()   { sql "select count(*) from $1" 2>/dev/null | tr -d ' \r' || echo 0; }
t0=$(date +%s)
etape() { echo ""; echo "=== $1 — $(( ($(date +%s) - t0) / 60 )) min ==="; }

# ── 0. LES DROITS ───────────────────────────────────────────────────────────
#
# Posés AVANT tout le reste, et pas seulement après une restauration : une
# sauvegarde prise avec `--no-acl` (ce que faisait ce projet jusqu'au
# 2026-09-22) se restaure sans le moindre GRANT. PostgREST répond alors 401 sur
# tout, l'application affiche « Failed to fetch », et on cherche du côté des
# clés JWT — qui sont bonnes. Reposer les droits est idempotent et coûte 2 s.
etape "0/6 droits des rôles applicatifs"
sql "grant usage on schema public to anon, authenticated, service_role;
     grant all on all tables    in schema public to anon, authenticated, service_role;
     grant all on all sequences in schema public to anon, authenticated, service_role;
     grant all on all functions in schema public to anon, authenticated, service_role;
     alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
     alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
     alter default privileges in schema public grant all on functions to anon, authenticated, service_role;" \
  >/dev/null 2>&1
echo "  droits reposés (anon · authenticated · service_role)"

# ── 1. LES CARREAUX ─────────────────────────────────────────────────────────
etape "1/6 carreaux_filosofi"
if [ "$(n public.carreaux_filosofi)" -ge 2324577 ]; then
  echo "  déjà chargés : $(n public.carreaux_filosofi)"
else
  bash scripts/local/07-carreaux-insee.sh || { echo "ÉCHEC carreaux" >&2; exit 1; }
fi

# ── 2. LES DISTANCES ────────────────────────────────────────────────────────
#
# Reprenable : le journal `carreau_risque_bandes` dit ce qui est fait et le
# script saute ces bandes-là. 22 bandes attendues — 20 en métropole, plus la
# Martinique et La Réunion, que le script traite en appels séparés.
etape "2/6 carreau_risque_distance"
node scripts/construire_carreau_risque.mjs || { echo "ÉCHEC distances" >&2; exit 1; }
echo "  -> $(n public.carreau_risque_distance) lignes"

# ── 3. LES NATURES ──────────────────────────────────────────────────────────
#
# ⚠ AUCUN script ne pilote cette table : `construire_carreau_risque.mjs` ne
# construit que sa mère, contrairement à ce qu'ARCHITECTURE.md a annoncé
# jusqu'au 2026-09-22. En suivant la doc, on lançait le script, on lisait
# « terminé », et le filtre par nature restait vide sans un mot — une table
# absente et une table qui ne retient rien se ressemblent à l'écran.
#
# Le découpage est le MÊME que celui de sql/203, et l'outre-mer part en appels
# séparés avec des clés de journal >= 1000 : une zone traitée en une seule
# bande a forcément l'index 0, déjà pris par la première bande métropolitaine.
etape "3/6 carreau_risque_nature"
if [ "$(n public.carreau_risque_nature)" -ge 1446552 ]; then
  echo "  déjà construite : $(n public.carreau_risque_nature)"
else
  sql "select public.remplir_pprt_nature_generateur()" >/dev/null
  for i in $(seq 0 19); do
    printf '  bande %2d/19 ' "$i"
    sql "select public.construire_carreau_risque_nature($i, 20)" | head -c 90; echo
  done
  echo "  Martinique : $(sql "select public.construire_carreau_risque_nature(0, 1, 10000, -61.6, -60.6, 1000)" | head -c 60)"
  echo "  La Réunion : $(sql "select public.construire_carreau_risque_nature(0, 1, 10000, 55.0, 56.0, 1001)" | head -c 60)"
fi
echo "  -> $(n public.carreau_risque_nature) lignes"

# ── 4. LE DÉNOMINATEUR ──────────────────────────────────────────────────────
etape "4/6 unite_population_totale"
if [ "$(n public.unite_population_totale)" -gt 0 ]; then
  echo "  déjà construit : $(n public.unite_population_totale) lignes"
else
  sql "select public.construire_unite_population_totale()" | head -c 200; echo
fi

# ── 4 bis. LE RATTACHEMENT CARREAU -> CODE POSTAL ───────────────────────────
#
# ⚠ AJOUTÉ le 2026-09-22, après avoir constaté que la reconstruction du matin
# l'avait OUBLIÉ : la colonne `carreau_risque_distance.code_postal` (sql/206)
# était renseignée sur **0 des 883 451 lignes**, et rien ne le signalait.
#
# Même famille de défaut que `carreau_risque_nature` : la fonction
# `remplir_code_postal_carreau` existe, AUCUN script ne la pilotait. Une
# fonction sans pilote n'est pas une étape de reconstruction, c'est une étape
# qu'on oublie.
#
# Ce que ça bloque quand c'est vide : toute conversion rayon -> code postal,
# donc le plan que le DSP achète. Et ça ne se voit pas — la colonne existe.
etape "4bis/6 carreau_risque_distance.code_postal"
manquants=$(sql "select count(*) from carreau_risque_distance where code_postal is null")
if [ "${manquants:-0}" = "0" ]; then
  echo "  déjà rattachés : $(n public.carreau_risque_distance) carreaux"
else
  echo "  $manquants carreau(x) sans code postal — remplissage par lots de 100 000"
  # La fonction traite un lot et rend `restant` : on boucle jusqu'à zéro plutôt
  # que de deviner le nombre de passes.
  while true; do
    r=$(sql "select public.remplir_code_postal_carreau(100000)")
    echo "    $r"
    reste=$(sql "select count(*) from carreau_risque_distance where code_postal is null")
    [ "${reste:-0}" = "0" ] && break
  done
fi

# ── 4 ter. LE DÉNOMINATEUR PAR CODE POSTAL ──────────────────────────────────
#
# ⚠ AJOUTÉ le 2026-09-22, même oubli : `cp_population_totale` (sql/207) était
# à ZÉRO ligne. Elle n'était pilotée que par
# `scripts/seed-demo-campagne-risque.ts`, donc reconstruire sans semer la démo
# la laissait vide.
#
# C'est elle que `construire_zone_set` (sql/211) lit pour remplir
# `zone_set_cp.pop_totale`. Vide, un jeu de zones sort avec un dénominateur
# absent : pas de taux d'exposition, pas de taux d'utile, pas de dilution —
# et aucun message.
#
# ⚠ 60 bandes en métropole, puis l'outre-mer par appels SÉPARÉS avec ses
# propres bornes : un découpage uniforme de -61,6 à 56,0 mettrait toute la
# France dans une ou deux bandes. Leçon de sql/200, déjà payée deux fois.
etape "4ter/6 cp_population_totale"
if [ "$(n public.cp_population_totale)" -gt 0 ]; then
  echo "  déjà construit : $(n public.cp_population_totale) codes postaux"
else
  # Une ligne toutes les dix bandes, PAS un retour chariot : le journal est relu
  # APRES coup, souvent dans un fichier, ou un  ecrase tout sur une seule
  # ligne illisible — constate sur la passe du 2026-09-22.
  for b in $(seq 0 59); do
    [ $(( b % 10 )) = 0 ] && echo "  metropole : bande $b/59…"
    sql "select public.remplir_cp_population_totale($b, 60)" >/dev/null
  done
  echo "  Martinique : $(sql "select public.remplir_cp_population_totale(0, 1, -61.6, -60.6)" | head -c 70)"
  echo "  La Réunion : $(sql "select public.remplir_cp_population_totale(0, 1, 55.0, 56.0)" | head -c 70)"
fi
echo "  -> $(n public.cp_population_totale) codes postaux"

# ── 5. LA COUVERTURE PAR RAYON ──────────────────────────────────────────────
#
# ⚠ `--tout` N'EST PAS UN LUXE ICI, et c'est l'erreur la plus coûteuse du
# 2026-09-22. La table de données est exclue de la sauvegarde ; son JOURNAL de
# bandes, lui, est une petite table qui était sauvegardée normalement. Après
# restauration, le journal annonçait « 122 bandes déjà construites » pour une
# table à ZÉRO ligne, et le script répondait « ✓ 0 bande construite en 1 s »
# avant de rendre la main, satisfait. L'écran, lui, continuait d'afficher « la
# couverture n'a pas encore été construite ».
#
# La cause est corrigée dans `10-sauvegarder.sh` (le journal est désormais
# exclu avec sa table), mais toute sauvegarde ANTÉRIEURE au 22/09 porte encore
# le défaut — d'où le `--tout` inconditionnel quand la table est vide.
etape "5/6 couverture_rayon_risque"
if [ "$(n public.couverture_rayon_risque)" -gt 0 ]; then
  echo "  déjà construite : $(n public.couverture_rayon_risque) lignes"
else
  node scripts/construire_couverture_rayon.mjs --tout || { echo "ÉCHEC couverture" >&2; exit 1; }
fi
echo "  -> $(n public.couverture_rayon_risque) lignes"

# ── CONTRÔLE ────────────────────────────────────────────────────────────────
#
# Les effectifs attendus sont ceux mesurés le 2026-09-22 après reprise
# complète. Un écart ne fait pas échouer le script — le millésime INSEE ou un
# import de sites les déplacera légitimement — mais il est AFFICHÉ, parce
# qu'une table à moitié construite ne se signale pas autrement.
etape "contrôle"
attendu() { # $1 = table, $2 = effectif de référence
  local v; v=$(n "public.$1")
  if [ "$v" -ge "$2" ]; then printf '  ✓ %-26s %s\n' "$1" "$v"
  else printf '  ⚠ %-26s %s  (attendu ~%s)\n' "$1" "$v" "$2"; fi
}
attendu carreaux_filosofi        2324577
attendu carreau_risque_distance   883451
attendu carreau_risque_nature    1446552
attendu unite_population_totale    35031
attendu couverture_rayon_risque   115962
attendu pprt_niveau_generateur       664
attendu cp_population_totale        6000

# ── LA SAUVEGARDE, ICI ET PAS PLUS TARD ─────────────────────────────────────
#
# C'est exactement ce qui a coûté cher : les pré-calculs du 19 au soir et du 20
# n'étaient dans aucune sauvegarde, parce que la dernière datait du 19 au
# matin. Une construction lourde qui ne se termine pas par une sauvegarde est
# une construction qu'on refera.
if [ "$SANS_SAUVEGARDE" = "0" ]; then
  etape "sauvegarde de ce qui vient d'être construit"
  bash scripts/local/10-sauvegarder.sh
fi

echo ""
echo "✓ Reconstruction terminée en $(( ($(date +%s) - t0) / 60 )) min."
