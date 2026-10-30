-- sql/295 — Les codes postaux d'une zone pour le score composite : la règle de la couverture (④ finitions, T1 ;
-- plan 2026-10-30, arbitrage A-1, écart E1).
--
-- LE DÉFAUT. Le score sur une zone (`POST /api/analyses/score`, `perimetre.type = 'zone'`) passait par la branche
-- `zone` de `codes_postaux_du_perimetre_jsonb` (sql/168, 287) : les CP dont le CENTROÏDE DU CONTOUR CP tombe dans la
-- zone. La couverture « Par code postal » de ④ rattache, elle, chaque CARREAU habité à son CP (`carreaux_de_forme`,
-- sql/269/275). Deux règles pour une même zone : un disque de 2 km en (0,5 ; 45,9) rendait 0 CP au score (« Périmètre
-- vide ») contre 2 en couverture ; la zone composite de 13 001 km², 459 contre 895.
--
-- LA RÈGLE UNIQUE. `codes_postaux_de_zone_jsonb(p_zone, p_org)` rend `{ codes: [...] }` = les `code_postal` distincts,
-- non nuls, triés, de `carreaux_de_forme(geometry, 1)` : exactement les `lignes[*].code` de
-- `couverture_geometrie(…, 'cp')` (égalité d'ensembles prouvée par tests/integration/analyse-finitions.test.ts). Le
-- rang de cible n'y change rien (un carreau a un seul CP) : 1 = `ind`.
--   Refus, comme la couverture : `zone_introuvable` (absente OU d'un autre espace : même réponse), `zone_trop_vaste`
--   (> 100 000 km², la borne de `couverture_geometrie`), `couverture_non_construite` + `motif` (table étroite non
--   certifiée : une liste partielle ne doit pas passer pour la liste de la zone ; certificat ≈ 5 ms, 512 accès).
--   Une zone PAYS (recette `{ type: 'pays', code: 'METRO' | 'FR' }`, sql/296) ne lit aucun carreau : les CP de
--   `cp_population_totale` contenus dans le pays (`pays_contient_code`, sql/296) — exactement les lignes de la
--   couverture nationale « Par code postal » —, AVANT la borne de surface.
--   ⚠ Corps FINAL ici (relecture 1 du groupe A) : sql/296 ne redéfinit plus cette fonction, et rejouer 295 seul ne
--   la fait pas régresser. `pays_contient_code` est créée par 296 ; PL/pgSQL ne la résout qu'à l'exécution, et aucune
--   zone ne peut porter la recette `pays` avant 296 (contrainte `custom_geo_zones_recette_forme`).
--
-- `codes_postaux_du_perimetre_jsonb` n'est PAS modifiée : sa branche `zone` reste pour ses autres appelants éventuels
-- (aucune fonction partagée réécrite).
--
-- Mesuré le 30/10 (EXPLAIN (ANALYZE, BUFFERS) du corps, base locale ; « accès » = hit + read) :
--   zone composite 13 001 km², à froid      1,42 s · 22 479 hit + 3 945 lus · temp 1 233 · 895 CP
--   zone composite, à chaud (2e passe)      0,31 s · 25 866 accès (3 lus) · temp 1 233 · 895 CP
--   disque de 2 km en (0,5 ; 45,9)         0,7 ms · 34 accès · 2 CP (16270, 16450)
--   (cibles du plan : ≤ 0,6 s à chaud, ≤ 40 000 accès ; l'ancienne règle : 36 ms · 6 120 accès · 459 CP)
--   l'appel complet de la fonction, zone composite, à chaud : 0,28-0,35 s · 25 919-27 407 accès (0 lu) · temp 376.
--
-- Droits : service_role. Rejouable (`create or replace`, aucun `drop`).

create or replace function public.codes_postaux_de_zone_jsonb(p_zone uuid, p_org uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  c_max_km2 constant numeric := 100000;
  v_geom    geometry;
  v_recette jsonb;
  v_surface numeric;
  v_motif   text;
  v_codes   jsonb;
begin
  -- Absente OU d'un autre espace : la même réponse, on ne révèle pas qu'elle existe ailleurs.
  select g.geometry, g.recette into v_geom, v_recette
    from public.custom_geo_zones g where g.id = p_zone and g.org_id = p_org;
  if v_geom is null then
    return jsonb_build_object('refus', 'zone_introuvable');
  end if;

  -- Zone pays (sql/296) : les CP de la couverture nationale (`cp_population_totale`), sans lire un carreau ni mesurer
  -- la surface.
  if v_recette->>'type' = 'pays' then
    select coalesce(jsonb_agg(cp.code_postal order by cp.code_postal), '[]'::jsonb) into v_codes
      from public.cp_population_totale cp
     where public.pays_contient_code(v_recette->>'code', cp.code_postal);
    return jsonb_build_object('codes', v_codes);
  end if;

  v_surface := ST_Area(v_geom::geography) / 1e6;
  if v_surface > c_max_km2 then
    return jsonb_build_object('refus', 'zone_trop_vaste', 'surface_km2', round(v_surface, 1), 'plafond_km2', c_max_km2);
  end if;

  v_motif := public.carreau_couverture_complete();
  if v_motif is not null then
    return jsonb_build_object('refus', 'couverture_non_construite', 'motif', v_motif);
  end if;

  select coalesce(jsonb_agg(s.code_postal order by s.code_postal), '[]'::jsonb) into v_codes
    from (select distinct f.code_postal from public.carreaux_de_forme(v_geom, 1) f where f.code_postal is not null) s;

  return jsonb_build_object('codes', v_codes);
end
$fn$;

comment on function public.codes_postaux_de_zone_jsonb(uuid, uuid) is
  'Codes postaux d''une zone de l''espace pour le score composite : CP des carreaux Filosofi dont le centroide est dans '
  'la zone (carreaux_de_forme), la regle de couverture_geometrie(cp). { codes } | { refus: zone_introuvable, '
  'zone_trop_vaste (> 100 000 km2), couverture_non_construite + motif }. Zone pays : CP de cp_population_totale du pays '
  '(pays_contient_code, sql/296), sans carreau. '
  'sql/295 (finitions de l''analyse, T1).';

revoke all on function public.codes_postaux_de_zone_jsonb(uuid, uuid) from public, anon, authenticated;
grant execute on function public.codes_postaux_de_zone_jsonb(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
