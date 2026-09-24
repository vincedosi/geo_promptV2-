-- sql/232 — Simulation d'une campagne sur une extraction (étape ⑤ du module risque).
--
-- ── CE QUE CETTE MIGRATION POSE ─────────────────────────────────────────────
--
-- L'étape ⑤ fait diffuser une campagne SIMULÉE sur le plan d'une extraction
-- (sql/231), pendant deux semaines, puis la recale sur une extraction v2 pour
-- deux semaines de plus. Le générateur est en TypeScript (`lib/simulation/`),
-- fonctions pures testées à graine fixe ; la base ne fait que STOCKER et
-- AGRÉGER, ce qu'elle sait faire mieux que le serveur applicatif.
--
-- ── LES DONNÉES VONT DANS LES TABLES DE CAMPAGNE EXISTANTES ────────────────
--
-- Une simulation est une vraie ligne de `dsp_campaigns` et ses impressions de
-- vraies lignes de `dsp_campaign_data`, pré-agrégées au grain de
-- `idx_dsp_data_unique` : (jour, code postal, partenaire). C'est la demande du
-- brief, et c'est ce qui permet de l'ouvrir plus tard dans le Suivi sans rien
-- réécrire.
--
-- ⚠ **`est_simulation` est ce qui empêche de la confondre avec une campagne
-- réelle.** `is_demo` existait déjà, mais aucune liste ne le filtre
-- (`/api/admin/campaigns` rend tout) : réutiliser ce drapeau aurait mis la
-- simulation dans le sélecteur de campagnes du Suivi, au milieu des vraies.
-- Un drapeau neuf, filtré par les trois routes qui listent les campagnes, dit
-- exactement ce qu'il veut dire.
--
-- ── CE QUI N'EST PAS FAIT ICI, ET POURQUOI ─────────────────────────────────
--
-- `refresh_campaign_rollups` n'est PAS appelée : elle lit la DERNIÈRE stratégie
-- de la campagne pour en tirer `planned_share`, et une simulation porte deux
-- plans successifs (v1 puis v2). L'alignement de l'étape ⑤ se calcule donc à
-- part, par `simulation_agregats`, au grain (jour × bassin) que les rollups
-- n'ont pas.

-- ── 1. Le drapeau ───────────────────────────────────────────────────────────

alter table public.dsp_campaigns
  add column if not exists est_simulation boolean not null default false;

comment on column public.dsp_campaigns.est_simulation is
  'Campagne produite par la simulation de l''étape ⑤ (sql/232). Exclue de toute '
  'liste de campagnes : une simulation ne doit jamais passer pour une campagne réelle.';

create index if not exists idx_dsp_campaigns_simulation
  on public.dsp_campaigns (id) where est_simulation;

-- ── 2. La simulation ────────────────────────────────────────────────────────

create table if not exists public.zone_set_simulations (
  id                uuid primary key default gen_random_uuid(),
  zone_set_id       uuid not null references public.zone_sets(id) on delete cascade,
  org_id            uuid not null,
  -- La campagne emporte ses impressions en cascade ; la simulation suit sa
  -- campagne : purger l'une purge l'autre, dans les deux sens.
  campaign_id       uuid not null unique references public.dsp_campaigns(id) on delete cascade,
  extraction_v1_id  uuid not null references public.zone_set_extractions(id) on delete cascade,
  -- `set null` et non `cascade` : supprimer la v2 (purge, échec du recalage)
  -- ramène la simulation à son état v1, elle ne la fait pas disparaître.
  extraction_v2_id  uuid references public.zone_set_extractions(id) on delete set null,
  date_debut        date not null,
  jours             int  not null check (jours between 14 and 56),
  jour_recalage     int  not null,
  params            jsonb not null,
  statut            text not null check (statut in ('v1', 'v2')),
  lignes_v1         int  not null default 0,
  lignes_v2         int  not null default 0,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  check (jour_recalage > 1 and jour_recalage <= jours)
);

create index if not exists idx_zss_zone_set
  on public.zone_set_simulations (zone_set_id, created_at desc);

comment on table public.zone_set_simulations is
  'Une campagne simulée sur une extraction (étape ⑤, sql/232) : v1 puis recalage v2. '
  'Les impressions vivent dans dsp_campaign_data, sous une campagne est_simulation.';

alter table public.zone_set_simulations enable row level security;
revoke all on table public.zone_set_simulations from public, anon, authenticated;
grant select, insert, update, delete on table public.zone_set_simulations to service_role;

