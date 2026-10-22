#!/usr/bin/env bash
# Sauvegarde la base LOCALE, et VÉRIFIE que la sauvegarde se restaure.
#
# ── POURQUOI CE SCRIPT EXISTE ────────────────────────────────────────────────
#
# Depuis l'abandon du projet Supabase hébergé (2026-09-19), le volume Docker est
# la SEULE copie des données. Notamment des 569 698 liaisons radio, récupérées
# de la production juste avant sa suppression : le dump de prod du 17/09 ne les
# contient pas.
#
# ── TROIS PIÈGES, TOUS RENCONTRÉS LE MÊME JOUR ───────────────────────────────
#
# Une première sauvegarde a été prise en `pg_dump` texte. Elle CONTENAIT bien
# les 569 698 lignes — et ne se restaurait pas. Trois causes, dans l'ordre où
# elles sont apparues :
#
# 1. **`\restrict` (PostgreSQL 17.6).** Un dump texte commence par cette
#    méta-commande de sécurité, qui met psql en mode restreint. Dans ce mode,
#    **`\.` — le terminateur de chaque bloc de données — est lui aussi bloqué** :
#    « backslash commands are restricted; only \unrestrict is allowed ». Les
#    lignes de données sont alors interprétées comme du SQL, et le restore rend
#    **568 197 « syntax error »**. D'où le format BINAIRE (`-Fc`), que
#    `pg_restore` lit sans aucune méta-commande psql.
#
# 2. **`OWNER TO` / `SET ROLE`.** Le `postgres` du conteneur Supabase n'est pas
#    superuser : « must be able to SET ROLE "supabase_auth_admin" ». D'où
#    `--no-owner --no-acl`.
#
# 3. **Le schéma `extensions`.** Convention Supabase : `pgcrypto` et
#    `uuid-ossp` y vivent, et des colonnes en dépendent. Sans lui,
#    `poi_france` et `panneaux_affichage` ne se créent pas — silencieusement,
#    au milieu de 58 autres lignes.
#
# ── CE QUI N'EST PAS SAUVEGARDÉ, ET POURQUOI ────────────────────────────────
#
# `carreaux_filosofi` (2 324 577 lignes), `couverture_rayon_risque`
# (115 962) et `carreau_couverture` (2 324 577, sql/266) sont EXCLUES : des
# scripts les reconstruisent (`07-carreaux-insee.sh`,
# `construire_couverture_rayon.mjs`, `construire_carreau_couverture.mjs`). Les
# inclure ferait 4 Go pour de la donnée régénérable.
#
# ── TROIS DANGERS, TROIS PARADES ────────────────────────────────────────────
#
# Cet en-tête disait « ⚠ La sauvegarde atterrit sur le MÊME disque que la base.
# La copier ailleurs. » — un avertissement qui comptait sur la discipline de
# quelqu'un, donc pas une protection. Le 2026-09-22 a montré pourquoi : le
# volume Docker vidé le matin, puis la sauvegarde du 19/09 mise à la corbeille
# à 10h05, pendant la reprise qu'elle rendait possible.
#
#   suppression accidentelle  -> la ROTATION (plusieurs fichiers, pas un seul)
#   perte du poste ou du disque -> la COPIE HORS POSTE, automatique
#   corruption silencieuse    -> la VÉRIFICATION (restauration réelle + droits)
#
# Les trois sont en bas de ce fichier. Aucune ne couvre les deux autres.
set -euo pipefail
cd "$(dirname "$0")/../.."

CONT="supabase_db_genesis_app"
DEST="${DEST_SAUVEGARDE:-C:/GENESIS/_sauvegarde_locale}"
JOUR="$(date +%Y-%m-%d)"
FICHIER="$DEST/local-$JOUR.dump"

mkdir -p "$DEST"

echo "▶ Sauvegarde de la base locale vers $FICHIER"
docker exec "$CONT" pg_dump -U postgres -d postgres \
  -Fc --compress=6 \
  --schema=public --schema=auth \
  --no-owner \
  --exclude-table-data=public.carreaux_filosofi \
  --exclude-table-data=public.couverture_rayon_risque \
  --exclude-table-data=public.couverture_rayon_bandes \
  --exclude-table-data=public.carreau_couverture \
  --exclude-table-data=public.carreau_couverture_bandes \
  --exclude-table-data=public.spatial_ref_sys \
  > "$FICHIER"
