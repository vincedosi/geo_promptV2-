-- sql/200 — Le pré-calcul de couverture par rayon savait ignorer l'outre-mer
-- ============================================================================
--
-- `construire_couverture_rayon` (sql/198) découpe la France en bandes de
-- longitude entre DEUX CONSTANTES, `-5.5` et `9.8` : la bbox métropole de
-- `CLAUDE.md`. Aucun carreau ni aucun site hors de cet intervalle n'est donc
-- jamais traité.
--
-- Mesuré le 2026-09-18 sur la base locale :
--
--     sites ICPE dans  [-5.5, 9.8]   97 454   dont 1 282 Seveso
--     sites ICPE HORS  [-5.5, 9.8]    1 698   dont    45 Seveso
--
-- Ces 45 Seveso d'outre-mer n'apparaissaient sur AUCUNE courbe de l'onglet
-- « Rayon d'influence », et rien ne le disait : la courbe ne montre pas les
-- sites, elle montre une population, et une population manquante ressemble
-- exactement à une population nulle.
--
-- ── CE QUE CETTE MIGRATION FAIT, ET CE QU'ELLE NE FAIT PAS ──────────────────
--
-- Elle rend les deux bornes PARAMÉTRABLES, avec les valeurs métropolitaines
-- par défaut : tout appel existant est inchangé, à la virgule. Une zone
-- d'outre-mer se construit par des appels supplémentaires portant ses propres
-- bornes et leur propre clé de journal (convention : >= 1000), par exemple :
--
--     select construire_couverture_rayon(
--       p_bande => 0, p_n_bandes => 1, p_rayon_max_m => 10000,
--       p_lon_ouest => -61.5, p_lon_est => -60.6, p_bande_id => 1000);
--
-- Elle ne partitionne PAS automatiquement selon l'étendue des données. Un
-- découpage uniforme de -61,8 à 55,8 mettrait la France entière dans une ou
-- deux bandes de 1° — exactement les bandes trop denses qui dépassaient déjà le
-- délai d'expiration. L'outre-mer n'est pas un prolongement de la métropole,
-- c'est un autre paquet de zones, très loin, très petites : il mérite ses
-- propres bornes, pas une règle qui prétendrait couvrir les deux.
--
-- ⚠ LIMITE QUI RESTE, ET QUI N'EST PAS DE NOTRE FAIT : `carreaux_filosofi` ne
-- porte de population que pour la métropole, la Martinique et La Réunion — ce
-- sont les trois seules zones publiées dans le carroyage Filosofi 2021 à 200 m.
-- La Guadeloupe, la Guyane et Mayotte n'ont AUCUN carreau, donc une population
-- exposée nulle. C'est une donnée absente, pas un zéro : à dire à l'écran, pas
-- à compenser.
--
-- ── POURQUOI UN DROP ET NON UN CREATE OR REPLACE ────────────────────────────
--
-- Ajouter deux paramètres à valeur par défaut CRÉE UNE SURCHARGE : les deux
-- signatures coexistent, et tout appel nommé devient ambigu (« function is not
-- unique »). Même leçon que sql/191. Le DROP et le CREATE sont dans la même
-- migration, donc la même transaction : la fonction n'est jamais absente.

drop function if exists public.construire_couverture_rayon(int, int, int);

create function public.construire_couverture_rayon(
  p_bande       int,
  p_n_bandes    int default 20,
  p_rayon_max_m int default 10000,
  p_lon_ouest   numeric default -5.5,
  p_lon_est     numeric default 9.8,
  -- `p_bande` a DEUX rôles dans sql/198 : l'index du découpage (il doit valoir
  -- 0..p_n_bandes-1) et la clé du journal (elle doit être unique). Tant qu'il
  -- n'existait qu'un seul découpage, les deux coïncidaient. Une zone d'outre-mer
  -- traitée en UNE bande a forcément l'index 0 — donc la clé 0, déjà prise par
  -- la première bande de métropole, qu'elle écraserait. Les deux rôles sont
  -- donc séparés : par défaut la clé reste l'index, à l'identique.
  p_bande_id    int default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  -- Les bornes du découpage étaient DEUX CONSTANTES `-5.5 / 9.8` — la bbox
  -- métropole de CLAUDE.md. Elles sont devenues des paramètres, de mêmes
  -- valeurs par défaut : tout appel existant se comporte à l'identique.
  c_ouest constant numeric := p_lon_ouest;
  c_est   constant numeric := p_lon_est;
  v_lon_min numeric;
  v_lon_max numeric;
  v_t0      timestamptz := clock_timestamp();
  v_x_min   double precision;
  v_x_max   double precision;
  v_cibles  text[];
  v_lignes  bigint;
  v_bande_id int := coalesce(p_bande_id, p_bande);
