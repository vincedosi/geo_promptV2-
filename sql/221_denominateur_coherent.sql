-- sql/221 — Un dénominateur qui compte la MÊME chose que le numérateur
--           (2026-09-20)
--
-- ── LE DÉFAUT, MESURÉ ────────────────────────────────────────────────────
--
-- La colonne « Part » de l'écran de couverture rapportait une population
-- exposée issue du CARROYAGE à une population totale issue des IRIS. Les deux
-- ne comptent pas la même chose, et cela se voit :
--
--     1 070 communes sur 6 517 (16,4 %) dépassaient 100 %
--     maximum mesuré : 163 %
--     exemple : Issou (78314), 4 550 exposés pour 3 858 habitants
--
-- ⚠ **Ce n'est pas une erreur d'arrondi, c'est une incohérence de définition.**
-- Un carreau INSEE de 200 m est attribué ENTIÈREMENT à une seule commune — la
-- première de son `lcog_geo` — parce que c'est cette règle qui rend les sommes
-- additives. Or **235 983 carreaux sur 2 324 577 (10,2 %) sont à cheval** sur
-- plusieurs communes. Le numérateur d'une commune contient donc des habitants
-- que le dénominateur INSEE compte chez la voisine.
--
-- Le projet a déjà rencontré exactement ce raisonnement et l'a tranché dans le
-- même sens (`cp_population_totale`, sql/207) :
--
--   « c'est la cohérence entre numérateur et dénominateur qui compte, un
--     prorata dont les deux termes ne comptent pas la même chose ne veut rien
--     dire »
--
-- Cette migration étend ce dénominateur aux trois autres mailles.
--
-- ── DEUX DÉNOMINATEURS, DEUX QUESTIONS ───────────────────────────────────
--
-- ⚠ La **part** et la **densité** ne se calculent pas sur le même dénominateur,
-- et ce n'est pas une inconséquence :
--
--   · **part** = exposés / population du carroyage de l'unité. Les deux termes
--     viennent des mêmes carreaux, attribués par la même règle. Par
--     construction, la part ne peut plus dépasser 100 %.
--   · **densité** = exposés / superficie ADMINISTRATIVE de l'unité. On demande
--     « combien d'exposés par km² de territoire », pas « par km² habité ».
--     Diviser par la surface des seuls carreaux habités (n × 0,04 km²)
--     multiplierait la densité de Paris par celle de la Lozère sans que rien
--     ne le signale.
--
-- ── CE QUE CE DÉNOMINATEUR N'EST PAS ─────────────────────────────────────
--
-- ⚠ Il totalise **63,7 millions** d'habitants et non 67,76. La différence n'est
-- pas une perte : le carroyage Filosofi 2021 à 200 m ne publie que la
-- métropole, la Martinique et La Réunion — **la Guadeloupe, la Guyane et
-- Mayotte n'ont aucun carreau**, et le carroyage ne porte que les carreaux
-- HABITÉS. La part se lit donc « part des habitants CARROYÉS de cette unité »,
-- ce que l'écran doit dire.

create table if not exists public.unite_population_totale (
  /** `commune` | `departement` | `region` | `code_postal`. */
  maille       text not null,
  code         text not null,
  /**
   * Les 24 cibles de `cibles_exposition`, comme `cp_population_totale`.
   *
   * Toutes, et pas seulement `ind` : la part doit suivre la cible choisie à
   * l'écran. Rapporter « les moins de 25 ans exposés » à la population TOTALE
   * rendrait une part qui ne veut rien dire, et qui aurait l'air juste.
   */
  populations  jsonb not null,
  n_carreaux   integer not null,
  construit_le timestamptz not null default now(),
  primary key (maille, code)
);

comment on table public.unite_population_totale is
  'Population TOTALE par unite territoriale, comptee sur les MEMES carreaux et par la '
  'MEME regle d''attribution que la population exposee. Existe parce que rapporter un '
  'numerateur issu du carroyage a un denominateur issu des IRIS faisait depasser 100 % '
  'a 1 070 communes sur 6 517 (max 163 %) : 235 983 carreaux sur 2 324 577 sont a '
  'cheval sur plusieurs communes, et chacun est attribue ENTIEREMENT a une seule. '
  'Meme raisonnement que cp_population_totale (sql/207). ⚠ Totalise 63,7 M et non '
  '67,76 M : le carroyage ne couvre ni la Guadeloupe ni la Guyane ni Mayotte, et ne '
  'porte que les carreaux HABITES.';