-- ── 3. Les entrées du générateur ────────────────────────────────────────────
--
-- Une ligne par code postal de l'extraction, avec ce que le générateur doit
-- savoir : plan, bassin, population, part en zone, surface.
--
-- ⚠ Un membre non canonique (Nantes 44200 quand 44000 porte le groupe) a une
-- population NULL dans l'extraction, et c'est voulu (sql/231). On lui prête
-- celle de son canonique POUR LE CALCUL DE DENSITÉ ET DE PART, jamais pour une
-- somme : le drapeau `membre` le dit au client, qui l'écarte de toute cible.
--
-- `RETURNS jsonb` : une extraction nationale porte 2 000 lignes, et la forme
-- tabulaire serait coupée à 5 000 le jour où un jeu plus large arrive.

create or replace function public.simulation_entrees(p_extraction uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code_postal',    e.code_postal,
           'code_canonique', e.code_canonique,
           'cluster_id',     e.cluster_id,
           'retenu',         e.retenu,
           'multiplicateur', e.multiplicateur,
           'pop_en_zone',    coalesce(e.pop_en_zone, c.pop_en_zone, 0),
           'pop_totale',     coalesce(e.pop_totale, c.pop_totale, 0),
           'part_en_zone',   coalesce(e.part_en_zone, c.part_en_zone, 0),
           'surface_km2',    r.surface_km2,
           'membre',         e.code_postal <> e.code_canonique,
           'x',              round(st_x(r.centroid)::numeric, 4),
           'y',              round(st_y(r.centroid)::numeric, 4)
         ) order by e.code_postal), '[]'::jsonb)
    from public.zone_set_extraction_cp e
    left join public.zone_set_extraction_cp c
      on c.extraction_id = e.extraction_id and c.code_postal = e.code_canonique
    left join public.ref_codes_postaux r
      on r.code_postal = e.code_canonique
   where e.extraction_id = p_extraction;
$$;

comment on function public.simulation_entrees is
  'Les codes postaux d''une extraction, tels que le générateur de simulation les consomme (sql/232).';

revoke all on function public.simulation_entrees(uuid) from public, anon, authenticated;
grant execute on function public.simulation_entrees(uuid) to service_role;

-- ── 4. Les agrégats d'une simulation ────────────────────────────────────────
--
-- Tout ce que l'écran lit, en UN appel : par code postal et par version, par
-- (jour × bassin), par jour, par partenaire et par version.
--
-- ⚠ Les impressions UTILES se calculent ICI, au grain de la ligne : impressions
-- × part en zone du code postal. Les calculer côté client imposerait de
-- rapatrier 80 000 lignes pour en faire la somme.
--
-- ⚠ « En zone » dépend de la VERSION : un code postal retenu en v1 peut être
-- baissé en v2, et la part en zone d'un jour se lit sur le plan de ce jour.

create or replace function public.simulation_agregats(p_simulation uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s   public.zone_set_simulations%rowtype;
  v_out jsonb;
begin
  select * into v_s from public.zone_set_simulations where id = p_simulation;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'simulation_introuvable');
  end if;

  with e1 as (
    select e.code_postal as cp, e.cluster_id as cid, e.retenu,
           coalesce(e.part_en_zone, c.part_en_zone, 0) as part
      from public.zone_set_extraction_cp e
      left join public.zone_set_extraction_cp c
        on c.extraction_id = e.extraction_id and c.code_postal = e.code_canonique
     where e.extraction_id = v_s.extraction_v1_id
  ),
  e2 as (
    select code_postal as cp, retenu
      from public.zone_set_extraction_cp
     where extraction_id = v_s.extraction_v2_id
  ),
  -- Le filtre AVANT les jointures : l'index `idx_dsp_data_campaign` ne sert
  -- que si la campagne est isolée d'abord.
  d as materialized (
    select (x.date - v_s.date_debut + 1) as jour,
           x.postal_code as cp, x.actor,
           x.impressions::numeric as imps,
           coalesce(x.spend, 0) as spend
      from public.dsp_campaign_data x
     where x.campaign_id = v_s.campaign_id
  ),
  dd as materialized (
    select d.jour, d.cp, d.actor, d.imps, d.spend,
           case when d.jour < v_s.jour_recalage then 1 else 2 end as v,
           e1.cid,
           d.imps * coalesce(e1.part, 0) / 100 as utiles,
           case when d.jour < v_s.jour_recalage then coalesce(e1.retenu, false)
                else coalesce(e2.retenu, e1.retenu, false) end as en_zone
      from d
      left join e1 on e1.cp = d.cp
      left join e2 on e2.cp = d.cp
  )
  select jsonb_build_object(
    'ok', true,
    'par_cp', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'cp', cp, 'v', v, 'imps', imps,
               'utiles', round(utiles, 1), 'spend', round(spend, 2))), '[]'::jsonb)
        from (select cp, v, sum(imps) imps, sum(utiles) utiles, sum(spend) spend
                from dd group by cp, v) t
    ),
    'par_zone_jour', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'jour', jour, 'cid', cid, 'imps', imps,
               'utiles', round(utiles, 1), 'spend', round(spend, 2))), '[]'::jsonb)
        from (select jour, cid, sum(imps) imps, sum(utiles) utiles, sum(spend) spend
                from dd where cid is not null group by jour, cid) t
    ),
    'par_jour', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'jour', jour, 'imps', imps, 'utiles', round(utiles, 1),
               'spend', round(spend, 2), 'en_zone', en_zone) order by jour), '[]'::jsonb)
        from (select jour, sum(imps) imps, sum(utiles) utiles, sum(spend) spend,
                     sum(imps) filter (where en_zone) en_zone
                from dd group by jour) t
    ),
    'par_partenaire', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'partenaire', actor, 'v', v, 'imps', imps,
               'spend', round(spend, 2), 'en_zone', en_zone,
               'utiles', round(utiles, 1))), '[]'::jsonb)
        from (select actor, v, sum(imps) imps, sum(spend) spend,
                     coalesce(sum(imps) filter (where en_zone), 0) en_zone,
                     sum(utiles) utiles
                from dd group by actor, v) t
    )
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.simulation_agregats is
  'Agrégats d''une simulation (étape ⑤, sql/232) : par CP × version, jour × bassin, jour, '
  'partenaire × version. Impressions utiles = impressions × part en zone du code postal.';

