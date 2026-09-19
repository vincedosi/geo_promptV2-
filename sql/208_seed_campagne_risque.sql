-- sql/208 — Campagne de démonstration pour l'onglet « Diffusion »
--           (2026-09-19)
--
-- Il n'existe AUCUNE campagne réelle croisant le risque industriel. Sans jeu de
-- données, l'onglet Diffusion ne montre qu'un écran vide, et rien ne permet de
-- juger s'il raconte quelque chose.
--
-- ── POURQUOI EN SQL, ET PAS DANS LE SCRIPT ───────────────────────────────
--
-- `docs/PROMPT.md` demande `scripts/seed-demo-campagne-risque.ts`. Le script
-- existe — il orchestre, affiche la progression et porte la purge — mais
-- l'écriture elle-même est ICI, ensembliste.
--
-- La raison est mesurable : 30 jours × 2 000 codes postaux font 60 000 lignes.
-- Le patron d'insertion du projet est par lots de 50 (`lib/import/inserter.ts`),
-- soit 1 200 allers-retours. Et `idx_dsp_data_unique` est un index
-- d'EXPRESSION sur six colonnes, que PostgREST ne sait pas inférer pour un
-- `onConflict` — le chemin applicatif imposerait donc un DELETE ciblé suivi
-- d'un INSERT, lot par lot.
--
-- C'est aussi le patron déjà retenu pour l'autre jeu de démonstration du projet
-- (sql/112, « bloc DO atomique + assertion »).
--
-- ── REPRODUCTIBLE SANS GÉNÉRATEUR ALÉATOIRE ──────────────────────────────
--
-- Le bruit vient de `md5(code_postal || jour)`, pas de `random()`. Deux
-- exécutions donnent exactement le même jeu, donc une capture d'écran reste
-- valable et une régression se voit. Un `setseed()` marcherait aussi, mais il
-- dépend de l'ordre d'évaluation des lignes, qui n'est pas garanti.

create or replace function public.seed_campagne_risque_demo()
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  -- UUID FIXE : rejouer le seed doit retrouver la même campagne, jamais en
  -- créer une seconde. C'est ce qui rend l'opération idempotente.
  c_campagne constant uuid := 'd0000000-0000-4000-8000-00000000f1a5';
  c_jours    constant int  := 30;
  c_cp       constant int  := 2000;
  v_org      uuid;
  v_fin      date := current_date - 1;
  v_lignes   bigint;
  v_t0       timestamptz := clock_timestamp();
