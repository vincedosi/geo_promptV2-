-- sql/213 — Le jeu de démonstration, refait
--           (2026-09-20)
--
-- Remplace sql/208, dont les quatre défauts ont été signalés après essai :
--
--   · 1 196 332 538 impressions en 30 jours — irréaliste d'un facteur trente ;
--   · trois partenaires à 7,06 / 7,06 / 7,07 € de CPM — indiscernables ;
--   · aucun plan, donc un alignement de 100/100 qui ne mesurait rien ;
--   · « La dernière actualisation a échoué », qui n'était pas un échec.
--
-- ── POURQUOI LES TROIS CPM SE RESSEMBLAIENT ──────────────────────────────
--
-- Le CPM valait `5,0 + 2,0 × bruit`, où `bruit` était tiré par **(code postal,
-- jour)**. Moyenné sur 20 000 lignes par acteur, il converge vers sa moyenne
-- (1,0) et les trois acteurs valent tous 7 €.
--
-- **Un bruit qui varie sur un axe qu'on agrège ensuite ne distingue rien.** Il
-- doit porter sur l'axe qu'on veut distinguer — ici l'ACTEUR. Chaque partenaire
-- a donc son CPM de base, et le bruit ne fait que l'habiller.
--
-- ── LE VOLUME ─────────────────────────────────────────────────────────────
--
-- Cible : 30 millions d'impressions sur 30 jours, soit ~1 M par jour. L'ancien
-- générateur partait de `population × 0,9` par code postal ET par jour, ce qui
-- revenait à servir chaque habitant presque une fois quotidiennement.
--
-- On fixe donc le TOTAL et on répartit, au lieu de fixer le taux par habitant
-- et de subir le total.