revoke all on function public.simulation_agregats(uuid) from public, anon, authenticated;
grant execute on function public.simulation_agregats(uuid) to service_role;

-- ── 5. La géométrie de la carte ─────────────────────────────────────────────
--
-- Les bassins d'un jeu et leurs sites, bornés au cadre visible. Aucune donnée
-- de diffusion ici : l'écran fusionne les indices côté client, ce qui permet de
-- changer de période sans redemander une seule géométrie.
--
-- ⚠ `ST_SimplifyPreserveTopology` et JAMAIS `ST_Simplify` : ce dernier VIDE les
-- petits polygones (602 zones PPRT sur 664 mesurées, sql/178), et un bassin
-- d'un seul site Seveso bas en est un.

create or replace function public.simulation_carte(
  p_zone_set uuid,
  p_xmin double precision, p_ymin double precision,
  p_xmax double precision, p_ymax double precision
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with cadre as (
    select st_makeenvelope(p_xmin, p_ymin, p_xmax, p_ymax, 4326) as g4326,
           st_transform(st_makeenvelope(p_xmin, p_ymin, p_xmax, p_ymax, 4326), 3857) as g3857,
           greatest((p_xmax - p_xmin) / 1500.0, 0.0003) as tol
  ),
  bassins as (
    select jsonb_build_object(
             'type', 'Feature',
             'geometry', st_asgeojson(st_simplifypreservetopology(c.geom, (select tol from cadre)), 5)::jsonb,
             'properties', jsonb_build_object(
               'type', 'bassin', 'id', c.id, 'rang', c.rang,
               'nom', coalesce(nullif(trim(c.nom), ''), 'Zone ' || c.rang))) as f
      from public.zone_set_clusters c
     where c.zone_set_id = p_zone_set
       and c.geom_3857 && (select g3857 from cadre)
  ),
  sites as (
    select jsonb_build_object(
             'type', 'Feature',
             'geometry', st_asgeojson(st_transform(s.geom_3857, 4326), 5)::jsonb,
             'properties', jsonb_build_object(
               'type', 'site', 'cluster_id', s.cluster_id,
               'nom', p.nom, 'ville', p.ville)) as f
      from public.zone_set_cluster_sites s
      join public.zone_set_clusters c on c.id = s.cluster_id
      left join public.poi_france p on p.id = s.site_id
     where c.zone_set_id = p_zone_set
       and s.geom_3857 && (select g3857 from cadre)
  )
  select jsonb_build_object(
           'type', 'FeatureCollection',
           'features', coalesce((select jsonb_agg(f) from bassins), '[]'::jsonb)
                    || coalesce((select jsonb_agg(f) from sites), '[]'::jsonb));
$$;

comment on function public.simulation_carte is
  'Bassins et sites d''un jeu dans un cadre, géométries simplifiées au zoom (étape ⑤, sql/232).';

revoke all on function public.simulation_carte(uuid, double precision, double precision, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.simulation_carte(uuid, double precision, double precision, double precision, double precision)
  to service_role;
