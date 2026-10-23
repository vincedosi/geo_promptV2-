-- sql/267 — Le dénominateur IRIS : `unite_population_totale`, maille `iris`, compté sur le carroyage (lot 4, T4, A-3).
--
-- POURQUOI. Le découpage « par IRIS » de la couverture (T5, `couverture_geometrie`) dit, pour chaque IRIS touché par une
-- zone, quelle PART de sa population la zone couvre. Le numérateur somme les carreaux de `carreau_couverture` dont le
-- centroïde est dans la zone ET dans l'IRIS. Le dénominateur doit compter les MÊMES carreaux par la MÊME règle — sinon une
-- part dépasse 100 % ou n'atteint jamais 100 % (leçon sql/207 et sql/221 : 1 070 communes sur 6 517 au-delà de 100 %,
-- jusqu'à 163 %, quand le dénominateur venait des IRIS et le numérateur du carroyage).
--   - JAMAIS `iris.population` : c'est le recensement, pas le carroyage Filosofi ; il ne compte ni les mêmes habitants
--     ni les mêmes contours.
--   - Construit DEPUIS `carreau_couverture.code_iris` (sql/266 : centroïde `ST_Centroid(geom_3857)` dans `iris.geom`,
--     plus petit code si deux IRIS se recouvrent — 0 carreau dans ce cas, mesuré le 22/10). L'exactitude de cette
--     colonne est recalculée par la géométrie sur un échantillon dans `tests/integration/carreau-couverture.test.ts`.
--
-- ⚠ IRIS ET COMMUNE NE S'EMBOÎTENT PAS. Mesuré le 22/10 sur `carreau_couverture` : 54 300 carreaux (803 132 habitants,
-- 2,3 %) ont un IRIS dont les cinq premiers caractères ne sont PAS leur commune (premier code `lcog_geo`, sql/221). Ils
-- touchent 19 543 IRIS sur 48 872 (des carreaux de bordure, à cheval, rattachés à la commune par `lcog_geo` et à l'IRIS
-- par le centroïde) ; 37 IRIS n'ont AUCUN carreau dans la commune de leur préfixe, et 18 portent un préfixe qui n'est
-- aucune commune du carroyage (communes nouvelles : millésimes COG différents entre `iris` et `lcog_geo`, ex. 49069 ↔
-- 49126). Chaque maille reste cohérente avec SON propre dénominateur (A-3) ; mais on ne déduit JAMAIS une commune d'un
-- IRIS, et on ne recoupe JAMAIS la somme des IRIS d'une commune avec la commune. Le seul recoupement valide entre
-- mailles est national : somme des IRIS + carreaux hors IRIS = total communal.
--
-- ⚠ PAS DE SECOND BALAYAGE DE `carreaux_filosofi`. La maille `commune` de sql/221 lit les carreaux ; celle-ci lit la
-- table étroite, qui en porte une copie dont l'égalité avec les communes est prouvée carreau pour carreau (test de
-- sql/266). Les effectifs sont sommés en `numeric` depuis les `real` de `pops` — exactement ce que T5 sommera au
-- numérateur : même source, même type, même règle.
--
-- REJOUABLE. `delete … where maille = 'iris'` puis `insert`, dans la MÊME transaction (le corps d'une fonction) : un
-- lecteur concurrent voit l'ancien dénominateur ou le nouveau, jamais un IRIS à moitié. `construire_unite_population_totale`
-- (sql/221) n'efface rien et n'écrit que ses trois mailles : les deux constructions ne se marchent pas dessus.
-- Coût mesuré le 22/10 : ≈ 18 s, UNE passe sur la table étroite (≈ 61 000 pages, 480 Mo). Le temps est du CPU — 2,3 M
-- de carreaux × 24 sommes `numeric` — sans parallélisme : un `INSERT … SELECT` n'en a pas (la même lecture seule, en
-- parallèle, prend 7,2 s ; en série 16,9 s). Une construction par reconstruction de la base, pas une lecture d'écran.
--
-- QUAND LA REJOUER : après toute construction de `carreau_couverture` (`11-reconstruire.sh`, étape 5 ter, qui compare
-- les dates : un dénominateur plus ancien que le journal `carreau_couverture_bandes` est périmé).

