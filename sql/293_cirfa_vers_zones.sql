-- 293 — Les 93 zones CIRFA de geography_zones rejoignent « Mes zones » de la Marine nationale (2026-10-29)
--
-- Plan : docs/superpowers/plans/2026-10-29-carte-en-parcours-zones.md, T3 et arbitrage A-11 ; Excel n° 23 ; Q-8 de
-- Vincent : MIGRER. Contexte : sql/133 (« Ménage en base du 2026-09-11 ») a gardé geography_zones parce que ses 93
-- lignes sont les zones CIRFA d'avril 2026, la donnée métier du plan média — de la géométrie façonnée, pas un cache —
-- mais AUCUN code ne la lit. Cette migration les rend visibles là où l'on travaille les zones (custom_geo_zones).
--
-- Ce que sont ces formes (properties de chaque ligne) : les territoires d'une bataille d'isochrones V2 en voiture,
-- 30-60 min, sur les CIRFA de métropole (cache_key `battle_v2_full__cirfa__drive__30-60min__metro`, union_mode
-- `tiers_leq_filled`), une zone par CIRFA. D'où, et c'est un ÉCART à A-11 (qui écrivait `type 'import'` avec
-- `parametres`) : la recette `import` du schéma serveur est STRICTE (`format` et `fichier` requis, aucune autre clé)
-- — la recette du plan y aurait été illisible, et « Mes zones » l'aurait affichée « Import GeoJSON (undefined) ».
-- On écrit donc la recette FIGÉE qu'aurait la capture de cette bataille : `{ v: 1, type: 'isochrone', parametres }`
-- (valeurs ≤ 200 caractères, ≤ 20 clés : le schéma l'accepte), `source_type 'isochrone_battle'` (« Battle
-- isochrones » dans Mes zones).
--
-- Règles :
-- - espace « Marine nationale » lu PAR SON NOM ; absent ou en double → exception, rien n'est écrit ;
-- - idempotente : une ligne n'est insérée que si aucune zone ne porte déjà son `geography_zone_id` ;
-- - ne RESSUSCITE pas (relecture 1, m-3) : dès qu'une zone migrée existe dans l'espace, la migration a déjà eu lieu
--   (une seule transaction, tout ou rien) et un nouveau passage n'insère rien — une CIRFA supprimée depuis par
--   l'utilisateur reste supprimée. Limite : si les 93 sont supprimées, un nouveau passage les remet toutes. Les copies
--   (« Dupliquer », sql/294) ne portent pas `origine`, elles ne comptent pas ;
-- - géométrie copiée telle quelle (93 valides, MultiPolygon 4326, mesuré le 29/10) — `ST_MakeValid` +
--   `ST_CollectionExtract` seulement pour une invalide, `ST_Multi` toujours ; bbox par le déclencheur ;
-- - AUCUNE résolution de codes CP / IRIS (règle 2 du § 16.2 : la forme est la vérité ; ⑤ convertit) : compteurs à 0,
--   « Mes zones » les montre sans comptes ;
-- - geography_zones n'est NI modifiée NI supprimée (sa suppression éventuelle est un autre arbitrage).
--
-- Mesuré le 2026-10-29 (local) : 93 lignes, 1 146 Ko de géométrie (pg_column_size ; les « 5 Mo » de sql/133 comptaient
-- aussi geom_simplified et les index), 72 820 sommets (max 1 433), 374 932 km² cumulés ; 0 invalide ; SRID 4326 ;
-- durée de la migration : 0,67 s (second passage : 0,56 s, 0 ligne).

begin;

do $mig$
declare
  v_org uuid;
  v_n integer;
  v_ins integer;
begin
  select count(*) into v_n from public.organizations where name = 'Marine nationale';
  if v_n <> 1 then
    raise exception 'espace « Marine nationale » introuvable ou en double (% ligne(s)) : migration des CIRFA abandonnée', v_n;
  end if;
  select id into v_org from public.organizations where name = 'Marine nationale';
  if exists (select 1 from public.custom_geo_zones
              where org_id = v_org and source_metadata->>'origine' = 'geography_zones') then
    raise notice 'CIRFA : déjà migrées, rien à faire (une zone supprimée depuis n''est pas remise)';
    return;
  end if;

  insert into public.custom_geo_zones (name, description, org_id, created_by, source_type, source_metadata, geometry, recette)
  select g.name,
         'Zone CIRFA d''avril 2026, migrée de geography_zones le 2026-10-29 (sql/293).',
         v_org,
         null,
         'isochrone_battle',
         jsonb_build_object(
           'origine', 'geography_zones', 'geography_zone_id', g.id, 'geography_set_id', g.set_id,
           'label', g.label, 'source_poi_id', g.source_poi_id, 'proprietes', g.properties,
           'surface_km2_source', g.surface_km2, 'cree_le', g.created_at, 'migre_le', '2026-10-29'
         ),
         ST_Multi(case when ST_IsValid(g.geom) then g.geom else ST_CollectionExtract(ST_MakeValid(g.geom), 3) end),
         jsonb_build_object('v', 1, 'type', 'isochrone', 'parametres', jsonb_strip_nulls(jsonb_build_object(
           'origine', 'geography_zones',
           'cree_le', '2026-04-13',
           'categorie', g.properties->>'categorie',
           'mode', g.properties->>'mode',
           'max_palier', g.properties->'max_palier',
           'requested_minutes', g.properties->'requested_minutes',
           'union_mode', g.properties->>'union_mode',
           'cache_key', g.properties->>'cache_key'
         )))
    from public.geography_zones g
   where not exists (
           select 1 from public.custom_geo_zones z
            where z.source_metadata->>'geography_zone_id' = g.id::text
         );
  get diagnostics v_ins = row_count;
  raise notice 'CIRFA : % zone(s) ajoutée(s) à l''espace Marine nationale', v_ins;
end
$mig$;

commit;
