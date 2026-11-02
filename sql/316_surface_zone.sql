-- sql/316 — B10 : la SURFACE d'une zone, posée par la base, pour le rayon par défaut de la maille cercle de ⑤.
--
-- LE CONSTAT : sans rayon de recette, le rayon par défaut était 10 km. Une zone plus petite qu'une cellule hexagonale
-- de 10 km (≈ 260 km²) ne retient alors aucun cercle au seuil de 20 % : refus au réglage par défaut.
--
-- LA RÈGLE (angular/.../logique/jeu/mailles-url.ts, `rayonDefautExplique`) : rayon de la recette s'il existe, sinon
-- R = √(surface / π) / 3, borné par la ligne de `plateformes_geo` — l'écran doit donc connaître la surface AVANT tout
-- pavage, avec la recette (liste « Mes zones », détail d'un jeu).
--
-- CE QUE POSE CETTE MIGRATION : `custom_geo_zones.surface_km2`, colonne GÉNÉRÉE (stockée) = surface géodésique de la
-- forme en km². Générée plutôt que calculée par le déclencheur `custom_geo_zones_before_write` : aucune ligne n'est
-- réécrite par un UPDATE (le déclencheur poserait `updated_at := now()`, ce qui périmerait toutes les couvertures en
-- cache par `zone_maj`), et aucun chemin d'écriture ne peut l'oublier. Calculée à l'écriture de la forme, lue gratuitement
-- ensuite : la liste ne relit jamais les géométries. `ST_Area(geography)` et le transtypage sont IMMUTABLE.
--
-- Ajouter la colonne réécrit la table (101 lignes, 3,4 Mo mesurés le 02/11/2026) sous verrou exclusif, une fois.
-- Les écritures existantes nomment leurs colonnes (`creer_zone_recette`, `dupliquer_zone`, `create_custom_geo_zone*`,
-- vérifié) : aucune n'insère dans une colonne générée.
--
-- Rejouable (`add column if not exists`), aucun DROP. `psql -1`.

alter table public.custom_geo_zones
  add column if not exists surface_km2 double precision
  generated always as (ST_Area(geometry::geography) / 1e6) stored;

comment on column public.custom_geo_zones.surface_km2 is
  'Surface geodesique de la forme, en km2 (colonne generee, B10 ; sql/316). Rayon par defaut de la maille cercle de (5) : '
  'sqrt(surface / pi) / 3, borne par plateformes_geo.';