# ⚠ `couverture_rayon_bandes` AJOUTÉE aux exclusions le 2026-09-22, et c'est le
# piège le plus vicieux de la reprise : exclure les DONNÉES d'une table sans
# exclure son JOURNAL produit une sauvegarde qui MENT au script de
# reconstruction. Mesuré ce jour-là — après restauration, le journal annonçait
# « 122 bandes déjà construites », la table en portait ZÉRO, et
# `construire_couverture_rayon.mjs` répondait « ✓ 0 bande construite en 1 s »
# puis rendait la main, satisfait. L'écran, lui, affichait toujours « la
# couverture n'a pas encore été construite ».
#
# Règle générale : une table de données régénérable et son journal de
# progression forment un COUPLE. On les exclut tous les deux, ou aucun des deux.
# `carreaux_filosofi` n'a pas ce problème — `07-carreaux-insee.sh` vide et
# recharge, il ne consulte aucun journal.
#
# `carreau_couverture` et `carreau_couverture_bandes` (sql/266, lot 4 T3) :
# exclues ENSEMBLE, pour la même raison. La table pèse plusieurs centaines de Mo
# et se reconstruit en ~5 min depuis les carreaux (`11-reconstruire.sh`, étape
# 5 bis) ; son journal seul ferait croire la construction faite. Son CERTIFICAT
# `carreau_couverture_controle` (sql/268) suit le couple pour la même raison :
# restauré seul, il certifierait une table vide.
# ⚠ `--no-acl` a été RETIRÉ le 2026-09-22, et c'est un quatrième piège, découvert
# en restaurant pour de vrai. Il était là par symétrie avec `--no-owner`, qui lui
# reste nécessaire. Mais une sauvegarde sans ACL ne porte AUCUN `GRANT` : après
# restauration, `anon`, `authenticated` et `service_role` n'ont plus le moindre
# droit sur les 102 tables, et PostgREST répond **401 sur tout** — un code qui
# fait chercher du côté des clés JWT, alors que le corps de la réponse dit
# `42501 permission denied for table profiles`. L'application, elle, n'affiche
# que « Failed to fetch ».
#
# Ce que ça dit de la vérification ci-dessous : elle comptait des lignes, et les
# lignes étaient toutes là. Un dump sans droits restaure parfaitement et ne sert
# à rien. D'où l'assertion de privilèges ajoutée le même jour — elle vérifie ce
# que l'application a besoin de faire, pas ce que `psql -U postgres` peut faire.
# `psql` est superuser sur sa base : il ne verra JAMAIS ce défaut.

taille=$(du -m "$FICHIER" | cut -f1)
echo "  écrit : ${taille} Mo"

# ── LA VÉRIFICATION, QUI EST LA MOITIÉ DU TRAVAIL ───────────────────────────
#
# Une sauvegarde non testée n'est pas une sauvegarde. On la restaure dans une
# base jetable, reproduite À L'IDENTIQUE (schéma `extensions` compris), et on
# compte les lignes des tables qui ne se régénèrent pas.
echo "  vérification : restauration dans une base jetable…"
MSYS_NO_PATHCONV=1 docker exec "$CONT" psql -U postgres -q \
  -c "drop database if exists verif_sauvegarde" \
  -c "create database verif_sauvegarde" >/dev/null

MSYS_NO_PATHCONV=1 docker exec "$CONT" psql -U postgres -d verif_sauvegarde -q -c "
  create schema if not exists extensions;
  create extension if not exists postgis with schema public;
  create extension if not exists pg_trgm with schema public;
  create extension if not exists unaccent with schema public;
  create extension if not exists pgcrypto with schema extensions;
  create extension if not exists \"uuid-ossp\" with schema extensions;" >/dev/null 2>&1

docker cp "$FICHIER" "$CONT:/tmp/verif.dump" >/dev/null
# `|| true` : pg_restore rend 1 pour le seul « schema public already exists »,
# qui est attendu — la base jetable en a déjà un. Les vraies erreurs sont
# comptées juste après.
# Pas de `--no-acl` ici NON PLUS : la vérification doit restaurer exactement ce
# qu'une vraie reprise restaurerait, droits compris. L'y remettre re-créerait le
# défaut du 2026-09-22 tout en affichant un contrôle vert.
MSYS_NO_PATHCONV=1 docker exec "$CONT" pg_restore -U postgres -d verif_sauvegarde \
  --no-owner -j 2 /tmp/verif.dump > "$DEST/verification.log" 2>&1 || true

