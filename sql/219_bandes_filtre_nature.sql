-- sql/219 — Le tableau des bandes honore enfin le filtre de nature
--           (2026-09-20)
--
-- `population_par_classe` ne portait AUCUN argument de nature, et la route des
-- bandes ne lui en passait aucun. Le filtre vit pourtant dans la barre COMMUNE
-- aux trois onglets : le décocher changeait la courbe — `couverture_rayon_risque`
-- porte la dimension depuis sql/198 — et ne changeait pas le tableau juste
-- au-dessus. Deux chiffres sur le même écran, l'un filtré, l'autre non.
--
-- ⚠ Un filtre affiché mais non appliqué est le pire des trois états possibles :
-- pire qu'un filtre absent, qui ne promet rien, et pire qu'un refus explicite,
-- qui dit ce qu'il ne sait pas faire. C'est celui que `construire_zone_set`
-- avait choisi (`filtre_nature_non_supporte`), et il avait raison.
--
-- ── LE DROP EST OBLIGATOIRE ──────────────────────────────────────────────
--
-- Ajouter un argument à valeur par défaut crée une SECONDE fonction et rend
-- tout appel nommé ambigu — leçon de sql/191, où le même geste avait déjà
-- imposé un `drop function`. DROP et CREATE sont dans la MÊME migration, donc
-- la même transaction : aucun instant sans fonction.

drop function if exists public.population_par_classe(jsonb, text, text, text, integer);

