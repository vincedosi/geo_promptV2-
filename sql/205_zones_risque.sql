-- sql/205 — Les zones de risque d'un profil, en géométrie, et leurs tuiles
--           (2026-09-19)
--
-- Donne une forme à ce que `population_par_classe` (sql/204) compte : une
-- géométrie par classe, exclusives entre elles, avec la même priorité.
--
-- ── POURQUOI UN CACHE PAR PROFIL ──────────────────────────────────────────
--
-- Mesuré le 2026-09-19 : l'union des 676 tampons de 5 km autour des sites
-- Seveso seuil haut prend **164 ms** et rend 12 317 sommets. Un profil complet
-- en demande une dizaine, plus autant de différences — quelques secondes. C'est
-- peu pour une construction, beaucoup pour une tuile, et une carte en demande
-- des dizaines par panoramique.
--
-- La clé est le CODE du profil (`lib/risques/code-profil.ts`), réversible et
-- sans collision possible. Une empreinte au sens strict pourrait servir les
-- zones d'un profil sous la légende d'un autre, en silence — le défaut que
-- sql/196 a dû corriger sur `exposition_cache`.
--
-- ── LA PRIORITÉ, TRANSCRITE EN GÉOMÉTRIE ─────────────────────────────────
--
-- `classerCarreau` essaie le seuil haut, puis le seuil bas ; dans un niveau, le
-- périmètre PPRT prime sur la bande. La géométrie suit exactement :
--
--   1. bande i        = disque(r_i) − disque(r_{i−1})
--   2. bande i        = bande i − PPRT du même niveau
--   3. toute classe du seuil bas = classe − (disque(dernier r haut) ∪ PPRT haut)
--
-- L'empreinte totale du seuil haut, et non ses seules bandes : un carreau que
-- le seuil haut « retient » l'est aussi par son périmètre publié.
--
-- ── CE QUE LA ZONE DESSINÉE DIT, ET CE QU'ELLE NE DIT PAS ────────────────
--
-- Elle est CONTINUE ; le comptage, lui, porte sur des carreaux de 200 m
-- rattachés par leur CENTRE. Un carreau à cheval sur une limite est donc compté
-- entièrement d'un côté. C'est cohérent — la limite dessinée est exactement le
-- lieu où le centre bascule — mais il ne faut pas lire la surface colorée comme
-- une surface d'habitants proportionnelle.

create table if not exists public.zones_risque_cache (
  -- Le code du profil, réversible : devant une tuile qui n'affiche pas ce qu'on
  -- attend, `h1000.2000.5000_b500.1000_a_L0_P1` se lit, `a3f9c2e1` demande une
  -- requête.
  profil_code text not null,
  -- 'haut:pprt', 'haut:1', … — MÊME identifiant que `classe_carreau_risque`,
  -- pour que la légende, le tableau et la carte se rejoignent.
  classe      text not null,
  niveau      text not null,
  -- Numéro de bande, ou NULL pour un périmètre publié.
  bande       int,
  geom        geometry(MultiPolygon, 4326) not null,
  -- Pré-calculée : c'est en 3857 que vivent les index GIST des carreaux et que
  -- `ST_AsMVT` travaille. La reprojeter par tuile la paierait des dizaines de
  -- fois par panoramique.
  geom_3857   geometry(MultiPolygon, 3857) not null,
  surface_km2 numeric,
  construit_le timestamptz not null default now(),
  primary key (profil_code, classe)
);

comment on table public.zones_risque_cache is
  'Geometrie des classes d''un profil de rayons, exclusives entre elles et dans le meme '
  'ordre de priorite que classe_carreau_risque (sql/204). Cle = le CODE du profil, '
  'reversible : une empreinte pourrait servir les zones d''un profil sous la legende '
  'd''un autre, en silence.';

alter table public.zones_risque_cache enable row level security;
revoke all on table public.zones_risque_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.zones_risque_cache to service_role;

create index if not exists idx_zones_risque_geom
  on public.zones_risque_cache using gist (geom_3857);

