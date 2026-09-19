-- sql/207 — Confronter la diffusion d'une campagne aux classes de risque
--           (2026-09-19)
--
-- Sert l'onglet « Diffusion » : une campagne est mesurée au CODE POSTAL, le
-- risque au CARREAU. Ce fichier construit le pont, et le dénominateur qui rend
-- la ventilation honnête.
--
-- ── LE DÉNOMINATEUR, ET POURQUOI ON NE PEUT PAS PRENDRE CELUI QUI EXISTE ──
--
-- Ventiler les impressions d'un code postal vers ses classes de risque se fait
-- au prorata de population. Il faut donc la population TOTALE du code postal —
-- pas seulement sa part exposée. Sans cela, un code postal comptant un habitant
-- exposé sur cinquante mille enverrait la TOTALITÉ de ses impressions dans la
-- classe à risque.
--
-- `carreaux_cp_population` existe et serait tentante. Elle est fausse :
-- mesurée le 2026-09-19, elle totalise **74 876 618 habitants** contre
-- 67 760 552 réels, soit **+10,5 %** — un carreau y est compté dans chaque code
-- postal qui le recouvre. `lib/risques/methode.ts` le documente déjà comme la
-- raison pour laquelle la part et la densité sont ABSENTES à la maille code
-- postal.
--
-- On recalcule donc le dénominateur avec la MÊME règle que
-- `carreau_risque_distance.code_postal` (sql/206) : un carreau, un code postal,
-- celui dont le centroïde est le plus proche. C'est la cohérence entre
-- numérateur et dénominateur qui compte — un prorata dont les deux termes ne
-- comptent pas la même chose ne veut rien dire.

create table if not exists public.cp_population_totale (
  code_postal text primary key,
  -- Les 24 cibles, même patron que `carreaux_filosofi` et
  -- `couverture_rayon_risque`. Six mille lignes : le jsonb ne coûte rien ici,
  -- contrairement aux 883 451 de `carreau_risque_distance`.
  populations jsonb not null,
  n_carreaux  int   not null,
  construit_le timestamptz not null default now()
);

comment on table public.cp_population_totale is
  'Population TOTALE par code postal, calculee avec la meme regle « un carreau, un code '
  'postal » que carreau_risque_distance. NE PAS remplacer par carreaux_cp_population, '
  'qui surcompte de 10,5 % (74 876 618 contre 67 760 552) en comptant un carreau dans '
  'chaque contour qui le recouvre. '
  'MESURE 2026-09-19 : 6 037 codes postaux, 63 711 780 habitants, 2 320 651 carreaux '
  'rattaches sur 2 324 577 (99,83 %). ⚠ Le total n''est PAS la population legale de la '
  'France (67 760 552) mais celle du CARROYAGE Filosofi, qui vaut 63 783 569 : le '
  'carroyage porte les menages fiscaux, pas la population totale. On en capte 99,89 %. '
  'Comparer ce total aux 67,8 M ferait conclure a tort a une lacune de calcul.';