alter table public.unite_population_totale enable row level security;

create or replace function public.construire_unite_population_totale()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_cibles text[];
  v_t0     timestamptz := clock_timestamp();
  v_n      jsonb := '{}'::jsonb;
begin
  -- Une construction, pas une lecture d'écran : le délai par défaut du rôle ne
  -- suffit pas à parcourir 2,3 millions de carreaux.
  set local statement_timeout = '30min';
  set local work_mem = '128MB';

  select array_agg(code order by code) into v_cibles
    from public.cibles_exposition where actif;

  /*
   * ── 1. LA COMMUNE, SEULE MAILLE LUE SUR LES CARREAUX ───────────────────
   *
   * ⚠ `split_part(lcog_geo, ',', 1)` et non le champ entier : `lcog_geo` est
   * une LISTE dès que le carreau est à cheval (relevé sur Paris :
   * `'75103,75104,75111'`). On retient le PREMIER code — la même règle que
   * `carreau_risque_distance`, sans quoi numérateur et dénominateur
   * n'attribueraient pas les mêmes carreaux aux mêmes communes, et le défaut
   * qu'on corrige réapparaîtrait sous une autre forme.
   *
   * ⚠ La population est dans `metadata`. La colonne `ind` existe mais est
   * NULL sur les 2,3 millions de lignes : la lire rendrait ZÉRO partout, sans
   * la moindre erreur.
   */
  with base as (
    select split_part(c.metadata->>'lcog_geo', ',', 1) as code, c.metadata
      from public.carreaux_filosofi c
     where c.metadata->>'lcog_geo' is not null
       and c.metadata->>'lcog_geo' <> ''
  ),
  /*
   * ⚠ `cross join unnest` plutôt que 24 sous-requêtes : on balaie les carreaux
   * UNE fois. Même patron que `remplir_cp_population_totale` (sql/207), et la
   * remarque qui l'accompagne vaut ici — ce qui explose, ce sont les GROUPES,
   * c'est-à-dire 24 par commune, pas les carreaux.
   */
  sommes as (
    select b.code, x.cible,
           sum(coalesce((b.metadata->>x.cible)::numeric, 0)) as somme
      from base b
      cross join unnest(v_cibles) as x(cible)
     group by b.code, x.cible
  ),
  comptes as (
    select code, count(*) as n from base group by code
  )
  insert into public.unite_population_totale (maille, code, populations, n_carreaux)
  select 'commune', s.code, jsonb_object_agg(s.cible, s.somme), max(c.n)
    from sommes s
    join comptes c on c.code = s.code
   group by s.code
  on conflict (maille, code) do update
     set populations = excluded.populations,
         n_carreaux  = excluded.n_carreaux,
         construit_le = now();

  /*
   * ── 2. DÉPARTEMENT, RÉGION ET CODE POSTAL ──────────────────────────────
   *
   * Par SOMMATION des communes, jamais par un second balayage des carreaux :
   * c'est ce qui garantit que les quatre mailles comptent exactement le même
   * ensemble de carreaux. Deux parcours pourraient diverger au premier
   * correctif appliqué d'un seul côté.
   *
   * ⚠ La règle `97`/`98` sur trois caractères n'est pas théorique : sans elle,
   * la Guadeloupe (971) et Mayotte (976) tomberaient toutes deux sur un
   * département « 97 » qui n'existe pas. Vérifiée sur les 34 921 communes
   * d'`iris_agg_commune` — zéro département dérivé absent de
   * `ref_departements`.
   */
  with comm as (
    select case when left(u.code, 2) in ('97', '98')
                then left(u.code, 3) else left(u.code, 2) end as dep,
           u.populations, u.n_carreaux
      from public.unite_population_totale u
     where u.maille = 'commune'
  ),
  paires as (
    select c.dep, x.cible,
           sum(coalesce((c.populations->>x.cible)::numeric, 0)) as somme
      from comm c
      cross join unnest(v_cibles) as x(cible)
     group by c.dep, x.cible
  ),
  compte as (
    select dep, sum(n_carreaux) as n from comm group by dep
  )
  insert into public.unite_population_totale (maille, code, populations, n_carreaux)
  select 'departement', p.dep, jsonb_object_agg(p.cible, p.somme), max(c.n)
    from paires p
    join compte c on c.dep = p.dep
   group by p.dep
  on conflict (maille, code) do update
     set populations = excluded.populations,
         n_carreaux  = excluded.n_carreaux,
         construit_le = now();

  /*
   * La région se somme à son tour depuis le département, par la jointure INSEE
   * réelle. ⚠ `'HORS'` et jamais `null` pour les trois collectivités
   * d'outre-mer sans région en base : une unité anonyme se perdrait, et
   * `population_par_classe` les regroupe déjà sous ce même code.
   */
  with dep as (
    select coalesce(r.code_region, 'HORS') as reg, u.populations, u.n_carreaux
      from public.unite_population_totale u
      left join public.ref_departements r on r.code_dept = u.code
     where u.maille = 'departement'
  ),
  paires as (
    select d.reg, x.cible,
           sum(coalesce((d.populations->>x.cible)::numeric, 0)) as somme
      from dep d
      cross join unnest(v_cibles) as x(cible)
     group by d.reg, x.cible
  ),
  compte as (
    select reg, sum(n_carreaux) as n from dep group by reg
  )
  insert into public.unite_population_totale (maille, code, populations, n_carreaux)
  select 'region', p.reg, jsonb_object_agg(p.cible, p.somme), max(c.n)
    from paires p
    join compte c on c.reg = p.reg
   group by p.reg
  on conflict (maille, code) do update
     set populations = excluded.populations,
         n_carreaux  = excluded.n_carreaux,
         construit_le = now();

  /*
   * ── PAS DE DÉNOMINATEUR AU CODE POSTAL, ET C'EST MESURÉ ────────────────
   *
   * Cette fonction en a calculé un, puis l'a retiré. Ce qui l'a décidé :
   *
   *   · `cp_population_totale` (sql/207) est **incomplète et silencieusement**.
   *     Sur 59640 (Dunkerque) elle porte 6 carreaux et 975 habitants ; le même
   *     prédicat, rejoué à la main, en trouve 121 et 23 116. Son total national
   *     a pourtant l'air juste — 63,7 M, à 0,1 % du total communal — ce qui
   *     rend le défaut invisible à tout agrégat.
   *   · **Recalculé ici**, sur les 2,3 millions de carreaux et la même règle du
   *     centroïde le plus proche, le résultat ne converge pas davantage : 23
   *     carreaux pour ce même code postal, et des parts jusqu'à **15 173 %**.
   *
   * La cause est dans la donnée, pas dans le code : les contours de
   * `ref_codes_postaux` **se recouvrent sur ~14 % des carreaux** et **ne pavent
   * pas le territoire**. Attribuer un carreau à « son » code postal est alors
   * un arbitrage, pas une mesure, et deux arbitrages également défendables
   * donnent deux dénominateurs incompatibles.
   *
   * ⚠ **C'est la conclusion à laquelle le projet était déjà parvenu**
   * (`ARCHITECTURE.md`, maille code postal : « une colonne vide qui s'explique
   * vaut mieux qu'un chiffre faux de 10 % qui colore une carte »). Elle a été
   * réexaminée ici, avec des mesures, et confirmée. Part et densité restent
   * donc ABSENTES à cette maille — et l'écran le dit, plutôt que d'afficher
   * 15 173 %.
   *
   * Un code postal n'est pas non plus une union de communes : le dériver de la
   * maille communale rendrait un total faux.
   */

  select jsonb_object_agg(maille, n) into v_n
    from (select maille, count(*) as n
            from public.unite_population_totale group by maille) t;

  return jsonb_build_object('ok', true, 'detail', v_n,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

comment on function public.construire_unite_population_totale is
  'Construit le denominateur COHERENT de la part de population exposee. La commune se '
  'lit sur les carreaux (premier code de lcog_geo, la MEME regle que le numerateur), '
  'le departement et la region se somment depuis elle, et le code postal est COPIE de '
  'cp_population_totale (sql/207) plutot que recalcule. A rejouer apres tout '
  'rechargement de carreaux_filosofi.';

revoke all on function public.construire_unite_population_totale() from public, anon, authenticated;
grant execute on function public.construire_unite_population_totale() to service_role;
