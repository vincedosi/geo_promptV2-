-- sql/211 — Figer un profil en jeu de zones
--           (2026-09-20)
--
-- ── UN SEUL CORPS POUR LA GÉOMÉTRIE ───────────────────────────────────────
--
-- La géométrie n'est PAS recalculée ici : `construire_zones_risque` (sql/205)
-- la produit déjà, avec sa priorité transcrite en `ST_Difference` (le seuil
-- haut l'emporte en entier, le périmètre publié prime sur la bande). On
-- l'appelle, puis on COPIE.
--
-- Recopier cette logique en donnerait deux versions qui divergent au premier
-- correctif — et l'écran montrerait alors des zones que le plan ne compte pas.
--
-- ── CE QUI EST REFUSÉ, ET POURQUOI ON LE DIT ──────────────────────────────
--
-- ⚠ `carreau_risque_distance` (sql/203) a été construite avec un prédicat
-- FIXE : Seveso haut et bas, TOUTES natures, sites actifs. Un filtre de nature
-- ne peut donc pas être honoré par le pré-calcul.
--
-- Deux façons de traiter ce trou : ignorer le filtre en silence — l'écran
-- afficherait « Explosibles » et compterait tout — ou refuser en le disant.
-- On refuse. Un filtre affiché mais non appliqué est exactement la famille de
-- défaut que ce chantier existe pour fermer.

create or replace function public.construire_zone_set(p_zone_set_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_jeu      record;
  v_code     text;
  v_geoms    int;
  v_cp       int;
  v_retenus  int;
  v_exposee  numeric;
  v_utile    numeric;
  v_t0       timestamptz := clock_timestamp();
begin
  set local statement_timeout = '15min';
  set local work_mem = '64MB';

  select * into v_jeu from public.zone_sets where id = p_zone_set_id;
  if v_jeu is null then
    return jsonb_build_object('error', 'jeu_introuvable', 'ok', false);
  end if;

  -- ⚠ Refus explicite plutôt qu'un filtre avalé en silence.
  if coalesce(array_length(v_jeu.natures, 1), 0) > 0 then
    return jsonb_build_object(
      'error', 'filtre_nature_non_supporte', 'ok', false,
      'detail', 'Le pre-calcul des distances porte toutes les natures de risque. '
                || 'Un filtre par nature ne peut pas etre honore sans le reconstruire.');
  end if;

  if not exists (select 1 from public.carreau_risque_distance) then
    return jsonb_build_object(
      'error', 'precalcul_absent', 'ok', false,
      'detail', 'node scripts/construire_carreau_risque.mjs');
  end if;

  v_code := v_jeu.profil_hash;

  -- ── 1. La géométrie, empruntée au cache de profil ───────────────────────
  perform public.construire_zones_risque(v_jeu.profil, v_code);

  delete from public.zone_set_geoms where zone_set_id = p_zone_set_id;
  insert into public.zone_set_geoms
    (zone_set_id, classe, niveau, bande, geom, geom_3857, surface_km2)
  select p_zone_set_id, z.classe, z.niveau, z.bande, z.geom, z.geom_3857, z.surface_km2
    from public.zones_risque_cache z
   where z.profil_code = v_code;
  get diagnostics v_geoms = row_count;

  -- ── 2. Les codes postaux ────────────────────────────────────────────────
  delete from public.zone_set_cp where zone_set_id = p_zone_set_id;

  insert into public.zone_set_cp
    (zone_set_id, code_postal, classe, pop_en_zone, pop_totale, part_en_zone, retenu)
  with par_classe as (
    select d.code_postal,
           public.classe_carreau_risque(
             d.d_haut_m, d.d_bas_m, d.pprt_niveau,
             (select coalesce(array_agg(x::int order by x::int), '{}')
                from jsonb_array_elements_text(coalesce(v_jeu.profil->'haut', '[]'::jsonb)) x),
             (select coalesce(array_agg(x::int order by x::int), '{}')
                from jsonb_array_elements_text(
                  case when coalesce((v_jeu.profil->>'lie')::boolean, false)
                       then coalesce(v_jeu.profil->'haut', '[]'::jsonb)
                       else coalesce(v_jeu.profil->'bas',  '[]'::jsonb) end) x),
             coalesce((v_jeu.profil->>'inclurePPRT')::boolean, true)
           ) as classe,
           sum(coalesce((c.metadata->>v_jeu.cible)::numeric, 0)) as pop
      from public.carreau_risque_distance d
      join public.carreaux_filosofi c on c.id = d.carreau_id
     where d.code_postal is not null and d.code_postal <> ''
       and (v_jeu.territoire is null or d.code_departement = v_jeu.territoire)
     group by d.code_postal, 2
  ),
  -- La classe DOMINANTE : celle qui porte le plus de population. Un code
  -- postal chevauche souvent plusieurs bandes ; en retenir une est ce qui fait
  -- tenir « un code postal, un poids ».
  dominante as (
    select distinct on (code_postal) code_postal, classe
      from par_classe
     where classe <> 'hors'
     order by code_postal, pop desc
  ),
  en_zone as (
    select code_postal, sum(pop) as pop_en_zone
      from par_classe where classe <> 'hors' group by code_postal
  )
  select p_zone_set_id,
         e.code_postal,
         d.classe,
         round(e.pop_en_zone),
         round(t.pop_totale),
         round(part.valeur, 2),
         part.valeur >= v_jeu.seuil_couverture_cp
    from en_zone e
    join dominante d on d.code_postal = e.code_postal
    -- ⚠ `cp_population_totale` (sql/207) et NON `carreaux_cp_population`, qui
    -- surcompte de 10,5 % en comptant un carreau dans chaque contour qui le
    -- recouvre. Le numérateur et le dénominateur doivent rattacher le carreau
    -- au MÊME code postal, sinon la part ne veut rien dire.
    join lateral (
      select coalesce((cpt.populations->>v_jeu.cible)::numeric, 0) as pop_totale
        from public.cp_population_totale cpt where cpt.code_postal = e.code_postal
    ) t on true
    join lateral (
      select least(100, e.pop_en_zone / nullif(t.pop_totale, 0) * 100) as valeur
    ) part on true
   where t.pop_totale > 0;
  get diagnostics v_cp = row_count;

  select count(*) filter (where retenu),
         sum(pop_en_zone) filter (where retenu),
         -- Le taux d'utile : population exposée rapportée à la population des
         -- codes postaux RETENUS. C'est ce qu'on achète contre ce qu'on vise.
         round(sum(pop_en_zone) filter (where retenu)
               / nullif(sum(pop_totale) filter (where retenu), 0) * 100, 1)
    into v_retenus, v_exposee, v_utile
    from public.zone_set_cp where zone_set_id = p_zone_set_id;

  update public.zone_sets
     set population_exposee = coalesce(v_exposee, 0),
         n_cp_retenus       = coalesce(v_retenus, 0),
         taux_utile         = v_utile,
         construit_le       = now()
   where id = p_zone_set_id;

  return jsonb_build_object(
    'ok', true,
    'jeu', p_zone_set_id,
    'classes', v_geoms,
    'codes_postaux', v_cp,
    'retenus', coalesce(v_retenus, 0),
    'population_exposee', coalesce(v_exposee, 0),
    'taux_utile', v_utile,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

comment on function public.construire_zone_set is
  'Fige un profil en jeu de zones : geometries COPIEES depuis zones_risque_cache (un '
  'seul corps pour la priorite haut/bas et l''exclusivite des bandes) et codes postaux '
  'avec leur classe dominante. REFUSE un filtre de nature, que le pre-calcul des '
  'distances ne peut pas honorer — un filtre affiche mais non applique est pire '
  'qu''un filtre absent.';

revoke all on function public.construire_zone_set(uuid) from public, anon, authenticated;
grant execute on function public.construire_zone_set(uuid) to service_role;
