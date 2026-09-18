-- sql/194 - Maille COMMUNE : le classement rapide des territoires exposes (2026-09-18)
--
-- « Quand je clique sur code postal je comprends que le calcul soit trop long,
--   mais c'est possible d'avoir tres rapidement les 100 plus grandes communes
--   exposees selon les criteres et filtres ? »
--
-- Oui, et c'est moins cher que le code postal, pas plus. La raison tient en
-- une ligne : le carreau PORTE DEJA son code commune INSEE
-- (`metadata->>'lcog_geo'`), alors que le code postal exige un point-dans-
-- polygone contre les 6 187 contours de `ref_codes_postaux`, carreau par
-- carreau. La maille commune supprime ce croisement spatial au lieu de
-- l'alourdir.
--
-- DEUX PIEGES MESURES LE JOUR MEME, a ne pas redecouvrir :
--
-- 1. `lcog_geo` n'est PAS un code mais une LISTE separee par des virgules
--    des que le carreau est a cheval : '75103,75104,75111' releve sur Paris.
--    Prendre la chaine entiere fabriquerait des cles qui n'existent dans
--    aucun referentiel. On retient le PREMIER code — ce qui preserve la regle
--    « un carreau appartient a UNE unite », donc l'egalite exacte entre la
--    somme des lignes et le total.
--
-- 2. Paris, Lyon et Marseille sont en codes d'ARRONDISSEMENT (75101 et non
--    75056), aussi bien dans les carreaux que dans `ref_communes` et
--    `iris_agg_commune` - verifie sur les trois. Le classement liste donc des
--    arrondissements. C'est coherent avec le referentiel, et c'est plus
--    precis ; ce n'est simplement pas « Paris » en une ligne.
--
-- Genere depuis la definition EN BASE par substitution d'ancres verifiees.