alter table public.cp_population_totale enable row level security;
revoke all on table public.cp_population_totale from public, anon, authenticated;
grant select, insert, update, delete on table public.cp_population_totale to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONSTRUCTION DU DÉNOMINATEUR
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.remplir_cp_population_totale(
  p_bande     int,
  p_n_bandes  int default 20,
  -- ⚠ MÉTROPOLE par défaut, et l'outre-mer par des appels SÉPARÉS.
  --
  -- La première version prenait −61,6 à 56,0 en vingt bandes, « pour couvrir
  -- l'outre-mer d'un coup ». Mesuré : 117,6° divisés par vingt font 5,88° par
  -- bande, or la métropole n'en fait que 15,3 — elle tenait donc dans TROIS
  -- bandes de 800 000 carreaux chacune, et la construction ne rendait plus la
  -- main. Après vingt minutes : 222 codes postaux sur 6 018.
  --
  -- C'est exactement l'avertissement de sql/200, que le script voisin porte
  -- dans son en-tête, et je l'ai reproduit ici. Un partitionnement uniforme sur
  -- une étendue dominée par l'outre-mer met toute la France dans une ou deux
  -- bandes : les bornes doivent suivre la DENSITÉ, pas l'étendue.
  p_lon_ouest numeric default -5.5,
  p_lon_est   numeric default 9.8
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_lon_min numeric;
  v_lon_max numeric;
  v_x_min   double precision;
  v_x_max   double precision;
  v_t0      timestamptz := clock_timestamp();
  v_cibles  text[];
  v_n       int;
begin
  set local statement_timeout = '30min';
  set local work_mem = '64MB';

  if p_bande < 0 or p_bande >= p_n_bandes then
    return jsonb_build_object('error', 'bande_hors_bornes', 'ok', false);
  end if;

  -- ⚠ Le dénominateur doit porter sur TOUS les carreaux, outre-mer compris :
  -- un code postal antillais à population nulle ferait diviser par zéro sa
  -- ventilation. Mais l'outre-mer se traite par des appels SÉPARÉS, avec ses
  -- propres bornes — voir le commentaire des paramètres ci-dessus, et le
  -- tableau `ZONES_LOINTAINES` de `scripts/construire_carreau_risque.mjs`.
  v_lon_min := p_lon_ouest + (p_lon_est - p_lon_ouest) * p_bande     / p_n_bandes;
  v_lon_max := p_lon_ouest + (p_lon_est - p_lon_ouest) * (p_bande+1) / p_n_bandes;
  v_x_min := ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(v_lon_min, 0), 4326), 3857));
  v_x_max := ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(v_lon_max, 0), 4326), 3857));

  select array_agg(code order by code) into v_cibles
    from public.cibles_exposition where actif;

  with carreaux as (
    select c.id, c.metadata,
           ST_Transform(ST_Centroid(c.geom_3857), 4326) as p
      from public.carreaux_filosofi c
     where ST_X(ST_Centroid(c.geom_3857)) >= v_x_min
       and ST_X(ST_Centroid(c.geom_3857)) <  v_x_max
  ),
  -- MÊME règle que sql/206 : le code postal dont le centroïde est le plus
  -- proche. Le numérateur et le dénominateur doivent rattacher le carreau au
  -- MÊME code postal, sinon le prorata compare deux découpages différents.
  rattaches as (
    select distinct on (x.id) x.id, x.metadata, r.code_postal
      from carreaux x
      join public.ref_codes_postaux r
        on r.geom && x.p and ST_Contains(r.geom, x.p)
     order by x.id, ST_Distance(r.centroid, x.p)
  )
  ,
  -- Les sommes par cible. Le `cross join` multiplie les lignes par 24 : c'est
  -- inhérent, il faut bien une ligne par (code postal, cible) pour agréger.
  sommes as (
    select r.code_postal, c.cible,
           sum(coalesce((r.metadata->>c.cible)::numeric, 0)) as somme
      from rattaches r
      cross join unnest(v_cibles) as c(cible)
     group by r.code_postal, c.cible
  ),
  -- ⚠ Le compte de carreaux est calculé À PART, et c'est un correctif. La
  -- première version le tirait d'un `count(*) over (partition by code_postal)`
  -- posé DANS la requête déjà groupée par (code postal, cible) : une fonction
  -- de fenêtrage s'évalue APRÈS le regroupement, elle comptait donc les
  -- GROUPES — c'est-à-dire 24, le nombre de cibles — et non les carreaux.
  -- Mesuré avant correctif : 119 808 carreaux annoncés là où la base en porte
  -- 2 324 577. Une colonne qui ment est pire qu'une colonne absente.
  comptes as (
    select code_postal, count(*) as n from rattaches group by code_postal
  )
  insert into public.cp_population_totale (code_postal, populations, n_carreaux)
  select s.code_postal, jsonb_object_agg(s.cible, s.somme), max(c.n)
    from sommes s
    join comptes c on c.code_postal = s.code_postal
   group by s.code_postal
  -- Additif : une bande complète un code postal à cheval, elle ne l'écrase pas.
  -- C'est la différence avec `carreau_risque_distance`, dont la clé est le
  -- carreau et dont l'insertion REMPLACE.
  on conflict (code_postal) do update
     set populations = (
           select jsonb_object_agg(k, (coalesce(cp_population_totale.populations->>k, '0')::numeric
                                       + coalesce(excluded.populations->>k, '0')::numeric))
             from jsonb_object_keys(excluded.populations) k),
         n_carreaux = cp_population_totale.n_carreaux + excluded.n_carreaux,
         construit_le = now();

  get diagnostics v_n = row_count;

  return jsonb_build_object(
    'ok', true, 'bande', p_bande, 'codes_postaux', v_n,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

comment on function public.remplir_cp_population_totale is
  'Construit UNE bande de longitude du denominateur par code postal. Additive : un code '
  'postal a cheval sur deux bandes est COMPLETE, pas ecrase. Couvre l''outre-mer, sans '
  'quoi un code postal antillais aurait une population nulle et sa ventilation diviserait '
  'par zero.';

revoke all on function public.remplir_cp_population_totale(int, int, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.remplir_cp_population_totale(int, int, numeric, numeric)
  to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- LA CONFRONTATION
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.diffusion_par_classe(
  p_campagne uuid,
  p_profil   jsonb,
  p_cible    text default 'ind',
  p_maille   text default 'departement',
  p_parent   text default null,
  p_limite   int  default 200
) returns jsonb
-- `parallel safe` : mesuré sur `population_par_classe`, il fait passer
-- l'agrégation nationale de 12,3 s à 2,8 s. Une fonction `security definer` est
-- non parallélisable par défaut ; celle-ci ne fait que lire.
language plpgsql stable parallel safe security definer set search_path to 'public' as $fn$
declare
  v_haut  int[];
  v_bas   int[];
  v_lie   boolean;
  v_pprt  boolean;
  v_cible text;
  v_res   jsonb;
begin
  select code into v_cible from public.cibles_exposition
   where code = coalesce(p_cible, 'ind') and actif;
  if v_cible is null then
    return jsonb_build_object('error', 'cible_inconnue', 'calculable', false);
  end if;

  if p_maille not in ('departement', 'commune') then
    return jsonb_build_object('error', 'maille_non_portee', 'calculable', false);
  end if;

  if not exists (select 1 from public.cp_population_totale) then
    -- Sans dénominateur, toute part serait fausse. Le dire vaut mieux que de
    -- rendre des pourcentages qu'on ne peut pas calculer.
    return jsonb_build_object('error', 'denominateur_absent', 'calculable', false);
  end if;

  v_lie  := coalesce((p_profil->>'lie')::boolean, false);
  v_pprt := coalesce((p_profil->>'inclurePPRT')::boolean, true);
  select coalesce(array_agg(x::int order by x::int), '{}')
    into v_haut from jsonb_array_elements_text(coalesce(p_profil->'haut', '[]'::jsonb)) x;
  if v_lie then v_bas := v_haut;
  else
    select coalesce(array_agg(x::int order by x::int), '{}')
      into v_bas from jsonb_array_elements_text(coalesce(p_profil->'bas', '[]'::jsonb)) x;
  end if;

  with
  -- Population exposée par code postal ET par classe.
  pop_classe as materialized (
    select d.code_postal,
           public.classe_carreau_risque(d.d_haut_m, d.d_bas_m, d.pprt_niveau,
                                        v_haut, v_bas, v_pprt) as classe,
           sum(coalesce((c.metadata->>v_cible)::numeric, 0)) as pop
      from public.carreau_risque_distance d
      join public.carreaux_filosofi c on c.id = d.carreau_id
     where d.code_postal is not null and d.code_postal <> ''
       and (p_parent is null or d.code_departement = p_parent)
     group by d.code_postal, 2
  ),
  -- ⚠ Les impressions sont SOMMÉES sur les acteurs. La clé primaire de
  -- `campaign_cp_rollup` est (campagne × code postal × ACTEUR) : un code postal
  -- y apparaît jusqu'à cinq fois, et oublier la somme annoncerait cinq fois
  -- trop. Même piège que `correlation_campagne_indicateur` (sql/147).
  diffusion as (
    select r.postal_code as code_postal,
           sum(r.impressions) as impressions,
           sum(r.spend) as depense
      from public.campaign_cp_rollup r
     where r.campaign_id = p_campagne
     group by r.postal_code
  ),
  -- Le prorata : la part de la population du code postal qui tombe dans chaque
  -- classe. Le dénominateur est la population TOTALE du code postal, pas sa
  -- seule part exposée — sinon un code postal comptant un habitant exposé sur
  -- cinquante mille enverrait toutes ses impressions dans la classe à risque.
  -- ⚠ `as materialized`, et c'est une mesure. Ces deux CTE sont référencées
  -- jusqu'à cinq fois par le `select` final ; inlinées, PostgreSQL rejoue le
  -- croisement des 883 451 carreaux à CHAQUE référence.
  --
  -- Mesuré sur le jeu de démonstration, à résultat rigoureusement identique
  -- (écart de somme nul dans les deux cas) : **25,8 s inlinées, 5,8 s
  -- matérialisées**. La règle est déjà connue du projet — « une CTE est inlinée
  -- depuis PG12 » — et elle vaut autant pour une agrégation coûteuse que pour
  -- une expression PostGIS.
  ventile as materialized (
    select pc.classe,
           sum(pc.pop) as pop,
           sum(d.impressions * pc.pop
               / nullif((t.populations->>v_cible)::numeric, 0)) as impressions,
           sum(d.depense * pc.pop
               / nullif((t.populations->>v_cible)::numeric, 0)) as depense
      from pop_classe pc
      join public.cp_population_totale t on t.code_postal = pc.code_postal
      join diffusion d on d.code_postal = pc.code_postal
     group by pc.classe
  ),
  totaux as materialized (
    select (select coalesce(sum(impressions), 0) from ventile where classe <> 'hors') as imp_en_zone,
           (select coalesce(sum(pop), 0) from ventile where classe <> 'hors') as pop_en_zone,
           (select coalesce(sum(impressions), 0) from diffusion) as imp_totales,
           (select coalesce(sum(depense), 0) from diffusion) as dep_totales,
           (select coalesce(sum((t.populations->>v_cible)::numeric), 0)
              from public.cp_population_totale t
              join diffusion d on d.code_postal = t.code_postal) as pop_touchee
  ),
  -- ⚠ LE HORS-ZONE EST LE RESTE, ET C'EST UN CORRECTIF.
  --
  -- La première version le tirait de `ventile`, c'est-à-dire des seuls codes
  -- postaux comptant au moins un carreau exposé. Mesuré sur le jeu de
  -- démonstration : 205 M en zone + 616 M hors zone = 821 M, pour 1 196 M
  -- d'impressions réelles. **375 millions d'impressions disparaissaient des
  -- barres** — celles des codes postaux qu'aucun site ne voisine, absents de
  -- `carreau_risque_distance`.
  --
  -- Un écran dont les barres ne somment pas au total est exactement ce que
  -- cette refonte existe pour supprimer. Le hors-zone est donc le RESTE :
  -- tout ce que les classes de risque ne retiennent pas.
  complet as (
    select classe, pop, impressions, depense from ventile where classe <> 'hors'
    union all
    select 'hors',
           (select pop_touchee - pop_en_zone from totaux),
           (select imp_totales - imp_en_zone from totaux),
           (select dep_totales from totaux)
             - coalesce((select sum(depense) from ventile where classe <> 'hors'), 0)
  )
  select jsonb_build_object(
    'calculable', true,
    'campagne', p_campagne,
    -- Le drapeau vient d'ICI et pas d'un second appel : une campagne de
    -- demonstration doit se signaler, et `is_demo` est la source — jamais le
    -- prefixe « [DEMO] » du nom, qui se modifie a la main.
    'est_demo', coalesce((select is_demo from public.dsp_campaigns where id = p_campagne), false),
    'cible', v_cible,
    'maille', p_maille,
    'parent', p_parent,
    'impressions_totales', round((select imp_totales from totaux)),
    'impressions_en_zone', round((select imp_en_zone from totaux)),
    'population_touchee', round((select pop_touchee from totaux)),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'classe', c.classe,
               'population', round(c.pop),
               'impressions', round(c.impressions),
               'depense', round(coalesce(c.depense, 0)::numeric, 2),
               -- L'INDICE DE PRESSION : part des impressions rapportée à la
               -- part de population, ×100. 100 = la classe reçoit exactement sa
               -- part démographique ; 150 = elle en reçoit la moitié en plus.
               -- C'est la grandeur que le custom bidding cherche à déplacer.
               'indice', case
                 when (select pop_touchee from totaux) > 0
                  and (select imp_totales from totaux) > 0
                  and c.pop > 0
                 then round(
                   (c.impressions / (select imp_totales from totaux))
                   / (c.pop / (select pop_touchee from totaux)) * 100)
                 else null end)
             order by c.classe)
        from complet c), '[]'::jsonb))
    into v_res;

  return v_res;
end;
$fn$;

comment on function public.diffusion_par_classe is
  'Confronte les impressions d''une campagne aux classes de risque, ventilees au prorata '
  'de population. Le denominateur est la population TOTALE du code postal (cp_population_'
  'totale) et non sa part exposee : sinon un code postal comptant un habitant expose sur '
  'cinquante mille enverrait toutes ses impressions dans la classe a risque. Les '
  'impressions sont SOMMEES sur les acteurs — la PK de campaign_cp_rollup les demultiplie.';

revoke all on function public.diffusion_par_classe(uuid, jsonb, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.diffusion_par_classe(uuid, jsonb, text, text, text, int)
  to service_role;
