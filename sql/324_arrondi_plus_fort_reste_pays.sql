-- ============================================================================
-- sql/324_arrondi_plus_fort_reste_pays.sql — C18, round 1 (plan de corrections du découpage des zones, lot 3,
-- 2026-11-03) : la zone NATIONALE se somme aussi à son total.
--
-- LE CONSTAT. sql/323 a corrigé `couverture_geometrie`, mais une zone pays passe par `couverture_pays_jsonb`, qui
-- arrondissait encore chaque ligne par `round(t.p)` (sql/310, lignes CP et département). France entière au CP, l'écran
-- affichait « manqués −1 504 » (−1 489 en METRO) à tout seuil : les CP sommant en ,5 arrondis vers le haut. Au
-- département, +24 en METRO pour la même raison (mesuré le 03/11).
--
-- LE CORRECTIF. La règle de sql/323 : chaque ligne reçoit floor(p), puis les round(Σ p) − Σ floor(p) plus grands
-- restes reçoivent +1 (départage par population décroissante puis code ; `nulls last` partout : une ligne à p NULL ne
-- prend jamais une unité d'arrondi). `pop_totale` = `pop_en_zone`, comme avant (l'unité est entière dans le pays).
--   - CP : Σ lignes = round(Σ t.p) = `population` (même dénominateur `cp_population_totale` ou sa jumelle filtrée).
--   - Département : Σ lignes = round(Σ des départements). L'écart qui reste à `population` (comptée par CP) n'est PAS
--     un arrondi : ce sont les carreaux sans CP (I-2 de la relecture, 71 789 en FR, 63 684 en METRO), rattachés à
--     C25 — même cause que l'écart département / CP de C17. Non traité ici.
-- La réponse porte `arrondi_lignes = 'plus_fort_reste'`.
--
-- LE CACHE. Seuls les chiffrages pays CP et département changent de contenu : ceux d'avant cette migration (sans la
-- clé) sont supprimés de `couverture_zone_cache`, une fois — borné à `resultat ? 'pays'` et ces deux découpages. Une
-- zone pays telle quelle (forme) ne change pas : gardée. Rejouable : au second passage, rien à supprimer.
--
-- Mesuré le 03/11 (EXPLAIN ANALYZE, FR au CP, 6 009 lignes, machine chargée) : avant 83-227 ms, 5 574 accès, 518 blocs
-- temporaires ; après 103-362 ms (médiane ≈ 140), 5 703 accès, 1 220 blocs temporaires (le tri de la fenêtre). Aucun
-- carreau lu : le surcoût est un tri de 6 009 lignes.
--
-- Corps recopié de sql/310 (la définition en base) ; les lignes changées sont marquées « C18 ». Même signature, même
-- retour jsonb, mêmes droits, aucun DROP. Appliquer par `psql -1`.
-- ============================================================================

-- ── couverture_pays_jsonb : sql/310 + lignes au plus fort reste (C18) ───────────────────────────────────────────────
create or replace function public.couverture_pays_jsonb(p_code text, p_cible text, p_decoupage text)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_motif    text;
  v_base     timestamptz;
  v_denom_le timestamptz;
  v_n        bigint;
  v_pop      numeric;
  v_lignes   jsonb := '[]'::jsonb;
  v_n_terr   integer := 0;
  v_ref      jsonb;
  v_inc      jsonb := '[]'::jsonb;  -- A4 : les lignes des unités non carroyées du territoire
  v_n_inc    integer := 0;
  v_min      numeric;   -- A5 : le minimum de ménages appliqué (0 pour la population totale)
  v_ec_n     bigint;    -- A5 : carreaux du pays écartés (moins de v_min ménages)
  v_ec_p     numeric;
