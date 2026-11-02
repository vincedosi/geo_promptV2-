-- ============================================================================
-- sql/320_unites_constitutives.sql — B15 : l'exactitude PAR COMPOSITION (plan de corrections du découpage des zones,
-- lot 2, 2026-11-02).
--
-- LE CONSTAT. Une zone « seuil sur territoires » est l'union d'IRIS ou de CP ENTIERS (sql/256), une capture de score
-- l'union de CP entiers (`/api/custom-geo/source/score`) : exactes dans cette maille. Seule la recette « liste de CP »
-- était reconnue exacte (`exactitude`, lib/zones/conversion.ts), par son TYPE. Et une liste qui ne contient qu'un
-- membre d'un groupe de CP indiscernables (sql/228) se disait exacte alors que la plateforme achète le groupe entier.
--
-- LE CORRECTIF. La recette garde `unites_constitutives : { maille, codes[], groupes_partiels }` ; `exactitude` lit ce
-- champ (`exacteParComposition`, lib/zones/exactitude-composition.ts), plus le type.
--   1. `zone_seuil_territoire` rend `codes` (triés), même signature, même type de retour (jsonb) : le serveur les pose
--      dans la recette à la création, à la duplication et au recalcul (lib/zones/executer-recette.ts).
--   2. Le trigger d'écriture de `custom_geo_zones` (la fonction de sql/307, reprise telle quelle) :
--      - liste de CP : `unites_constitutives` = { maille: 'cp', codes: recette.codes } — dérivée, jamais divergente ;
--      - autre type que seuil sur territoires, capture ou liste de CP : la clé est retirée ;
--      - maille CP : `groupes_partiels` = les groupes de CP indiscernables (cp_groupe, n_membres > 1) dont la liste
--        contient AU MOINS UN membre et PAS TOUS. Posé par la base à chaque écriture (une valeur du client est écrasée),
--        comme `part_retenue` (A3). Coût : `cp_groupe` parcouru (6 187 lignes, 181 en groupe). Mesuré le 02/11
--        (EXPLAIN ANALYZE, la requête du trigger) : 2 codes 1,7 ms ; 3 000 codes 9,6 ms, 187 buffers construction comprise.
--   3. `remplacer_geometrie_zone_unites` : le recalcul (sql/253) ET la recette mise à jour dans la MÊME transaction
--      (les codes d'un seuil sur territoires changent avec les données) — enveloppe mince de `remplacer_geometrie_zone`,
--      gardée telle quelle.
--
-- LES RECETTES DÉJÀ ENREGISTRÉES. Liste de CP : RECONSTITUÉE par le rattrapage ci-dessous (le trigger dérive le champ).
-- Seuil sur territoires et capture : NON reconstituées — les codes retenus à la création ne sont gardés nulle part
-- (recalculer le seuil lirait les données d'aujourd'hui, pas celles de la forme enregistrée ; les CP d'une capture de
-- score ne sont pas stockés). Elles sont lues NON EXACTES, comme avant B15 (perte calculée, aucun ajustement) ; un
-- recalcul d'un seuil sur territoires pose la liste. Base locale le 02/11 : 0 seuil sur territoires, 0 capture,
-- 0 liste de CP (93 isochrones, 1 rayon POI).
--
-- Rejouable (`create or replace`, rattrapage filtré), aucun DROP. Appliquer par `psql -1`.
-- ⚠ ROUND 1 (I-2) : le trigger et `remplacer_geometrie_zone_unites` sont REDÉFINIS par sql/321 (les unités vont dans
-- une colonne, plus dans le JSON recette). Rejouer cette migration SANS rejouer sql/321 après remettrait l'ancien trigger.
-- ============================================================================

create or replace function public.zone_seuil_territoire(
  p_indicateur text, p_operateur text, p_seuil numeric, p_perimetre_type text, p_perimetre_code text,
  p_org_id uuid, p_max_territoires integer default 5000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  reg record;
  v_expr text;
  v_table text;
  v_extra text := '';
  v_filtre text;
  v_per geometry;
  v_refus text;
  v_codes text[];
  v_n integer;
  v_g geometry;
begin
  if p_operateur is null or p_operateur not in ('>=', '<=') then
    raise exception 'operateur non autorise : %', p_operateur using errcode = '22023';
  end if;
  if p_seuil is null then
    raise exception 'seuil absent' using errcode = '22023';
  end if;
  if p_max_territoires is null or p_max_territoires < 1 or p_max_territoires > 5000 then
    raise exception 'plafond hors bornes (1 a 5 000) : %', p_max_territoires using errcode = '22023';
  end if;

  select * into reg from public.cible_indicator_registry where indicator_code = p_indicateur and active;
  if not found then
    return jsonb_build_object('refus', 'indicateur_inconnu');
  end if;

  -- 100 000 km² : ne refuse en pratique que la France (la plus grande région fait 84 617 km²).
  select r.g, r.refus into v_per, v_refus
    from public.resoudre_perimetre(p_perimetre_type, p_perimetre_code, p_org_id, 100000,
                                   array['region', 'departement', 'commune', 'cp', 'zone']) r;
  if v_refus is not null then
    return jsonb_build_object('refus', v_refus);
  end if;

  if reg.data_source = 'iris_column' then
    v_expr := case when reg.normalize = 'pct_of_population'
                   then format('(t.%I::float / nullif(t.population, 0) * 100)', reg.data_column)
                   else format('t.%I', reg.data_column) end;
    v_filtre := case p_perimetre_type
      when 'region'      then 't.code_region = $4'
      when 'departement' then 't.code_dept = $4'
      -- pas de `code_commune = $4` : la commune de ① est un NOM (résolu par resoudre_perimetre) — on passe par la
      -- géométrie, ce qui couvre aussi Paris, Lyon et Marseille (arrondissements unis)
      else 't.geom && $1 and ST_Intersects(ST_PointOnSurface(t.geom), $1)'
    end;
    execute format(
      'select array_agg(code) from (select t.code_iris as code from public.iris t
        where t.is_true_iris and %s is not null and %s %s $2 and %s limit $3) s',
      v_expr, v_expr, p_operateur, v_filtre)
      into v_codes using v_per, p_seuil, p_max_territoires + 1, p_perimetre_code;
    v_n := coalesce(cardinality(v_codes), 0);   -- code_iris est la clé primaire : déjà distincts
    if v_n > p_max_territoires then
      return jsonb_build_object('refus', 'trop_de_territoires', 'plafond', p_max_territoires);
    end if;
    if v_n > 0 then
      select ST_Multi(ST_Union(geom)) into v_g from public.iris where code_iris = any (v_codes);
    end if;
  else
    v_table := case reg.data_source
      when 'abstention' then 'dataset_abstention_2022'
      when 'pollen'     then 'pollen_map_daily'
      else 'atmo_map_daily' end;
    if reg.data_source in ('pollen', 'atmo') then
      v_extra := format(' and t.date_ech = (select max(date_ech) from public.%I)', v_table);
    end if;
    v_expr := format('t.%I', reg.data_column);
    -- distinct AVANT le limit (même select) : le compte comparé au plafond est un compte de codes, pas de lignes
    execute format(
      'select array_agg(code) from (select distinct t.code_postal as code from public.%I t
         join public.ref_codes_postaux r on r.code_postal = t.code_postal
        where %s is not null and %s %s $2 %s
          and r.geom && $1 and ST_Intersects(ST_PointOnSurface(r.geom), $1) limit $3) s',
      v_table, v_expr, v_expr, p_operateur, v_extra)
      into v_codes using v_per, p_seuil, p_max_territoires + 1;
    v_n := coalesce(cardinality(v_codes), 0);
    if v_n > p_max_territoires then
      return jsonb_build_object('refus', 'trop_de_territoires', 'plafond', p_max_territoires);
    end if;
    if v_n > 0 then
      select ST_Multi(ST_Union(geom)) into v_g from public.ref_codes_postaux where code_postal = any (v_codes);
    end if;
  end if;

  return jsonb_build_object(
    'vide', v_g is null or ST_IsEmpty(v_g),
    'compte', v_n,
    'maille', reg.scale,
    -- B15 (sql/320) : les unités constitutives, triées — la zone est leur union, exacte dans cette maille.
    'codes', coalesce((select jsonb_agg(c order by c) from unnest(v_codes) c), '[]'::jsonb),
    'geometry', case when v_g is null or ST_IsEmpty(v_g) then null else ST_AsGeoJSON(v_g, 6)::jsonb end,
    'surface_km2', case when v_g is null or ST_IsEmpty(v_g) then 0
                        else round((ST_Area(v_g::geography) / 1e6)::numeric, 2) end
  );
