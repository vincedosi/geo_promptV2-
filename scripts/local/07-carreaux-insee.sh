#!/usr/bin/env bash
# Charge `carreaux_filosofi` depuis la SOURCE PUBLIQUE INSEE, sans passer par la
# production Supabase.
#
# ── POURQUOI PAS UNE COPIE DE LA PROD ────────────────────────────────────────
#
# `06-rapatrier-carreaux.sh` copie la table depuis Supabase. Il fait une lecture
# séquentielle de 4,6 Go sur une base dont le budget d'I/O a déjà été épuisé une
# fois le 2026-09-18, et il exige un mot de passe de production. Le fichier
# INSEE ne coûte rien à personne et ne demande aucun identifiant.
#
# Et il est STRICTEMENT plus complet : la production ne porte que la métropole
# (2 298 582 carreaux). L'INSEE publie aussi la Martinique et La Réunion, soit
# 25 995 carreaux de plus — 2 324 577 au total.
#
# ── LA SOURCE ────────────────────────────────────────────────────────────────
#
#   https://www.insee.fr/fr/statistiques/fichier/8735162/Filosofi2021_carreaux_200m_csv.zip
#
# Trois CSV, un par zone. NE PAS prendre le parquet de data.gouv.fr : il se
# résout en `carreaux-200m-met-3035.parquet`, métropole SEULE — c'est
# exactement la lacune qu'on répare ici.
#
# Identité du fichier vérifiée avant d'écrire ce script, et pas supposée : sur
# le carreau `CRS3035RES200mN2242800E3635800`, les 31 champs de `metadata`
# concordent un à un avec la ligne du CSV (lcog_geo 09122, ind 29, men 12,
# ind_snv 640748.7, même `idcar_nat`).
#
# ── CE QUE LE FICHIER NE DIT PAS, ET QUI A ÉTÉ MESURÉ ────────────────────────
#
# 1. **Le SRID est DANS l'identifiant, et il change d'une zone à l'autre.**
#    `CRS3035RES200mN2242800E3635800` : métropole 3035, Martinique 5490,
#    La Réunion 2975. Appliquer 3035 aux trois fichiers poserait les carreaux
#    antillais au large du Portugal — sans aucune erreur, la projection étant
#    parfaitement valide.
#
# 2. **N et E donnent le coin SUD-OUEST, pas le centre.** Vérifié contre la
#    géométrie déjà en base : 0,0 m d'écart pour le coin, 142 m pour le centre.
#
# 3. **La reconstruction est fidèle à ~1 mm.** Comparée aux géométries stockées
#    sur 5 000 carreaux : écart de centroïde max 1,1 mm, Hausdorff 1,3 mm,
#    surface 0,26 m² sur 40 000 (6 ppm). L'écart est un dernier bit de `double`
#    entre deux versions de PROJ, pas une erreur de méthode. `ST_Equals` répond
#    quand même « faux » — c'est un test EXACT ; ne pas s'en alarmer.
#
# 4. **`lcog_geo` peut contenir plusieurs communes séparées par une virgule**
#    (`"66061,66179"`). Le champ est alors entre guillemets : tout parseur CSV
#    correct s'en sort, un `cut -d,` non.
#
# ── L'IDENTIFIANT `id` N'EST PAS REPRODUCTIBLE ───────────────────────────────
#
# `carreaux_filosofi.id` est un `bigint` de séquence : il ne se dérive pas de
# `idcar`. Les id locaux ne seront donc PAS ceux de la production. Vérifié avant
# d'écrire ce script : aucune clé étrangère ne pointe vers cette table, aucun
# trigger ne la garnit, et aucun cache applicatif ne stocke d'id de carreau
# (`exposition_cache`, `couverture_rayon_risque` et `seveso_exposition` ne
# gardent que des agrégats). La clé stable est `(idcar, resolution, millesime)`,
# qui porte l'index UNIQUE.
#
# `geom_centroid` reste NULL, comme en production (0 ligne renseignée sur les
# 200 000 du dump) : son index GIST existe, rien ne le remplit ni ne le lit.
set -euo pipefail
cd "$(dirname "$0")/../.."

CONT="supabase_db_genesis_app"
SRC="${INSEE_DIR:-C:/GENESIS/_insee_carreaux}"
MILLESIME="${MILLESIME:-2021}"
# Le chargement final se fait par tranches : un INSERT unique de 2,3 M lignes
# produit ~2 Go de WAL en une seule transaction. Découper laisse les points de
# reprise recycler le journal, et donne une progression (règle CLAUDE.md :
# jamais de traitement DB silencieux).
TRANCHES="${TRANCHES:-12}"