create or replace function public.construire_denominateur_iris()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
-- Posé sur la fonction et non par `set local` dans le corps : il vaut ainsi dès la première instruction. (Pas de
-- `statement_timeout` : un `set local` dans le corps n'arme pas le délai de l'instruction EN COURS — sql/266, réserve
-- r6 de T3 — et la construction tient en quelques secondes.)
set work_mem to '128MB'
as $fn$
declare
  v_t0        timestamptz := clock_timestamp();
  v_n_iris    integer;
  v_n_carr    bigint;
  v_n_hors    bigint;
  v_n_cibles  integer;
  v_paires    text;
  v_motif     text;
begin
  -- La table étroite doit être COMPLÈTE : un dénominateur construit sur une table à moitié remplie serait faux pour
  -- chaque IRIS d'une bande manquante. Le certificat de sql/268, comparé à `carreaux_filosofi` — et non « journal =
  -- lignes », vrai par construction : un --tout interrompu passait (relecture de T4).
  v_motif := public.carreau_couverture_complete();
  if v_motif is not null then
    raise exception 'carreau_couverture incomplete ou non certifiee (%) : la construire jusqu''au bout '
      '(scripts/construire_carreau_couverture.mjs, qui certifie en fin de course)', v_motif
      using errcode = '55000';
  end if;

  /*
   * Les cibles par leur RANG (A-2) : `pops[rang_pop]` est l'effectif de la cible de ce code. Mêmes clés que les trois
   * autres mailles (`cibles_exposition where actif`), pour que `populations->>p_cible` se lise partout pareil.
   *
   * ⚠ UNE passe, 24 agrégats écrits en clair, et non un `cross join` des cibles : celui-ci démultiplierait les 2,3 M de
   * carreaux par 24 (56 M de lignes à hacher) là où il suffit de 24 `sum` par IRIS. La liste vient de la base, d'où le
   * SQL dynamique — les codes passent par `quote_literal`, les rangs sont des entiers.
   */
  select count(*),
         string_agg(format('%s, sum(cc.pops[%s]::numeric)', quote_literal(code), rang_pop), ', ' order by rang_pop)
    into v_n_cibles, v_paires
    from public.cibles_exposition
   where actif and rang_pop is not null;

  if v_n_cibles = 0 or v_n_cibles > 50 then  -- jsonb_build_object : 100 arguments au plus
    raise exception 'cibles_exposition : % cibles actives avec un rang, attendu 1 à 50', v_n_cibles using errcode = '55000';
  end if;

  delete from public.unite_population_totale where maille = 'iris';

  execute format($q$
    insert into public.unite_population_totale (maille, code, populations, n_carreaux)
    select 'iris', cc.code_iris, jsonb_build_object(%s), count(*)
      from public.carreau_couverture cc
     where cc.code_iris is not null
     group by cc.code_iris$q$, v_paires);

  get diagnostics v_n_iris = row_count;
  select coalesce(sum(n_carreaux), 0) into v_n_carr from public.unite_population_totale where maille = 'iris';
  select count(*) into v_n_hors from public.carreau_couverture where code_iris is null;

  return jsonb_build_object(
    'ok', true,
    'n_iris', v_n_iris,
    'n_carreaux', v_n_carr,
    'n_carreaux_sans_iris', v_n_hors,
    'n_cibles', v_n_cibles,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

comment on function public.construire_denominateur_iris() is
  'Construit la maille iris d''unite_population_totale DEPUIS carreau_couverture (meme regle que le numerateur de la '
  'couverture : centroide dans iris.geom). Jamais iris.population. Efface puis reecrit la seule maille iris, en une '
  'transaction ; refuse si carreau_couverture n''est pas certifiee complete (sql/268). A rejouer apres toute '
  'construction de carreau_couverture. sql/267, sql/268.';

revoke all on function public.construire_denominateur_iris() from public, anon, authenticated;
grant execute on function public.construire_denominateur_iris() to service_role;