begin
  set local statement_timeout = '10min';
  set local work_mem = '64MB';

  if not exists (select 1 from public.cp_population_totale) then
    return jsonb_build_object('error', 'denominateur_absent', 'ok', false,
      'detail', 'Lancer remplir_cp_population_totale avant le seed.');
  end if;

  -- L'org du seed : la première existante. Une campagne sans org serait
  -- invisible de toute interface, le scoping par organisation étant la règle.
  select id into v_org from public.organizations order by created_at limit 1;
  if v_org is null then
    return jsonb_build_object('error', 'aucune_organisation', 'ok', false);
  end if;

  insert into public.dsp_campaigns
    (id, name, dsp_source, advertiser, product, date_start, date_end,
     countries, organization_id, total_budget, currency, is_demo)
  values (
    c_campagne, '[DEMO] Risque industriel', 'magelian',
    'Annonceur de démonstration', 'Campagne de sensibilisation',
    v_fin - c_jours + 1, v_fin, array['FR'], v_org, 180000.00, 'EUR', true)
  on conflict (id) do update
    set date_start = excluded.date_start, date_end = excluded.date_end,
        is_demo = true;

  -- DELETE ciblé puis INSERT, jamais un upsert : `idx_dsp_data_unique` est un
  -- index d'EXPRESSION sur six colonnes (campagne, date, code postal, ville,
  -- média, ACTEUR) que PostgREST ne sait pas inférer. ⚠ Le DELETE est dans la
  -- MÊME transaction que l'INSERT : un DELETE raté suivi de son INSERT
  -- transformerait un remplacement en DOUBLEMENT, le piège documenté dans
  -- `CLAUDE.md`.
  delete from public.dsp_campaign_data where campaign_id = c_campagne;

  with
  -- Les 2 000 codes postaux les plus peuplés : un achat média se concentre sur
  -- la population, et le tri est déterministe.
  cibles as (
    select t.code_postal,
           (t.populations->>'ind')::numeric as pop,
           -- Part de la population du code postal qui est exposée au seuil
           -- HAUT. C'est la grandeur sur laquelle porte le scénario.
           coalesce((
             select sum(coalesce((c.metadata->>'ind')::numeric, 0))
               from public.carreau_risque_distance d
               join public.carreaux_filosofi c on c.id = d.carreau_id
              where d.code_postal = t.code_postal and d.d_haut_m < 5000
           ), 0) as pop_haut,
           left(t.code_postal, 2) as dept
      from public.cp_population_totale t
     where (t.populations->>'ind')::numeric > 0
     order by (t.populations->>'ind')::numeric desc
     limit c_cp
  ),
  jours as (select generate_series(v_fin - c_jours + 1, v_fin, '1 day'::interval)::date as j),
  lignes as (
    select
      c.code_postal, j.j,
      -- Trois acteurs, répartis de façon déterministe. La PK de
      -- `campaign_cp_rollup` étant (campagne × CP × ACTEUR), avoir plusieurs
      -- acteurs est ce qui rend le jeu représentatif du piège de sommation.
      (array['dv360', 'tiktok', 'regie_locale'])[1 + (('x' || substr(md5(c.code_postal), 1, 8))::bit(32)::bigint % 3)] as acteur,
      c.pop, c.pop_haut, c.dept,
      -- Bruit reproductible dans [0,7 ; 1,3], tiré du couple (code postal, jour).
      0.7 + 0.6 * (('x' || substr(md5(c.code_postal || j.j::text), 1, 8))::bit(32)::bigint::numeric / 4294967295.0) as bruit
      from cibles c cross join jours j
  ),
  calcul as (
    select
      l.*,
      -- LE SCÉNARIO, et il est délibéré : l'écran doit raconter quelque chose.
      --   · sur-pression dans trois régions (Île-de-France, Rhône, PACA),
      --   · SOUS-pression là où la population exposée au seuil haut est forte.
      -- Le second point est le cas d'usage du module : une campagne qui
      -- sur-presse les zones à risque sans le savoir, ou qui les évite.
      (case when l.dept in ('75', '92', '93', '94', '69', '13') then 1.45 else 1.0 end)
      * (case when l.pop > 0 and l.pop_haut / l.pop > 0.25 then 0.55 else 1.0 end)
      as facteur
      from lignes l
  )
  insert into public.dsp_campaign_data
    (campaign_id, date, postal_code, country, media, actor, dsp_source,
     impressions, unique_impressions, tracked_ads, clicks, spend)
  select
    c_campagne, c.j, c.code_postal, 'FR', c.acteur, c.acteur, 'magelian',
    greatest(round(c.pop * 0.9 * c.bruit * c.facteur), 0)::bigint,
    greatest(round(c.pop * 0.6 * c.bruit * c.facteur), 0)::int,
    greatest(round(c.pop * 0.9 * c.bruit * c.facteur), 0)::int,
    greatest(round(c.pop * 0.9 * c.bruit * c.facteur * 0.004), 0)::int,
    -- CPM de 6 EUR, bruité lui aussi : un CPM constant donnerait un écran dont
    -- toutes les colonnes de coût sont proportionnelles aux impressions, ce qui
    -- ne ressemble à aucune campagne réelle.
    round(c.pop * 0.9 * c.bruit * c.facteur / 1000.0 * (5.0 + 2.0 * c.bruit), 4)
  from calcul c;

  get diagnostics v_lignes = row_count;

  -- Les rollups sont ce que lit l'écran de diffusion : sans ce rafraîchissement
  -- la campagne existerait mais n'aurait aucune donnée agrégée, et l'onglet
  -- afficherait zéro impression sur une campagne pleine.
  perform public.refresh_campaign_rollups(c_campagne);

  return jsonb_build_object(
    'ok', true, 'campagne', c_campagne, 'lignes', v_lignes,
    'codes_postaux', c_cp, 'jours', c_jours,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

comment on function public.seed_campagne_risque_demo is
  'Jeu de demonstration de l''onglet Diffusion : une campagne [DEMO] de 30 jours au code '
  'postal, is_demo = true, avec un scenario delibere (sur-pression sur trois regions, '
  'SOUS-pression la ou la population exposee au seuil haut depasse 25 %). Bruit '
  'reproductible tire de md5(code_postal || jour), jamais de random().';

revoke all on function public.seed_campagne_risque_demo() from public, anon, authenticated;
grant execute on function public.seed_campagne_risque_demo() to service_role;

create or replace function public.purger_campagne_risque_demo()
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  c_campagne constant uuid := 'd0000000-0000-4000-8000-00000000f1a5';
  v_n bigint;
begin
  select count(*) into v_n from public.dsp_campaign_data where campaign_id = c_campagne;
  -- `dsp_campaign_data` et les rollups partent en cascade avec la campagne
  -- (ON DELETE CASCADE) : supprimer la campagne suffit, et le faire en une
  -- instruction évite un état intermédiaire où les données survivraient sans
  -- leur campagne.
  delete from public.dsp_campaigns where id = c_campagne;
  return jsonb_build_object('ok', true, 'lignes_supprimees', v_n);
end;
$fn$;

comment on function public.purger_campagne_risque_demo is
  'Retire le jeu de demonstration. La campagne emporte ses donnees et ses rollups en '
  'cascade.';

revoke all on function public.purger_campagne_risque_demo() from public, anon, authenticated;
grant execute on function public.purger_campagne_risque_demo() to service_role;