CREATE OR REPLACE FUNCTION public.population_par_classe(
  p_profil jsonb,
  p_cible text DEFAULT 'ind'::text,
  p_maille text DEFAULT 'departement'::text,
  p_parent text DEFAULT NULL::text,
  p_limite integer DEFAULT 200,
  /** Libellés de natures retenus. Vide ou NULL = toutes. */
  p_natures text[] DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_haut    int[];
  v_bas     int[];
  v_lie     boolean;
  v_pprt    boolean;
  v_cible   text;
  v_res     jsonb;
  v_ords    smallint[];
  v_filtre  boolean;
  v_inconnues text[];
begin
  /*
   * ── LE FILTRE DE NATURE ────────────────────────────────────────────────
   *
   * Il était ABSENT de cette fonction jusqu'au 2026-09-20, et la route ne lui
   * en passait aucun : sur l'onglet Rayons, décocher une nature changeait la
   * courbe — `couverture_rayon_risque` porte la dimension depuis sql/198 — et
   * ne changeait pas le tableau juste au-dessus. Deux chiffres sur le même
   * écran, l'un filtré, l'autre non, et rien pour le dire.
   *
   * Les LIBELLÉS arrivent en argument, comme dans les fonctions sœurs, et sont
   * résolus UNE fois en ordinaux : la table fille les stocke en `smallint`
   * (sql/218), 3,4 M de lignes ne pouvant pas porter 25 caractères chacune.
   */
  if p_natures is not null and array_length(p_natures, 1) is not null then
  /*
   * ⚠ On REFUSE un libellé qu'on ne sait pas résoudre, on ne le replie pas.
   * `ordinal_nature` rend 0 pour l'inconnu — correct à la construction, où un
   * site hors registre doit garder une ligne ; mensonger ici, où 0 est le seau
   * des natures non précisées. Mesuré : un accent manquant sur « GPL et
   * produits pétroliers » rendait 136 277 habitants au lieu de 7 753 811.
   */
  v_inconnues := public.natures_inconnues(p_natures);
  if array_length(v_inconnues, 1) is not null then
    return jsonb_build_object(
      'error', 'natures_inconnues',
      'calculable', false,
      'natures_inconnues', to_jsonb(v_inconnues));
  end if;

    select array_agg(public.ordinal_nature(n)) into v_ords
      from unnest(p_natures) n;
  end if;
  v_filtre := v_ords is not null and array_length(v_ords, 1) is not null;
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
           /*
            * ⚠ SANS filtre, on lit la table MÈRE — le chemin rapide, et le cas
            * le plus fréquent. AVEC filtre, on lit la fille, restreinte aux
            * natures retenues. Personne ne paie pour une dimension qu'il
            * n'utilise pas.
            */
           public.classe_carreau_risque(
             case when v_filtre then n.d_haut_m    else d.d_haut_m    end,
             case when v_filtre then n.d_bas_m     else d.d_bas_m     end,
             case when v_filtre then n.pprt_niveau else d.pprt_niveau end,
             v_haut, v_bas, v_pprt) as classe,
           -- ⚠ Jointure par clé PRIMAIRE, et seulement sur les carreaux déjà
           -- retenus par le pré-calcul : jamais un balayage des 2,3 millions.
           -- ⚠ La population est dans `metadata->>'ind'`. La colonne `ind`
           -- existe mais est NULL sur toutes les lignes : la lire rendrait ZÉRO
           -- partout, sans erreur.
           coalesce((c.metadata->>v_cible)::numeric, 0) as pop
      from public.carreau_risque_distance d
      join public.carreaux_filosofi c on c.id = d.carreau_id
      /*
       * ⚠ Une jointure ORDINAIRE, et surtout pas un `lateral`.
       *
       * Un `left join lateral` s'évalue LIGNE À LIGNE : même avec `where
       * v_filtre` à l'intérieur, PostgreSQL construit un sous-plan pour
       * chacun des 883 451 carreaux. Mesuré le 2026-09-20 — 4,27 s contre
       * 3,75 s pour la version sans filtre du tout, soit 0,5 s payés par des
       * gens qui ne filtrent rien.
       *
       * Ici la sous-requête est agrégée UNE fois. Sans filtre elle ne rend
       * AUCUNE ligne, la table de hachage est vide, et la jointure ne coûte
       * presque rien.
       */
      left join (
        select x.carreau_id,
               min(x.d_haut_m) as d_haut_m,
               min(x.d_bas_m)  as d_bas_m,
               -- Le seuil haut l'emporte, comme dans la table mère : un carreau
               -- couvert par deux périmètres prend le plus grave.
               case when bool_or(x.pprt_niveau = 'haut') then 'haut'
                    when bool_or(x.pprt_niveau = 'bas')  then 'bas'
                    else null end as pprt_niveau
          from public.carreau_risque_nature x
         where v_filtre
           and x.nature_ord = any(v_ords)
         group by x.carreau_id
      ) n on n.carreau_id = d.carreau_id
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
    -- ⚠ Le filtre APPLIQUÉ repart dans la réponse. C'est la garde contre le
    -- défaut qu'on vient de corriger : un écran ne doit pas avoir à SUPPOSER
    -- qu'un filtre a été honoré.
    'natures', coalesce(to_jsonb(p_natures), '[]'::jsonb),
    'filtre_natures_applique', v_filtre,
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
$function$;

comment on function public.population_par_classe is
  'Population par classe du profil et par territoire. RETURNS jsonb et non TABLE : '
  'cinquieme occurrence de la troncature PostgREST recensee dans le projet. '
  'L''arrondi a lieu AU GRAIN LE PLUS FIN et nulle part ailleurs, tous les totaux en '
  'decoulant par addition. ⚠ `parallel safe` n''est pas decoratif : une fonction '
  'security definer est non parallelisable par defaut, et la marque fait passer '
  'l''appel national de 12,3 s a 2,8 s. Depuis sql/219, elle honore p_natures : sans '
  'filtre elle lit la table mere (chemin rapide), avec filtre la table fille '
  'carreau_risque_nature. Le filtre applique repart dans la reponse — un ecran ne '
  'doit pas avoir a SUPPOSER qu''il a ete honore.';

revoke all on function public.population_par_classe(jsonb, text, text, text, integer, text[])
  from public, anon, authenticated;
grant execute on function public.population_par_classe(jsonb, text, text, text, integer, text[])
  to service_role;
