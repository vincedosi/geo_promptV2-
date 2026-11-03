-- ============================================================================
-- sql/329_categorie_speciale.sql — C29 (plan de corrections du découpage des zones, lot 3, 2026-11-03) : Meta,
-- catégories d'annonces spéciales — une borne au registre, une case sur le jeu de zones.
--
-- LE CONSTAT. La ligne Meta / cercle de `plateformes_geo` portait la règle dans sa NOTE seulement (« Catégorie
-- d'annonces spéciale : rayon d'au moins 15 km en Europe (doc Special Ad Categories, relue le 24/10) ») : aucun code
-- ne la lisait, un jeu de zones en catégorie spéciale achetait des cercles de 1 km sans rien dire.
--
-- LE CORRECTIF.
--   1. `limites.rayon_min_categorie_speciale` : une clé de plus admise par `plateformes_geo_limites_valides` (entier
--      > 0, mètres), et un paramètre de plus admis par `plateformes_geo_parametres_valides` (« à vérifier » par
--      paramètre, amendement E9).
--   2. Meta / cercle : `rayon_min_categorie_speciale` = 15 000 m. SOURCE : la note de la ligne elle-même (relevé du
--      24/10, doc Special Ad Categories de Meta) — reprise, pas inventée ; non marquée « à vérifier », la note disant
--      la doc relue. La note est réécrite pour renvoyer à la borne.
--   3. `zone_sets.categorie_speciale boolean not null default false` : la case du jeu de zones. La règle de rayon
--      minimum la lit (`regleCategorieSpeciale`, lib/zones/conversion-rayon.ts et sa copie Angular) : rayon minimal
--      effectif = le plus grand de `rayon_min_m` et de `rayon_min_categorie_speciale`. Tout ajustement ou refus se dit
--      avec la valeur avant et après (règle 5).
--
-- Rejouable : fonctions par `create or replace`, colonne par `add column if not exists`, valeur et note posées
-- seulement si la clé manque (une valeur corrigée depuis par `update` est gardée). Aucun DROP. Appliquer par `psql -1`.
-- ============================================================================

-- ── 1. Les clés admises (avant les données : les contraintes de la table appellent ces fonctions) ─────────────────────
create or replace function public.plateformes_geo_limites_valides(p_limites jsonb)
returns boolean
language sql immutable set search_path to 'public' as $fn$
  select jsonb_typeof(p_limites) = 'object'
     and coalesce(bool_and(
           e.key in ('max_unites', 'rayon_min_m', 'rayon_max_m', 'pop_min_unite', 'pop_min_groupe', 'max_sommets',
                     'rayon_min_categorie_speciale')
           and jsonb_typeof(e.value) = 'number'
           and e.value::text ~ '^[1-9][0-9]*$'), true)
    from jsonb_each(case when jsonb_typeof(p_limites) = 'object' then p_limites else '{}'::jsonb end) e;
$fn$;
revoke all on function public.plateformes_geo_limites_valides(jsonb) from public, anon, authenticated;
grant execute on function public.plateformes_geo_limites_valides(jsonb) to service_role;

create or replace function public.plateformes_geo_parametres_valides(p text[])
returns boolean
language sql
immutable
set search_path to 'public'
as $fn$
  select p is not null
     and p <@ array['poids_groupe_cp', 'max_unites', 'rayon_min_m', 'rayon_max_m', 'pop_min_unite', 'pop_min_groupe',
                    'max_sommets', 'polygone_sommets_max', 'polygone_morceaux_max',
                    'pop_min_unite_comportement', 'pop_min_groupe_comportement',
                    'rayon_min_categorie_speciale']::text[]
     and cardinality(p) = (select count(distinct x) from unnest(p) x)
$fn$;
revoke all on function public.plateformes_geo_parametres_valides(text[]) from public, anon, authenticated;
grant execute on function public.plateformes_geo_parametres_valides(text[]) to service_role;

-- ── 2. La borne de Meta / cercle, tirée de sa note ───────────────────────────────────────────────────────────────────
update public.plateformes_geo
   set limites = limites || jsonb_build_object('rayon_min_categorie_speciale', 15000),
       note = 'Catégorie d''annonces spéciale : rayon minimal porté par la borne rayon_min_categorie_speciale (15 km en '
              || 'Europe, doc Special Ad Categories, relue le 24/10), appliquée aux jeux cochés « catégorie spéciale ».'
 where plateforme = 'meta' and maille = 'cercle' and not (limites ? 'rayon_min_categorie_speciale');

-- ── 3. La case du jeu de zones ───────────────────────────────────────────────────────────────────────────────────────
alter table public.zone_sets add column if not exists categorie_speciale boolean not null default false;
comment on column public.zone_sets.categorie_speciale is
  'Jeu de zone : annonces en categorie d''annonces speciale (Meta, Special Ad Categories). La regle de rayon '
  'minimum lit plateformes_geo.limites.rayon_min_categorie_speciale quand elle est vraie. sql/329 (C29).';
