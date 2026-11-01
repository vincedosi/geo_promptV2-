-- sql/312 — A7 (plan de corrections du découpage des zones, 2026-10-31, lot 1) : à l'extraction en maille POLYGONE,
-- la forme est SIMPLIFIÉE (Douglas-Peucker, tolérance 50 m), puis son nombre de sommets et de morceaux est contrôlé
-- contre le registre des plateformes ; la perte de population induite par la simplification est chiffrée.
--
-- LE DÉFAUT. La borne de 20 000 sommets (`MAX_SOMMETS_FORME`, lib/zones/recette.ts) ne valait qu'à l'import et au
-- dessin (`figer`, lib/zones/executer-recette.ts). Un rayon autour de milliers de POI, un seuil sur des milliers de
-- carreaux ou une union de 20 zones produisent des multipolygones bien plus lourds, poussés TELS QUELS en maille
-- polygone : `creer_extraction_jeu_zone` copiait `custom_geo_zones.geometry` dans `zone_set_extractions.forme`, que le
-- fichier de la plateforme (format `polygone`) rend sans autre contrôle ; `verifierLimites` ne lisait aucune borne de
-- sommets (lib/zones/conversion.ts, commentaire « max_sommets n'est pas vérifié ici »).
--
-- CE QUE POSE CETTE MIGRATION.
--   1. `plateformes_geo.polygone_sommets_max`, `polygone_morceaux_max` (entiers > 0, ligne `polygone` seulement ; NULL
--      = aucune limite connue). Seed TTD (seule plateforme au polygone natif et disponible) : 20 000 sommets — la borne
--      d'import du produit, pour qu'une forme importable reste extractible — et 2 000 morceaux. AUCUNE des deux n'est
--      relevée dans une doc TTD (doc derrière connexion) : toutes deux dans `parametres_a_verifier` (amendement E9 ;
--      Q29 : dentsu confirme). Posées une fois (une valeur corrigée par `update` n'est pas remise par un rejeu).
--      La clé `limites.max_sommets` (sql/274) reste sans lecteur ni valeur : elle ne disait ni de quelle forme, ni
--      après quelle simplification.
--   2. `plateformes_geo_parametres_valides` : les deux noms admis dans `parametres_a_verifier`.
--   3. `reglages_conversion` : `simplification_polygone_m` = 50 (en dessous de la résolution du carreau, 200 m ; bornée
--      ]0, 200[) et `perte_simplification_affichee` = 0,1 (% de la population de la zone au-delà duquel la perte est
--      affichée ; bornée [0, 100]).
--   4. `forme_simplifiee(p_geom, p_tolerance_m)` → geometry : LA simplification (une seule copie, lue par 5 et 6).
--      Douglas-Peucker topologique (`ST_SimplifyPreserveTopology`) en Web Mercator (conforme : la tolérance est
--      isotrope), tolérance multipliée par 1/cos(latitude d'un point de la forme) pour valoir des mètres AU SOL à cette
--      latitude. Si aucun sommet n'est retiré, la forme d'origine est rendue TELLE QUELLE (pas d'aller-retour de
--      projection qui bougerait les coordonnées). Une sortie invalide (cas rare) est réparée par `ST_MakeValid`.
--   5. `simplification_polygone(p_zone_id, p_org_id, p_cible)` → jsonb : sommets et morceaux avant / après, tolérance,
--      et la population PERDUE (habitants de la zone hors de la forme simplifiée) et GAGNÉE (habitants hors zone dans
--      la forme simplifiée), par la règle des carreaux d'une forme (`carreaux_de_forme_menages` : centroïde dans la
--      forme, minimum de ménages de la cible, A5). Seuls les carreaux de la BANDE (différence symétrique des deux
--      formes, au plus 50 m de large) sont lus : la population de la zone, déjà chiffrée par la couverture `forme`,
--      n'est pas relue. Aucun carreau lu si rien n'a été simplifié.
--   6. `creer_extraction_jeu_zone` : `forme` = la forme SIMPLIFIÉE quand le jeu a une plateforme au polygone (celle que
--      le fichier envoie, celle dont les sommets ont été comptés), la forme telle quelle sinon. Corps recopié de
--      sql/306, seule la ligne marquée A7 change ; même signature, mêmes droits.
--
-- MESURES (01/11, base locale, à chaud) :
--   composite `919ca65d` (23 073 sommets, 565 morceaux, 13 001 km², 11,2 M hab.) → 19 574 sommets, 565 morceaux ;
--     bande 368 carreaux, perdue 28 164 (0,25 %), gagnée 37 562 ; 0,19 à 0,93 s. Lecture de la bande seule (EXPLAIN
--     ANALYZE) : 61 ms, 16 693 accès, `idx_carreau_couverture_centroide`, aucun parcours séquentiel ;
--   2 000 disques de 500 m (grille, Toulouse ; 66 000 sommets, 2 000 morceaux, 236 697 hab.) → 18 000 sommets,
--     sous la borne TTD ; bande 954 carreaux, perdue 19 828 (8,4 % : un disque de 500 m simplifié à 50 m est un
--     polygone inscrit) ; 0,28 s ;
--   les mêmes à 1 km → 34 000 sommets : refusés par la borne TTD (20 000).
--
-- Rejouable : `add column if not exists`, contraintes gardées par `do`, `on conflict do nothing`, `create or replace`,
-- aucun DROP. Appliquer par `psql -1`.

-- ── 1. Les bornes du polygone, par plateforme ────────────────────────────────────────────────────────────────────────
alter table public.plateformes_geo add column if not exists polygone_sommets_max integer;
alter table public.plateformes_geo add column if not exists polygone_morceaux_max integer;

do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plateformes_geo'::regclass and conname = 'plateformes_geo_polygone_bornes_valides') then
    alter table public.plateformes_geo add constraint plateformes_geo_polygone_bornes_valides check (
      (polygone_sommets_max is null or (maille = 'polygone' and polygone_sommets_max > 0))
      and (polygone_morceaux_max is null or (maille = 'polygone' and polygone_morceaux_max > 0)));
  end if;
end
$do$;

comment on column public.plateformes_geo.polygone_sommets_max is
  'Ligne polygone : nombre maximal de sommets (anneaux compris) de la forme envoyee, APRES simplification '
  '(simplification_polygone_m). Au-dela : extraction refusee avec les nombres obtenus. NULL = aucune limite connue. '
  'sql/312 (A7).';
comment on column public.plateformes_geo.polygone_morceaux_max is
  'Ligne polygone : nombre maximal de morceaux (polygones d''un multipolygone) de la forme envoyee, apres '
  'simplification. Au-dela : extraction refusee avec les nombres obtenus. NULL = aucune limite connue. sql/312 (A7).';

-- ── 2. Les paramètres « à vérifier » admis ───────────────────────────────────────────────────────────────────────────
create or replace function public.plateformes_geo_parametres_valides(p text[])
returns boolean
language sql immutable set search_path to 'public' as $fn$
  select p is not null
     and p <@ array['poids_groupe_cp', 'max_unites', 'rayon_min_m', 'rayon_max_m', 'pop_min_unite', 'pop_min_groupe',
                    'max_sommets', 'polygone_sommets_max', 'polygone_morceaux_max']::text[]
     and cardinality(p) = (select count(distinct x) from unnest(p) x)
$fn$;
revoke all on function public.plateformes_geo_parametres_valides(text[]) from public, anon, authenticated;
grant execute on function public.plateformes_geo_parametres_valides(text[]) to service_role;

-- Seed TTD, posé une fois : ni l'une ni l'autre valeur n'est encore posée. Les deux noms rejoignent
-- `parametres_a_verifier` sans doublon.
update public.plateformes_geo
   set polygone_sommets_max = 20000,
       polygone_morceaux_max = 2000,
       parametres_a_verifier = array(select distinct x from unnest(parametres_a_verifier
                                       || array['polygone_sommets_max', 'polygone_morceaux_max']::text[]) x order by x)
 where plateforme = 'ttd' and maille = 'polygone'
   and polygone_sommets_max is null and polygone_morceaux_max is null;

-- ── 3. Les réglages de la simplification ─────────────────────────────────────────────────────────────────────────────
insert into public.reglages_conversion (cle, valeur, description)
values ('simplification_polygone_m', 50,
        'Extraction en maille polygone : tolerance de la simplification Douglas-Peucker de la forme envoyee, en metres '
        'au sol, en dessous de la resolution du carreau (200 m). sql/312 (A7).'),
       ('perte_simplification_affichee', 0.1,
        'Extraction en maille polygone : part de la population de la zone (en %) au-dela de laquelle la population '
        'perdue par la simplification est affichee. sql/312 (A7).')
on conflict (cle) do nothing;

do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.reglages_conversion'::regclass and conname = 'reglages_conversion_simplification_bornee') then
    alter table public.reglages_conversion
      add constraint reglages_conversion_simplification_bornee
      check (cle <> 'simplification_polygone_m' or (valeur > 0 and valeur < 200));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.reglages_conversion'::regclass and conname = 'reglages_conversion_perte_affichee_bornee') then
    alter table public.reglages_conversion
      add constraint reglages_conversion_perte_affichee_bornee
      check (cle <> 'perte_simplification_affichee' or (valeur >= 0 and valeur <= 100));
  end if;
end
$do$;

-- ── 4. LA simplification ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.forme_simplifiee(p_geom geometry, p_tolerance_m numeric)
returns geometry
language plpgsql
immutable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_s geometry;
begin
  if p_geom is null then
    return null;
  end if;
  if p_tolerance_m is null or p_tolerance_m <= 0 then
    raise exception 'tolerance de simplification hors bornes : %', p_tolerance_m using errcode = '22023';
  end if;
  -- Web Mercator est conforme : une tolérance y est isotrope, à l'échelle 1/cos(latitude). La latitude d'un point DE
  -- la forme (`ST_PointOnSurface`) : à 50 m, l'écart d'échelle d'un bout à l'autre d'une région reste sous 15 %.
  v_s := ST_Transform(
           ST_SimplifyPreserveTopology(
             ST_Transform(p_geom, 3857),
             (p_tolerance_m / cos(radians(ST_Y(ST_PointOnSurface(p_geom)))))::double precision),
           ST_SRID(p_geom));
  -- Rien de retiré : la forme d'origine, à l'octet près (l'aller-retour de projection bougerait les coordonnées).
  if ST_NPoints(v_s) = ST_NPoints(p_geom) then
    return p_geom;
  end if;
  if not ST_IsValid(v_s) then
    v_s := ST_CollectionExtract(ST_MakeValid(v_s), 3);
  end if;
  return v_s;
end
$fn$;
comment on function public.forme_simplifiee(geometry, numeric) is
  'LA simplification d''une forme envoyee en maille polygone : Douglas-Peucker topologique en Web Mercator, tolerance '
  'en metres au sol (echelle 1/cos(latitude)). Rend la forme d''origine si aucun sommet n''est retire. Lue par '
  'simplification_polygone et creer_extraction_jeu_zone. sql/312 (A7).';
revoke all on function public.forme_simplifiee(geometry, numeric) from public, anon, authenticated;
grant execute on function public.forme_simplifiee(geometry, numeric) to service_role;

-- ── 5. Le contrôle et la perte ───────────────────────────────────────────────────────────────────────────────────────
create or replace function public.simplification_polygone(p_zone_id uuid, p_org_id uuid, p_cible text default 'ind')
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  -- Borne de SÉCURITÉ des carreaux lus dans la bande : celle de `couverture_geometrie` (400 000) ; la bande est
  -- contenue dans la zone élargie de la tolérance, déjà chiffrée sous cette borne par la couverture `forme`.
  c_max_carreaux constant integer := 400000;
  v_geom     geometry;
  v_simple   geometry;
  v_geom_m   geometry;              -- les deux formes en 3857, transformées UNE fois (pas une fois par carreau)
  v_simple_m geometry;
  v_tol      numeric;
  v_rang     integer;
  v_rang_men integer;
  v_min      numeric;
  v_n_lus    bigint := 0;
  v_perdue   numeric := 0;
  v_gagnee   numeric := 0;
begin
  select g.geometry into v_geom from public.custom_geo_zones g where g.id = p_zone_id and g.org_id = p_org_id;
  if v_geom is null then
    return jsonb_build_object('refus', 'zone_introuvable');
  end if;
  select ce.rang_pop into v_rang from public.cibles_exposition ce
   where ce.code = p_cible and ce.actif and ce.rang_pop is not null;
  if v_rang is null then
    return jsonb_build_object('refus', 'cible_inconnue');
  end if;
  -- A5 : le minimum de ménages de la cible, la règle de `couverture_geometrie` (0 pour la population totale).
  v_min := public.min_menages_de_cible(p_cible);
  select ce.rang_pop into v_rang_men from public.cibles_exposition ce where ce.code = 'men' and ce.rang_pop is not null;
  if v_min > 0 and v_rang_men is null then
    raise exception 'cible men (menages) absente de cibles_exposition : le minimum ne peut pas se lire' using errcode = '55000';
  end if;

  v_tol := public.reglage_conversion('simplification_polygone_m');
  v_simple := public.forme_simplifiee(v_geom, v_tol);

  -- La bande : seuls ses carreaux peuvent changer de côté. Un centroïde est « dans » une forme par `ST_Intersects`
  -- (bord compris), la règle de `carreaux_de_forme_menages` : perdu = dans la zone et pas dans la forme simplifiée.
  if v_simple is distinct from v_geom then
    v_geom_m := ST_Transform(v_geom, 3857);
    v_simple_m := ST_Transform(v_simple, 3857);
    with b as materialized (
      select f.pop,
             ST_Intersects(f.centroide_3857, v_geom_m)   as dans_zone,
             ST_Intersects(f.centroide_3857, v_simple_m) as dans_simple
        from public.carreaux_de_forme_menages(ST_SymDifference(v_geom, v_simple), v_rang, coalesce(v_rang_men, v_rang)) f
       where v_min = 0 or f.men >= v_min
       limit c_max_carreaux + 1
    )
    select count(*),
           coalesce(sum(b.pop) filter (where b.dans_zone and not b.dans_simple), 0),
           coalesce(sum(b.pop) filter (where b.dans_simple and not b.dans_zone), 0)
      into v_n_lus, v_perdue, v_gagnee
      from b;
    if v_n_lus > c_max_carreaux then
      return jsonb_build_object('refus', 'trop_de_carreaux', 'plafond', c_max_carreaux);
    end if;
  end if;

  return jsonb_build_object(
    'tolerance_m', v_tol,
    'simplifiee', v_simple is distinct from v_geom,
    'sommets_avant', ST_NPoints(v_geom),
    'morceaux_avant', ST_NumGeometries(v_geom),
    'sommets', ST_NPoints(v_simple),
    'morceaux', ST_NumGeometries(v_simple),
    'carreaux_bande', v_n_lus,
    'perdue', round(v_perdue),
    'gagnee', round(v_gagnee),
    'min_menages', v_min,
    'seuil_perte_affichee', public.reglage_conversion('perte_simplification_affichee')
  );
end
$fn$;
comment on function public.simplification_polygone(uuid, uuid, text) is
  'Extraction en maille polygone : la forme de la zone simplifiee (forme_simplifiee, tolerance simplification_polygone_m), '
  'ses sommets et morceaux avant / apres, et la population perdue / gagnee par la simplification (carreaux de la bande '
  'seulement, regle de carreaux_de_forme_menages, minimum de menages de la cible). sql/312 (A7).';
revoke all on function public.simplification_polygone(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.simplification_polygone(uuid, uuid, text) to service_role;

-- ── 6. creer_extraction_jeu_zone : la forme figée est celle qui part ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.creer_extraction_jeu_zone(p_zone_set_id uuid, p_cp jsonb, p_unites jsonb, p_resume jsonb, p_origine text DEFAULT 'initiale'::text, p_commentaire text DEFAULT ''::text, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t0          timestamptz := clock_timestamp();
  v_jeu         public.zone_sets%rowtype;
  v_cp          jsonb := coalesce(p_cp, '[]'::jsonb);
  v_unites      jsonb := coalesce(p_unites, '[]'::jsonb);
  v_resumes     jsonb := case when jsonb_typeof(p_resume -> 'plateformes') = 'array'
                              then p_resume -> 'plateformes' else '[]'::jsonb end;
  v_plateformes jsonb;
  v_seuil       numeric;
  v_empreinte   text;
  v_existante   public.zone_set_extractions%rowtype;
  v_version     int;
  v_id          uuid;
  v_n_cp        int;
  v_n_unites    int;
begin
  select * into v_jeu from public.zone_sets where id = p_zone_set_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'jeu_introuvable');
  end if;
  if v_jeu.type <> 'zone' then
    return jsonb_build_object('ok', false, 'error', 'type_non_zone');
  end if;
  -- Deux tests et non un `or` : SQL ne garantit pas l'ordre d'évaluation, et jsonb_array_length lève sur un objet.
  if jsonb_typeof(v_cp) <> 'array' or jsonb_typeof(v_unites) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'plan_vide');
  end if;
  if jsonb_array_length(v_cp) + jsonb_array_length(v_unites) = 0 then
    return jsonb_build_object('ok', false, 'error', 'plan_vide');
  end if;

  if exists (select 1 from jsonb_array_elements(v_unites) e
              where not exists (select 1 from public.zone_set_plateformes zp
                                 where zp.zone_set_id = p_zone_set_id
                                   and zp.plateforme = e ->> 'plateforme' and zp.maille = e ->> 'maille'))
     or (jsonb_array_length(v_cp) > 0
         and not exists (select 1 from public.zone_set_plateformes
                          where zone_set_id = p_zone_set_id and maille = 'cp')) then
    return jsonb_build_object('ok', false, 'error', 'unites_hors_choix');
  end if;

  -- Le CHOIX vient de la base, les CHIFFRES du résumé calculé par le serveur : le choix l'emporte sur une clé
  -- homonyme du résumé, un résumé ne réécrit pas ce qui a été enregistré.
  select coalesce(jsonb_agg(coalesce(r.resume, '{}'::jsonb)
                            || jsonb_build_object('plateforme', zp.plateforme, 'maille', zp.maille,
                                                  'seuil', zp.seuil, 'rayon_m', zp.rayon_m)
                            order by zp.plateforme), '[]'::jsonb)
    into v_plateformes
    from public.zone_set_plateformes zp
    left join lateral (select e as resume from jsonb_array_elements(v_resumes) e
                        where jsonb_typeof(e) = 'object' and e ->> 'plateforme' = zp.plateforme
                        limit 1) r on true
   where zp.zone_set_id = p_zone_set_id;

  -- `seuil_couverture_cp` dit le seuil du PLAN CP de cette extraction : le plus bas des plateformes au CP (le plan
  -- est leur sur-ensemble, décision du contrôleur, relecture T6) ; à défaut (aucune plateforme au CP), la valeur du
  -- jeu. Le seuil de chaque plateforme est dans `plateformes`, ses CP dans `zone_set_extraction_unites`.
  select min(seuil) into v_seuil from public.zone_set_plateformes
   where zone_set_id = p_zone_set_id and maille = 'cp';
  v_seuil := coalesce(v_seuil, v_jeu.seuil_couverture_cp);

  select md5(concat_ws('|',
           v_jeu.mode_plan,
           (select string_agg(concat_ws(':', plateforme, maille, seuil::text, coalesce(rayon_m::text, '')), ','
                              order by plateforme)
              from public.zone_set_plateformes where zone_set_id = p_zone_set_id),
           (select coalesce(string_agg(k, ',' order by k collate "C"), '')
              from (select concat_ws(':', e ->> 'code_postal',
                                     round(coalesce((e ->> 'multiplicateur')::numeric, 0), 3)::text) as k
                      from jsonb_array_elements(v_cp) e) c),
           (select coalesce(string_agg(k, ',' order by k collate "C"), '')
              from (select concat_ws(':', e ->> 'plateforme', e ->> 'maille', coalesce(e ->> 'code', ''),
                                     coalesce(round((e ->> 'lon')::numeric, 6)::text, ''),
                                     coalesce(round((e ->> 'lat')::numeric, 6)::text, ''),
                                     coalesce(e ->> 'rayon_m', ''),
                                     coalesce((e ->> 'retenu')::boolean, false)::text,
                                     coalesce(round((e ->> 'part')::numeric, 3)::text, ''),
                                     coalesce(round((e ->> 'pop_en_zone')::numeric)::text, ''),
                                     coalesce(round((e ->> 'pop_totale')::numeric)::text, '')) as k
                      from jsonb_array_elements(v_unites) e) u)))
    into v_empreinte;

  -- ⚠ Le verrou couvre la lecture d'idempotence ET l'attribution du numéro (leçon de sql/159, comme sql/231).
  perform pg_advisory_xact_lock(hashtext('zone_set_extraction'), hashtext(p_zone_set_id::text));

  select * into v_existante from public.zone_set_extractions
   where zone_set_id = p_zone_set_id and empreinte = v_empreinte;
  if found then
    return jsonb_build_object(
      'ok', true, 'deja_extraite', true,
      'id', v_existante.id, 'version', v_existante.version,
      'origine', v_existante.origine, 'created_at', v_existante.created_at,
      'n_cp', v_existante.n_cp, 'n_retenus', v_existante.n_retenus,
      'taux_utile', v_existante.taux_utile, 'part_plan_en_zone', v_existante.part_plan_en_zone,
      'plateformes', v_existante.plateformes,
      'duree_ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000));
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.zone_set_extractions where zone_set_id = p_zone_set_id;

  insert into public.zone_set_extractions (
    zone_set_id, version, origine, commentaire, seuil_couverture_cp, mode_plan,
    n_cp, n_retenus, taux_utile, part_plan_en_zone, population_exposee,
    empreinte, created_by, plateformes, forme, resume_plan
  ) values (
    p_zone_set_id, v_version,
    coalesce(nullif(p_origine, ''), 'initiale'), coalesce(p_commentaire, ''),
    v_seuil, v_jeu.mode_plan,
    coalesce((p_resume ->> 'n_cp')::int, jsonb_array_length(v_cp)),
    coalesce((p_resume ->> 'n_retenus')::int, 0),
    (p_resume ->> 'taux_utile')::numeric,
    (p_resume ->> 'part_plan_en_zone')::numeric,
    coalesce((p_resume ->> 'population_exposee')::numeric, 0),
    v_empreinte, p_created_by, v_plateformes,
    -- A7 (sql/312) : au polygone, la forme SIMPLIFIÉE — celle que le fichier envoie et dont l'extraction a compté les
    -- sommets et les morceaux (`simplification_polygone`, même fonction, même réglage) ; telle quelle sinon.
    (select case when exists (select 1 from public.zone_set_plateformes zp
                               where zp.zone_set_id = p_zone_set_id and zp.maille = 'polygone')
                 then public.forme_simplifiee(z.geometry, public.reglage_conversion('simplification_polygone_m'))
                 else z.geometry end
       from public.custom_geo_zones z where z.id = v_jeu.custom_geo_zone_id),
    -- A8 (sql/306) : le bilan du plan CP (séquence E4 et ligne HORS_ZONE, A1) et la façon dont la part prévue a été
    -- formée. Avant sql/306 ce bilan était envoyé puis JETÉ : la ligne HORS_ZONE n'était figée nulle part.
    nullif(jsonb_strip_nulls(jsonb_build_object('multiplicateur', p_resume -> 'multiplicateur',
                                                'part_prevue', p_resume -> 'part_prevue')), '{}'::jsonb)
  )
  returning id into v_id;

  -- Les CP : mêmes colonnes et mêmes replis que sql/231 ; pas de grappe pour un jeu de zone.
  insert into public.zone_set_extraction_cp (
    extraction_id, code_postal, code_canonique, classe, pop_en_zone, pop_totale, part_en_zone, retenu, multiplicateur,
    part_prevue
  )
  select v_id, e ->> 'code_postal',
         coalesce(nullif(e ->> 'code_canonique', ''), e ->> 'code_postal'),
         coalesce(e ->> 'classe', 'hors'),
         (e ->> 'pop_en_zone')::numeric, (e ->> 'pop_totale')::numeric, (e ->> 'part_en_zone')::numeric,
         coalesce((e ->> 'retenu')::boolean, false),
         least(greatest(coalesce((e ->> 'multiplicateur')::numeric, 0), 0), 999.999),
         (e ->> 'part_prevue')::numeric  -- A8 : part prévue E5, NULL hors plan ou à volume inconnu
    from jsonb_array_elements(v_cp) e
  on conflict (extraction_id, code_postal) do nothing;
  get diagnostics v_n_cp = row_count;

  insert into public.zone_set_extraction_unites (
    extraction_id, plateforme, maille, ordinal, code, nom, centre, rayon_m, pop_en_zone, pop_totale, part, retenu
  )
  select v_id, e ->> 'plateforme', e ->> 'maille',
         row_number() over (partition by e ->> 'plateforme', e ->> 'maille' order by n),
         nullif(e ->> 'code', ''), nullif(e ->> 'nom', ''),
         case when e ? 'lon' and e ? 'lat'
              then ST_SetSRID(ST_MakePoint((e ->> 'lon')::float8, (e ->> 'lat')::float8), 4326) end,
         (e ->> 'rayon_m')::int,
         (e ->> 'pop_en_zone')::numeric, (e ->> 'pop_totale')::numeric, (e ->> 'part')::numeric,
         coalesce((e ->> 'retenu')::boolean, false)
    from jsonb_array_elements(v_unites) with ordinality t(e, n);
  get diagnostics v_n_unites = row_count;

  return jsonb_build_object(
    'ok', true, 'deja_extraite', false,
    'id', v_id, 'version', v_version,
    'origine', coalesce(nullif(p_origine, ''), 'initiale'),
    'lignes_ecrites', v_n_cp, 'unites_ecrites', v_n_unites,
    'n_cp', coalesce((p_resume ->> 'n_cp')::int, jsonb_array_length(v_cp)),
    'n_retenus', coalesce((p_resume ->> 'n_retenus')::int, 0),
    'taux_utile', (p_resume ->> 'taux_utile')::numeric,
    'part_plan_en_zone', (p_resume ->> 'part_plan_en_zone')::numeric,
    'plateformes', v_plateformes,
    'duree_ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000));
end $function$;

revoke all on function public.creer_extraction_jeu_zone(uuid, jsonb, jsonb, jsonb, text, text, uuid) from public, anon, authenticated;
grant execute on function public.creer_extraction_jeu_zone(uuid, jsonb, jsonb, jsonb, text, text, uuid) to service_role;

notify pgrst, 'reload schema';
