-- sql/204 — La règle d'affectation unique, en SQL, et la population par classe
--           (2026-09-19)
--
-- Transcrit `lib/risques/affectation.ts` pour l'appliquer aux ~914 000 lignes
-- de `carreau_risque_distance` (sql/203).
--
-- ── DEUX IMPLÉMENTATIONS, ET POURQUOI C'EST ASSUMÉ ────────────────────────
--
-- La même règle existe en TypeScript et ici. Ce n'est pas une duplication
-- accidentelle : le TypeScript classe quelques dizaines de carreaux dans une
-- infobulle, le SQL en classe 914 000 pour un tableau. Faire descendre les
-- 914 000 jusqu'au navigateur pour n'avoir qu'une implémentation coûterait
-- ~50 Mo par changement d'anneau.
--
-- Ce qui n'est PAS assumé, c'est qu'elles divergent. `tests/integration/
-- affectation-sql.test.ts` croise les deux sur une grille de cas — y compris
-- les bornes, où une convention différente ferait basculer un carreau d'une
-- bande à l'autre selon qui l'interroge. Les jumeaux TypeScript précédents du
-- projet (`lib/analyses/score.ts`, `lib/campagne/alignement.ts`) ont été
-- croisés UNE FOIS à la main, et leur en-tête le signale comme une limite ;
-- celui-ci est rejoué à chaque exécution de la suite.
--
-- ── LA CONVENTION DE BORNE ────────────────────────────────────────────────
--
-- Bandes exclusives `[0, r1)`, `[r1, r2)`, … : la borne appartient à la bande
-- SUPÉRIEURE. Écrit ici parce que c'est exactement le genre de détail que deux
-- implémentations choisissent chacune de leur côté.

create or replace function public.classe_carreau_risque(
  p_d_haut       int,
  p_d_bas        int,
  p_pprt_niveau  text,
  p_haut         int[],
  p_bas          int[],
  p_inclure_pprt boolean
) returns text
language sql immutable parallel safe as $$
  -- ⚠ AUCUNE SOUS-REQUÊTE ICI, et c'est une mesure, pas une élégance.
  --
  -- La première version cherchait la bande par
  -- `select i from generate_subscripts(...) where ... limit 1`. Correcte, mais
  -- une fonction SQL qui contient une sous-requête n'est PAS INLINABLE :
  -- PostgreSQL l'appelle réellement, une fois par ligne. Sur 883 451 carreaux,
  -- **108 s** — quand la même agrégation écrite à plat en prend **5**.
  --
  -- Le symptôme désignait mal la cause : la requête nue mesurée à 5 s et la
  -- fonction mesurée à 108 s avaient le même plan à l'œil. C'est le nombre
  -- d'APPELS qui changeait, pas le plan.
  --
  -- Écrite en `case` imbriqué, la fonction est une expression scalaire :
  -- PostgreSQL la fond dans la requête appelante, et le coût par ligne devient
  -- une poignée de comparaisons d'entiers.
  --
  -- ⚠ Quatre anneaux au maximum par niveau, ce qui est aussi la borne du
  -- modèle (`ANNEAUX_MAX`, lib/risques/profil.ts). Un cinquième serait
  -- IGNORÉ ici — le schéma Zod le refuse en amont, mais si cette borne bouge
  -- un jour, elle doit bouger dans les deux fichiers.
  --
  -- `p_haut[5]` sur un tableau de trois éléments rend NULL en PostgreSQL, pas
  -- une erreur : les branches inutilisées s'effacent d'elles-mêmes.
  select coalesce(
    case
      -- Un niveau sans anneau n'a aucune bande définie : il ne peut rien
      -- retenir, pas même par son PPRT. Cette branche vient donc EN PREMIER.
      when coalesce(cardinality(p_haut), 0) = 0 then null
      -- Le périmètre publié prime sur toute bande calculée, y compris au-delà
      -- du dernier anneau : une servitude opposable ne disparaît pas parce
      -- qu'un curseur d'interface est réglé trop bas.
      when p_inclure_pprt and p_pprt_niveau = 'haut' then 'haut:pprt'
      when p_d_haut is null then null
      -- Bandes exclusives [0, r1), [r1, r2), … : la borne appartient à la bande
      -- SUPÉRIEURE. Convention écrite ici ET dans lib/risques/affectation.ts,
      -- croisée par tests/integration/affectation-sql.test.ts.
      when p_d_haut < p_haut[1] then 'haut:1'
      when p_d_haut < p_haut[2] then 'haut:2'
      when p_d_haut < p_haut[3] then 'haut:3'
      when p_d_haut < p_haut[4] then 'haut:4'
      else null
    end,
    case
      when coalesce(cardinality(p_bas), 0) = 0 then null
      when p_inclure_pprt and p_pprt_niveau = 'bas' then 'bas:pprt'
      when p_d_bas is null then null
      when p_d_bas < p_bas[1] then 'bas:1'
      when p_d_bas < p_bas[2] then 'bas:2'
      when p_d_bas < p_bas[3] then 'bas:3'
      when p_d_bas < p_bas[4] then 'bas:4'
      else null
    end,
    'hors');
$$;

comment on function public.classe_carreau_risque is
  'La regle d''affectation unique : un carreau, un niveau, une bande. Transcription '
  'de lib/risques/affectation.ts, croisee avec elle par tests/integration/'
  'affectation-sql.test.ts. Bandes exclusives, la borne appartient a la bande '
  'SUPERIEURE.';

revoke all on function public.classe_carreau_risque(int, int, text, int[], int[], boolean)
  from public, anon, authenticated;
grant execute on function public.classe_carreau_risque(int, int, text, int[], int[], boolean)
  to service_role, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- POPULATION PAR CLASSE, ET PAR TERRITOIRE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ `RETURNS jsonb` et non `TABLE` : PostgREST tronque à 5 000 lignes TOUTE
-- fonction tabulaire, sans erreur et sans en-tête (CLAUDE.md). À la maille
-- commune, 1 106 communes exposées × jusqu'à 10 classes dépasse largement le
-- seuil. C'est la cinquième occurrence recensée dans le projet.
--
-- ⚠ La population est dans `metadata->>'ind'`. La colonne `ind` existe mais est
-- NULL sur les 2 298 582 lignes : la lire rendrait ZÉRO partout, sans erreur.

create or replace function public.population_par_classe(
  p_profil  jsonb,
  p_cible   text default 'ind',
  p_maille  text default 'departement',
  p_parent  text default null,
  p_limite  int  default 200
) returns jsonb
-- ⚠ `parallel safe` n'est PAS décoratif : mesuré le 2026-09-19, il fait passer
-- cet appel de 12,3 s à 2,8 s. Une fonction `security definer` est supposée
-- NON parallélisable par défaut, donc l'agrégation sur 883 451 carreaux
-- tournait sur un seul cœur alors que la même requête écrite à plat mobilisait
-- deux ouvriers. Elle ne fait que lire : la marque est exacte, pas optimiste.
--
-- Trajet complet de l'optimisation, toutes mesures sur le même résultat
-- (14 103 699 habitants, écart de somme nul) :
--   113 s  version initiale
--    12 s  apres avoir rendu classe_carreau_risque INLINABLE (sans sous-requete)
--     2,8 s apres `parallel safe`
language plpgsql stable parallel safe security definer set search_path to 'public' as $fn$
declare
  v_haut    int[];
  v_bas     int[];
  v_lie     boolean;
  v_pprt    boolean;
  v_cible   text;
  v_res     jsonb;
begin
  -- La cible est validée contre le CATALOGUE, jamais contre une liste écrite
  -- ici : le menu de l'écran lit la même table, les deux ne peuvent donc pas
  -- diverger. C'est aussi la seule barrière contre l'injection par nom de
  -- champ, le nom étant interpolé dans un accès jsonb.
  select code into v_cible from public.cibles_exposition
   where code = coalesce(p_cible, 'ind') and actif;
  if v_cible is null then
    return jsonb_build_object('error', 'cible_inconnue', 'calculable', false,
                              'cible', p_cible);
  end if;

  if p_maille not in ('departement', 'commune') then
    -- Les deux seules mailles que `carreau_risque_distance` porte en colonne.
    -- Le code postal exigerait un point-dans-polygone contre 6 187 contours,
    -- carreau par carreau : c'est un chantier, pas un oubli.
    return jsonb_build_object('error', 'maille_non_portee', 'calculable', false,
                              'maille', p_maille);
  end if;

  v_lie  := coalesce((p_profil->>'lie')::boolean, false);
  v_pprt := coalesce((p_profil->>'inclurePPRT')::boolean, true);

  select coalesce(array_agg(x::int order by x::int), '{}')
    into v_haut from jsonb_array_elements_text(coalesce(p_profil->'haut', '[]'::jsonb)) x;
  -- La liaison est appliquée ICI comme elle l'est dans `normaliserProfil` : le
  -- niveau bas hérite des anneaux du haut. Lire `p_profil->'bas'` quand `lie`
  -- est vrai donnerait une carte qui contredit le cadenas affiché à l'écran.
  if v_lie then
    v_bas := v_haut;
  else
    select coalesce(array_agg(x::int order by x::int), '{}')
      into v_bas from jsonb_array_elements_text(coalesce(p_profil->'bas', '[]'::jsonb)) x;
  end if;

  with
  -- UN SEUL passage de classification. La première version en faisait deux — un
  -- pour les unités, un pour les totaux — et portait en plus une sous-requête
  -- CORRÉLÉE sur une CTE, ré-exécutée pour chaque unité retenue.
  -- Mesuré : 113 s, quand l'agrégation nue en prend 4,7. Le coût n'était pas
  -- dans la jointure, contrairement à ce que laissait croire sa taille.
  base as (
    select case p_maille when 'commune' then d.code_commune else d.code_departement end as unite,
           public.classe_carreau_risque(d.d_haut_m, d.d_bas_m, d.pprt_niveau,
                                        v_haut, v_bas, v_pprt) as classe,
           -- ⚠ Jointure par clé PRIMAIRE, et seulement sur les carreaux déjà
           -- retenus par le pré-calcul : jamais un balayage des 2,3 millions.
           -- ⚠ La population est dans `metadata->>'ind'`. La colonne `ind`
           -- existe mais est NULL sur toutes les lignes : la lire rendrait ZÉRO
           -- partout, sans erreur.
           coalesce((c.metadata->>v_cible)::numeric, 0) as pop
      from public.carreau_risque_distance d
      join public.carreaux_filosofi c on c.id = d.carreau_id
     where (p_parent is null or d.code_departement = p_parent)
  ),
  -- ⚠ L'ARRONDI A LIEU ICI, AU GRAIN LE PLUS FIN, ET NULLE PART AILLEURS.
  -- Tous les totaux en découlent par simple addition. Arrondir chaque total
  -- séparément produisait un écart d'un habitant entre `total` et la somme de
  -- `par_classe` — mesuré : 14 103 577 contre 14 103 578. Un tableau qui ne
  -- s'additionne pas fait douter le lecteur, pas le logiciel. Même correctif
  -- que sql/188 sur les couronnes d'exposition.
  par_uc as (
    select unite, classe, round(sum(pop)) as pop, count(*) as n
      from base group by unite, classe
  ),
  totaux_unite as (
    select unite, sum(pop) filter (where classe <> 'hors') as total
      from par_uc group by unite
  ),
  retenues as (
    select unite, total from totaux_unite
     -- Le hors-zone ne décide pas du classement : une unité serait « en tête »
     -- pour des habitants que le profil ne retient justement pas.
     where total > 0
     order by total desc
     limit greatest(coalesce(p_limite, 200), 1)
  ),
  -- Jointure, jamais une sous-requête corrélée : c'est la différence entre
  -- 4,7 s et 113 s.
  unites_json as (
    select pu.unite,
           sum(pu.pop) filter (where pu.classe <> 'hors') as total,
           jsonb_object_agg(pu.classe, pu.pop) filter (where pu.classe <> 'hors') as classes
      from par_uc pu
      join retenues r on r.unite = pu.unite
     group by pu.unite
  )
  select jsonb_build_object(
    'calculable', true,
    'maille', p_maille,
    'cible', v_cible,
    'parent', p_parent,
    'n_unites', (select count(*) from totaux_unite where total > 0),
    'tronquee', (select count(*) from totaux_unite where total > 0)
                  > (select count(*) from retenues),
    'n_carreaux', (select sum(n) from par_uc),
    -- Le total porte sur TOUT le périmètre, jamais sur la liste tronquée : un
    -- total qui ne compterait que les unités affichées se contredirait avec le
    -- libellé « les plus peuplées seulement sont affichées ».
    'total', coalesce((select sum(pop) from par_uc where classe <> 'hors'), 0),
    'par_classe', coalesce((
      select jsonb_object_agg(classe, pop) from (
        select classe, sum(pop) as pop from par_uc
         where classe <> 'hors' group by classe) t), '{}'::jsonb),
    -- ⚠ `hors_zone` compte les habitants de carreaux PROCHES d'un site que le
    -- profil courant ne retient pas — un rayon réglé trop court, par exemple.
    -- Ce n'est PAS « la population non exposée de France » : cette table ne
    -- contient que des carreaux à moins de 10 km d'un site.
    'hors_zone', coalesce((select sum(pop) from par_uc where classe = 'hors'), 0),
    'unites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'unite', u.unite, 'total', u.total, 'classes', u.classes)
             order by u.total desc)
        from unites_json u), '[]'::jsonb))
    into v_res;

  return v_res;
end;
$fn$;

comment on function public.population_par_classe is
  'Population par classe du profil et par territoire. Chaque carreau porte UNE classe, '
  'donc les sommes sont additives — par niveau, par bande, par territoire. RETURNS jsonb '
  'et non TABLE : PostgREST tronque toute fonction tabulaire a 5 000 lignes, sans erreur.';

revoke all on function public.population_par_classe(jsonb, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.population_par_classe(jsonb, text, text, text, int)
  to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- CLASSEMENT PAR LOT — pour le croisement avec le jumeau TypeScript
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `tests/integration/affectation-sql.test.ts` balaie des milliers de cas, dont
-- toutes les bornes du profil et leurs voisines immédiates. Un aller-retour par
-- cas ferait durer le test des minutes pour la même information.
--
-- ⚠ ENVELOPPE MINCE, et c'est essentiel : elle ne réimplémente rien, elle
-- appelle `classe_carreau_risque`. Une seconde transcription de la règle ici
-- ferait valider par le test une fonction que l'application n'appelle pas —
-- le test resterait vert pendant que l'écran afficherait faux.

create or replace function public.classer_lot_risque(
  p_cas          jsonb,
  p_haut         int[],
  p_bas          int[],
  p_inclure_pprt boolean
) returns text[]
language sql stable parallel safe as $$
  select coalesce(array_agg(
           public.classe_carreau_risque(
             nullif(c->>'h', '')::int,
             nullif(c->>'b', '')::int,
             nullif(c->>'p', ''),
             p_haut, p_bas, p_inclure_pprt)
           order by o), '{}')
    from jsonb_array_elements(p_cas) with ordinality as t(c, o);
$$;

comment on function public.classer_lot_risque is
  'Classe un lot de cas en un appel. ENVELOPPE MINCE de classe_carreau_risque : elle '
  'ne reimplemente rien, sinon le croisement validerait une fonction que l''application '
  'n''appelle pas.';

revoke all on function public.classer_lot_risque(jsonb, int[], int[], boolean)
  from public, anon, authenticated;
grant execute on function public.classer_lot_risque(jsonb, int[], int[], boolean)
  to service_role;