CREATE OR REPLACE FUNCTION public.population_exposee_agregee(p_dimension text DEFAULT 'departement'::text, p_cible text DEFAULT 'ind'::text, p_gravites text[] DEFAULT NULL::text[], p_natures text[] DEFAULT NULL::text[], p_modes text[] DEFAULT NULL::text[], p_rayon_m integer DEFAULT NULL::integer, p_limite integer DEFAULT 200, p_perim_niveau text DEFAULT NULL::text, p_perim_codes text[] DEFAULT NULL::text[], p_forcer_rayon boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_tolerance_m constant int := 500;   -- meme rattachement que sql/179 et sql/180
  v_rayon    int;
  v_gravites text[];
  v_pprt     boolean;
  v_buffer   boolean;
  v_limite   int := greatest(1, least(coalesce(p_limite, 200), 7000));
  v_depts    text[] := null;   -- perimetre resolu en departements
  v_forcer   boolean := coalesce(p_forcer_rayon, false);
  v_n_sites  bigint;
  c_max_sites constant int := 3000;
  c_max_km2  constant int := 5500;
  v_km2      numeric;
  v_cle      text;
  v_n_pprt   bigint;
  v_cache    jsonb;
  v_t0       timestamptz := clock_timestamp();
  v_result   jsonb;
begin
  if p_dimension not in ('region', 'departement', 'code_postal', 'commune') then
    return jsonb_build_object('error', 'dimension_inconnue', 'calculable', false);
  end if;

  -- La cible est validee contre le CATALOGUE, jamais interpolee telle quelle :
  -- c'est la seule barriere contre l'injection par nom de champ.
  if not exists (select 1 from public.cibles_exposition where code = p_cible and actif) then
    return jsonb_build_object('error', 'cible_inconnue', 'calculable', false);
  end if;

  v_rayon    := coalesce(p_rayon_m, public.rayon_defaut_exposition());
  v_gravites := coalesce(p_gravites, array['seveso_haut', 'seveso_bas']);
  v_pprt     := p_modes is null or 'pprt'   = any(p_modes);
  v_buffer   := p_modes is null or 'buffer' = any(p_modes);

  -- Le perimetre est resolu en une liste de DEPARTEMENTS, quel que soit le
  -- niveau demande : c'est la seule maille que le site porte en attribut
  -- (`poi_france.code_departement`), donc la seule qui filtre sans geometrie.
  if p_perim_niveau = 'departement' then
    v_depts := p_perim_codes;
  elsif p_perim_niveau = 'region' then
    select array_agg(d.code_dept) into v_depts
      from public.ref_departements d
     where d.code_region = any(p_perim_codes);
  end if;

  -- Garde-fou de cout. Mesure du 2026-09-18 EN PRODUCTION, deux points reels :
  --    1 326 sites (Seveso haut+bas, France)              ->  ~3 s
  --   19 521 sites (idem + regime 'autorisation', France) -> 88,3 s
  -- soit 2,3 a 4,5 ms par site, l'intersection avec carreaux_filosofi (2,3 M
  -- lignes) dominant tout le reste. Le plafond de 3 000 tient l'ecran sous ~15 s.
  --
  -- Sans lui, cocher 'autre' (41 690 sites) ou 'enregistrement' (29 665) partait
  -- pour plusieurs MINUTES sur la base de production : la famille exacte de
  -- l'incident du 28/03 (CLAUDE.md, « Incidents »). A l'ecran, une attente sans
  -- fin se lit comme une panne, et c'est ainsi qu'elle a ete signalee.
  select count(*) into v_n_sites
    from public.sites_exposition(v_gravites, p_natures, v_depts);

  if v_n_sites > c_max_sites then
    return jsonb_build_object(
      'error', 'trop_de_sites', 'calculable', false,
      'n_sites', v_n_sites, 'max_sites', c_max_sites);
  end if;

  -- ── Second garde-fou : la SURFACE, pas seulement le nombre de sites ─────
  --
  -- Le compte de sites ne suffit pas, et la mesure le prouve. En production le
  -- 2026-09-18, sur les MEMES 1 258 sites Seveso :
  --
  --   rayon par defaut (532 m, PPRT prioritaire) ->  ~3 s,  ~5 600 carreaux
  --   cercle impose de 2 km                      -> 42,8 s, 95 268 carreaux
  --
  -- Le cout suit les CARREAUX INTERSECTES (~0,45 ms chacun), donc la surface
  -- cumulee des zones — pas leur nombre. Un cercle de 2 km couvre 14 fois
  -- l'aire d'un de 532 m, et le PPRT moyen ne fait que 0,94 km de large.
  -- Sans ce second controle, « 20 km autour de chaque site » passait le
  -- premier garde-fou sans encombre et partait pour des heures.
  --
  -- La borne est une MAJORATION volontairement grossiere : on suppose que tous
  -- les sites prennent un cercle et qu'aucun ne se recouvre. Elle surestime
  -- donc le cout reel (95 268 carreaux mesures contre ~395 000 majores : les
  -- carreaux INSEE ne couvrent que les zones habitees). Majorer est le bon
  -- sens de l'erreur pour un garde-fou : il refuse un peu trop tot, jamais
  -- trop tard.
  v_km2 := v_n_sites * pi() * power(v_rayon / 1000.0, 2);

  if v_km2 > c_max_km2 then
    return jsonb_build_object(
      'error', 'zone_trop_vaste', 'calculable', false,
      'n_sites', v_n_sites,
      'rayon_m', v_rayon,
      'km2', round(v_km2),
      'max_km2', c_max_km2,
      -- Le rayon le plus large qui passerait sur CE nombre de sites : sans
      -- lui, l'utilisateur tatonne a l'aveugle entre deux refus.
      'rayon_max_m', floor(sqrt(c_max_km2 / (v_n_sites * pi())) * 1000));
  end if;

  -- CACHE. Le calcul coute de 3 a 43 s selon le rayon et le nombre de sites
  -- (mesures de production, sql/190 et sql/192). L'ecran le relance a CHAQUE
  -- clic de filtre, et deux utilisateurs qui ouvrent la meme vue le paient
  -- deux fois.
  --
  -- La cle porte TOUS les parametres, plus deux temoins de fraicheur :
  --   - v_n_sites, deja compte par le garde-fou, donc gratuit ici ;
  --   - le nombre de perimetres PPRT (664 lignes, compte trivial).
  -- Un import qui ajoute ou retire des sites ou des perimetres change donc la
  -- cle : le cache s'invalide DE LUI-MEME, sans peremption a regler ni purge a
  -- penser au moment de l'import. Un cache a TTL aurait servi des chiffres
  -- perimes apres un import, en silence.
  --
  -- Ce qu'il ne couvre PAS, et il faut le dire : une modification des CARREAUX
  -- a nombre de sites constant. Cela n'arrive qu'a un millesime INSEE, une
  -- fois par an, et vider_exposition_cache() est la pour ce jour-la.
  select count(*) into v_n_pprt from public.pprt_perimetres;

  v_cle := md5(concat_ws('|',
    p_dimension, p_cible,
    array_to_string(coalesce(v_gravites, '{}'), ','),
    array_to_string(coalesce(p_natures,  '{}'), ','),
    array_to_string(coalesce(p_modes,    '{}'), ','),
    v_rayon::text, v_limite::text, v_forcer::text,
    coalesce(p_perim_niveau, ''),
    array_to_string(coalesce(v_depts, '{}'), ','),
    v_n_sites::text, v_n_pprt::text));

  select payload into v_cache from public.exposition_cache where cle = v_cle;
  if v_cache is not null then
    update public.exposition_cache
       set lu_le = now(), n_lectures = n_lectures + 1
     where cle = v_cle;
    -- du_cache remonte jusqu'a l'ecran : une valeur servie instantanement doit
    -- pouvoir dire de quand elle date, sinon elle se fait passer pour un
    -- calcul frais.
    return v_cache || jsonb_build_object('du_cache', true);
  end if;

  with
  sites as (
    -- Le predicat vit desormais dans `sites_exposition` : le garde-fou de cout
    -- ci-dessus compte EXACTEMENT ce que ce calcul va traiter.
    select s.id, s.lng, s.lat
      from public.sites_exposition(v_gravites, p_natures, v_depts) s
  ),
  -- Chaque site recoit SA zone : le perimetre PPRT s'il en a un, sinon le
  -- rayon. Meme regle de rattachement que la carte et que le calcul par site.
  zones as (
    select s.id,
           case when z.id is not null then 'pprt' else 'buffer' end as mode,
           -- ⚠ `mode` dit si le site A un PPRT ; `geom` dit quelle zone on
           -- MESURE. Les deux se separent des que le rayon est impose, et
           -- c'est voulu : le filtre « quels sites » doit continuer de
           -- fonctionner (un Seveso avec plan reste distinguable d'un site
           -- sans plan) alors meme qu'on mesure un cercle autour des deux.
           case when v_forcer then
             ST_Transform(
               ST_Buffer(ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography,
                         v_rayon, 'quad_segs=8')::geometry, 3857)
           else
             coalesce(
               z.geom_3857,
               ST_Transform(
                 ST_Buffer(ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography,
                           v_rayon, 'quad_segs=8')::geometry, 3857)
             )
           end as geom
      from sites s
      left join lateral (
        select pz.id, pz.geom_3857
          from public.pprt_perimetres pz
         where ST_DWithin(pz.geom::geography,
                          ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography,
                          c_tolerance_m)
         order by ST_Distance(pz.geom::geography,
                              ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography)
         limit 1
      ) z on true
  ),
  retenues as (
    select * from zones
     where (mode = 'pprt' and v_pprt) or (mode = 'buffer' and v_buffer)
  ),
  -- ══ L'UNION PAR CARREAU, ET ELLE SEULE ══════════════════════════════════
  --
  -- Groupee par CARREAU, pas par (carreau x unite). C'est ce qui fait passer
  -- le calcul de 54 s a moins d'une seconde : la premiere version decoupait
  -- chaque zone par chaque unite geographique (ST_Intersection polygone x
  -- polygone, des milliers de fois) AVANT de croiser les carreaux.
  --
  -- L'attribution a une unite se fait APRES, sur les quelques milliers de
  -- carreaux reellement exposes, et par un JOIN D'ATTRIBUT : chaque carreau
  -- porte deja son code commune INSEE dans `metadata->>'lcog_geo'`, renseigne
  -- a 100 % (mesure du 2026-09-18 sur 50 000 lignes).
  --
  -- Effet VOULU : un carreau appartient a UNE unite et une seule, donc la
  -- somme des lignes egale exactement le total. Ce qui double, en revanche,
  -- c'est le COMPTE DE SITES : un site dont la zone deborde sur deux
  -- departements compte dans les deux, et l'interface doit le dire.
  par_carreau as (
    select c.id                                         as carreau,
           (c.metadata->>p_cible)::numeric              as valeur,
           c.metadata->>'lcog_geo'                      as commune,
           ST_Area(c.geom_3857)                         as aire,
           -- Le centroide est CALCULE, pas lu : `carreaux_filosofi.geom_centroid`
           -- existe mais est NULL sur les 2 298 582 lignes (mesure du
           -- 2026-09-18, local ET prod). Le lire rendait `cle` a NULL pour tous
           -- les carreaux, la dimension « code postal » ne rendait donc RIEN —
           -- un tableau vide, sans erreur. Meme piege que la colonne `ind`.
           ST_Transform(ST_Centroid(c.geom_3857), 4326) as centroid,
           ST_Union(ST_Intersection(c.geom_3857, r.geom)) as couvert
      from retenues r
      join public.carreaux_filosofi c
        on c.geom_3857 && r.geom and ST_Intersects(c.geom_3857, r.geom)
     -- `group by c.id` suffit : id est la cle primaire, donc PostgreSQL
     -- autorise les autres colonnes sans agregat. Evite un `max()` sur une
     -- geometrie, dont l'ordre n'a aucun sens.
     group by c.id
  ),
  couverts as (
    select carreau, commune, centroid,
           valeur * (ST_Area(couvert) / nullif(aire, 0))::numeric as exposee
      from par_carreau
  ),
  -- Region et departement se deduisent du code commune. Le code postal demande
  -- la geometrie — une commune pouvant en porter plusieurs — mais seulement
  -- sur les quelques milliers de carreaux exposes, et par un point dans
  -- polygone qui emprunte l'index GIST.
  attribues as (
    select cv.carreau, cv.exposee,
           case p_dimension
             when 'departement' then dep.code_dept
             when 'region'      then dep.code_region
             -- ⚠ `lcog_geo` n'est PAS un code, c'est une LISTE : un carreau a
             -- cheval porte '75103,75104,75111' (mesure du 2026-09-18 sur
             -- Paris). Prendre la chaine entiere fabriquerait des cles
             -- inexistantes. On retient le PREMIER code, ce qui garde la regle
             -- « un carreau appartient a UNE unite » — donc la somme des
             -- lignes reste exactement egale au total.
             --
             -- Les branches departement et region s'appuient deja sur cette
             -- meme convention : `left(commune, 2)` lit les deux premiers
             -- caracteres du premier code de la liste.
             when 'commune'     then split_part(cv.commune, ',', 1)
             else cp.code_postal
           end as cle
      from couverts cv
      left join lateral (
        select d.code_dept, d.code_region
          from public.ref_departements d
         where p_dimension in ('departement', 'region')
           and d.code_dept = case when left(cv.commune, 2) = '97'
                                  then left(cv.commune, 3) else left(cv.commune, 2) end
         limit 1
      ) dep on true
      left join lateral (
        select c2.code_postal
          from public.ref_codes_postaux c2
         where p_dimension = 'code_postal'
           and c2.geom && cv.centroid
           and ST_Contains(c2.geom, cv.centroid)
         limit 1
      ) cp on true
  ),
  agrege as (
    select cle, sum(exposee) as exposee, count(*) as carreaux
      from attribues where cle is not null
     group by cle
  ),
  -- ══ LES SITES PAR UNITE : PAR ATTRIBUT, PAS PAR GEOMETRIE ══════════════
  --
  -- La version precedente croisait les 1 259 zones avec les 101 polygones
  -- departementaux (ST_Intersects sur des geometries administratives, donc
  -- lourdes) : a elle seule, cette CTE pesait l'essentiel des 23 s mesurees.
  --
  -- Le site porte DEJA son departement et son code postal. On compte donc les
  -- sites IMPLANTES dans l'unite, et non ceux dont la zone y deborde.
  --
  -- ⚠ CE N'EST PAS LA MEME QUESTION, et la difference doit etre dite : un site
  --   situe juste en dehors d'un departement mais dont la zone y mord apporte
  --   de la POPULATION a ce departement sans y compter comme SITE. La colonne
  --   se lit « sites implantes ici », pas « sites qui touchent ici ».
  --   En echange, ce compte s'additionne correctement, ce que l'autre ne
  --   faisait pas.
  sites_unite as (
    select cle,
           count(*)                                  as n_sites,
           count(*) filter (where v_forcer or mode = 'buffer') as n_indicatifs
      from (
        select r.id, r.mode,
               case p_dimension
                 when 'departement' then p.code_departement
                 when 'region'      then d.code_region
                 -- Le site porte son code commune INSEE dans ses metadonnees
                 -- (pose par l'import Georisques, repare par
                 -- consolider_geo_icpe, sql/174). Aucune geometrie ici.
                 when 'commune'     then p.metadata->>'code_insee'
                 else p.code_postal
               end as cle
          from retenues r
          join public.poi_france p on p.id = r.id
          left join public.ref_departements d
            on p_dimension = 'region' and d.code_dept = p.code_departement
      ) t
     where cle is not null
     group by cle
  ),
  -- ══ LES DENOMINATEURS : SOURCE VALIDEE CONTRE L'INSEE ═════════════════
  --
  -- `part_pct` et `densite` valent ce que valent leur denominateur, et les
  -- deux colonnes de `ref_codes_postaux` utilisees jusqu'ici SURCOMPTENT
  -- (mesures du 2026-09-18) :
  --
  --   sum(pop_total)   74 876 618 = 110,5 % de la France reelle (67 760 552)
  --   sum(surface_km2)    691 758 = 109,3 % des 632 834 km2 du pays
  --
  -- Un carreau a cheval sur deux codes postaux compte dans les deux : c'est le
  -- meme double comptage que celui combattu dans le numerateur, present cette
  -- fois dans le referentiel. Consequence, avant correctif : une part
  -- SOUS-ESTIMEE d'environ 10 %, et une densite avec elle — sur l'encodage par
  -- DEFAUT de la mini-carte.
  --
  -- Pire, 169 codes postaux sur 6 187 ont `pop_total` a NULL, dont la TOTALITE
  -- de ceux de Paris, La Reunion, la Guadeloupe, la Martinique et la Guyane.
  -- Comme `sum()` ignore les NULL, ces departements recevaient un denominateur
  -- ampute sans que rien ne le signale.
  --
  -- `iris_agg_departement` (sql/138) rend EXACTEMENT 67 760 552 habitants,
  -- soit 100,0 % du chiffre INSEE, et 638 019 km2 (+0,8 %). C'est la source.
  --
  -- ⚠ AU PALIER CODE POSTAL, IL N'EN EXISTE AUCUNE. `carreaux_cp_population`
  --   rend le meme 110,5 % (c'est la source de `ref_codes_postaux.pop_total`),
  --   et `indicator_cp_values` ne porte aucun indicateur de population. La
  --   part et la densite y sont donc rendues NULLES : une colonne vide qui
  --   s'explique vaut mieux qu'un chiffre faux de 10 % qui colore une carte.
  libelles as (
    select a.code as cle, a.nom,
           a.population::numeric     as pop_totale,
           a.superficie_km2::numeric as surface_km2
      from public.iris_agg_departement a where p_dimension = 'departement'
    union all
    select r.code_region, r.nom_region,
           (select sum(a.population)     from public.iris_agg_departement a
              join public.ref_departements d2 on d2.code_dept = a.code
             where d2.code_region = r.code_region)::numeric,
           (select sum(a.superficie_km2) from public.iris_agg_departement a
              join public.ref_departements d2 on d2.code_dept = a.code
             where d2.code_region = r.code_region)::numeric
      from public.ref_regions r where p_dimension = 'region'
    union all
    -- Au code postal : le libelle seul, sans denominateur. Voir ci-dessus.
    select cp.code_postal, cp.nom_principal, null::numeric, null::numeric
      from public.ref_codes_postaux cp where p_dimension = 'code_postal'
    union all
    -- La commune a un VRAI denominateur, contrairement au code postal :
    -- `iris_agg_commune` derive des memes IRIS que `iris_agg_departement`,
    -- dont la somme vaut 100,0 % du chiffre INSEE. Part et densite sont donc
    -- disponibles a cette maille.
    --
    -- Deux limites connues, heritees de ce palier (ARCHITECTURE.md) :
    --   - 82 IRIS y sont absents (80 253 habitants, 68 communes absentes de
    --     `ref_communes`) : ces communes auront un denominateur NULL, donc ni
    --     part ni densite — et non un pourcentage faux ;
    --   - Paris, Lyon et Marseille n'y figurent QUE par arrondissement
    --     (75101…, pas 75056), ce qui colle exactement aux codes que portent
    --     les carreaux. Le classement liste donc des arrondissements, pas
    --     « Paris » en un bloc.
    select a.code, a.nom, a.population::numeric, a.superficie_km2::numeric
      from public.iris_agg_commune a where p_dimension = 'commune'
  ),
  lignes as (
    select a.cle,
           coalesce(l.nom, a.cle)         as nom,
           -- ARRONDI CUMULATIF, et non `round()` ligne a ligne.
           --
           -- La valeur affichee est la difference de deux cumuls arrondis :
           -- la somme des lignes retombe donc EXACTEMENT sur le total, tout en
           -- restant a moins d'une unite de la valeur vraie de chaque ligne.
           --
           -- Avec un `round()` par ligne, les arrondis s'accumulaient : 5 804
           -- affiches pour un total de 5 805 sur 11 departements, et l'ecart
           -- grandit avec le nombre de lignes (54 codes postaux dans le meme
           -- test). Or l'ecran AFFIRME que la somme des lignes egale le total.
           -- Un tableau qui ne s'additionne pas fait douter le lecteur, pas le
           -- logiciel.
           round(sum(a.exposee) over (order by a.exposee desc, a.cle))
             - coalesce(round(sum(a.exposee) over (
                 order by a.exposee desc, a.cle
                 rows between unbounded preceding and 1 preceding)), 0)
                                          as exposee,
           coalesce(su.n_sites, 0)        as n_sites,
           coalesce(su.n_indicatifs, 0)   as n_indicatifs,
           a.carreaux,
           l.pop_totale,
           l.surface_km2,
           -- La PART : la seule grandeur comparable d'une unite a l'autre.
           case when coalesce(l.pop_totale, 0) > 0
                then round(100.0 * a.exposee / l.pop_totale, 2) else null end as part_pct,
           -- La DENSITE : habitants exposes par km2 d'unite.
           case when coalesce(l.surface_km2, 0) > 0
                then round(a.exposee / l.surface_km2, 1) else null end as densite
      from agrege a
      left join libelles l     on l.cle  = a.cle
      left join sites_unite su on su.cle = a.cle
  )
  select jsonb_build_object(
    'calculable',   true,
    'dimension',    p_dimension,
    'cible',        p_cible,
    'rayon_m',      v_rayon,
    'rayon_deduit', p_rayon_m is null,
    -- Quand il est impose, AUCUN chiffre de l'ecran ne vient d'une zone
    -- publiee par l'Etat : l'interface doit le dire, pas le deviner.
    'rayon_force', v_forcer,
    'perim_niveau', p_perim_niveau,
    'perim_codes',  to_jsonb(coalesce(p_perim_codes, array[]::text[])),
    'n_unites',     (select count(*) from lignes),
    -- Un carreau appartenant a UNE unite, ce total EGALE la somme de toutes les
    -- lignes. Il peut differer de la somme des lignes AFFICHEES quand la liste
    -- est tronquee par `p_limite` — d'ou le fait de le rendre a part.
    -- Arrondi UNE fois, sur la somme non arrondie. Sommer des lignes deja
    -- arrondies faisait diverger les dimensions entre elles : region 5 805 et
    -- departement 5 804 pour exactement la meme France (mesure avant
    -- correctif). Le total ne doit pas dependre du nombre de lignes.
    'total_exposee',    (select round(coalesce(sum(exposee), 0)) from agrege),
    'total_sites',      (select count(*) from retenues),
    'total_indicatifs', (select count(*) from retenues where v_forcer or mode = 'buffer'),
    'total_carreaux',   (select coalesce(sum(carreaux), 0) from lignes),
    -- Les carreaux qu'on n'a PAS su rattacher a une unite. Ils sont exclus
    -- du total, et l'ecran doit pouvoir le dire : un chiffre ampute en
    -- silence est pire qu'un chiffre absent.
    'carreaux_non_attribues', (select count(*) from attribues where cle is null),
    'tronquee',         (select count(*) from lignes) > v_limite,
    'lignes', coalesce((
      select jsonb_agg(l order by l.exposee desc)
        from (select * from lignes order by exposee desc limit v_limite) l
    ), '[]'::jsonb),
    'calcule_le', now()
  )
  into v_result;

  v_result := v_result || jsonb_build_object(
    'du_cache', false,
    'duree_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));

  -- on conflict plutot qu'un test d'existence : deux onglets qui ouvrent la
  -- meme vue en meme temps arrivent ici ensemble, et le second doit ecraser
  -- sans lever.
  insert into public.exposition_cache (cle, payload, calcule_le, lu_le, n_lectures)
  values (v_cle, v_result, now(), now(), 0)
  on conflict (cle) do update set payload = excluded.payload, calcule_le = now();

  return v_result;
end;
$function$;

revoke all on function public.population_exposee_agregee(text, text, text[], text[], text[], integer, integer, text, text[], boolean) from public, anon, authenticated;
grant execute on function public.population_exposee_agregee(text, text, text[], text[], text[], integer, integer, text, text[], boolean) to service_role;