begin
  if p_code is null or p_code not in ('METRO', 'FR') then
    raise exception 'pays inconnu : % (METRO ou FR)', p_code using errcode = '22023';
  end if;
  if p_decoupage is null or p_decoupage not in ('forme', 'cp', 'iris', 'commune', 'departement') then
    raise exception 'decoupage non autorise : % (forme, cp, iris, commune ou departement)', p_decoupage using errcode = '22023';
  end if;
  -- Trop fin pour un pays : refusé AVANT toute lecture.
  if p_decoupage in ('iris', 'commune') then
    return jsonb_build_object('refus', 'decoupage_trop_fin_pays', 'decoupage', p_decoupage);
  end if;
  if not exists (select 1 from public.cibles_exposition ce where ce.code = p_cible and ce.actif and ce.rang_pop is not null) then
    return jsonb_build_object('refus', 'cible_inconnue');
  end if;
  v_min := public.min_menages_de_cible(p_cible);  -- A5 (ARB-4)

  -- Les mêmes refus de base que couverture_geometrie : la forme se chiffre par les dénominateurs CP.
  select max(b.construit_le) into v_base from public.carreau_couverture_bandes b;
  v_motif := public.carreau_couverture_complete();
  if v_motif is null then
    v_denom_le := public.denominateur_construit_le(case p_decoupage when 'forme' then 'cp' else p_decoupage end);
    if v_denom_le is null then
      v_motif := 'denominateur_' || case p_decoupage when 'forme' then 'cp' else p_decoupage end || '_absent';
    elsif v_denom_le > v_base then
      v_motif := 'denominateur_' || case p_decoupage when 'forme' then 'cp' else p_decoupage end || '_plus_recent';
    end if;
  end if;
  -- A5 : sous un minimum, les chiffres viennent de la jumelle filtrée (CP pour la forme, sinon la maille demandée).
  if v_motif is null and v_min > 0 then
    v_motif := public.denominateur_menages_motif(case p_decoupage when 'forme' then 'cp' else p_decoupage end);
  end if;
  if v_motif is not null then
    return jsonb_build_object('refus', 'couverture_non_construite', 'motif', v_motif);
  end if;

  -- A5 : sans minimum, `cp_population_totale` ; sous un minimum, la jumelle filtrée maille cp, jointe par hachage. Les
  -- écartés = tous les carreaux du pays moins ceux qui comptent.
  select coalesce(sum(case when v_min > 0 then dm.n_carreaux else cp.n_carreaux end), 0),
         coalesce(sum(case when v_min > 0 then coalesce((dm.populations->>p_cible)::numeric, 0)
                           else (cp.populations->>p_cible)::numeric end), 0),
         coalesce(sum(cp.n_carreaux - coalesce(dm.n_carreaux, cp.n_carreaux)), 0),
         coalesce(sum((cp.populations->>p_cible)::numeric - coalesce((dm.populations->>p_cible)::numeric,
                                                                     (cp.populations->>p_cible)::numeric)), 0)
    into v_n, v_pop, v_ec_n, v_ec_p
    from public.cp_population_totale cp
    left join (select d.code, d.n_carreaux, d.populations from public.denominateur_menages_min d
                  where v_min > 0 and d.maille = 'cp' offset 0) dm on dm.code = cp.code_postal
   where public.pays_contient_code(p_code, cp.code_postal);

  if p_decoupage = 'cp' then
    -- C18 : les lignes d'abord (`l`), puis leur population arrondie au plus fort reste (`a`, la règle de sql/323) :
    -- Σ pop_en_zone = round(Σ t.p) = `population` (même dénominateur, mêmes carreaux). `round(t.p)` ligne à ligne
    -- arrondissait chaque ,5 vers le haut : +1 504 en FR, +1 489 en METRO (« manqués −1 504 » à l'écran).
    with l as (
    select cp.code_postal as code, rcp.nom_principal as nom, t.n, t.p, m.membres
      from public.cp_population_totale cp
      -- A5 : sous un minimum, population et carreaux de la jumelle filtrée.
      left join (select d.code, d.n_carreaux, d.populations from public.denominateur_menages_min d
                  where v_min > 0 and d.maille = 'cp' offset 0) dm on dm.code = cp.code_postal
      cross join lateral (select case when v_min > 0 then coalesce((dm.populations->>p_cible)::numeric, 0)
                                      else (cp.populations->>p_cible)::numeric end as p,
                                 case when v_min > 0 then coalesce(dm.n_carreaux, 0) else cp.n_carreaux end as n) t
      -- A2 : les groupes lus UNE fois (181 lignes, n_membres > 1) puis joints par hachage ; une sous-requête par ligne
      -- coûtait 18 000 accès de plus sur la métropole (5 956 lignes : 22 879 contre 4 834 sans la clé, mesuré le 31/10).
      left join (select g.code_canonique, array_agg(g.code_postal order by g.code_postal) as codes
                   from public.cp_groupe g where g.n_membres > 1 group by g.code_canonique) grp
             on grp.code_canonique = cp.code_postal
      cross join lateral (select coalesce(grp.codes, array[cp.code_postal]) as membres) m
      left join public.ref_codes_postaux rcp on rcp.code_postal = cp.code_postal
     where public.pays_contient_code(p_code, cp.code_postal)
    ), a as (
      select l.*, floor(l.p) + case when row_number() over (order by l.p - floor(l.p) desc nulls last, l.p desc nulls last,
                                                                     l.code)
                                         <= round(sum(l.p) over ()) - sum(floor(l.p)) over () then 1 else 0 end as pa
        from l
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', a.code, 'nom', a.nom, 'commune', null, 'n_carreaux', a.n,
             -- C18 : pop_totale = pop_en_zone, toujours (le CP est entier dans le pays : taux utile 100 %).
             'pop_en_zone', a.pa, 'pop_totale', a.pa, 'part', case when a.p > 0 then 100.0 end,
             'part_brute', case when a.p > 0 then 100 end,  -- B11 : exacte, mais la clé que lit `estRetenue`
             'membres', to_jsonb(a.membres))  -- A2 : les codes de l'unité CP
           order by a.p desc, a.code), '[]'::jsonb), count(*)
      into v_lignes, v_n_terr
      from a;
  elsif p_decoupage = 'departement' then
    -- C18 : même répartition ; Σ pop_en_zone = round(Σ des départements). L'écart qui reste à `population` (comptée
    -- par CP) est celui des carreaux sans CP (I-2, rattaché à C25), hors de ce correctif.
    with l as (
    select u.code, rd.nom_dept as nom, t.n, t.p
      from public.unite_population_totale u
      left join (select d.code, d.n_carreaux, d.populations from public.denominateur_menages_min d
                  where v_min > 0 and d.maille = 'departement' offset 0) dm on dm.code = u.code
      cross join lateral (select case when v_min > 0 then coalesce((dm.populations->>p_cible)::numeric, 0)
                                      else (u.populations->>p_cible)::numeric end as p,
                                 case when v_min > 0 then coalesce(dm.n_carreaux, 0) else u.n_carreaux end as n) t
      left join public.ref_departements rd on rd.code_dept = u.code
     where u.maille = 'departement' and public.pays_contient_code(p_code, u.code)
    ), a as (
      select l.*, floor(l.p) + case when row_number() over (order by l.p - floor(l.p) desc nulls last, l.p desc nulls last,
                                                                     l.code)
                                         <= round(sum(l.p) over ()) - sum(floor(l.p)) over () then 1 else 0 end as pa
        from l
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', a.code, 'nom', a.nom, 'commune', null, 'n_carreaux', a.n,
             'pop_en_zone', a.pa, 'pop_totale', a.pa, 'part', case when a.p > 0 then 100.0 end,
             'part_brute', case when a.p > 0 then 100 end)  -- B11
           order by a.p desc, a.code), '[]'::jsonb), count(*)
      into v_lignes, v_n_terr
      from a;
  end if;

  -- A4 (ARB-3) : les unités du TERRITOIRE de la recette que le carroyage ne couvre pas — départements ayant une région
  -- (la règle de `zone_pays_geometrie`, qui unit les régions) contenus dans le pays, sans dénominateur ; au CP, le
  -- canonique de chaque groupe de ces départements, avec ses `membres`. Population NULL (jamais 0) ; `incluse` = vrai :
  -- la zone EST le territoire, chaque unité y est entière — c'est ce qui la retient (`estRetenue`), quel que soit le seuil.
  -- FR → 971, 973, 976 au 31/10 (3 départements, 65 unités CP / 69 codes) ; METRO → aucun.
  if p_decoupage in ('cp', 'departement') then
    with nc as (
      select rd.code_dept as code, rd.nom_dept as nom
        from public.ref_departements rd
       where rd.code_region is not null
         and public.pays_contient_code(p_code, rd.code_dept)
         and not exists (select 1 from public.unite_population_totale u
                          where u.maille = 'departement' and u.code = rd.code_dept)
    ), u as (
      select nc.code, nc.nom, null::text[] as membres from nc where p_decoupage = 'departement'
      union all
      select r.code_postal, r.nom_principal,
             coalesce((select array_agg(m.code_postal order by m.code_postal)
                         from public.cp_groupe m where m.code_canonique = r.code_postal), array[r.code_postal])
        from public.ref_codes_postaux r join nc on nc.code = r.code_dept
       where p_decoupage = 'cp'
         and not exists (select 1 from public.cp_groupe g where g.code_postal = r.code_postal and g.code_canonique <> r.code_postal)
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', u.code, 'nom', u.nom, 'commune', null, 'n_carreaux', 0,
             'pop_en_zone', null, 'pop_totale', null, 'part', null, 'part_brute', null, 'incluse', true)
             || case when u.membres is not null then jsonb_build_object('membres', to_jsonb(u.membres)) else '{}'::jsonb end
           order by u.code), '[]'::jsonb), count(*)
      into v_inc, v_n_inc
      from u;
  end if;

  select jsonb_build_object(
           'source', 'carroyage INSEE Filosofi 200 m (ménages fiscaux)',
           'millesime', (select max(cf.millesime) from public.carreaux_filosofi cf where cf.resolution = '200m'),
           -- A5 : la France de la cible compte les mêmes carreaux que les lignes.
           'population_france', case when v_min > 0
                                  then (select round(coalesce(sum((dm.populations->>p_cible)::numeric), 0))
                                          from public.denominateur_menages_min dm where dm.maille = 'departement')
                                  else (select round(coalesce(sum((u.populations->>p_cible)::numeric), 0))
                                          from public.unite_population_totale u where u.maille = 'region') end,
           'n_carreaux_france', (select k.n_lignes from public.carreau_couverture_controle k limit 1))
    into v_ref;

  return jsonb_build_object(
    'pays', p_code,
    'cible', p_cible,
    'decoupage', p_decoupage,
    'n_carreaux', v_n,
    'population', round(v_pop),
    'lignes', v_lignes || v_inc,  -- A4 : les unités inconnues après les chiffrées
    'hors_territoire', jsonb_build_object('n_carreaux', 0, 'population', 0),
    'n_territoires', v_n_terr + v_n_inc,
    'n_inconnues', v_n_inc,  -- A4
    -- A5 : le minimum appliqué et ce qu'il écarte.
    'min_menages', v_min,
    'arrondi_lignes', 'plus_fort_reste',  -- C18 (sql/324) : lignes au plus fort reste
    'carreaux_ecartes', jsonb_build_object('n_carreaux', v_ec_n, 'population', round(v_ec_p)),
    'motif_vide', case when v_n > 0 then null when v_ec_n > 0 then 'carreaux_tous_ecartes' else 'aucun_carreau' end,
    'territoires_non_carroyes', '[]'::jsonb,
    'reference', v_ref,
    'base_construite_le', v_base,
    'calcule_le', now()
  );
