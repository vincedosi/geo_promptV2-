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
#     └─ cp_groupe -> cp_population_totale
#          └─ carreau_couverture     (sql/266 : même règle CP, test d'égalité)
#               └─ unite_population_totale, maille `iris` (sql/267 : construite
#                  DEPUIS carreau_couverture — l'étape 4 n'écrit que les trois
#                  autres mailles)
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
etape "0/7 droits des rôles applicatifs"
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
etape "1/7 carreaux_filosofi"
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
etape "2/7 carreau_risque_distance"
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
etape "3/7 carreau_risque_nature"
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
etape "4/7 unite_population_totale"
# ⚠ Compter les seules mailles de sql/221 : la maille `iris` (sql/267) vit dans
# la même table mais se construit à l'étape 5 ter, depuis carreau_couverture.
# Compter toute la table ferait sauter les communes dès qu'un IRIS est présent.
upt_n=$(n "public.unite_population_totale where maille <> 'iris'")
if [ "${upt_n:-0}" -gt 0 ]; then
  echo "  déjà construit : $upt_n lignes (commune, département, région)"
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
# ⚠ AJOUTÉ le 2026-09-22 : `cp_groupe` (sql/228) est un PRÉREQUIS des deux
# remplissages qui suivent. `cp_du_point` la joint pour rendre le code
# CANONIQUE d'un groupe de codes postaux indiscernables, et sans elle la
# jointure ne rend AUCUNE ligne — donc tous les carreaux seraient déclarés
# « sans code postal », en silence. 130 ms, aucune raison de s'en passer.
etape "4bis/7 cp_groupe"
if [ "$(n public.cp_groupe)" -gt 0 ]; then
  echo "  déjà construit : $(n public.cp_groupe) codes postaux"
else
  echo "  $(sql "select public.construire_cp_groupe()")"
fi

etape "4ter/7 carreau_risque_distance.code_postal"
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
# ── 4 quater. LA POPULATION DU CARREAU, À CÔTÉ DE SA DISTANCE ───────────────
#
# ⚠ AJOUTÉ le 2026-09-22 (sql/229). Sans elle, le remplissage des codes
# postaux d'un jeu de zones joint `carreaux_filosofi` — 4,6 Go, 811 octets de
# jsonb par ligne — pour en tirer un nombre par carreau. Mesuré : 0,9 s pour
# lire les distances seules, 11,2 s avec la jointure, et de 12 s à plus de
# 400 s selon le cache sur une construction complète, quand Kong coupe à 60 s.
#
# Ce que ça bloque quand c'est vide : `remplir_zone_set_cp` REFUSE
# (`population_carreau_absente`) plutôt que de replier sur la jointure — deux
# chemins pour la même donnée, c'est deux chemins qui divergent.
etape "4quater/7 carreau_risque_distance.pops"
manquants=$(sql "select count(*) from carreau_risque_distance where pops is null")
if [ "${manquants:-0}" = "0" ]; then
  echo "  déjà remplis : $(n public.carreau_risque_distance) carreaux"
else
  echo "  $manquants carreau(x) sans population — remplissage par lots de 200 000"
  while true; do
    echo "    $(sql "select public.remplir_population_carreau(200000)")"
    reste=$(sql "select count(*) from carreau_risque_distance where pops is null")
    [ "${reste:-0}" = "0" ] && break
  done
fi

etape "5/7 cp_population_totale"
if [ "$(n public.cp_population_totale)" -gt 0 ]; then
  echo "  déjà construit : $(n public.cp_population_totale) codes postaux"
else
  # Une ligne toutes les dix bandes, PAS un retour chariot : le journal est relu
  # APRES coup, souvent dans un fichier, ou un 
 ecrase tout sur une seule
  # ligne illisible — constate sur la passe du 2026-09-22.
  for b in $(seq 0 59); do
    [ $(( b % 10 )) = 0 ] && echo "  metropole : bande $b/59…"
    sql "select public.remplir_cp_population_totale($b, 60)" >/dev/null
  done
  echo "  Martinique : $(sql "select public.remplir_cp_population_totale(0, 1, -61.6, -60.6)" | head -c 70)"
  echo "  La Réunion : $(sql "select public.remplir_cp_population_totale(0, 1, 55.0, 56.0)" | head -c 70)"
fi
echo "  -> $(n public.cp_population_totale) codes postaux"

# ── 5 bis. LA TABLE ÉTROITE DE LA COUVERTURE (sql/266, lot 4 T3) ────────────
#
# Une ligne par carreau (centroïde, CP canonique, IRIS, commune, département,
# 24 effectifs) : c'est ce que lit la couverture d'une zone en ④. Vide, la
# couverture REFUSE (`couverture_non_construite`) — pas de repli, exprès.
#
# APRÈS `cp_population_totale`, parce qu'elle applique la même règle
# (`cp_des_points`, donc `cp_groupe`) et que son test d'intégration exige
# l'égalité CP par CP avec ce dénominateur. ~5 min, 26 bandes.
#
# ⚠ « NON VIDE » NE VEUT PAS DIRE « À JOUR » (leçon du 22/10, étape 6) :
#   - vide                               -> --tout ;
#   - journal antérieur au dénominateur CP -> --tout (contours rechargés) ;
#   - moins de lignes que de carreaux     -> reprise (une bande a échoué).
# Elle n'a pas de date propre : son journal `carreau_couverture_bandes` la
# porte, et le cache de la couverture (T6) s'en sert pour se périmer.
etape "5bis/7 carreau_couverture"
cc_n=$(n public.carreau_couverture)
cc_attendu=$(n public.carreaux_filosofi)
cc_perimee=$(sql "select coalesce((select max(construit_le) from public.carreau_couverture_bandes)
                       < (select max(construit_le) from public.cp_population_totale), false)" | tr -d ' \r')
