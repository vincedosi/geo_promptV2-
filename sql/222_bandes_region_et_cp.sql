-- sql/222 — Territoires quitte son moteur : les bandes savent agréger à la
--           région et au code postal
--           (2026-09-20)
--
-- ── LE DÉFAUT ────────────────────────────────────────────────────────────
--
-- L'en-tête annonçait « Seveso seuil haut 5 km / seuil bas 5 km » pendant que
-- l'onglet Territoires gardait sa propre réglette, marquée « Propre à
-- Territoires ». Deux totaux sur le même écran pour le même profil affiché :
-- **390 112 d'un côté, 24 406 618 de l'autre** (mesuré le 2026-09-20).
--
-- ⚠ **Ce n'était PAS un oubli de câblage, et c'est ce qui rend cette migration
-- nécessaire.** Les deux écrans tournent sur deux moteurs différents, et celui
-- de Territoires ne PEUT PAS honorer le rayon du profil :
--
--   · `population_par_classe` (sql/204) lit `carreau_risque_distance`,
--     pré-calculée. Aucun rayon maximal, 2,8 s sur la France.
--   · `population_exposee_agregee` (sql/185) croise des tampons avec
--     `carreaux_filosofi` (2,3 M lignes) EN DIRECT. Son garde-fou de surface
--     (sql/192) plafonne le rayon national à **1 179 m** :
--
--       {"error":"zone_trop_vaste","km2":98882,"max_km2":5500,
--        "n_sites":1259,"rayon_m":5000,"calculable":false,"rayon_max_m":1179}
--
-- Synchroniser les deux réglettes ne suffirait donc pas : poser 5 km sur
-- Territoires lui ferait rendre un refus, pas un chiffre. La seule sortie est
-- de mettre Territoires sur le MÊME moteur — celui-ci — ce qui suppose qu'il
-- sache agréger aux deux mailles qui lui manquaient.
--
-- Le garde-fou de surface n'est PAS desserré : « 20 km autour de chaque site »
-- partait pour plusieurs minutes, la famille exacte de l'incident du 28/03.
-- `population_exposee_agregee` reste en place et garde ses limites ; elle sert
-- toujours `/api/risques/exposition/export`, qui DOIT appeler la même RPC que
-- son écran sous peine de diverger.
--
-- ── LES DEUX MAILLES AJOUTÉES ────────────────────────────────────────────
--
-- **`code_postal` ne coûte rien** : `carreau_risque_distance.code_postal` est
-- déjà une colonne, posée par sql/203 selon la règle « un carreau, un code
-- postal, celui dont le centroïde est le plus proche ». Le commentaire de la
-- garde annonçait « un point-dans-polygone contre 6 187 contours, carreau par
-- carreau : c'est un chantier » — il décrivait le coût de CALCULER cette
-- colonne, pas celui de la lire. Elle existe depuis lors.
--
-- **`region` se joint par `ref_departements`**, 101 lignes, 2,2 ms. Trois
-- départements (975/977/978, collectivités d'outre-mer) ont `code_region` NULL
-- en base : ils sont regroupés sous `'HORS'` et jamais laissés `null`, même
-- règle que `alignement_par_maille` (ruling PV-2).
--
-- ── POURQUOI UN ARGUMENT `p_region` ET NON UN `p_parent` POLYMORPHE ──────
--
-- ⚠ Il aurait été tentant de faire de `p_parent` un code de région quand la
-- maille est `departement`. **C'est le piège de sql/171**, payé une fois déjà :
-- le prédicat `code_dept = p_parent OR code_region = p_parent` paraissait
-- permissif, mais **18 codes INSEE désignent à la fois un département et une
-- région** (01, 02, 03, 04, 06, 11, 24, 27, 28, 32, 44, 52, 53, 75, 76, 84,
-- 93, 94). Un drill-down sur Paris (`'75'`, 21 CP) rendait 164 CP, dont 143 en
-- Nouvelle-Aquitaine.
--
-- Deux nomenclatures, deux arguments : aucune ambiguïté n'est possible, et le
-- comportement de `p_parent` ne change pas d'un iota pour ses appelants
-- actuels.
--
-- ── LE DROP EST OBLIGATOIRE ──────────────────────────────────────────────
--
-- Ajouter un argument à valeur par défaut crée une SECONDE fonction et rend
-- tout appel nommé ambigu (leçon de sql/191). DROP et CREATE sont dans la MÊME
-- migration, donc la même transaction : aucun instant sans fonction.

drop function if exists public.population_par_classe(jsonb, text, text, text, integer, text[]);

CREATE OR REPLACE FUNCTION public.population_par_classe(
  p_profil jsonb,
  p_cible text DEFAULT 'ind'::text,
  p_maille text DEFAULT 'departement'::text,
  /** Code de DÉPARTEMENT, et rien d'autre. Voir l'en-tête. */
  p_parent text DEFAULT NULL::text,
  p_limite integer DEFAULT 200,
  /** Libellés de natures retenus. Vide ou NULL = toutes. */
  p_natures text[] DEFAULT NULL::text[],
  /** Code de RÉGION. Cumulable avec `p_parent`, qui est plus fin. */
  p_region text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_haut    int[];
  v_bas     int[];
  v_pprt    boolean;
  v_lie     boolean;
  v_cible   text;
  v_res     jsonb;
  v_ords    smallint[];
  v_filtre  boolean;
  v_inconnues text[];
begin
  /*
   * ── LE FILTRE DE NATURE ────────────────────────────────────────────────
   *
   * Il était ABSENT de cette fonction jusqu'au 2026-09-20 : sur l'onglet
   * Rayons, décocher une nature changeait la courbe — `couverture_rayon_risque`
   * porte la dimension depuis sql/198 — et ne changeait pas le tableau juste
   * au-dessus. Deux chiffres sur le même écran, l'un filtré, l'autre non.
   */
  if p_natures is not null and array_length(p_natures, 1) is not null then
    /*
     * ⚠ On REFUSE un libellé qu'on ne sait pas résoudre, on ne le replie pas.
     * `ordinal_nature` rend 0 pour l'inconnu — correct à la construction, où un
     * site hors registre doit garder une ligne ; mensonger ici, où 0 est le
     * seau des natures non précisées. Mesuré : un accent manquant sur « GPL et
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

  select code into v_cible from public.cibles_exposition
   where code = coalesce(p_cible, 'ind') and actif;
  if v_cible is null then
    return jsonb_build_object('error', 'cible_inconnue', 'calculable', false,
                              'cible', p_cible);
  end if;

  /*
   * ── LES QUATRE MAILLES ─────────────────────────────────────────────────
   *
   * `departement`, `commune` et `code_postal` sont des COLONNES de
   * `carreau_risque_distance` : leur coût est celui d'un `group by`.
   * `region` demande une jointure de 101 lignes.
   *
   * Cette garde n'acceptait que les deux premières jusqu'au 2026-09-20, et son
   * commentaire justifiait le refus du code postal par « un point-dans-polygone
   * contre 6 187 contours ». Il décrivait le coût de CALCULER la colonne, que
   * sql/203 a payé une fois pour toutes ; pas celui de la lire.
   */
  if p_maille not in ('region', 'departement', 'commune', 'code_postal') then
    return jsonb_build_object('error', 'maille_non_portee', 'calculable', false,
                              'maille', p_maille);
  end if;

  v_lie  := coalesce((p_profil->>'lie')::boolean, false);
  v_pprt := coalesce((p_profil->>'inclurePPRT')::boolean, true);

  select coalesce(array_agg(x::int order by ord), '{}'::int[]) into v_haut
    from jsonb_array_elements_text(coalesce(p_profil->'haut', '[]'::jsonb))
         with ordinality t(x, ord);
  select coalesce(array_agg(x::int order by ord), '{}'::int[]) into v_bas
    from jsonb_array_elements_text(coalesce(p_profil->'bas', '[]'::jsonb))
         with ordinality t(x, ord);
  if v_lie then v_bas := v_haut; end if;

  with
  base as (
    select
           /*
            * ⚠ `'HORS'` et jamais `null` pour les trois collectivités d'outre-mer
            * sans région en base (975/977/978) : une unité anonyme se perdrait
            * dans le tableau sans que personne sache ce qu'elle porte. Même
            * ruling que `alignement_par_maille` (PV-2).
            */
           case p_maille
             when 'commune'     then d.code_commune
             when 'code_postal' then d.code_postal
             when 'region'      then coalesce(rd.code_region, 'HORS')
             else d.code_departement
           end as unite,
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
           coalesce((c.metadata->>v_cible)::numeric, 0) as pop,
           -- Porté à part de `unite`, parce qu'on le compte à TOUTES les
           -- mailles : c'est le grain auquel le DSP achète, quel que soit le
           -- découpage choisi pour lire le tableau.
           nullif(d.code_postal, '') as cp
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
      /*
       * ⚠ `left join` et non `join` : un département absent de
       * `ref_departements` ferait disparaître ses carreaux du TOTAL, pas
       * seulement de son étiquette. La jointure n'a lieu que si on en a
       * besoin — sans elle, le planificateur ne l'ouvre pas.
       */
      left join public.ref_departements rd
             on (p_maille = 'region' or p_region is not null)
            and rd.code_dept = d.code_departement
     where (p_parent is null or d.code_departement = p_parent)
       and (p_region is null or coalesce(rd.code_region, 'HORS') = p_region)
  ),
  -- ⚠ L'ARRONDI A LIEU ICI, AU GRAIN LE PLUS FIN, ET NULLE PART AILLEURS.
  -- Tous les totaux en découlent par simple addition. Arrondir chaque total
  -- séparément produisait un écart d'un habitant entre `total` et la somme de
  -- `par_classe` — mesuré : 14 103 577 contre 14 103 578. Un tableau qui ne
  -- s'additionne pas fait douter le lecteur, pas le logiciel. Même correctif
  -- que sql/188.
  par_uc as (
    select unite, classe, round(sum(pop)) as pop, count(*) as n
      from base group by unite, classe
  ),
  /*
   * ── LE TOTAL NE DÉPEND PAS DE LA MAILLE, ET CE N'EST PAS UN DÉTAIL ─────
   *
   * Les agrégats d'en-tête sont groupés sur la CLASSE SEULE, jamais sur
   * (unité, classe). Sans cela, l'arrondi au grain fin les fait bouger quand
   * on change de maille — mesuré le 2026-09-20 sur le même profil :
   *
   *     vérité non arrondie   24 406 554
   *     région                24 406 565   (+11)
   *     département           24 406 618   (+64)
   *     code postal           24 407 351   (+797)
   *     commune               24 408 136   (+1 582)
   *
   * L'erreur croît avec le nombre de groupes. Elle est minuscule en relatif —
   * 0,006 % — mais c'est la MÊME famille de défaut que celui que cet écran
   * corrige : un chiffre d'en-tête qui change parce qu'on a choisi de le lire
   * autrement. La population couverte est une propriété du PROFIL, pas du
   * découpage choisi pour la regarder.
   *
   * `total` et `par_classe` sortent donc du même arrondi et s'additionnent
   * exactement, ce qui préserve le correctif de sql/188.
   *
   * ⚠ Corollaire assumé : la somme des lignes d'unités ne retombe pas à
   * l'habitant près sur `total`. Elle ne le pouvait déjà pas — la liste est
   * bornée par `p_limite`, d'où `tronquee` et `n_unites` dans le payload.
   */
  par_classe_global as (
    select classe, round(sum(pop)) as pop, count(*) as n
      from base group by classe
  ),
  /*
   * ⚠ L'arrondi du total d'une unité a lieu UNE fois, sur la somme brute, et
   * non en additionnant des classes déjà arrondies.
   *
   * Additionner jusqu'à sept classes arrondies gonfle le total de quelques
   * habitants — invisible sur un département, pas sur une commune de vingt
   * personnes. Mesuré avant correctif : **1 212 communes affichaient une part
   * supérieure à 100 %**, jusqu'à 104 %, alors que numérateur et dénominateur
   * portent exactement les mêmes carreaux.
   *
   * La ventilation par classe reste arrondie au grain fin — elle n'est pas
   * affichée par unité, et c'est l'additivité globale qui compte pour elle.
   */
  totaux_unite as (
    -- Depuis `base` et non `par_uc` : la somme BRUTE, arrondie une seule fois.
    select unite, round(sum(pop)) as total
      from base
     where classe <> 'hors'
     group by unite
  ),
  retenues as (
    select unite, total from totaux_unite
     where total > 0
     order by total desc
     limit greatest(coalesce(p_limite, 200), 1)
  ),
  /*
   * ── LIBELLÉS ET DÉNOMINATEURS ──────────────────────────────────────────
   *
   * L'écran Territoires affiche une part et une densité. Le basculer sur cette
   * fonction sans dénominateurs lui ferait PERDRE deux colonnes — corriger une
   * contradiction en retirant de l'information n'est pas une correction.
   *
   * ⚠ **DEUX DÉNOMINATEURS, PARCE QUE DEUX QUESTIONS.**
   *
   * `pop_totale` vient d'`unite_population_totale` (sql/221), c'est-à-dire des
   * MÊMES carreaux que le numérateur, attribués par la MÊME règle. Il venait
   * d'`iris_agg_*` jusqu'au 2026-09-20, et les deux ne comptaient pas la même
   * chose : **1 070 communes sur 6 517 dépassaient 100 %**, jusqu'à 163 %
   * (Issou, 4 550 exposés pour 3 858 habitants). 235 983 carreaux sont à
   * cheval sur plusieurs communes, et chacun est attribué ENTIÈREMENT à une
   * seule. Désormais la part ne peut plus dépasser 100 % par construction.
   *
   * `surface_km2` reste la superficie ADMINISTRATIVE d'`iris_agg_*` : la
   * densité demande « combien d'exposés par km² de territoire », pas « par km²
   * habité ». Diviser par la surface des seuls carreaux habités multiplierait
   * la densité de Paris par celle de la Lozère sans rien signaler.
   *
   * ⚠ **Le code postal a maintenant une part**, et n'en avait pas avant.
   * `ref_codes_postaux.pop_total` surcompte de 10,5 %, d'où le refus d'origine
   * — mais `cp_population_totale` (sql/207), bâtie sur la règle du centroïde le
   * plus proche, ne surcompte pas. Elle n'a toujours **pas de surface**, donc
   * pas de densité : aucun référentiel ne publie la superficie d'un code
   * postal, qui n'est pas une circonscription administrative.
   */
  libelles as (
    select coalesce(a.code, u.code) as cle,
           a.nom,
           /*
            * Le dénominateur COHÉRENT — et ARRONDI, comme le numérateur.
            *
            * ⚠ Sans cet arrondi, 1 095 communes affichaient plus de 100 %.
            * Le pire cas mesuré : 14 exposés pour 13,5 au dénominateur, soit
            * 103,7 %. Les deux termes portent exactement les mêmes carreaux —
            * vérifié sur la commune 59183, 478 carreaux et 82 900 habitants de
            * part et d'autre — mais l'un était entier et l'autre non.
            * Comparer deux nombres qui ne sont pas dans la même unité produit
            * un pourcentage faux, même quand le comptage est juste.
            */
           round((u.populations->>v_cible)::numeric) as pop_totale,
           a.superficie_km2::numeric          as surface_km2
      from public.unite_population_totale u
      /*
       * ⚠ `full join` et non `join` : une unité connue du carroyage mais
       * absente du référentiel administratif doit garder son dénominateur, et
       * une unité connue du référentiel mais sans carreau doit garder son
       * libellé. Perdre l'une ou l'autre ferait disparaître des lignes du
       * tableau pour un défaut de jointure.
       */
      full join (
        select a.code, a.nom, a.superficie_km2
          from public.iris_agg_departement a where p_maille = 'departement'
        union all
        select r.code_region, r.nom_region,
               (select sum(x.superficie_km2) from public.iris_agg_departement x
                  join public.ref_departements d2 on d2.code_dept = x.code
                 where d2.code_region = r.code_region)
          from public.ref_regions r where p_maille = 'region'
        union all
        select a.code, a.nom, a.superficie_km2
          from public.iris_agg_commune a where p_maille = 'commune'
        union all
        -- Pas de superficie au code postal : ce n'est pas une circonscription
        -- administrative, et aucun référentiel ne la publie.
        select cp.code_postal, cp.nom_principal, null::numeric
          from public.ref_codes_postaux cp where p_maille = 'code_postal'
      ) a on a.code = u.code
     where u.maille = p_maille
  ),
  unites_json as (
    select pu.unite,
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
    'region', p_region,
    -- ⚠ Le filtre APPLIQUÉ repart dans la réponse. C'est la garde contre le
    -- défaut corrigé par sql/219 : un écran ne doit pas avoir à SUPPOSER
    -- qu'un filtre a été honoré.
    'natures', coalesce(to_jsonb(p_natures), '[]'::jsonb),
    'filtre_natures_applique', v_filtre,
    'n_unites', (select count(*) from totaux_unite where total > 0),
    'tronquee', (select count(*) from totaux_unite where total > 0)
                > (select count(*) from retenues),
    'n_carreaux', coalesce(
      (select sum(n) from par_classe_global where classe <> 'hors'), 0),
    /*
     * ── LE GRAIN D'ACHAT, À TOUTES LES MAILLES ─────────────────────────────
     *
     * Le DSP achète au CODE POSTAL, le risque se mesure au carreau de 200 m,
     * et l'écran se lit à la maille qu'on veut. Ce compte reste donc le même
     * quelle que soit la maille affichée — sans quoi « combien de codes postaux
     * vais-je acheter » changerait de réponse selon la façon de regarder.
     *
     * ⚠ Les codes postaux RETENUS sont un autre chiffre : ils dépendent du
     * seuil de couverture, qui se règle à l'étape Zones. Celui-ci compte ceux
     * qui sont TOUCHÉS.
     */
    'n_codes_postaux', (
      select count(distinct cp) from base where classe <> 'hors' and cp is not null),
    /*
     * ── LE DÉNOMINATEUR DE LA PART NATIONALE ───────────────────────────────
     *
     * La population de référence du PÉRIMÈTRE, pas de la France, dès qu'un
     * territoire est choisi : « 12 % de la population » doit vouloir dire 12 %
     * de ce qu'on regarde. Rapporter à la France entière depuis un département
     * rendrait un chiffre toujours minuscule, donc illisible.
     *
     * ⚠ Elle sort d'`unite_population_totale`, donc du MÊME carroyage que le
     * numérateur — jamais des 67,76 millions de l'INSEE, qui comptent trois
     * départements d'outre-mer sans aucun carreau.
     */
    'population_reference', coalesce((
      select round(sum((u.populations->>v_cible)::numeric))
        from public.unite_population_totale u
        left join public.ref_departements rd on rd.code_dept = u.code
       where u.maille = 'departement'
         and (p_parent is null or u.code = p_parent)
         and (p_region is null or coalesce(rd.code_region, 'HORS') = p_region)
    ), 0),
    /*
     * ── LA DILUTION ────────────────────────────────────────────────────────
     *
     * Population totale des unités TOUCHÉES, avant toute troncature de la
     * liste. Rapportée au total exposé, elle dit ce qu'on achète pour ce qu'on
     * vise — l'indicateur qui chute aux petits rayons et qu'il faut voir avant
     * l'achat, pas après.
     *
     * ⚠ `null` quand la maille n'a pas de dénominateur (code postal) : un zéro
     * se lirait « on n'achète rien », ce qui est l'inverse de « on ne sait pas
     * dire combien ».
     */
    'pop_unites_touchees', (
      select sum(l.pop_totale)
        from totaux_unite t
        join libelles l on l.cle = t.unite
       where t.total > 0),
    'total', coalesce(
      (select sum(pop) from par_classe_global where classe <> 'hors'), 0),
    'par_classe', coalesce(
      (select jsonb_object_agg(classe, pop) from par_classe_global
        where classe <> 'hors'), '{}'::jsonb),
    -- ⚠ Des habitants de carreaux PROCHES d'un site que le profil ne retient
    -- pas. Ce n'est PAS la population non exposée de France : la table ne
    -- contient que des carreaux à moins de 10 km d'un site.
    'hors_zone', coalesce(
      (select sum(pop) from par_classe_global where classe = 'hors'), 0),
    'unites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'unite', u.unite,
               'nom', u.nom,
               'total', u.total,
               'classes', u.classes,
               -- Les DEUX dénominateurs partent bruts, jamais une part déjà
               -- calculée : l'écran, le classeur et la choroplèthe en tirent
               -- chacun ce qu'il montre, et une seule définition circule.
               'pop_totale', u.pop_totale,
               'surface_km2', u.surface_km2)
             order by u.total desc)
        from (select r.unite, r.total,
                     coalesce(uj.classes, '{}'::jsonb) as classes,
                     -- ⚠ `left join` : une unité sans libellé garde sa ligne et
                     -- son total. La faire disparaître retirerait sa population
                     -- du tableau pour un défaut de référentiel.
                     l.nom, l.pop_totale, l.surface_km2
                from retenues r
                left join unites_json uj on uj.unite = r.unite
                left join libelles l on l.cle = r.unite) u), '[]'::jsonb)
  ) into v_res;

  return v_res;