# Deux erreurs sont ATTENDUES, et il faut savoir pourquoi avant de les tolérer :
#
#  1. `schema "public" already exists` — la base jetable en a déjà un, qui
#     porte PostGIS ; on ne peut pas le recréer sans emporter l'extension dont
#     toutes les colonnes `geometry` dépendent.
#
#  2. `permission denied to change default privileges` — apparue le 2026-09-22
#     avec le retrait de `--no-acl` : le dump emporte désormais les
#     `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`, et le `postgres` du
#     conteneur Supabase n'est PAS superuser, donc ne peut pas fixer les
#     privilèges par défaut d'un AUTRE rôle. Sans consequence — ces lignes ne
#     régissent que des objets créés PLUS TARD par ce rôle, et rien ne crée de
#     table sous ce rôle en local. C'est la même neutralisation que
#     `03-restore-local.sh` applique au dump de prod, pour la même raison.
#
#     ⚠ Ce qui compte vraiment, ce sont les GRANTs sur les tables existantes,
#     et ceux-là passent : l'assertion `has_table_privilege` ci-dessous le
#     vérifie plutôt que de le supposer.
#
# ⚠ ON COMPTE DES MARQUEURS `ERROR:`, PAS DES LIGNES, et ce n'est pas un détail
# de style. `pg_restore -j 2` écrit depuis deux processus : leurs sorties
# s'entrelacent AU MILIEU d'une ligne, et le journal du 2026-09-22 porte
# littéralement « pg_restore:pg_restore: error:  error: could not execute
# query ». Un `grep -c "^pg_restore: error"` rate ces lignes-là, tandis qu'un
# `grep -c` sur le motif attendu en compte d'autres qui n'en sont pas — mesuré
# le même jour : « 2 erreurs dont 4 attendues », soit un garde-fou qui laissait
# passer deux erreurs réelles sans le dire. Le texte de l'erreur, lui, survit
# à l'entrelacement.
graves=$(grep -o 'ERROR:' "$DEST/verification.log" | wc -l | tr -d ' ')
attendues=$(grep -oE 'ERROR:  (schema "public" already exists|permission denied to change default privileges)' \
              "$DEST/verification.log" | wc -l | tr -d ' ')
echo "  erreurs de restauration : ${graves} (dont ${attendues} attendue·s)"

echo ""
MSYS_NO_PATHCONV=1 docker exec "$CONT" psql -U postgres -d verif_sauvegarde -c "
select 'emetteur_radio_stations' as table_restauree, count(*) as lignes from public.emetteur_radio_stations
union all select 'poi_france', count(*) from public.poi_france
union all select 'iris', count(*) from public.iris
union all select 'dsp_campaign_data', count(*) from public.dsp_campaign_data
union all select 'comptages_routiers', count(*) from public.comptages_routiers
union all select 'pprt_perimetres', count(*) from public.pprt_perimetres
union all select 'auth.users', count(*) from auth.users;"