if [ "${cc_n:-0}" = "0" ] || [ "$cc_perimee" = "t" ]; then
  [ "$cc_perimee" = "t" ] && echo "  PÉRIMÉE : construite avant cp_population_totale — reconstruction"
  node scripts/construire_carreau_couverture.mjs --tout || { echo "ÉCHEC carreau_couverture" >&2; exit 1; }
elif [ "$cc_n" -lt "$cc_attendu" ]; then
  echo "  INCOMPLÈTE : $cc_n lignes pour $cc_attendu carreaux — reprise"
  node scripts/construire_carreau_couverture.mjs || { echo "ÉCHEC carreau_couverture" >&2; exit 1; }
else
  echo "  déjà construite : $cc_n lignes"
fi
echo "  -> $(n public.carreau_couverture) lignes"

# ── 5 ter. LE DÉNOMINATEUR IRIS ─────────────────────────────────────────────
#
# `unite_population_totale`, maille `iris` (sql/267, lot 4 T4) : la population
# de chaque IRIS comptée sur `carreau_couverture` — la même règle que le
# numérateur de la couverture par IRIS, jamais `iris.population`. ≈ 18 s.
#
# Reconstruit si absent OU plus ancien que le journal de carreau_couverture :
# la table de dénominateurs EST sauvegardée, la table étroite NON — après une
# restauration, le dénominateur restauré daterait d'avant la reconstruction de
# la table dont il dérive, et c'est exactement ce que la comparaison voit.
etape "5ter/7 dénominateur IRIS"
iris_perime=$(sql "select coalesce((select max(construit_le) from public.unite_population_totale where maille = 'iris')
                        < (select max(construit_le) from public.carreau_couverture_bandes), true)" | tr -d ' \r')
if [ "$iris_perime" = "t" ]; then
  sql "select public.construire_denominateur_iris()" || { echo "ÉCHEC dénominateur IRIS" >&2; exit 1; }
else
  echo "  déjà construit : $(n "public.unite_population_totale where maille = 'iris'") IRIS"
fi

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
#
# ⚠ « NON VIDE » NE VEUT PAS DIRE « À JOUR » — constaté le 2026-10-22.
#
# Jusqu'à cette date, l'étape sautait dès que la table portait des lignes. Or
# `couverture_rayon_risque` (journal daté du 2026-09-18) était PÉRIMÉE par
# rapport à `carreau_risque_distance` (journal du 2026-09-19) : sa courbe
# nationale rendait 42 409 940 habitants à 10 km quand la table des distances
# n'en compte que 41 025 586 — 1,4 M de trop, et le test de caractérisation
# `zone-risque-caracterisation.test.ts` rouge depuis un mois sans que ce script
# n'y voie rien. Une table pleine et une table juste se ressemblent.
#
# On compare donc les JOURNAUX : `carreau_risque_distance` n'a pas de date, son
# journal `carreau_risque_bandes` la porte (sql/203). Si la couverture a été
# construite AVANT les distances dont elle dérive, elle est reconstruite.
#
# Limite connue : ce contrôle ne voit que l'ordre des deux journaux. Des
# distances restaurées d'une sauvegarde AVEC leur journal, après un rechargement
# des carreaux, passeraient pour fraîches — même défaut aux étapes 4 et 5
# (`unite_population_totale`, `cp_population_totale`), à traiter à part.
etape "6/7 couverture_rayon_risque"
couv_le=$(sql "select coalesce(max(construit_le)::text, '') from public.couverture_rayon_bandes" | tr -d '\r')
dist_le=$(sql "select coalesce(max(construit_le)::text, '') from public.carreau_risque_bandes" | tr -d '\r')
perimee=$(sql "select (select max(construit_le) from public.couverture_rayon_bandes)
                    < (select max(construit_le) from public.carreau_risque_bandes)" | tr -d ' \r')
if [ "$(n public.couverture_rayon_risque)" -gt 0 ] && [ "$perimee" != "t" ]; then
  echo "  déjà construite : $(n public.couverture_rayon_risque) lignes (couverture ${couv_le:-?}, distances ${dist_le:-?})"
else
  [ "$perimee" = "t" ] && echo "  PÉRIMÉE : couverture construite le $couv_le, distances le $dist_le — reconstruction"
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
attendu unite_population_totale    83903   # 35 031 (sql/221) + 48 872 IRIS (sql/267)
attendu couverture_rayon_risque   115962
attendu pprt_niveau_generateur       664
attendu cp_population_totale        6000
attendu carreau_couverture       2324577

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