end
$fn$;

revoke all on function public.zone_seuil_territoire(text, text, numeric, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.zone_seuil_territoire(text, text, numeric, text, text, uuid, integer) to service_role;

create or replace function public.custom_geo_zones_before_write()
returns trigger
language plpgsql
-- Le réglage d'origine de la fonction, conservé (un `create or replace` sans lui l'effacerait).
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_part numeric;
  v_partiels integer;
begin
  if GeometryType(NEW.geometry) = 'POLYGON' then
    NEW.geometry := ST_Multi(NEW.geometry);
  end if;
  NEW.bbox := ST_Envelope(NEW.geometry);
  NEW.updated_at := now();

  -- A3 (sql/307) : la part du disque retenue sur le territoire, posée par la base, jamais par le client.
  if NEW.recette->>'type' = 'rayon_point'
     and jsonb_typeof(NEW.recette->'lon') = 'number' and jsonb_typeof(NEW.recette->'lat') = 'number'
     and jsonb_typeof(NEW.recette->'rayon_m') = 'number' and (NEW.recette->>'rayon_m')::numeric > 0 then
    v_part := ST_Area(NEW.geometry::geography) / nullif(ST_Area(ST_Buffer(
                ST_SetSRID(ST_MakePoint((NEW.recette->>'lon')::float8, (NEW.recette->>'lat')::float8), 4326)::geography,
                (NEW.recette->>'rayon_m')::float8)), 0);
    if v_part is not null then
      NEW.recette := NEW.recette || jsonb_build_object('part_retenue',
        case when v_part >= 1 - 1e-6 then 1 else least(round(v_part::numeric, 4), 0.9999) end);
    end if;
  end if;

  -- B15 (sql/320) : les unités constitutives. Une liste de CP les dérive de ses codes ; seuls le seuil sur
  -- territoires et la capture en portent d'autres (posées par le serveur) ; toute autre recette n'en a pas.
  if NEW.recette->>'type' = 'codes_postaux' and jsonb_typeof(NEW.recette->'codes') = 'array' then
    NEW.recette := NEW.recette || jsonb_build_object('unites_constitutives',
      jsonb_build_object('maille', 'cp', 'codes', NEW.recette->'codes'));
  elsif NEW.recette->>'type' not in ('seuil_territoire', 'capture') then
    NEW.recette := NEW.recette - 'unites_constitutives';
  end if;
  -- Au CP : les groupes indiscernables présents EN PARTIE (au moins un membre, pas tous) ; la plateforme les achète
  -- entiers, la zone n'est donc pas exacte. Une valeur envoyée par le client est écrasée.
  if NEW.recette->'unites_constitutives'->>'maille' = 'cp'
     and jsonb_typeof(NEW.recette->'unites_constitutives'->'codes') = 'array' then
    select count(*)::integer into v_partiels
      from (select g.code_canonique
              from public.cp_groupe g
              left join (select distinct x as c
                           from jsonb_array_elements_text(NEW.recette->'unites_constitutives'->'codes') x) l
                on l.c = g.code_postal
             where g.n_membres > 1
             group by g.code_canonique
            having bool_or(l.c is not null) and bool_or(l.c is null)) s;
    NEW.recette := jsonb_set(NEW.recette, '{unites_constitutives,groupes_partiels}', to_jsonb(v_partiels));
  elsif NEW.recette ? 'unites_constitutives' then
    NEW.recette := NEW.recette #- '{unites_constitutives,groupes_partiels}';
  end if;
  return NEW;