-- ═══════════════════════════════════════════════════════════════════════════
-- CONSTRUCTION
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.construire_zones_risque(
  p_profil jsonb,
  p_code   text
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_haut     int[];
  v_bas      int[];
  v_lie      boolean;
  v_pprt     boolean;
  v_t0       timestamptz := clock_timestamp();
  v_n        int := 0;
  v_niveau   text;
  v_anneaux  int[];
  v_gravite  text;
  v_precedent geometry;   -- disque du rayon précédent, pour l'exclusivité
  v_courant  geometry;
  v_bande    geometry;
  v_pprt_niv geometry;
  v_haut_total geometry;  -- empreinte complète du seuil haut, pour la priorité
  i          int;
begin
  set local statement_timeout = '10min';
  -- L'union de milliers de sommets déborde vite le `work_mem` de ce palier.
  set local work_mem = '64MB';

  v_lie  := coalesce((p_profil->>'lie')::boolean, false);
  v_pprt := coalesce((p_profil->>'inclurePPRT')::boolean, true);

  select coalesce(array_agg(x::int order by x::int), '{}')
    into v_haut from jsonb_array_elements_text(coalesce(p_profil->'haut', '[]'::jsonb)) x;
  if v_lie then
    v_bas := v_haut;
  else
    select coalesce(array_agg(x::int order by x::int), '{}')
      into v_bas from jsonb_array_elements_text(coalesce(p_profil->'bas', '[]'::jsonb)) x;
  end if;

  delete from public.zones_risque_cache where profil_code = p_code;

  for v_niveau in select unnest(array['haut', 'bas']) loop
    v_anneaux := case v_niveau when 'haut' then v_haut else v_bas end;
    v_gravite := case v_niveau when 'haut' then 'seveso_haut' else 'seveso_bas' end;

    -- Un niveau sans anneau ne retient rien, pas même par son PPRT. MÊME ordre
    -- que `classerCarreau` : cette condition passe AVANT le périmètre publié.
    continue when coalesce(cardinality(v_anneaux), 0) = 0;

    -- Le périmètre publié du niveau, s'il est distingué.
    v_pprt_niv := null;
    if v_pprt then
      select ST_Union(pn.geom_3857) into v_pprt_niv
        from public.pprt_niveau_generateur pn
       where pn.niveau = v_niveau;
    end if;

    v_precedent := null;

    for i in 1 .. cardinality(v_anneaux) loop
      -- ⚠ `ST_Buffer` sur **geography** : le rayon est en mètres. En 4326,
      -- « 5 km » vaudrait 5 km en latitude et ~3,5 km en longitude à Marseille —
      -- une ellipse présentée comme un cercle. Même raison que `zone_rayon`
      -- (sql/155) et `risques_industriels_carte` (sql/175).
      select ST_Union(
               ST_Transform(
                 ST_Buffer(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                           v_anneaux[i])::geometry, 3857))
        into v_courant
        from public.poi_france p
       where p.categorie = 'risque_industriel'
         and p.sous_categorie = v_gravite
         and coalesce(p.metadata->>'etat_activite', '') is distinct from 'En fin d''exploitation'
         and p.lng is not null and p.lat is not null;

      continue when v_courant is null;

      -- Exclusivité : la bande est l'anneau, jamais le disque.
      v_bande := case when v_precedent is null then v_courant
                      else ST_Difference(v_courant, v_precedent) end;
      v_precedent := v_courant;

      -- Le périmètre publié prime sur la bande calculée du même niveau.
      if v_pprt_niv is not null then
        v_bande := ST_Difference(v_bande, v_pprt_niv);
      end if;

      -- Priorité de NIVEAU : le seuil haut l'emporte en entier.
      if v_niveau = 'bas' and v_haut_total is not null then
        v_bande := ST_Difference(v_bande, v_haut_total);
      end if;

      if v_bande is not null and not ST_IsEmpty(v_bande) then
        insert into public.zones_risque_cache
          (profil_code, classe, niveau, bande, geom, geom_3857, surface_km2)
        values (
          p_code, v_niveau || ':' || i, v_niveau, i,
          ST_Multi(ST_Transform(v_bande, 4326)),
          ST_Multi(v_bande),
          round((ST_Area(ST_Transform(v_bande, 4326)::geography) / 1e6)::numeric, 2))
        on conflict (profil_code, classe) do update
          set geom = excluded.geom, geom_3857 = excluded.geom_3857,
              surface_km2 = excluded.surface_km2, construit_le = now();
        v_n := v_n + 1;
      end if;
    end loop;

    -- Le périmètre publié, après les bandes : il doit lui aussi céder au seuil
    -- haut quand on traite le seuil bas.
    if v_pprt_niv is not null then
      v_bande := v_pprt_niv;
      if v_niveau = 'bas' and v_haut_total is not null then
        v_bande := ST_Difference(v_bande, v_haut_total);
      end if;
      if v_bande is not null and not ST_IsEmpty(v_bande) then
        insert into public.zones_risque_cache
          (profil_code, classe, niveau, bande, geom, geom_3857, surface_km2)
        values (
          p_code, v_niveau || ':pprt', v_niveau, null,
          ST_Multi(ST_Transform(v_bande, 4326)),
          ST_Multi(v_bande),
          round((ST_Area(ST_Transform(v_bande, 4326)::geography) / 1e6)::numeric, 2))
        on conflict (profil_code, classe) do update
          set geom = excluded.geom, geom_3857 = excluded.geom_3857,
              surface_km2 = excluded.surface_km2, construit_le = now();
        v_n := v_n + 1;
      end if;
    end if;

    -- L'empreinte COMPLÈTE du seuil haut : son dernier disque plus son
    -- périmètre publié. C'est elle que le seuil bas doit céder — pas seulement
    -- les bandes, car un carreau « retenu » par le seuil haut peut l'être par
    -- sa servitude au-delà du dernier anneau.
    if v_niveau = 'haut' then
      v_haut_total := coalesce(
        case when v_precedent is not null and v_pprt_niv is not null
               then ST_Union(v_precedent, v_pprt_niv)
             else coalesce(v_precedent, v_pprt_niv) end,
        null);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true, 'profil', p_code, 'classes', v_n,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

comment on function public.construire_zones_risque is
  'Construit la geometrie des classes d''un profil, exclusives et dans le MEME ordre de '
  'priorite que classe_carreau_risque : le seuil haut prime sur le seuil bas, le '
  'perimetre publie prime sur la bande calculee. ST_Buffer sur geography — le rayon est '
  'en metres, jamais en degres.';

revoke all on function public.construire_zones_risque(jsonb, text) from public, anon, authenticated;
grant execute on function public.construire_zones_risque(jsonb, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- TUILES MVT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ `ST_SimplifyPreserveTopology` et JAMAIS `ST_Simplify`, pour la raison
-- mesurée dans sql/178 sur les périmètres PPRT : `ST_Simplify` VIDE les petits
-- polygones, et une bande intérieure de 500 m en est un. La tolérance est
-- dérivée de la taille du pixel au zoom demandé, plafonnée pour ne jamais
-- effacer une zone entière.

create or replace function public.zones_risque_tuile(
  p_z int, p_x int, p_y int, p_profil_code text
) returns bytea
language plpgsql stable parallel safe security definer set search_path to 'public' as $fn$
declare
  v_env geometry;
  v_tol double precision;
  v_mvt bytea;
begin
  v_env := ST_TileEnvelope(p_z, p_x, p_y);
  -- Un pixel de tuile, en mètres 3857 : 4096 unités d'étendue MVT pour la
  -- largeur de la tuile. Simplifier plus finement que le pixel ne change rien à
  -- l'écran et coûte des sommets.
  v_tol := greatest((ST_XMax(v_env) - ST_XMin(v_env)) / 4096.0, 0.5);

  select ST_AsMVT(t, 'zones_risque', 4096, 'geom') into v_mvt
    from (
      select z.classe, z.niveau, z.bande, z.surface_km2,
             ST_AsMVTGeom(
               ST_SimplifyPreserveTopology(z.geom_3857, v_tol),
               v_env, 4096, 64, true) as geom
        from public.zones_risque_cache z
       where z.profil_code = p_profil_code
         and z.geom_3857 && v_env
    ) t
   where t.geom is not null;

  return coalesce(v_mvt, ''::bytea);
end;
$fn$;

comment on function public.zones_risque_tuile is
  'Tuile MVT des zones d''un profil. ST_SimplifyPreserveTopology et jamais ST_Simplify : '
  'ce dernier VIDE les petits polygones, et une bande interieure de 500 m en est un '
  '(meme mesure que sql/178 sur les perimetres PPRT).';

revoke all on function public.zones_risque_tuile(int, int, int, text) from public, anon, authenticated;
grant execute on function public.zones_risque_tuile(int, int, int, text) to service_role;

create or replace function public.vider_zones_risque(p_avant timestamptz default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  delete from public.zones_risque_cache
   where p_avant is null or construit_le < p_avant;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'supprimees', v_n);
end;
$$;

comment on function public.vider_zones_risque is
  'Vidange du cache de zones. A rejouer apres un import de sites ou de perimetres : la '
  'cle est le profil, elle ne voit pas changer les donnees sous elle.';

revoke all on function public.vider_zones_risque(timestamptz) from public, anon, authenticated;
grant execute on function public.vider_zones_risque(timestamptz) to service_role;
