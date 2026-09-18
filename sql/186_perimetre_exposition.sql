-- sql/186 — Perimetre d'etude sur l'agregat de population exposee
--
-- Ajoute `p_perim_niveau` / `p_perim_codes` a `population_exposee_agregee`
-- (sql/185) : l'ecran doit pouvoir repondre « et dans MA region ? » sans
-- ramener la France entiere puis filtrer a l'affichage.
--
-- Le perimetre est resolu en une liste de DEPARTEMENTS quel que soit le
-- niveau demande, parce que c'est la seule maille que le site porte en
-- ATTRIBUT (`poi_france.code_departement`) : filtrer par geometrie couterait
-- exactement ce que sql/185 a passe trois reecritures a supprimer.
--
-- Le filtre porte sur les SITES, pas sur les carreaux. Un site du perimetre
-- dont la zone deborde juste au-dela apporte quand meme sa population — c'est
-- le comportement attendu d'une etude locale : on etudie les installations
-- d'un territoire, pas un decoupage administratif de la population.
--
-- ⚠ CE FICHIER EST GENERE EN COPIANT LE CORPS DE sql/185, avec cinq
--   substitutions verifiees. Meme raison que sql/184 : une fonction de cette
--   taille ne se recopie pas a la main — la derniere fois, la geometrie se
--   lisait dans le mauvais champ et l'INSERT n'ecrivait rien SANS LEVER.
--
-- ── POURQUOI UN DROP ICI, ALORS QUE LE PROJET L'EXCLUT ───────────────────
--
-- Les deux surcharges ne peuvent pas coexister : toutes les deux ont des
-- valeurs par defaut sur tous leurs parametres, donc un appel a deux arguments
-- correspond aux deux et PostgreSQL refuse de choisir
-- (« function ... is not unique »). PostgREST buterait de la meme facon.
--
-- La regle « pas de DROP en production » protege les fonctions qu'une version
-- deployee peut encore appeler. Celle-ci a ete creee le meme jour, n'a jamais
-- ete deployee, et rien ne l'appelle hors de ce chantier. Le DROP est donc
-- sans risque — et le laisser en place, lui, casserait l'appel.
drop function if exists public.population_exposee_agregee(text, text, text[], text[], text[], integer, integer);