end;
$function$;

comment on function public.population_par_classe is
  'Population par classe du profil et par territoire. RETURNS jsonb et non TABLE : '
  'cinquieme occurrence de la troncature PostgREST recensee dans le projet. '
  'L''arrondi a lieu AU GRAIN LE PLUS FIN et nulle part ailleurs, tous les totaux en '
  'decoulant par addition. ⚠ `parallel safe` n''est pas decoratif : une fonction '
  'security definer est non parallelisable par defaut, et la marque fait passer '
  'l''appel national de 12,3 s a 2,8 s. Depuis sql/219 elle honore p_natures (sans '
  'filtre la table mere, avec filtre carreau_risque_nature) et refuse un libelle '
  'inconnu plutot que de le replier sur le seau « non precisee ». Depuis sql/221 elle '
  'porte QUATRE mailles : region, departement, commune, code_postal — c''est ce qui '
  'permet a l''onglet Territoires de quitter population_exposee_agregee, dont le '
  'garde-fou de surface plafonne le rayon national a 1 179 m quand le profil en '
  'demande 5 000. ⚠ p_parent est un code de DEPARTEMENT et p_region un code de '
  'REGION : DEUX arguments et non un parent polymorphe, parce que 18 codes INSEE '
  'designent les deux (piege de sql/171).';

revoke all on function public.population_par_classe(jsonb, text, text, text, integer, text[], text)
  from public, anon, authenticated;
grant execute on function public.population_par_classe(jsonb, text, text, text, integer, text[], text)
  to service_role;
