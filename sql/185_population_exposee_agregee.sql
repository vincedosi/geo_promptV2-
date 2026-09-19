-- sql/185 — Population exposée AGRÉGÉE par maille géographique
--
-- Sert l'overlay « Analyser la population à risque ». Trois objets :
--   1. `cibles_exposition`          le catalogue des cibles calculables
--   2. `rayon_defaut_exposition()`  le rayon déduit des périmètres réels
--   3. `population_exposee_agregee` le calcul
--
-- ════════════════════════════════════════════════════════════════════════
-- 1. POURQUOI CE N'EST PAS UNE SOMME DE `seveso_exposition`
-- ════════════════════════════════════════════════════════════════════════
--
-- `seveso_exposition` (sql/180) est un cache PAR SITE. Additionner ses lignes
-- compte DEUX FOIS les habitants qui vivent dans le recouvrement de deux zones.
--
-- Mesuré le 2026-09-18, sur la production :
--
--   664 perimetres PPRT, France   somme naive 173 819  juste 173 669   +0,1 %
--   69 Seveso des B.-du-Rhone,
--   rayon 2 km                    somme naive 334 401  juste 206 169  +62,2 %
--
-- Deux regimes opposes. Les PPRT ne se recouvrent presque pas ; les rayons
-- calcules se recouvrent massivement — sommer 69 cercles de 2 km annonce
-- 128 232 habitants qui n'existent pas.
--
-- LA METHODE : on unit les zones A L'INTERIEUR DE CHAQUE CARREAU, puis on
-- compte une fois. L'union reste locale au carreau, ou elle ne porte que deux
-- ou trois morceaux — JAMAIS un ST_Union global sur des centaines de polygones,
-- qui serait ruineux.
--
-- ════════════════════════════════════════════════════════════════════════
-- 2. POURQUOI LE TYPE DE RISQUE EST UN FILTRE ET NON UNE DIMENSION
-- ════════════════════════════════════════════════════════════════════════
--
-- Un site porte PLUSIEURS natures de risque. Grouper par type ferait
-- reapparaitre le meme habitant dans deux lignes, et l'union par carreau ne
-- peut pas le rattraper : elle ne sait pas a quel type attribuer un
-- recouvrement entre un site toxique et un site inflammable.
--
-- Les dimensions sont donc UNIQUEMENT geographiques. Le type de risque et la
-- gravite sont des FILTRES : pour un tableau « par type », l'appelant fait
-- quatre appels filtres, et sait que leurs totaux ne s'additionnent pas.
--
-- Corollaire : le regroupement des natures en quatre types reste ecrit UNE
-- fois, dans `lib/carte/palette-risques.ts`. Cette fonction recoit des
-- libelles de nature, jamais des types — mettre le regroupement en SQL en
-- creerait une seconde definition, qui divergerait au premier type ajoute.
--
-- ════════════════════════════════════════════════════════════════════════
-- 3. COMMENT UN CARREAU EST ATTRIBUE A SON UNITE
-- ════════════════════════════════════════════════════════════════════════
--
-- Une zone a cheval sur deux departements ne doit pas compter entierement
-- dans chacun. La premiere version de cette fonction la DECOUPAIT donc
-- geometriquement par chaque unite avant de croiser les carreaux : mesure,
-- **54 secondes** — des milliers d'intersections polygone x polygone, pour un
-- ecran cense reagir a chaque changement de menu.
--
-- La version retenue attribue le CARREAU, pas la zone. Chaque carreau porte
-- deja son code commune INSEE dans `metadata->>'lcog_geo'`, renseigne a 100 %
-- (mesure du 2026-09-18 sur 50 000 lignes) : region et departement s'en
-- deduisent par un simple join d'attribut, et seul le code postal demande un
-- point-dans-polygone — sur les quelques milliers de carreaux reellement
-- exposes, jamais sur les 2,3 millions.
--
-- Un carreau de 200 m appartient ainsi a UNE unite et une seule. Deux
-- consequences, opposees a celles du decoupage :
--
--   la somme des lignes EGALE exactement le total — il n'y a plus de
--   population partagee entre deux lignes ;
--
--   en revanche le COMPTE DE SITES, lui, double : un site dont la zone deborde
--   sur deux departements compte dans les deux. C'est la seule grandeur du
--   tableau qui ne s'additionne pas, et l'interface doit le dire.

-- ─────────────────────────────────────────────────────────────────────────
-- Le catalogue des cibles
--
-- EN BASE et non dans un tableau TypeScript : ajouter une cible ne doit pas
-- demander un deploiement, et le menu de l'overlay se construit depuis cette
-- table — jamais depuis une liste ecrite en dur (regle du projet).
--
-- ⚠ TOUTES CES CIBLES SONT DES EFFECTIFS, et c'est ce qui rend le calcul juste.
--   On peut prendre 30 % des habitants d'un carreau ; on NE PEUT PAS prendre
--   30 % d'un revenu median. Les taux (part de menages pauvres, revenu moyen)
--   se calculent APRES agregation, a partir de deux effectifs — jamais par
--   prorata. Meme distinction que `classe_iris` (sql/138).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.cibles_exposition (
  code    text primary key,
  libelle text    not null,
  famille text    not null,
  ordre   integer not null,
  actif   boolean not null default true
);

alter table public.cibles_exposition enable row level security;

comment on table public.cibles_exposition is
  'Catalogue des cibles calculables de l overlay population exposee (sql/185). Uniquement des EFFECTIFS : un taux ne se prorate pas par la surface. Les 23 champs numeriques de carreaux_filosofi.metadata, mesures renseignes a 100 %. RLS deny-all.';