end
$fn$;

comment on function public.custom_geo_zones_before_write() is
  'Avant ecriture de custom_geo_zones : MultiPolygon, bbox, updated_at ; recette.part_retenue d''un rayon_point (A3, '
  'sql/307) ; recette.unites_constitutives (B15, sql/320) : derivee des codes d''une liste de CP, retiree hors seuil '
  'sur territoires / capture / liste de CP, et groupes_partiels (groupes de CP indiscernables presents en partie) '
  'pose au CP. La zone n''est exacte au CP que si groupes_partiels = 0.';

-- Le recalcul (A-2) avec la recette : la forme ET les unités constitutives, sous le même verrou, dans la même
-- transaction. `p_unites` NULL retire la clé (le trigger la redérive pour une liste de CP).
create or replace function public.remplacer_geometrie_zone_unites(
  p_zone_id uuid, p_org_id uuid, p_geometry_geojson text, p_unites jsonb
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v jsonb;
begin
  if p_unites is not null and jsonb_typeof(p_unites) <> 'object' then
    raise exception 'unites constitutives : un objet est attendu' using errcode = '22023';
  end if;
  v := public.remplacer_geometrie_zone(p_zone_id, p_org_id, p_geometry_geojson);
  if v->>'remplace' = 'true' then
    update public.custom_geo_zones
       set recette = case when p_unites is null then recette - 'unites_constitutives'
                          else recette || jsonb_build_object('unites_constitutives', p_unites) end
     where id = p_zone_id and recette is not null;
  end if;
  return v;
end
$fn$;

comment on function public.remplacer_geometrie_zone_unites(uuid, uuid, text, jsonb) is
  'B15 (sql/320) : remplacer_geometrie_zone, puis recette.unites_constitutives = p_unites (NULL : retiree) dans la meme '
  'transaction. Rend la reponse de remplacer_geometrie_zone.';

revoke all on function public.remplacer_geometrie_zone_unites(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.remplacer_geometrie_zone_unites(uuid, uuid, text, jsonb) to service_role;

-- Rattrapage : les listes de CP enregistrées avant B15 reçoivent leurs unités (le trigger les dérive). Rejouable : la
-- seconde passe ne trouve plus de ligne. ⚠ `updated_at` change sur ces lignes (couverture en cache relue une fois).
update public.custom_geo_zones
   set recette = recette
 where recette->>'type' = 'codes_postaux'
   and not (recette ? 'unites_constitutives');