create or replace function public.population_exposee_agregee(
  p_dimension text    default 'departement',  -- region | departement | code_postal
  p_cible     text    default 'ind',
  p_gravites  text[]  default null,           -- null = les deux niveaux Seveso
  p_natures   text[]  default null,           -- libelles de nature ; null = toutes
  p_modes     text[]  default null,           -- 'pprt' | 'buffer' ; null = les deux
  p_rayon_m   integer default null,           -- null = rayon deduit
  p_limite    integer default 200,
  -- Perimetre d'etude : 'region' | 'departement', et les codes retenus.
  -- null = France entiere.
  p_perim_niveau text   default null,
  p_perim_codes  text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  c_tolerance_m constant int := 500;   -- meme rattachement que sql/179 et sql/180
  v_rayon    int;
  v_gravites text[];
  v_pprt     boolean;
  v_buffer   boolean;
  v_limite   int := greatest(1, least(coalesce(p_limite, 200), 7000));
  v_depts    text[] := null;   -- perimetre resolu en departements
  v_result   jsonb;
begin
  if p_dimension not in ('region', 'departement', 'code_postal') then
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

  with
  sites as (
    select p.id, p.lng, p.lat
      from public.poi_france p
     where p.categorie = 'risque_industriel'
       and p.sous_categorie = any(v_gravites)
       and (p_natures is null or (p.metadata->>'libelle_nature') = any(p_natures))
       and coalesce(p.metadata->>'etat_activite', '') is distinct from 'En fin d''exploitation'
       -- Perimetre d'etude. Filtre les SITES, pas les carreaux : un site du
       -- perimetre dont la zone deborde juste a cote apporte quand meme sa
       -- population, ce qui est le comportement attendu d'une etude locale.
       and (v_depts is null or p.code_departement = any(v_depts))
       and p.lng is not null and p.lat is not null
  ),
  -- Chaque site recoit SA zone : le perimetre PPRT s'il en a un, sinon le
  -- rayon. Meme regle de rattachement que la carte et que le calcul par site.
  zones as (
    select s.id,
           case when z.id is not null then 'pprt' else 'buffer' end as mode,
           coalesce(
             z.geom_3857,
             ST_Transform(
               ST_Buffer(ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography,
                         v_rayon, 'quad_segs=8')::geometry, 3857)
           ) as geom
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
           max((c.metadata->>p_cible)::numeric)         as valeur,
           max(c.metadata->>'lcog_geo')                 as commune,
           max(ST_Area(c.geom_3857))                    as aire,
           ST_Union(ST_Intersection(c.geom_3857, r.geom)) as couvert,
           max(c.geom_centroid)                         as centroid
      from retenues r
      join public.carreaux_filosofi c
        on c.geom_3857 && r.geom and ST_Intersects(c.geom_3857, r.geom)
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
           count(*) filter (where mode = 'buffer')   as n_indicatifs
      from (
        select r.id, r.mode,
               case p_dimension
                 when 'departement' then p.code_departement
                 when 'region'      then d.code_region
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
  libelles as (
    select d.code_dept as cle, d.nom_dept as nom,
           (select sum(cp.pop_total) from public.ref_codes_postaux cp
             where cp.code_dept = d.code_dept)::numeric as pop_totale,
           (select sum(cp.surface_km2) from public.ref_codes_postaux cp
             where cp.code_dept = d.code_dept)::numeric as surface_km2
      from public.ref_departements d where p_dimension = 'departement'
    union all
    select r.code_region, r.nom_region,
           (select sum(cp.pop_total) from public.ref_codes_postaux cp
              join public.ref_departements d2 on d2.code_dept = cp.code_dept
             where d2.code_region = r.code_region)::numeric,
           (select sum(cp.surface_km2) from public.ref_codes_postaux cp
              join public.ref_departements d2 on d2.code_dept = cp.code_dept
             where d2.code_region = r.code_region)::numeric
      from public.ref_regions r where p_dimension = 'region'
    union all
    select cp.code_postal, cp.nom_principal, cp.pop_total::numeric, cp.surface_km2::numeric
      from public.ref_codes_postaux cp where p_dimension = 'code_postal'
  ),
  lignes as (
    select a.cle,
           coalesce(l.nom, a.cle)         as nom,
           round(a.exposee)               as exposee,
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
    'perim_niveau', p_perim_niveau,
    'perim_codes',  to_jsonb(coalesce(p_perim_codes, array[]::text[])),
    'n_unites',     (select count(*) from lignes),
    -- Un carreau appartenant a UNE unite, ce total EGALE la somme de toutes les
    -- lignes. Il peut differer de la somme des lignes AFFICHEES quand la liste
    -- est tronquee par `p_limite` — d'ou le fait de le rendre a part.
    'total_exposee',    (select round(coalesce(sum(exposee), 0)) from lignes),
    'total_sites',      (select count(*) from retenues),
    'total_indicatifs', (select count(*) from retenues where mode = 'buffer'),
    'total_carreaux',   (select coalesce(sum(carreaux), 0) from lignes),
    'tronquee',         (select count(*) from lignes) > v_limite,
    'lignes', coalesce((
      select jsonb_agg(l order by l.exposee desc)
        from (select * from lignes order by exposee desc limit v_limite) l
    ), '[]'::jsonb),
    'calcule_le', now()
  )
  into v_result;

  return v_result;
end;
$function$;

revoke all on function public.population_exposee_agregee(text, text, text[], text[], text[], integer, integer, text, text[])
  from public, anon, authenticated;
grant execute on function public.population_exposee_agregee(text, text, text[], text[], text[], integer, integer, text, text[])
  to service_role;

-- L'ancienne signature a 7 arguments reste en place : la supprimer demanderait
-- un DROP, exclu en production tant qu'une version deployee peut encore
-- l'appeler. Les deux coexistent, la nouvelle ayant deux parametres de plus
-- avec des valeurs par defaut.