begin
  -- ⚠ `work_mem` vaut 3,4 Mo sur ce compute Micro (mesuré le 2026-09-18). Le
  -- `grouping sets` sur des centaines de milliers de lignes déborde donc
  -- massivement sur disque : les bandes denses passaient leur temps en
  -- `BuffileRead`, 33 s puis 48, 95, 87, et la suivante ne rendait plus la main.
  --
  -- `set local` ne vaut QUE pour la transaction de cette fonction : la valeur
  -- revient seule ensuite, et aucune autre requête de l'application n'est
  -- affectée. 64 Mo sur ~1 Go de RAM est tenable pour un traitement qui tourne
  -- une fois par import, jamais en réponse à un utilisateur.
  set local work_mem = '64MB';

  -- ⚠ ET LE DÉLAI D'EXPIRATION. Le rôle de PostgREST porte un
  -- `statement_timeout` de **2 min** (mesuré le 2026-09-18). Les bandes denses
  -- étaient donc ANNULÉES, pas lentes — « canceling statement due to statement
  -- timeout ». Le script les comptait en échec et passait à la suivante, ce qui
  -- donnait l'illusion d'un traitement figé à 12 bandes sur 40 alors qu'il
  -- échouait en boucle.
  --
  -- Piège de diagnostic à retenir : la sortie du script partait dans un `tail`
  -- qui la retenait jusqu'à la fin. Le message d'erreur EXISTAIT depuis le
  -- début et n'était simplement pas lisible. Une demi-heure passée à soupçonner
  -- la lenteur d'une requête qui, elle, allait très bien.
  --
  -- Comme pour `work_mem`, `set local` ne vaut que pour la transaction de cette
  -- fonction : aucune requête de l'application ne perd sa protection.
  set local statement_timeout = '30min';

  if p_bande < 0 or p_bande >= p_n_bandes then
    return jsonb_build_object('error', 'bande_hors_bornes', 'ok', false);
  end if;

  v_lon_min := c_ouest + (c_est - c_ouest) * p_bande     / p_n_bandes;
  v_lon_max := c_ouest + (c_est - c_ouest) * (p_bande+1) / p_n_bandes;

  -- Les bornes de bande converties UNE fois en 3857, projection dans laquelle
  -- `carreaux_filosofi` est stockée. Filtrer en 4326 obligeait à transformer le
  -- centroïde de CHAQUE carreau juste pour le comparer — deux ST_Transform par
  -- ligne, sur des centaines de milliers de lignes, pour une comparaison de
  -- nombres. La transformation est monotone en longitude : comparer en 3857
  -- donne exactement le même découpage.
  v_x_min := ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(v_lon_min, 0), 4326), 3857));
  v_x_max := ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(v_lon_max, 0), 4326), 3857));

  -- Les cibles viennent du CATALOGUE, jamais d'une liste écrite ici : le
  -- sélecteur de l'écran lit la même table, les deux ne peuvent pas diverger.
  select array_agg(code order by code) into v_cibles
    from public.cibles_exposition where actif;

  -- Idempotence : on efface ce que cette bande avait écrit avant de réécrire.
  -- La bande est identifiée par ses carreaux, donc on ne peut pas cibler par
  -- département — on supprime les lignes des départements que la bande touche,
  -- ce qui serait faux. On procède donc par UPSERT additif, et la purge
  -- éventuelle passe par `vider_couverture_rayon()`.

  with
  sites as (
    select p.id,
           p.sous_categorie as gravite,
           coalesce(nullif(p.metadata->>'libelle_nature', ''), 'Nature non précisée') as nature,
           ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography as g,
           ST_Transform(
             ST_Buffer(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                       p_rayon_max_m, 'quad_segs=4')::geometry, 3857) as z
      from public.poi_france p
     where p.categorie = 'risque_industriel'
       and p.sous_categorie in ('seveso_haut', 'seveso_bas')
       and coalesce(p.metadata->>'etat_activite', '') is distinct from 'En fin d''exploitation'
       and p.lng is not null and p.lat is not null
       -- ⚠ LES SITES AUSSI SONT FILTRÉS PAR LA BANDE, et c'est ce qui rend la
       -- construction faisable. Sans ce prédicat, chaque bande parcourait les
       -- 1 258 sites de France pour n'en utiliser qu'une poignée : la première
       -- bande lancée en production a dépassé le délai et sa transaction a été
       -- annulée, sans rien écrire.
       --
       -- La marge de 0,15° vaut environ 11 km à nos latitudes, donc plus que le
       -- rayon maximal de 10 km : un site juste au-delà du bord ne peut pas
       -- avoir de carreau de la bande dans son tampon. Élargir la marge ne
       -- changerait rien au résultat, seulement au temps.
       and p.lng >= v_lon_min - 0.15
       and p.lng <  v_lon_max + 0.15
  ),
  -- Les carreaux de la bande, avec leur centroïde en geography (mètres réels)
  -- et leur département déduit du code commune INSEE. ⚠ `lcog_geo` est une
  -- LISTE dès que le carreau est à cheval : on retient le premier code, comme
  -- partout ailleurs dans ce module (sql/194).
  paires as (
    select c.id   as carreau,
           -- ⚠ PAS de `metadata` ici. Le jsonb des carreaux pèse ~806 octets ;
           -- le traîner jusque dans les clés de `group by` obligeait Postgres à
           -- le hacher pour CHAQUE groupe, à chacun des quatre niveaux
           -- d'agrégation. Mesuré : 54,5 s pour une bande bretonne éparse en
           -- production. On ne garde donc que l'identifiant, et on rejoint la
           -- table par sa clé primaire au tout dernier moment.
           case when left(split_part(c.metadata->>'lcog_geo', ',', 1), 2) = '97'
                then left(split_part(c.metadata->>'lcog_geo', ',', 1), 3)
                else left(split_part(c.metadata->>'lcog_geo', ',', 1), 2) end as dep,
           s.gravite,
           s.nature,
           ST_Distance(ST_Transform(ST_Centroid(c.geom_3857), 4326)::geography, s.g) as d
      from sites s
      join public.carreaux_filosofi c
        on c.geom_3857 && s.z
       and ST_Intersects(c.geom_3857, s.z)
     -- Bande en 3857, aucune transformation par ligne. Un carreau de 200 m ne
     -- chevauche jamais deux bandes ; s'il le faisait il serait attribué à
     -- celle de son bord ouest, donc à UNE seule.
     where ST_XMin(c.geom_3857) >= v_x_min
       and ST_XMin(c.geom_3857) <  v_x_max
  ),
  -- Minimum par carreau ET par couple (gravité, nature) : c'est CE minimum qui
  -- interdit le double comptage entre deux sites de même nature.
  min_combo as (
    select carreau, dep, gravite, nature, min(d) as d
      from paires
     where d <= p_rayon_max_m
     group by carreau, dep, gravite, nature
  ),
  -- Les quatre niveaux d'agrégation en UN passage : par couple, par gravité
  -- seule, par nature seule, et global. Le niveau global vient du MINIMUM par
  -- carreau, jamais d'une somme — c'est ce qui évite le double comptage entre
  -- natures.
  niveaux as (
    select carreau, dep,
           coalesce(gravite, '*') as gravite,
           coalesce(nature,  '*') as nature,
           min(d) as d
      from min_combo
     group by grouping sets (
       (carreau, dep, gravite, nature),
       (carreau, dep, gravite),
       (carreau, dep, nature),
       (carreau, dep)
     )
  ),
  seaux as (
    select carreau, dep, gravite, nature,
           -- Palier de 100 m. `floor` garde le palier 0 pour tout ce qui est à
           -- moins de 100 m, ce qui se lit mieux qu'un découpage décalé.
           least(floor(d / 100)::int * 100, p_rayon_max_m) as rayon_m
      from niveaux
  ),
  -- La population n'est lue QU'ICI, par jointure sur la clé primaire des
  -- carreaux, et une seule fois par (carreau × niveau × cible).
  -- ⚠ LES CIBLES SONT EXTRAITES UNE FOIS PAR CARREAU, pas une fois par
  -- (carreau × niveau). `grouping sets` produit QUATRE niveaux par carreau ;
  -- extraire les 24 cibles à chaque niveau faisait 96 lectures jsonb par
  -- carreau au lieu de 24. En Île-de-France, même un tiers de bande dépassait
  -- les 2 min de `statement_timeout`.
  --
  -- Le résultat est identique : la somme d'une valeur constante par carreau ne
  -- dépend pas du nombre de fois qu'on l'a lue.
  valeurs as (
    select u.carreau, k.code as cible,
           coalesce((c.metadata->>k.code)::numeric, 0) as v
      from (select distinct carreau from seaux) u
      join public.carreaux_filosofi c on c.id = u.carreau
      cross join unnest(v_cibles) as k(code)
  ),
  detail as (
    select s.dep, s.gravite, s.nature, s.rayon_m, v.cible,
           sum(v.v) as somme
      from seaux s
      join valeurs v on v.carreau = s.carreau
     where s.dep is not null and s.dep <> ''
     group by s.dep, s.gravite, s.nature, s.rayon_m, v.cible
  ),
  pop as (
    select dep, gravite, nature, rayon_m, jsonb_object_agg(cible, somme) as populations
      from detail
     group by dep, gravite, nature, rayon_m
  ),
  compte as (
    select dep, gravite, nature, rayon_m, count(*)::int as n
      from seaux
     where dep is not null and dep <> ''
     group by dep, gravite, nature, rayon_m
  )
  insert into public.couverture_rayon_risque as t
        (code_departement, gravite, nature, rayon_m, n_carreaux, populations)
  select c.dep, c.gravite, c.nature, c.rayon_m, c.n, p.populations
    from compte c
    join pop p
      on p.dep = c.dep and p.gravite = c.gravite
     and p.nature = c.nature and p.rayon_m = c.rayon_m
  on conflict (code_departement, gravite, nature, rayon_m) do update
     set n_carreaux  = t.n_carreaux + excluded.n_carreaux,
         populations = (
           select jsonb_object_agg(k, coalesce((t.populations->>k)::numeric, 0)
                                    + coalesce((excluded.populations->>k)::numeric, 0))
             -- ⚠ `unnest(v_cibles)` et NON `jsonb_object_keys(a || b)`.
             -- Cette concaténation construisait un jsonb complet POUR CHAQUE
             -- LIGNE en conflit, juste pour en énumérer les clés — et les
             -- départements denses, déjà écrits par les bandes précédentes,
             -- sont presque tous en conflit. C'était LE goulet : une bande
             -- d'Île-de-France passait de « dépasse 2 min » à 26 s.
             --
             -- Les deux côtés portent les mêmes clés, celles du catalogue.
             from unnest(v_cibles) k
         );

  get diagnostics v_lignes = row_count;

  insert into public.couverture_rayon_bandes (bande, lon_min, lon_max, n_lignes, duree_ms)
  values (v_bande_id, v_lon_min, v_lon_max, v_lignes,
          round(extract(epoch from (clock_timestamp() - v_t0)) * 1000)::int)
  on conflict (bande) do update
     set lon_min = excluded.lon_min, lon_max = excluded.lon_max,
         n_lignes = excluded.n_lignes,
         duree_ms = excluded.duree_ms, construit_le = now();

  return jsonb_build_object(
    'ok', true, 'bande', v_bande_id, 'lon_min', v_lon_min, 'lon_max', v_lon_max,
    'lignes', v_lignes,
    'duree_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));
end;
$fn$;

revoke all on function public.construire_couverture_rayon(int, int, int, numeric, numeric, int)
  from public, anon, authenticated;
grant execute on function public.construire_couverture_rayon(int, int, int, numeric, numeric, int)
  to service_role;

comment on function public.construire_couverture_rayon(int, int, int, numeric, numeric, int) is
  'Construit une bande de couverture_rayon_risque. Bornes de longitude '
  'paramétrables (défaut : bbox métropole -5.5/9.8) — sql/200. '
  'L''outre-mer se construit par des appels séparés, numéros de bande >= 1000. '
  'Insertion ADDITIVE : rejouer une bande sans purge doublerait ses chiffres.';
