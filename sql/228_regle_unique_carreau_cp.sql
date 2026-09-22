-- ============================================================================
-- sql/228 — une seule règle pour rattacher un carreau à un code postal,
--           et des groupes là où le référentiel ne sait pas trancher
-- ============================================================================
--
-- CE QUI A ÉTÉ MESURÉ LE 2026-09-22, ET QUI EST PIRE QU'UN TROU DE DONNÉES.
--
-- `cp_population_totale` ne couvrait que 6 037 des 6 187 codes postaux, et
-- 47 codes postaux portant des carreaux à portée n'y avaient aucune ligne —
-- Nantes 44200, Strasbourg 67100, Limoges 87100, Saint-Denis 97417. On
-- pouvait croire à une reconstruction incomplète. Ce n'en est pas une.
--
-- **`ref_codes_postaux` porte la MÊME géométrie pour tous les codes postaux
-- d'une commune.** Vérifié : `ST_Equals(geom('44000'), geom('44200'))` répond
-- `true`, et les quatre codes postaux de Nantes partagent aussi leur
-- centroïde, au bit près. **71 groupes, 181 codes postaux**, jusqu'à 6 membres.
--
-- Conséquences en chaîne :
--
-- ① `ST_Contains(r.geom, p)` est vrai pour LES QUATRE. Le départage
--    « le centroïde le plus proche » est alors une ÉGALITÉ PARFAITE, tranchée
--    par l'ordre physique des lignes — c'est-à-dire par le plan d'exécution.
--    Mesuré : les 103 carreaux que le numérateur avait donnés à 44200, la même
--    règle rejouée les éclate en 44000 (45), 44300 (24), 44100 (18), 44200
--    (16). Deux fonctions qui prétendent appliquer la même règle ne tiraient
--    pas le même numéro.
--
-- ② Les « 47 codes postaux manquants » sont les PERDANTS de ce tirage. Rien à
--    compléter : il fallait comprendre pourquoi ils perdaient.
--
-- ③ Et le plus coûteux, côté métier : le plan achetait UN code postal sur
--    quatre. À Nantes, on ciblait 44200 pendant que les exposés sont répartis
--    sur les quatre — la donnée ne permet pas de savoir lequel, puisque le
--    référentiel ne distingue pas leurs contours.
--
-- ── CE QUE CETTE MIGRATION POSE ─────────────────────────────────────────────
--
-- **`cp_groupe`** : chaque code postal reçoit un CODE CANONIQUE, celui du
-- groupe des codes postaux dont la géométrie est identique (le plus petit
-- code, choix arbitraire mais STABLE). Un code postal seul est son propre
-- canonique — donc la table couvre les 6 187 et aucune requête n'a de cas
-- particulier à écrire.
--
-- **`cp_du_point(geometry)`** : LA règle, en un seul endroit. Le contour qui
-- contient le point, départagé par la distance au centroïde PUIS par le code
-- postal — ce second critère est ce qui rend le tirage déterministe quand le
-- premier est une égalité. Elle rend le code CANONIQUE : les quatre codes
-- postaux de Nantes ne sont pas quatre réponses possibles, ils sont une seule
-- réponse à quatre noms.
--
-- ⚠ Écrite en `language sql` et non `plpgsql`, et MESURÉE plutôt que supposée.
-- L'espoir était qu'elle soit inlinée ; elle ne l'est pas — EXPLAIN ne montre
-- aucun sous-plan, et retirer `security definer` puis `set search_path` (qui
-- tous deux interdisent l'inlining) n'a fait passer 50 000 appels que de
-- 1 023 ms à 775 ms. Un `order by … limit 1` n'est pas inlinable. Le coût
-- retenu est donc **15 µs par carreau**, soit ~36 s sur les 2 324 577 du
-- référentiel : négligeable devant les 9 minutes que coûte déjà la lecture des
-- carreaux eux-mêmes, et c'est ce qui rend ce choix acceptable. La leçon
-- inverse est dans ce dépôt — `classe_carreau_risque` en sous-requête coûtait
-- 108 s contre 12 s à plat (sql/204) — mais elle était appelée 883 451 fois
-- pour un calcul pur, là où celle-ci fait un point-dans-polygone que l'ancien
-- code faisait de toute façon.
--
-- ⚠ Le regroupement porte sur l'ÉGALITÉ EXACTE des géométries, jamais sur le
-- recouvrement. Les contours postaux se recouvrent partiellement sur ~14 % des
-- carreaux (sql/221) : ça, c'est une vraie ambiguïté de frontière, qu'un
-- départage tranche honnêtement. Deux contours IDENTIQUES, c'est autre chose —
-- l'information n'existe pas, et aucun départage ne la fera apparaître.
-- ============================================================================

-- ── 1. Les groupes de codes postaux indiscernables ──────────────────────────

create table if not exists public.cp_groupe (
  code_postal    text primary key,
  code_canonique text not null,
  n_membres      smallint not null,
  construit_le   timestamptz not null default now()
);

create index if not exists idx_cp_groupe_canonique on public.cp_groupe (code_canonique);

alter table public.cp_groupe enable row level security;

comment on table public.cp_groupe is
  'Code canonique de chaque code postal : le plus petit code du groupe des '
  'codes postaux dont la GEOMETRIE est identique dans ref_codes_postaux '
  '(71 groupes, 181 codes postaux, jusqu''a 6 membres — les communes a '
  'plusieurs codes postaux y portent le contour communal, pas des contours '
  'postaux). Un code postal seul est son propre canonique. sql/228.';

comment on column public.cp_groupe.n_membres is
  'Taille du groupe. 1 = code postal ordinaire. > 1 = le referentiel ne sait '
  'pas distinguer ces codes postaux, et le plan doit donc les ACHETER TOUS.';

create or replace function public.construire_cp_groupe()
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_t0 timestamptz := clock_timestamp();
  v_n  int;
  v_g  int;
begin
  -- ⚠ `md5(ST_AsBinary(geom))` et non un `ST_Equals` croisé : ce dernier est
  -- quadratique (6 187 x 6 187 tests géométriques). L'empreinte binaire donne
  -- le même regroupement par un simple `group by`. Elle est plus STRICTE que
  -- `ST_Equals` — deux géométries égales mais d'encodage différent (ordre des
  -- anneaux, point de départ) ne se regrouperaient pas — et c'est le bon sens
  -- de l'erreur : on ne regroupe QUE ce qui est indiscutablement identique.
  delete from public.cp_groupe;

  insert into public.cp_groupe (code_postal, code_canonique, n_membres)
  select r.code_postal,
         min(r.code_postal) over (partition by md5(ST_AsBinary(r.geom))),
         count(*)           over (partition by md5(ST_AsBinary(r.geom)))
    from public.ref_codes_postaux r
   where r.geom is not null;
  get diagnostics v_n = row_count;

  select count(distinct code_canonique) into v_g
    from public.cp_groupe where n_membres > 1;

  return jsonb_build_object(
    'ok', true,
    'codes_postaux', v_n,
    'groupes_multi', v_g,
    'cp_regroupes', (select count(*) from public.cp_groupe where n_membres > 1),
    'duree_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));
end;
$fn$;

comment on function public.construire_cp_groupe is
  'Reconstruit cp_groupe depuis ref_codes_postaux. A rejouer apres tout import '
  'du referentiel des codes postaux, et AVANT remplir_code_postal_carreau et '
  'remplir_cp_population_totale, qui en dependent. sql/228.';

revoke all on function public.construire_cp_groupe() from public, anon, authenticated;
grant execute on function public.construire_cp_groupe() to service_role;


-- ── 2. LA règle, en un seul endroit ─────────────────────────────────────────

-- ── LA RÈGLE EN DEUX FORMES, UN SEUL CORPS ─────────────────────────────────
--
-- `cp_des_points` est LE corps : elle prend un LOT de points et rend leur code
-- postal. `cp_du_point` en est une enveloppe mince pour le cas d'un point
-- seul. Patron « un seul corps, deux formes » déjà appliqué à
-- `codes_postaux_du_perimetre` (sql/169) et `calculer_score_composite`
-- (sql/170).
--
-- ⚠ **CE N'EST PAS DU CONFORT, C'EST MESURÉ.** La première version n'avait que
-- la forme scalaire, et les deux remplissages l'appelaient une fois par
-- carreau : le rattachement des 883 451 carreaux a pris **33 min 34**, contre
-- ~9 min pour l'ancien code qui écrivait la règle en jointure. La cause est
-- dans PostGIS : `ST_Contains` met en cache la géométrie PRÉPARÉE de son
-- premier argument et la réutilise d'une ligne à l'autre — ce qu'une jointure
-- permet et qu'un appel scalaire par ligne interdit, chaque appel repartant à
-- zéro. Une règle partagée ne doit pas coûter quatre fois la règle recopiée,
-- sinon quelqu'un finira par la recopier.
create or replace function public.cp_des_points(
  p_ids bigint[],
  p_pts geometry[]
) returns table (id bigint, code_postal text)
language sql stable parallel safe as $fn$
  select distinct on (x.id) x.id, g.code_canonique
    from unnest(p_ids, p_pts) as x(id, p)
    join public.ref_codes_postaux r on r.geom && x.p and ST_Contains(r.geom, x.p)
    join public.cp_groupe g on g.code_postal = r.code_postal
   -- ⚠ LE SECOND CRITÈRE DE TRI EST LE CŒUR DE CETTE MIGRATION. Sans lui,
   -- quand plusieurs contours contiennent le point et partagent leur
   -- centroïde, l'ordre est celui des lignes sur le disque : deux appels de la
   -- même règle rendent deux réponses différentes.
   order by x.id, ST_Distance(r.centroid, x.p), r.code_postal
$fn$;

comment on function public.cp_des_points is
  'LE corps de la regle de rattachement point -> code postal CANONIQUE, sous '
  'forme ENSEMBLISTE : c''est elle que les remplissages appellent, et c''est '
  'ce qui permet a PostGIS de reutiliser sa geometrie preparee d''une ligne a '
  'l''autre. 33 min en appels scalaires contre quelques minutes ici. sql/228.';

revoke all on function public.cp_des_points(bigint[], geometry[]) from public, anon, authenticated;
grant execute on function public.cp_des_points(bigint[], geometry[]) to service_role;


-- ⚠ NI `security definer` NI `set search_path`, et ce n'est pas un oubli :
-- l'un et l'autre EMPÊCHENT le planificateur d'inliner une fonction SQL. Tous
-- les identifiants sont donc qualifiés en `public.` dans le corps, et les deux
-- appelants sont eux-mêmes `security definer` — la règle s'exécute avec leurs
-- droits. Mesuré : 15 µs par carreau, soit ~36 s sur les 2 324 577 du
-- référentiel, à comparer aux 9 minutes que coûte déjà la passe complète.
create or replace function public.cp_du_point(p geometry)
returns text
language sql stable parallel safe as $fn$
  select code_postal from public.cp_des_points(array[0::bigint], array[p])
$fn$;

comment on function public.cp_du_point is
  'LA regle de rattachement d''un point a un code postal : le contour qui le '
  'contient, departage par la distance au centroide PUIS par le code postal. '
  'Rend le code CANONIQUE (cp_groupe). Appelee par remplir_code_postal_carreau '
  'et remplir_cp_population_totale — une seule regle, donc numerateur et '
  'denominateur ne peuvent plus diverger. sql/228.';

revoke all on function public.cp_du_point(geometry) from public, anon, authenticated;
grant execute on function public.cp_du_point(geometry) to service_role;


-- ── 3. Les deux remplissages appellent la règle, ils ne la recopient plus ───

create or replace function public.remplir_code_postal_carreau(p_lot integer default 100000)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$

declare
  v_t0      timestamptz := clock_timestamp();
  v_faits   int;
  v_restant bigint;
begin
  set local statement_timeout = '30min';
  set local work_mem = '64MB';

  -- Par LOTS, et reprenable : la colonne est nullable, donc « ce qui reste à
  -- faire » se lit directement en base. Pas besoin d'un journal de bandes comme
  -- pour la construction des distances — ici l'état EST la donnée.
  --
  -- ⚠ UNE SEULE instruction, et c'est un correctif. La première version
  -- appariait, puis marquait d'une seconde requête « tout ce qui reste NULL »
  -- comme sans code postal. Or ce qui reste NULL inclut les carreaux JAMAIS
  -- ESSAYÉS — ceux des lots suivants. Ils auraient été condamnés sans qu'aucun
  -- point-dans-polygone les ait seulement examinés, et le traitement aurait
  -- rendu « terminé » sur des carreaux qu'il n'a pas traités.
  --
  -- `a_faire` est référencée DEUX fois, donc matérialisée par PostgreSQL : le
  -- `limit` désigne le même lot dans les deux branches. Inlinée, il pourrait
  -- désigner deux lots différents.
  with a_faire as materialized (
    select d.carreau_id, ST_Transform(ST_Centroid(c.geom_3857), 4326) as p
      from public.carreau_risque_distance d
      join public.carreaux_filosofi c on c.id = d.carreau_id
     where d.code_postal is null
     limit greatest(coalesce(p_lot, 100000), 1)
  ),
  -- ⚠ LA RÈGLE N'EST PLUS ÉCRITE ICI (sql/228). Elle l'était, et le
  -- dénominateur en portait sa propre copie — deux copies appliquant le même
  -- départage « le centroïde le plus proche » et rendant pourtant des réponses
  -- différentes, parce que ce départage est une ÉGALITÉ PARFAITE dans les 71
  -- communes dont les codes postaux partagent un contour identique.
  -- `cp_du_point` tranche par le code postal en second critère et rend le code
  -- CANONIQUE du groupe. Un seul corps, donc plus rien à synchroniser.
  -- ⚠ La forme ENSEMBLISTE, jamais l'appel scalaire par ligne : mesuré, 33 min
  -- contre quelques minutes sur les 883 451 carreaux (voir l'en-tête).
  choisis as (
    select * from public.cp_des_points(
      (select array_agg(carreau_id) from a_faire),
      (select array_agg(p) from a_faire))
  )
  update public.carreau_risque_distance d
     -- ⚠ La chaîne VIDE, et non `null`, pour un carreau qu'aucun contour ne
     -- couvre : les codes postaux ne pavent pas le territoire sans trou
     -- (littoral, zones non adressées). Laissé à `null`, un tel carreau
     -- reviendrait à chaque lot et le traitement ne finirait jamais. La chaîne
     -- vide dit « essayé, sans résultat », ce que `null` ne dit pas.
     set code_postal = coalesce(c.code_postal, '')
    from a_faire a
    left join choisis c on c.id = a.carreau_id
   where d.carreau_id = a.carreau_id;

  get diagnostics v_faits = row_count;

  select count(*) into v_restant
    from public.carreau_risque_distance where code_postal is null;

  return jsonb_build_object(
    'ok', true, 'apparies', v_faits, 'restant', v_restant,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;

$fn$;



create or replace function public.remplir_cp_population_totale(
  p_bande integer,
  p_n_bandes integer default 20,
  p_lon_ouest numeric default -5.5,
  p_lon_est numeric default 9.8
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

  -- ⚠ `as materialized` : la CTE est désormais référencée TROIS fois (les deux
  -- tableaux passés à la règle, et la jointure du résultat). Inlinée, le
  -- balayage de la bande et le calcul des centroïdes seraient refaits trois
  -- fois — sur une bande dense, trois fois 800 000 carreaux.
  with carreaux as materialized (
    select c.id, c.metadata,
           ST_Transform(ST_Centroid(c.geom_3857), 4326) as p
      from public.carreaux_filosofi c
     where ST_X(ST_Centroid(c.geom_3857)) >= v_x_min
       and ST_X(ST_Centroid(c.geom_3857)) <  v_x_max
  ),
  -- ⚠ LA MÊME RÈGLE QUE LE NUMÉRATEUR, ET DÉSORMAIS LE MÊME CORPS (sql/228).
  -- Ce commentaire annonçait « MÊME règle que sql/206 » en recopiant le
  -- départage, et les deux copies divergeaient : mesuré sur Nantes, les 103
  -- carreaux que le numérateur donnait à 44200 se répartissaient ici en 44000
  -- (45), 44300 (24), 44100 (18), 44200 (16). Recopier une règle, c'est
  -- promettre de la synchroniser.
  resolu as (
    select * from public.cp_des_points(
      (select array_agg(id) from carreaux),
      (select array_agg(p) from carreaux))
  ),
  rattaches as (
    select x.id, x.metadata, r.code_postal
      from carreaux x
      left join resolu r on r.id = x.id
  )
  ,
  -- Les sommes par cible. Le `cross join` multiplie les lignes par 24 : c'est
  -- inhérent, il faut bien une ligne par (code postal, cible) pour agréger.
  sommes as (
    select r.code_postal, c.cible,
           sum(coalesce((r.metadata->>c.cible)::numeric, 0)) as somme
      from rattaches r
      cross join unnest(v_cibles) as c(cible)
     where r.code_postal is not null
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
    select code_postal, count(*) as n from rattaches
     -- ⚠ Un carreau qu'aucun contour ne couvre rend `null` : il n'appartient à
     -- aucun code postal, donc à aucun dénominateur. Le laisser passer créerait
     -- une ligne au code postal `null` que la clé primaire refuserait.
     where code_postal is not null group by code_postal
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