create or replace function public.seed_impressions_risque_demo(
  p_campagne uuid,
  p_total    bigint default 30000000,
  p_jours    int default 30
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_fin     date := current_date - 1;
  v_lignes  bigint;
  v_t0      timestamptz := clock_timestamp();
  v_total   bigint;
begin
  set local statement_timeout = '10min';
  set local work_mem = '64MB';

  if not exists (select 1 from public.bidding_zone_configs z
                  join public.bidding_strategies s on s.id = z.strategy_id
                 where s.campaign_id = p_campagne) then
    return jsonb_build_object(
      'error', 'plan_absent', 'ok', false,
      'detail', 'Rattacher un jeu de zones AVANT de semer les impressions : '
                || 'sans plan, l''alignement n''est pas calculable.');
  end if;

  -- DELETE ciblé + INSERT, jamais un upsert : `idx_dsp_data_unique` est un
  -- index d'EXPRESSION sur six colonnes (campagne, date, CP, ville, média,
  -- ACTEUR) que PostgREST ne sait pas inférer. ⚠ Le DELETE est dans la MÊME
  -- transaction que l'INSERT — un DELETE raté suivi de son INSERT
  -- transformerait un remplacement en DOUBLEMENT (`CLAUDE.md`).
  delete from public.dsp_campaign_data where campaign_id = p_campagne;

  with
  -- Les codes postaux du PLAN, et leur classe. C'est le plan qui décide où la
  -- campagne diffuse — une campagne qui diffuserait ailleurs que sur son plan
  -- ne serait pas une démonstration, ce serait une anomalie.
  cibles as (
    select z.postal_code,
           coalesce(z.target_metrics->>'classe', 'hors') as classe,
           z.bid_multiplier::numeric as mult,
           left(z.postal_code, 2) as dept
      from public.bidding_zone_configs z
      join public.bidding_strategies s on s.id = z.strategy_id
     where s.campaign_id = p_campagne and z.is_active
  ),
  jours as (
    select generate_series(v_fin - p_jours + 1, v_fin, '1 day'::interval)::date as j
  ),
  -- Trois partenaires, chacun avec SA part de budget et SON CPM. Le CPM est la
  -- propriété de l'ACTEUR, pas du couple (code postal, jour) : c'est ce qui
  -- rendait les trois indiscernables dans sql/208.
  acteurs as (
    select * from (values
      ('dv360',        0.45::numeric,  4.20::numeric),
      ('tiktok',       0.30::numeric,  8.10::numeric),
      -- 10,60 et non 11,40 : le bruit multiplie par 1,04 a 1,12, et la base
      -- precedente sortait a 12,35 EUR — au-dessus de la fourchette realiste
      -- de 3 a 12 EUR que le brief fixe. Mesure, pas estime.
      ('regie_locale', 0.25::numeric, 10.60::numeric)
    ) as a(nom, part_budget, cpm_base)
  ),
  croise as (
    select c.postal_code, c.classe, c.mult, c.dept, j.j, a.nom, a.part_budget, a.cpm_base,
           -- Bruit reproductible dans [0,75 ; 1,25], tiré du TRIPLET
           -- (code postal, jour, acteur) — et jamais de `random()`, pour que
           -- deux exécutions donnent le même jeu.
           0.75 + 0.5 * (('x' || substr(md5(c.postal_code || j.j::text || a.nom), 1, 8))
                         ::bit(32)::bigint::numeric / 4294967295.0) as bruit
      from cibles c cross join jours j cross join acteurs a
  ),
  /*
   * ── LE SCÉNARIO, ET POURQUOI IL SE RÉÉQUILIBRE ──────────────────────────
   *
   * L'écran doit montrer des écarts, sinon il ne montre rien :
   *   · sur-pression de +45 % sur l'Île-de-France, le Rhône et les
   *     Bouches-du-Rhône ;
   *   · SOUS-pression de 70 % sur les ABORDS IMMÉDIATS des sites Seveso
   *     seuil haut — le cas d'usage même : une campagne qui néglige les
   *     zones à risque sans le savoir.
   *
   * ⚠ **Les abords immédiats, et non toutes les classes `haut:`.** Mesuré le
   * 2026-09-20 : `haut:3`, l'anneau le plus large, porte à lui seul **1 468
   * des 1 942 codes postaux** (76 %). Un prédicat `classe like 'haut:%'`
   * attrapait 1 622 codes postaux, il ne restait plus AUCUN groupe neutre, et
   * les 1 942 se répartissaient en deux blocs à 0,55 et 1,45 — un écran de
   * démonstration sans un seul code postal conforme. Le scénario ne porte
   * donc que sur `haut:pprt`, `haut:1` et `haut:2` (154 codes postaux), et
   *   · SOUS-pression modérée de 30 % sur les abords des sites de seuil BAS
   *     (`bas:1`, `bas:2`, 320 codes postaux) — un second signal, plus
   *     discret, pour que l'écran ait autre chose à montrer qu'un seul bloc.
   *
   * Sans ce second groupe, seuls 8 % de la masse du plan sont en jeu et le
   * score reste à 98/100 : juste, mais illisible comme démonstration d'une
   * campagne qui néglige les zones à risque.
   *
   * ⚠ **Un budget est fixe : gonfler un groupe dégonfle tous les autres.**
   * Mesuré le 2026-09-20, avant ce correctif : les codes postaux NEUTRES
   * tombaient tous entre 0,75 et 0,83 de leur plan, donc comptés en
   * sous-pression, et l'écran n'affichait plus que **9 codes postaux
   * conformes sur 1 942** (0,5 %). Un écran où presque rien n'est conforme
   * est aussi muet qu'un écran où tout l'est : les deux cachent le scénario
   * qu'on voulait montrer.
   *
   * La cause est arithmétique et non accidentelle. Les parts sont normalisées
   * par leur somme, donc ce qui compte est le facteur RELATIF à sa moyenne
   * pondérée. Avec +45 % sur des départements qui pèsent lourd, cette moyenne
   * valait 1,27 et un code postal neutre se retrouvait à 1/1,27 = 0,79.
   *
   * ── CE QUI EST FAIT, ET POURQUOI C'EST LE SEUL ÉQUILIBRE POSSIBLE ────────
   *
   * Le facteur du boost n'est PAS une constante : il est CALCULÉ pour que le
   * groupe sur-diffusé reçoive **exactement** les impressions que la coupe a
   * libérées. C'est aussi la phrase que l'écran doit faire lire — « ce qui n'a
   * pas été diffusé près des sites classés est parti en Île-de-France » — et
   * c'est la seule répartition où le groupe neutre reste sur son plan.
   *
   * Poser un boost constant ne le permet pas : avec 45 % retirés à 154 codes
   * postaux et 45 % ajoutés à 330, la différence est prise sur les 1 458
   * autres, qui tombent alors à 0,90 de leur plan — mesuré, et pile sur la
   * borne de tolérance, donc la moitié bascule en sous-pression sur un bruit.
   */
  marque as (
    select cr.*,
           -- Un code postal des abords d'un site classé compte comme négligé
           -- même s'il est en Île-de-France : c'est le propos de l'écran, il
           -- prime sur la sur-diffusion régionale.
           (cr.dept in ('75','92','93','94','77','78','91','95','69','13')
            and cr.classe not in ('haut:pprt', 'haut:1', 'haut:2', 'bas:1', 'bas:2')) as boost,
           (cr.classe in ('haut:pprt', 'haut:1', 'haut:2')) as evite,
           (cr.classe in ('bas:1', 'bas:2')) as evite_doux,
           cr.mult * cr.part_budget * cr.bruit as base
      from croise cr
  ),
  -- Poids de chaque groupe, en part du total. `as materialized` : la CTE est
  -- référencée deux fois et PostgreSQL l'inline depuis la 12, ce qui
  -- recalculerait le balayage complet à chaque référence.
  parts as materialized (
    select sum(base) filter (where boost) / nullif(sum(base), 0) as w_boost,
           sum(base) filter (where evite) / nullif(sum(base), 0) as w_evite,
           sum(base) filter (where evite_doux) / nullif(sum(base), 0) as w_doux,
           sum(base) filter (where not boost and not evite) / nullif(sum(base), 0) as w_reste
      from marque
  ),
  scenario as (
    select m.*,
           case
             -- Les deux coupes : franche sur les abords immédiats du seuil
             -- haut, modérée sur ceux du seuil bas.
             when m.evite then 0.30
             when m.evite_doux then 0.70
             -- Le boost reçoit ce que la coupe a libéré, ni plus ni moins.
             -- Borné à 2,0 : si le groupe boosté était minuscule devant le
             -- groupe coupé, le facteur s'envolerait et l'écran montrerait une
             -- aberration plutôt qu'un scénario. Le plafond se voit alors dans
             -- les chiffres, il ne se devine pas.
             when m.boost then least(2.0,
               1 + (0.70 * coalesce(p.w_evite, 0) + 0.30 * coalesce(p.w_doux, 0))
                   / nullif(p.w_boost, 0))
             -- Le reste ne bouge pas : il est sur son plan, et c'est ce qui
             -- rend les deux écarts lisibles.
             else 1.0
           end as facteur
      from marque m cross join parts p
  ),
  -- ⚠ `somme_poids` et non `p_total` : le paramètre de la fonction s'appelle
  -- `p_total`, et PostgreSQL ne sait pas lequel on désigne — « column
  -- reference "p_total" is ambiguous ». Le préfixe `p_` des paramètres est une
  -- convention du projet, donc toute colonne de CTE qui le porte entre en
  -- collision.
  poids as (
    select s.*, s.base * s.facteur as p,
           sum(s.base * s.facteur) over () as somme_poids
      from scenario s
  )
  insert into public.dsp_campaign_data
    (campaign_id, date, postal_code, country, media, actor, dsp_source,
     impressions, unique_impressions, tracked_ads, clicks, spend)
  select p_campagne, p.j, p.postal_code, 'FR', p.nom, p.nom, 'magelian',
         greatest(1, round(p_total * p.p / nullif(p.somme_poids, 0)))::bigint,
         greatest(1, round(p_total * p.p / nullif(p.somme_poids, 0) * 0.62))::int,
         greatest(1, round(p_total * p.p / nullif(p.somme_poids, 0)))::int,
         greatest(0, round(p_total * p.p / nullif(p.somme_poids, 0) * 0.0042))::int,
         -- La dépense DÉCOULE du CPM de l'acteur : c'est ce qui rend les trois
         -- partenaires distinguables dans le tableau « Qui a diffusé ».
         round(p_total * p.p / nullif(p.somme_poids, 0) / 1000.0
               * p.cpm_base * (0.92 + 0.16 * p.bruit), 4)
    from poids p;

  get diagnostics v_lignes = row_count;

  select sum(impressions) into v_total
    from public.dsp_campaign_data where campaign_id = p_campagne;

  -- Les rollups sont ce que lit l'écran de suivi : sans ce rafraîchissement la
  -- campagne existerait mais n'aurait aucun agrégat, et l'onglet afficherait
  -- zéro impression sur une campagne pleine.
  perform public.refresh_campaign_rollups(p_campagne);

  return jsonb_build_object(
    'ok', true, 'lignes', v_lignes, 'impressions', v_total, 'jours', p_jours,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

comment on function public.seed_impressions_risque_demo is
  'Seme les impressions de la campagne de demonstration SUR SON PLAN. Le CPM est la '
  'propriete de l''ACTEUR et non du couple (code postal, jour) : dans sql/208 le bruit '
  'etait tire par CP et par jour, donc moyenne sur 20 000 lignes il convergeait et les '
  'trois partenaires valaient tous 7,06 EUR. Un bruit qui varie sur un axe qu''on agrege '
  'ensuite ne distingue rien.';

revoke all on function public.seed_impressions_risque_demo(uuid, bigint, int)
  from public, anon, authenticated;
grant execute on function public.seed_impressions_risque_demo(uuid, bigint, int)
  to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- LA PURGE
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.purger_demo_risque()
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  c_campagne constant uuid := 'd0000000-0000-4000-8000-00000000f1a5';
  v_lignes bigint;
  v_jeux   int;
begin
  select count(*) into v_lignes
    from public.dsp_campaign_data where campaign_id = c_campagne;

  -- La campagne emporte ses données, ses rollups et ses stratégies en cascade.
  delete from public.dsp_campaigns where id = c_campagne;

  -- Les jeux de démonstration partent aussi : leurs géométries et leurs codes
  -- postaux suivent par `on delete cascade`.
  delete from public.zone_sets where nom like '[DEMO]%';
  get diagnostics v_jeux = row_count;

  return jsonb_build_object('ok', true, 'lignes_supprimees', v_lignes, 'jeux_supprimes', v_jeux);
end;
$fn$;

comment on function public.purger_demo_risque is
  'Retire la campagne de demonstration ET les jeux de zones [DEMO]. La campagne emporte '
  'ses donnees, ses rollups et ses strategies en cascade ; un jeu emporte ses geometries '
  'et ses codes postaux.';

revoke all on function public.purger_demo_risque() from public, anon, authenticated;
grant execute on function public.purger_demo_risque() to service_role;
