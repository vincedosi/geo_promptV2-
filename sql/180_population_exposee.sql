-- sql/180 — Population exposée par site à risque industriel
--
-- Chantier C de la feuille de route : « combien de personnes vivent dans le
-- périmètre de ce site ». C'est la finalité produit ; les points et les zones
-- n'étaient que ce qu'il fallait pour y arriver.
--
-- ── DEUX MODES, ET LE PREMIER N'EST PAS UNE APPROXIMATION ─────────────────
--
--   'pprt'   le site est couvert par un périmètre PPRT réel. La zone est la
--            SERVITUDE, publiée par l'État, opposable en urbanisme. Le
--            nombre rendu est celui d'un périmètre que personne n'a choisi.
--   'buffer' le site n'a pas de périmètre publié. On retombe sur des rayons
--            de 500 / 1 000 / 2 000 m, et `indicatif` vaut TRUE. Ce drapeau
--            n'est pas décoratif : il dit que le chiffre dépend d'un rayon
--            que NOUS avons choisi, et il doit remonter jusqu'à l'écran.
--
-- Le basculement suit EXACTEMENT la règle de `risques_industriels_carte`
-- (sql/179) : périmètre le plus proche à 500 m, et non inclusion stricte —
-- les coordonnées AIOT de Géorisques pointent parfois l'entrée du site ou le
-- centroïde communal, et l'inclusion stricte perdait 71 Seveso seuil haut
-- dont le PPRT est à 200 m. Une seule définition du rattachement, pas une
-- pour la carte et une pour le calcul.
--
-- ── POURQUOI PAS LE ZONAGE ROUGE / BLEU / GRIS ───────────────────────────
--
-- Parce qu'il n'est pas atteignable. Vérifié le 2026-09-18, une piste après
-- l'autre : la couche `PPRT_ZONE_RISQIND` de Géorisques n'existe qu'en WMS
-- (image, pas de géométrie) ; sa page de téléchargement national répond 403 ;
-- le motif d'URL `files.georisques.fr/ppr/pprx_<dept>.zip` est mort (404 sur
-- toutes ses variantes) ; le jeu national de data.gouv (BRGM) n'a qu'une
-- ressource WMS, dérivée de la MÊME source GPU que nos 664 périmètres ; les
-- WFS des DREAL publient les assiettes PM3, c'est-à-dire l'enveloppe qu'on a
-- déjà ; et le nom normalisé CNIG `N_ZONE_REG_PPRT` ne rend aucun résultat.
--
-- Donc `palier` vaut 'perimetre' en mode PPRT — l'enveloppe entière, un seul
-- niveau. Le jour où le zonage interne devient accessible, il s'ajoute comme
-- des paliers supplémentaires SANS changer ce modèle.
--
-- ── LES DEUX PIÈGES DE PROJECTION ────────────────────────────────────────
--
-- 1. Le BUFFER est construit sur `geography`, donc en mètres vrais qui suivent
--    la sphère. Le construire en 3857 (« métrique ») serait faux : à la
--    latitude de Marseille, un mètre de 3857 vaut environ 0,73 m réel — un
--    rayon « 500 m » en couvrirait 685. Même raison que `zone_rayon`
--    (sql/155) et `risques_industriels_carte` (sql/175). C'est EXACTEMENT le
--    cercle affiché à l'écran : une seule définition, pas une pour la carte
--    et une pour le calcul.
-- 2. L'INTERSECTION se fait en 3857, parce que c'est là que vit l'index GIST
--    de `carreaux_filosofi` (`idx_carreaux_filosofi_geom_3857`). On transforme
--    donc la zone UNE fois, au lieu de reprojeter 2,3 M de carreaux.
--
-- ── LE NOMBRE EST UNE ESTIMATION, ET LA FONCTION LE DIT ──────────────────
--
-- La population est répartie au prorata de la SURFACE de chaque carreau
-- intersecté : un carreau dont 30 % tombe dans la zone contribue 30 % de ses
-- habitants. C'est l'hypothèse d'une population uniforme dans le carreau —
-- fausse au détail, raisonnable en agrégat, et la seule possible sans palier
-- plus fin que 200 m. Le ratio est calculé en 3857 : la distorsion y est
-- identique au numérateur et au dénominateur à une même latitude, donc le
-- RATIO reste juste même si les surfaces absolues ne le sont pas.
--
-- ⚠ `carreaux_filosofi` NE COUVRE QUE LES CARREAUX HABITÉS (c'est la nature
--    du dispositif Filosofi). Un périmètre sans carreau n'est donc pas une
--    donnée manquante : c'est une zone sans habitant. Mesuré le 2026-09-18 :
--    250 des 664 périmètres sont dans ce cas — des emprises purement
--    industrielles ou portuaires.
--
-- ⚠ LA POPULATION EST DANS LE JSONB, PAS DANS LA COLONNE. `carreaux_filosofi`
--    porte une colonne `ind` qui est **NULL sur les 2 298 582 lignes** ; la
--    valeur vit dans `metadata->>'ind'`. Lire la colonne rendrait zéro
--    partout, sans erreur.
--
-- ── MESURES (prod, 2026-09-18) ───────────────────────────────────────────
--
--   un périmètre (Berre, 10,75 km²) : 299 ms, `shared hit=1367 read=242`,
--     Index Scan sur `idx_carreaux_filosofi_geom_3857`, 45 carreaux retenus
--   les 664 périmètres d'un coup : 173 819 habitants, 414 périmètres peuplés,
--     5 656 carreaux croisés
--   plus fort : Petit et Grand Quevilly (Rouen) 36 084 hab / 27,4 km² ;
--     puis Vallée de la Chimie (Lyon) 20 396 ; Fos-Est 8 918

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Cache des résultats
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.seveso_exposition (
  id            bigserial primary key,
  site_id       uuid        not null references public.poi_france(id) on delete cascade,
  mode          text        not null check (mode in ('pprt', 'buffer')),
  -- 'perimetre' en mode PPRT ; '500' / '1000' / '2000' en mode buffer.
  palier        text        not null,
  -- TRUE quand le chiffre dépend d'un rayon que NOUS avons choisi.
  indicatif     boolean     not null,
  pop_exposee   numeric     not null default 0,
  -- Population de la COURONNE seule (palier courant moins le précédent), en
  -- mode buffer. Égale à `pop_exposee` en mode PPRT, qui n'a qu'un palier.
  -- Stockée plutôt que dérivée à l'affichage : deux soustractions du même
  -- nombre à deux endroits finiraient par diverger.
  pop_couronne  numeric     not null default 0,
  nb_carreaux   integer     not null default 0,
  surface_km2   numeric,
  calcule_le    timestamptz not null default now(),
  unique (site_id, mode, palier)
);