end
$fn$;

comment on function public.couverture_pays_jsonb(text, text, text) is
  'Couverture nationale d''une zone pays (METRO / FR) sans lire un carreau : forme = somme de cp_population_totale ; '
  'cp = chaque CP du pays a 100 % ; departement = unite_population_totale ; iris et commune refuses '
  '(decoupage_trop_fin_pays) sans lecture. Memes cles que couverture_geometrie + pays. sql/296 (T2), sql/303 (B11 : part_brute), sql/304 (A2 : membres '
  'des lignes CP), sql/308 (A4 : cp et departement portent aussi les unites non carroyees du territoire, population '
  'NULL, incluse = true ; n_inconnues), sql/310 (A5 : cible autre que ind, chiffres de denominateur_menages_min, '
  'min_menages, carreaux_ecartes), sql/324 (C18 : pop_en_zone = pop_totale arrondies au plus fort reste, '
  'somme des lignes = round(somme brute) ; arrondi_lignes).';

revoke all on function public.couverture_pays_jsonb(text, text, text) from public, anon, authenticated;
grant execute on function public.couverture_pays_jsonb(text, text, text) to service_role;

-- Les chiffrages pays CP / département arrondis ligne à ligne (sans la clé) ne sont plus servis : supprimés une fois.
delete from public.couverture_zone_cache c
 where c.resultat ? 'pays' and c.decoupage in ('cp', 'departement') and not (c.resultat ? 'arrondi_lignes');
