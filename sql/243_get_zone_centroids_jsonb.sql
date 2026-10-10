-- 243 — Météo au code postal : les 6 187 CP, plus 1 000 (2026-10-10)
--
-- ── Le défaut ────────────────────────────────────────────────────────────────
--
-- `/api/meteo-geo?scale=cp` lisait `get_zone_centroids('cp')`, une fonction
-- `RETURNS TABLE` : PostgREST la coupe sans erreur. En local (`max_rows` =
-- 1 000, supabase/config.toml) la route recevait 1 000 centroïdes sur 6 187 —
-- mesuré le 2026-10-10 par un appel PostgREST direct ; l'ancienne production
-- en rendait 5 000 (défaut A de docs/SUITE_TRONCATURE_POSTGREST.md). Les CP
-- perdus étaient la queue de la liste : toute la moitié sud, et les 136 codes
-- ultramarins.
--
-- Aggravant : la route filtrait ENSUITE par la bbox, en mémoire. Une vue sur
-- un CP de la queue ne trouvait aucune zone et retombait sur la France
-- entière — la météo d'un autre territoire, sans signe d'échec.
--
-- ── Le correctif ─────────────────────────────────────────────────────────────
--
-- Jumelle `get_zone_centroids_jsonb` (patron sql/154, 168-170) : elle porte le
-- corps, rend du `jsonb` (hors troncature PostgREST) et filtre la bbox EN BASE
-- par l'index GIST `idx_ref_codes_postaux_centroid` — en un passage. La bbox
-- ne s'applique qu'au palier CP (comme la route le faisait).
--
-- Borne : `p_limite` (route : 10 000), au-dessus du référentiel complet
-- (6 187 CP, 104 départements, 18 régions). On lit `p_limite + 1` lignes et
-- `tronque` le DIT : la route échoue alors plutôt que de peindre un début.
--
-- `get_zone_centroids(p_scale)` devient une ENVELOPPE MINCE de la jumelle :
-- un seul corps, deux formes de retour, dérive impossible. Plus aucun code de
-- l'application ne l'appelle.
--
-- Réservée à service_role (la route passe par `createAdminClient`).
-- Rejouable. Verrouillé par tests/integration/zone-centroids-jsonb.test.ts.

begin;

create or replace function public.get_zone_centroids_jsonb(
  p_scale text,
  p_ouest double precision default null,
  p_sud double precision default null,
  p_est double precision default null,
  p_nord double precision default null,
  p_limite integer default 10000
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_catalog'
as $fn$
declare
  resultat jsonb;
  avec_bbox boolean := p_ouest is not null and p_sud is not null
                       and p_est is not null and p_nord is not null;
begin
  if p_scale not in ('region', 'departement', 'cp') then
    raise exception 'Invalid scale: %. Expected region, departement, or cp.', p_scale;
  end if;

  -- EXECUTE … USING : plan sur mesure à chaque appel (bbox présente ou non),
  -- jamais le plan générique d'une fonction `language sql` (sql/241).
  execute $q$
    with zones as materialized (
      select r.code_region::text as code,
             r.nom_region::text as nom,
             coalesce(r.centroid_lat, st_y(st_centroid(r.geom)))::double precision as lat,
             coalesce(r.centroid_lon, st_x(st_centroid(r.geom)))::double precision as lon
      from ref_regions r
      where $1 = 'region'
        and ((r.centroid_lat is not null and r.centroid_lon is not null) or r.geom is not null)
      union all
      select d.code_dept::text,
             d.nom_dept::text,
             coalesce(d.centroid_lat, st_y(st_centroid(d.geom)))::double precision,
             coalesce(d.centroid_lon, st_x(st_centroid(d.geom)))::double precision
      from ref_departements d
      where $1 = 'departement'
        and ((d.centroid_lat is not null and d.centroid_lon is not null) or d.geom is not null)
      union all
      -- `centroid_lat` / `centroid_lon` sont NULL sur toute la table : seule la
      -- géométrie `centroid` porte l'information (sql/144, sql/160).
      select c.code_postal::text,
             c.nom_principal::text,
             coalesce(c.centroid_lat, st_y(c.centroid))::double precision,
             coalesce(c.centroid_lon, st_x(c.centroid))::double precision
      from ref_codes_postaux c
      where $1 = 'cp'
        and (c.centroid is not null or (c.centroid_lat is not null and c.centroid_lon is not null))
        and (not $6 or c.centroid && st_makeenvelope($2, $3, $4, $5, 4326))
      order by 1
      limit $7 + 1
    )
    select jsonb_build_object(
      'zones', coalesce(
        (select jsonb_agg(to_jsonb(z) order by z.code)
         from (select * from zones order by code limit $7) z),
        '[]'::jsonb),
      'tronque', (select count(*) from zones) > $7
    )
  $q$
  into resultat
  using p_scale, p_ouest, p_sud, p_est, p_nord, avec_bbox, p_limite;
  return resultat;
end;
$fn$;

revoke all on function public.get_zone_centroids_jsonb(text, double precision, double precision, double precision, double precision, integer) from public, anon, authenticated;
grant execute on function public.get_zone_centroids_jsonb(text, double precision, double precision, double precision, double precision, integer) to service_role;

-- Enveloppe mince : même signature, même forme de retour qu'en sql/160.
create or replace function public.get_zone_centroids(p_scale text)
returns table(code text, nom text, lat double precision, lon double precision)
language sql
stable
set search_path to 'public', 'pg_catalog'
as $fn$
  select z->>'code', z->>'nom', (z->>'lat')::double precision, (z->>'lon')::double precision
  from jsonb_array_elements(public.get_zone_centroids_jsonb(p_scale) -> 'zones') z;
$fn$;

notify pgrst, 'reload schema';

commit;