psqll() { MSYS_NO_PATHCONV=1 docker exec -i "$CONT" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

for f in carreaux_200m_met.csv carreaux_200m_mart.csv carreaux_200m_reun.csv; do
  if [ ! -f "$SRC/$f" ]; then
    echo "ERREUR : $SRC/$f introuvable." >&2
    echo "         Télécharger et dézipper Filosofi2021_carreaux_200m_csv.zip dans $SRC" >&2
    exit 1
  fi
done

echo "▶ Chargement des carreaux INSEE 200 m (millésime ${MILLESIME}) dans la base LOCALE"
t0=$(date +%s)

echo "  [1/6] table de transit…"
psqll -q -f - <<'SQL'
drop table if exists public._insee_200m;
-- UNLOGGED : ce contenu est jetable, et ne pas le journaliser divise par deux
-- le coût d'écriture de 470 Mo de CSV.
create unlogged table public._insee_200m (
  -- Aucun index sur cette table : rien ne la lit autrement que par balayage
  -- complet, et un index construit pendant le COPY de 2,3 M lignes ne servirait
  -- qu'à le ralentir.
  idcar_200m text, idcar_1km text, idcar_nat text,
  i_est_200 text, i_est_1km text, lcog_geo text,
  ind numeric, men numeric, men_pauv numeric, men_1ind numeric, men_5ind numeric,
  men_prop numeric, men_fmp numeric, ind_snv numeric, men_surf numeric,
  men_coll numeric, men_mais numeric,
  log_av45 numeric, log_45_70 numeric, log_70_90 numeric, log_ap90 numeric,
  log_inc numeric, log_soc numeric,
  ind_0_3 numeric, ind_4_5 numeric, ind_6_10 numeric, ind_11_17 numeric,
  ind_18_24 numeric, ind_25_39 numeric, ind_40_54 numeric, ind_55_64 numeric,
  ind_65_79 numeric, ind_80p numeric, ind_inc numeric
);
SQL

echo "  [2/6] lecture des trois fichiers…"
for f in carreaux_200m_met.csv carreaux_200m_mart.csv carreaux_200m_reun.csv; do
  printf '        %-26s ' "$f"
  # Le CSV est sur le disque Windows, `psql` est dans le conteneur : on passe
  # par stdin plutôt que par un `docker cp` de 447 Mo.
  cat "$SRC/$f" | psqll -q -c "\\copy public._insee_200m from stdin with (format csv, header true, null '')"
  echo "ok"
done
n_src=$(psqll -tAc "select count(*) from public._insee_200m")
echo "        ${n_src} carreaux lus"

echo "  [3/6] dépose des index (les reconstruire après coûte bien moins cher)…"
psqll -q -f - <<'SQL'
drop index if exists public.idx_carreaux_filosofi_res_mil;
drop index if exists public.idx_carreaux_filosofi_resolution;
drop index if exists public.idx_carreaux_filosofi_geom;
drop index if exists public.idx_carreaux_filosofi_geom_3857;
drop index if exists public.idx_carreaux_filosofi_geom_centroid;
drop index if exists public.idx_carreaux_filosofi_geom_resolution;
alter table public.carreaux_filosofi
  drop constraint if exists carreaux_filosofi_idcar_resolution_millesime_key;
SQL

echo "  [4/6] purge de la table…"
psqll -q -c "truncate public.carreaux_filosofi restart identity"

echo "  [5/6] construction des géométries et insertion…"
for i in $(seq 0 $((TRANCHES - 1))); do
  # Heredoc QUOTÉ et paramètres passés en variables psql. Dans un heredoc NON
  # quoté, le shell mange les antislashs : l'ancre de fin de la regex devrait
  # alors s'écrire échappée, et une fois dans le SQL elle serait un caractère
  # LITTÉRAL au lieu d'une ancre. La regex ne matcherait plus rien, rendrait NULL
  # partout, et le chargement insérerait zéro ligne sans lever la moindre erreur.
  psqll -q -v millesime="${MILLESIME}" -v tranches="${TRANCHES}" -v i="${i}" -f - <<'SQL'
set work_mem = '96MB';
-- ⚠ LES COLONNES `ind`, `ind_18_24`, `ind_25_39`, `ind_40_54` ET `ind_inc`
-- RESTENT VIDES, ET C'EST DÉLIBÉRÉ.
--
-- Elles existent dans la table, et le CSV porte exactement ces valeurs : les
-- remplir demandait cinq mots de plus. Mais elles sont NULL sur les 2 298 582
-- lignes de la PRODUCTION, et tout le code d'exposition lit `metadata->>'ind'`
-- précisément à cause de ça (`population_exposee_site`, sql/180 : « la colonne
-- `ind` existe mais est NULL, la lire rendrait ZERO partout sans erreur »).
--
-- Les remplir ici créerait une seconde source de vérité qui n'existe QU'EN
-- LOCAL. Un développeur écrirait `c.ind`, le verrait marcher sur son poste, et
-- la requête rendrait zéro en production — sans erreur, sans plan différent,
-- sans rien à déboguer. Une base locale n'a de valeur que si ce qui y marche
-- marche aussi ailleurs.
--
-- `tests/integration/exposition-invariants.test.ts` garde cette règle : il
-- échoue dès que `ind` se remplit, en invitant à vérifier « qu'il n'existe pas
-- deux sources ». C'est lui qui a attrapé une première version de ce script.
-- Le jour où la production disparaît, remplir ces colonnes devient la bonne
-- simplification — mais ce jour-là, et pas avant.
insert into public.carreaux_filosofi
  (idcar, resolution, millesime, geom, geom_3857, metadata)
select
  d.idcar_200m, '200m', :'millesime',
  ST_Transform(d.env, 4326),
  ST_Transform(d.env, 3857),
  jsonb_build_object(
    'idcar_1km', d.idcar_1km, 'idcar_nat', d.idcar_nat, 'lcog_geo', d.lcog_geo,
    'ind', d.ind, 'men', d.men, 'men_pauv', d.men_pauv, 'men_1ind', d.men_1ind,
    'men_5ind', d.men_5ind, 'men_prop', d.men_prop, 'men_fmp', d.men_fmp,
    'ind_snv', d.ind_snv, 'men_surf', d.men_surf, 'men_coll', d.men_coll,
    'men_mais', d.men_mais, 'log_av45', d.log_av45, 'log_45_70', d.log_45_70,
    'log_70_90', d.log_70_90, 'log_ap90', d.log_ap90, 'log_inc', d.log_inc,
    'log_soc', d.log_soc, 'ind_0_3', d.ind_0_3, 'ind_4_5', d.ind_4_5,
    'ind_6_10', d.ind_6_10, 'ind_11_17', d.ind_11_17, 'ind_18_24', d.ind_18_24,
    'ind_25_39', d.ind_25_39, 'ind_40_54', d.ind_40_54, 'ind_55_64', d.ind_55_64,
    'ind_65_79', d.ind_65_79, 'ind_80p', d.ind_80p, 'ind_inc', d.ind_inc)
from (
  select s.*,
         -- L'enveloppe est bâtie DANS la projection d'origine, puis transformée.
         -- La bâtir directement en 4326 donnerait un rectangle en degrés, donc
         -- un carreau qui n'est pas carré et ne pave plus le plan.
         ST_MakeEnvelope(s.e, s.n, s.e + 200, s.n + 200, s.srid) as env
    from (
      select t.*,
             (regexp_match(t.idcar_200m, '^CRS([0-9]+)RES200mN([0-9]+)E([0-9]+)$'))[1]::int   as srid,
             (regexp_match(t.idcar_200m, '^CRS([0-9]+)RES200mN([0-9]+)E([0-9]+)$'))[2]::float as n,
             (regexp_match(t.idcar_200m, '^CRS([0-9]+)RES200mN([0-9]+)E([0-9]+)$'))[3]::float as e
        from public._insee_200m t
       where abs(hashtext(t.idcar_200m)) % :tranches = :i
    ) s
   -- Un identifiant qui ne se lit pas est ÉCARTÉ, jamais posé au hasard sur une
   -- projection par défaut. Le compte final le rendrait visible.
   where s.srid is not null
) d;
SQL
  n=$(psqll -tAc "select count(*) from public.carreaux_filosofi")
  printf '        [%3d %%] tranche %2d/%d · %s carreaux · %s s\n' \
    "$(( (i + 1) * 100 / TRANCHES ))" "$((i + 1))" "$TRANCHES" "$n" "$(( $(date +%s) - t0 ))"
done

echo "  [6/6] reconstruction des index…"
psqll -q -f - <<'SQL'
set maintenance_work_mem = '512MB';
alter table public.carreaux_filosofi
  add constraint carreaux_filosofi_idcar_resolution_millesime_key
  unique (idcar, resolution, millesime);
create index idx_carreaux_filosofi_res_mil on public.carreaux_filosofi (resolution, millesime);
create index idx_carreaux_filosofi_resolution on public.carreaux_filosofi (resolution);
create index idx_carreaux_filosofi_geom on public.carreaux_filosofi using gist (geom);
create index idx_carreaux_filosofi_geom_3857 on public.carreaux_filosofi using gist (geom_3857);
create index idx_carreaux_filosofi_geom_centroid on public.carreaux_filosofi using gist (geom_centroid);
create index idx_carreaux_filosofi_geom_resolution on public.carreaux_filosofi using gist (geom) include (resolution);
analyze public.carreaux_filosofi;
drop table public._insee_200m;
SQL

echo ""
psqll -f - <<'SQL'
select count(*)                                          as carreaux,
       count(*) filter (where ST_SRID(geom) <> 4326)     as srid_faux,
       count(*) filter (where geom is null)              as sans_geometrie,
       -- Doit valoir 0 : ces colonnes restent vides pour tenir la parité avec
       -- la production (voir le commentaire de l'insertion).
       count(ind) + count(ind_18_24) + count(ind_25_39)
                  + count(ind_40_54) + count(ind_inc)    as colonnes_en_double,
       to_char(sum((metadata->>'ind')::numeric), 'FM9G999G999G999') as population
  from public.carreaux_filosofi;
SQL
echo "✓ Terminé en $(( $(date +%s) - t0 )) s."