insert into public.cibles_exposition (code, libelle, famille, ordre) values
  ('ind',        'Population totale',        'Population', 10),
  ('ind_0_3',    'Enfants 0-3 ans',          'Âge',        20),
  ('ind_4_5',    'Enfants 4-5 ans',          'Âge',        21),
  ('ind_6_10',   'Enfants 6-10 ans',         'Âge',        22),
  ('ind_11_17',  'Adolescents 11-17 ans',    'Âge',        23),
  ('ind_18_24',  'Jeunes 18-24 ans',         'Âge',        24),
  ('ind_25_39',  'Adultes 25-39 ans',        'Âge',        25),
  ('ind_40_54',  'Adultes 40-54 ans',        'Âge',        26),
  ('ind_55_64',  'Adultes 55-64 ans',        'Âge',        27),
  ('ind_65_79',  'Seniors 65-79 ans',        'Âge',        28),
  ('ind_80p',    'Seniors 80 ans et plus',   'Âge',        29),
  ('men',        'Ménages',                  'Ménages',    40),
  ('men_pauv',   'Ménages pauvres',          'Ménages',    41),
  ('men_fmp',    'Familles monoparentales',  'Ménages',    42),
  ('men_1ind',   'Ménages d''une personne',  'Ménages',    43),
  ('men_5ind',   'Ménages de 5 pers. et +',  'Ménages',    44),
  ('men_prop',   'Ménages propriétaires',    'Ménages',    45),
  ('men_mais',   'Ménages en maison',        'Ménages',    46),
  ('men_coll',   'Ménages en collectif',     'Ménages',    47),
  ('log_soc',    'Logements sociaux',        'Logement',   60),
  ('log_av45',   'Logements avant 1945',     'Logement',   61),
  ('log_45_70',  'Logements 1945-1970',      'Logement',   62),
  ('log_70_90',  'Logements 1970-1990',      'Logement',   63),
  ('log_ap90',   'Logements après 1990',     'Logement',   64)
on conflict (code) do update
  set libelle = excluded.libelle, famille = excluded.famille, ordre = excluded.ordre;

-- ─────────────────────────────────────────────────────────────────────────
-- Le rayon par défaut : DÉDUIT des périmètres réels, jamais décrété
--
-- Mesure du 2026-09-18 sur les 664 perimetres, rayon equivalent r = √(aire/π) :
--   moyenne 532 m · mediane 286 m · Q1 99 m · Q3 654 m · max 12 307 m
--
-- C'est la moyenne des RAYONS, pas le rayon de l'aire moyenne : les deux
-- different d'un facteur deux (532 m contre 974 m), la racine carree etant
-- concave.
--
-- ⚠ Ce rayon est probablement TROP GENEREUX pour les sites concernes. Un PPRT
--   n'existe que la ou l'Etat a juge le risque assez fort pour en imposer un ;
--   les sites qui n'en ont pas sont majoritairement des Seveso seuil BAS, donc
--   moins dangereux. L'interface doit le dire.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.rayon_defaut_exposition()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    round(avg(sqrt(superficie_km2 / pi()) * 1000))::int,
    500  -- repli si la table est vide : on ne rend jamais NULL
  )
  from public.pprt_perimetres
  where superficie_km2 > 0;
$function$;

comment on function public.rayon_defaut_exposition() is
  'Rayon par defaut des sites sans PPRT, DEDUIT des perimetres reels : moyenne des rayons equivalents r = racine(aire/pi). 532 m mesures le 2026-09-18. Recalcule a chaque import, jamais ecrit en dur (sql/185).';

-- ─────────────────────────────────────────────────────────────────────────
-- Le calcul
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.population_exposee_agregee(
  p_dimension text    default 'departement',  -- region | departement | code_postal
  p_cible     text    default 'ind',
  p_gravites  text[]  default null,           -- null = les deux niveaux Seveso
  p_natures   text[]  default null,           -- libelles de nature ; null = toutes
  p_modes     text[]  default null,           -- 'pprt' | 'buffer' ; null = les deux
  p_rayon_m   integer default null,           -- null = rayon deduit
  p_limite    integer default 200
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

  with
  sites as (
    select p.id, p.lng, p.lat
      from public.poi_france p
     where p.categorie = 'risque_industriel'
       and p.sous_categorie = any(v_gravites)
       and (p_natures is null or (p.metadata->>'libelle_nature') = any(p_natures))
       and coalesce(p.metadata->>'etat_activite', '') is distinct from 'En fin d''exploitation'
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

comment on function public.population_exposee_agregee(text, text, text[], text[], text[], integer, integer) is
  'Population exposee agregee par region / departement / code_postal (sql/185). Unit les zones A L INTERIEUR de chaque carreau : un habitant dans le recouvrement de deux zones n est compte qu une fois — sommer naivement surestime de 62 % en mode buffer sur un departement dense (mesure 2026-09-18). Chaque carreau est attribue a UNE unite par son code commune INSEE (metadata lcog_geo, renseigne a 100 %) et non par un decoupage geometrique de la zone : 54 s -> moins d une seconde, et la somme des lignes EGALE le total. Ce qui double, c est le COMPTE DE SITES. Le type de risque est un FILTRE et non une dimension, un site portant plusieurs natures. La cible est validee contre cibles_exposition, seule barriere contre l injection par nom de champ.';

revoke all on function public.population_exposee_agregee(text, text, text[], text[], text[], integer, integer)
  from public, anon, authenticated;
grant execute on function public.population_exposee_agregee(text, text, text[], text[], text[], integer, integer)
  to service_role;

revoke all on function public.rayon_defaut_exposition() from public, anon, authenticated;
grant execute on function public.rayon_defaut_exposition() to service_role;