# ── LES DROITS, ET NON LES SEULES LIGNES ───────────────────────────────────
#
# Trois rôles, trois tables témoins choisies pour ce qu'elles prouvent :
# `profiles` (l'app lit les comptes à chaque requête), `poi_france` (la carte),
# `dsp_campaign_data` (les campagnes). `service_role` est celui par lequel
# TOUTES les routes passent (`createAdminClient`) : sans son SELECT, l'app est
# morte même si la base est pleine.
manquants=$(MSYS_NO_PATHCONV=1 docker exec "$CONT" psql -U postgres -d verif_sauvegarde -tAc "
  select count(*) from (
    select r.rolname, t.tbl
      from (values ('anon'),('authenticated'),('service_role')) r(rolname)
      cross join (values ('public.profiles'),('public.poi_france'),
                         ('public.dsp_campaign_data')) t(tbl)
     where not has_table_privilege(r.rolname, t.tbl, 'select')
  ) x")
echo "  droits manquants (3 rôles × 3 tables) : ${manquants}"

MSYS_NO_PATHCONV=1 docker exec "$CONT" psql -U postgres -q -c "drop database if exists verif_sauvegarde" >/dev/null
MSYS_NO_PATHCONV=1 docker exec "$CONT" rm -f /tmp/verif.dump

if [ "${manquants:-9}" != "0" ]; then
  echo ""
  echo "⚠ La sauvegarde se restaure mais SANS LES DROITS : PostgREST répondrait" >&2
  echo "  401 sur tout. Vérifier que pg_dump tourne bien sans --no-acl." >&2
  exit 1
fi

if [ "$graves" -gt "$attendues" ]; then
  echo ""
  echo "⚠ La restauration a rencontré des erreurs INATTENDUES — voir $DEST/verification.log" >&2
  exit 1
fi

echo ""
echo "✓ Sauvegarde vérifiée : elle se restaure et les comptes sont bons."

# ── LA COPIE HORS DU POSTE, ET LA ROTATION ──────────────────────────────────
#
# ⚠ Ces deux blocs ont été ajoutés le 2026-09-22, après DEUX pertes le même
# jour : le volume Docker vidé (images, conteneurs, volumes — plus rien), puis
# la sauvegarde du 19/09 elle-même mise à la corbeille à 10h05, pendant la
# reprise qu'elle rendait possible. Récupérée de la corbeille, vérifiée, et
# c'est cette frayeur-là qui a produit ce qui suit.
#
# Cette ligne disait « ⚠ Elle est sur le même disque que la base. LA COPIER
# AILLEURS. » Un avertissement qui compte sur la discipline de quelqu'un n'est
# pas une protection : il faut que la copie parte toute seule.
#
# Trois dangers, trois parades distinctes — aucune ne couvre les deux autres :
#   suppression accidentelle -> la ROTATION (plusieurs fichiers, pas un seul)
#   perte du poste / du disque -> la COPIE HORS POSTE
#   corruption silencieuse    -> la VÉRIFICATION ci-dessus (restauration réelle)
COPIE="${COPIE_SAUVEGARDE:-$HOME/OneDrive/MAGELIAN_sauvegardes}"
GARDER_LOCAL="${GARDER_LOCAL:-7}"
GARDER_COPIE="${GARDER_COPIE:-3}"

if [ -n "$COPIE" ] && [ "$COPIE" != "aucune" ]; then
  mkdir -p "$COPIE" 2>/dev/null || true
  if [ -d "$COPIE" ]; then
    echo "  copie hors poste -> $COPIE"
    # `cp` puis renommage : un fichier à moitié copié porterait un nom
    # définitif et passerait pour une sauvegarde complète.
    if cp "$FICHIER" "$COPIE/.local-$JOUR.partiel" 2>/dev/null \
       && mv "$COPIE/.local-$JOUR.partiel" "$COPIE/local-$JOUR.dump" 2>/dev/null; then
      echo "  ✓ copiée ($(du -m "$COPIE/local-$JOUR.dump" | cut -f1) Mo)"
    else
      rm -f "$COPIE/.local-$JOUR.partiel" 2>/dev/null
      echo "  ⚠ COPIE HORS POSTE ÉCHOUÉE — la sauvegarde n'existe qu'ici" >&2
    fi
  else
    echo "  ⚠ $COPIE inaccessible — la sauvegarde n'existe que sur ce disque" >&2
  fi
fi

# Rotation : on garde les N plus récentes de chaque côté. Un fichier unique
# écrasé chaque jour n'est pas une sauvegarde — il suffit d'une mauvaise passe
# pour que la seule copie soit la mauvaise.
rotation() { # $1 = dossier, $2 = combien garder
  [ -d "$1" ] || return 0
  ls -1t "$1"/local-*.dump 2>/dev/null | tail -n "+$(( $2 + 1 ))" | while read -r vieux; do
    echo "  rotation : $(basename "$vieux") retirée"
    rm -f "$vieux"
  done
}
rotation "$DEST"  "$GARDER_LOCAL"
rotation "$COPIE" "$GARDER_COPIE"

echo ""
echo "  local : $(ls -1 "$DEST"/local-*.dump 2>/dev/null | wc -l) sauvegarde(s) · copie : $(ls -1 "$COPIE"/local-*.dump 2>/dev/null | wc -l)"