create index if not exists idx_seveso_exposition_site on public.seveso_exposition(site_id);

alter table public.seveso_exposition enable row level security;

comment on table public.seveso_exposition is
  'Cache de la population exposee par site a risque industriel (sql/180). mode=pprt : la zone est la servitude PPRT publiee par l Etat. mode=buffer : rayons 500/1000/2000 m choisis par nous, indicatif=true. RLS deny-all, lue par les routes en service_role.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Le calcul, pour UN site
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.population_exposee_site(
  p_site_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  c_tolerance_m constant int   := 500;                 -- même règle que sql/179
  c_rayons      constant int[] := array[500, 1000, 2000];
  v_site        record;
  v_zone        geometry;
  v_km2         numeric;
  v_paliers     jsonb := '[]'::jsonb;
  v_pprt        record;
  v_pop         numeric;
  v_nb          int;
  v_precedent   numeric := 0;   -- cumul ARRONDI du palier précédent
  v_arrondi     numeric;
  v_r           int;
begin
  select p.id, p.nom, p.lng, p.lat, p.sous_categorie, p.geom
    into v_site
    from public.poi_france p
   where p.id = p_site_id and p.categorie = 'risque_industriel';

  if not found then
    return jsonb_build_object('error', 'site_introuvable', 'calculable', false);
  end if;
  if v_site.lng is null or v_site.lat is null then
    return jsonb_build_object('error', 'site_sans_coordonnees', 'calculable', false);
  end if;

  -- ── Le site a-t-il un périmètre PPRT ? ────────────────────────────────
  select z.id, z.nom, z.superficie_km2, z.geom_3857
    into v_pprt
    from public.pprt_perimetres z
   where ST_DWithin(z.geom::geography,
                    ST_SetSRID(ST_MakePoint(v_site.lng, v_site.lat), 4326)::geography,
                    c_tolerance_m)
   order by ST_Distance(z.geom::geography,
                        ST_SetSRID(ST_MakePoint(v_site.lng, v_site.lat), 4326)::geography)
   limit 1;

  if found then
    -- ── Mode PPRT : la zone est la servitude, telle quelle ──────────────
    select coalesce(sum( (c.metadata->>'ind')::numeric
                         * ST_Area(ST_Intersection(c.geom_3857, v_pprt.geom_3857))
                         / nullif(ST_Area(c.geom_3857), 0) ), 0),
           count(*)
      into v_pop, v_nb
      from public.carreaux_filosofi c
     where c.geom_3857 && v_pprt.geom_3857
       and ST_Intersects(c.geom_3857, v_pprt.geom_3857);

    return jsonb_build_object(
      'site_id',    v_site.id,
      'site_nom',   v_site.nom,
      'mode',       'pprt',
      'indicatif',  false,
      'calculable', true,
      'pprt_id',    v_pprt.id,
      'pprt_nom',   v_pprt.nom,
      'paliers',    jsonb_build_array(jsonb_build_object(
        'palier',       'perimetre',
        'libelle',      'Périmètre PPRT',
        'ordre',        1,
        'pop_exposee',  round(v_pop),
        'pop_couronne', round(v_pop),
        'nb_carreaux',  v_nb,
        'surface_km2',  round(v_pprt.superficie_km2::numeric, 3)
      )),
      'calcule_le', now()
    );
  end if;

  -- ── Mode buffer : aucun périmètre publié ────────────────────────────────
  foreach v_r in array c_rayons loop
    -- Buffer sur geography (mètres vrais), puis transformé UNE fois en 3857
    -- pour rencontrer l'index. `quad_segs=8` donne 32 sommets : au-delà, le
    -- coût monte sans que le résultat bouge.
    v_zone := ST_Transform(
      ST_Buffer(ST_SetSRID(ST_MakePoint(v_site.lng, v_site.lat), 4326)::geography,
                v_r, 'quad_segs=8')::geometry,
      3857);
    -- Surface vraie du disque, en km². Calculée et non mesurée sur la
    -- géométrie 3857 : `ST_Area` y rendrait une surface gonflée par la
    -- projection (facteur ~1/cos²(latitude)), soit près du double à Marseille.
    v_km2 := (pi() * v_r * v_r) / 1000000.0;

    select coalesce(sum( (c.metadata->>'ind')::numeric
                         * ST_Area(ST_Intersection(c.geom_3857, v_zone))
                         / nullif(ST_Area(c.geom_3857), 0) ), 0),
           count(*)
      into v_pop, v_nb
      from public.carreaux_filosofi c
     where c.geom_3857 && v_zone
       and ST_Intersects(c.geom_3857, v_zone);

    v_arrondi := round(v_pop);

    v_paliers := v_paliers || jsonb_build_object(
      'palier',       v_r::text,
      'libelle',      case when v_r < 1000 then v_r || ' m' else (v_r / 1000) || ' km' end,
      'ordre',        array_position(c_rayons, v_r),
      -- Le cumul est arrondi UNE fois, et la couronne se déduit des valeurs
      -- DÉJÀ ARRONDIES. Autrement la somme des couronnes ne retombe pas sur le
      -- cumul : mesuré avant correctif, 2 + 29 + 2 096 = 2 127 pour un cumul
      -- affiché à 2 126. Un écran qui montre les deux colonnes rend alors un
      -- tableau qui ne s'additionne pas, et c'est le lecteur qui doute de lui.
      'pop_exposee',  v_arrondi,
      'pop_couronne', greatest(v_arrondi - v_precedent, 0),
      'nb_carreaux',  v_nb,
      'surface_km2',  round(v_km2, 3)
    );
    v_precedent := v_arrondi;
  end loop;

  return jsonb_build_object(
    'site_id',    v_site.id,
    'site_nom',   v_site.nom,
    'mode',       'buffer',
    -- Le drapeau qui doit remonter jusqu'à l'écran : ces chiffres dépendent
    -- de rayons que nous avons choisis, pas d'une servitude.
    'indicatif',  true,
    'calculable', true,
    'pprt_id',    null,
    'pprt_nom',   null,
    'paliers',    v_paliers,
    'calcule_le', now()
  );
end;
$function$;

comment on function public.population_exposee_site(uuid) is
  'Population exposee d un site a risque industriel (sql/180). mode=pprt quand une servitude PPRT est a moins de 500 m (meme regle que sql/179) : la zone est alors celle de l Etat, indicatif=false. Sinon mode=buffer sur 500/1000/2000 m, indicatif=TRUE. Population au prorata de surface depuis carreaux_filosofi 200 m, lue dans metadata->>''ind'' (la colonne ind est NULL sur toutes les lignes). Buffer construit sur GEOGRAPHY puis transforme en 3857 ou vit l index GIST.';

revoke all on function public.population_exposee_site(uuid) from public, anon, authenticated;
grant execute on function public.population_exposee_site(uuid) to service_role;
