-- ============================================================
-- Migration 20260401 — Radio FM/DAB+ data model
-- Tables, index, fonctions PostGIS, RLS, vue matérialisée
-- Réf : docs/plan-radio-geomatik.md — Phase 0
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Table radios — Référentiel des stations radio
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS radios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom TEXT NOT NULL,
  categorie_arcom TEXT CHECK (categorie_arcom IN ('A', 'B', 'C', 'D', 'E')),
  portee TEXT CHECK (portee IN ('nationale', 'regionale', 'locale', 'autoroute')),
  genre TEXT CHECK (genre IN ('generaliste', 'musicale', 'info_talk', 'culturelle', 'communautaire', 'autre')),
  groupe_media TEXT,
  logo_url TEXT,
  site_web TEXT,
  audience_data JSONB DEFAULT '{}'::jsonb,
  tarifs_data JSONB DEFAULT '{}'::jsonb,
  audience_updated_at TIMESTAMPTZ,
  tarifs_updated_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT radios_nom_unique UNIQUE (nom)
);

CREATE INDEX IF NOT EXISTS idx_radios_nom ON radios (nom);
CREATE INDEX IF NOT EXISTS idx_radios_categorie ON radios (categorie_arcom);
CREATE INDEX IF NOT EXISTS idx_radios_portee ON radios (portee);
CREATE INDEX IF NOT EXISTS idx_radios_genre ON radios (genre);
CREATE INDEX IF NOT EXISTS idx_radios_groupe ON radios (groupe_media);
CREATE INDEX IF NOT EXISTS idx_radios_audience ON radios USING GIN (audience_data);
CREATE INDEX IF NOT EXISTS idx_radios_tarifs ON radios USING GIN (tarifs_data);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_radios_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_radios_updated_at ON radios;
CREATE TRIGGER trg_radios_updated_at
  BEFORE UPDATE ON radios
  FOR EACH ROW EXECUTE FUNCTION update_radios_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. Table emetteurs_radio — État courant des émetteurs
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS emetteurs_radio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sta_nm_anfr TEXT UNIQUE NOT NULL,
  radio_id UUID REFERENCES radios(id) ON DELETE SET NULL,
  systeme TEXT NOT NULL CHECK (systeme IN ('FM', 'DAB+')),
  frequence_mhz NUMERIC,
  puissance_w NUMERIC,
  hauteur_m NUMERIC,
  exploitant TEXT,
  adresse TEXT,
  commune TEXT,
  departement TEXT,
  geom GEOMETRY(Point, 4326),
  rayon_couverture_m NUMERIC,
  snapshot_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emetteurs_geom ON emetteurs_radio USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_emetteurs_radio_id ON emetteurs_radio (radio_id);
CREATE INDEX IF NOT EXISTS idx_emetteurs_systeme ON emetteurs_radio (systeme);
CREATE INDEX IF NOT EXISTS idx_emetteurs_dept ON emetteurs_radio (departement);
CREATE INDEX IF NOT EXISTS idx_emetteurs_freq ON emetteurs_radio (frequence_mhz);
CREATE INDEX IF NOT EXISTS idx_emetteurs_snapshot ON emetteurs_radio (snapshot_date);
CREATE INDEX IF NOT EXISTS idx_emetteurs_systeme_dept ON emetteurs_radio (systeme, departement);

-- ────────────────────────────────────────────────────────────
-- 3. Table emetteurs_radio_archive — Historique 12 mois
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS emetteurs_radio_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sta_nm_anfr TEXT NOT NULL,
  radio_id UUID REFERENCES radios(id) ON DELETE SET NULL,
  systeme TEXT NOT NULL CHECK (systeme IN ('FM', 'DAB+')),
  frequence_mhz NUMERIC,
  puissance_w NUMERIC,
  hauteur_m NUMERIC,
  exploitant TEXT,
  adresse TEXT,
  commune TEXT,
  departement TEXT,
  geom GEOMETRY(Point, 4326),
  rayon_couverture_m NUMERIC,
  snapshot_date DATE NOT NULL,
  archived_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archive_snapshot ON emetteurs_radio_archive (snapshot_date);
CREATE INDEX IF NOT EXISTS idx_archive_archived ON emetteurs_radio_archive (archived_at);
CREATE INDEX IF NOT EXISTS idx_archive_sta ON emetteurs_radio_archive (sta_nm_anfr);

-- ────────────────────────────────────────────────────────────
-- 4. Table radio_imports_log — Journal des imports
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS radio_imports_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('anfr', 'arcom')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  stats JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  source_file TEXT,
  created_by UUID
);

-- ────────────────────────────────────────────────────────────
-- 5. Fonction estimate_radio_coverage
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION estimate_radio_coverage(
  puissance_w NUMERIC,
  hauteur_m NUMERIC DEFAULT 30
) RETURNS NUMERIC AS $$
BEGIN
  RETURN LEAST(
    4120 * (sqrt(COALESCE(hauteur_m, 30)) + sqrt(1.5)) * ln(GREATEST(COALESCE(puissance_w, 100), 1)) / ln(1000),
    150000
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ────────────────────────────────────────────────────────────
-- 6. Fonction get_radios_in_zone
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_radios_in_zone(
  zone_geom GEOMETRY,
  systeme_filter TEXT DEFAULT NULL
) RETURNS TABLE (
  radio_id UUID,
  radio_nom TEXT,
  categorie_arcom TEXT,
  portee TEXT,
  genre TEXT,
  groupe_media TEXT,
  nb_emetteurs BIGINT,
  audience_data JSONB,
  tarifs_data JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id, r.nom, r.categorie_arcom, r.portee, r.genre, r.groupe_media,
    COUNT(e.id) as nb_emetteurs, r.audience_data, r.tarifs_data
  FROM radios r
  JOIN emetteurs_radio e ON e.radio_id = r.id
  WHERE ST_DWithin(e.geom::geography, zone_geom::geography, e.rayon_couverture_m)
  AND (systeme_filter IS NULL OR e.systeme = systeme_filter)
  GROUP BY r.id, r.nom, r.categorie_arcom, r.portee, r.genre, r.groupe_media, r.audience_data, r.tarifs_data
  ORDER BY nb_emetteurs DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- ────────────────────────────────────────────────────────────
-- 7. Fonction archive_and_purge_radio
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION archive_and_purge_radio() RETURNS JSONB AS $$
DECLARE
  archived_count INTEGER;
  purged_count INTEGER;
BEGIN
  INSERT INTO emetteurs_radio_archive (
    sta_nm_anfr, radio_id, systeme, frequence_mhz, puissance_w,
    hauteur_m, exploitant, adresse, commune, departement,
    geom, rayon_couverture_m, snapshot_date
  )
  SELECT sta_nm_anfr, radio_id, systeme, frequence_mhz, puissance_w,
    hauteur_m, exploitant, adresse, commune, departement,
    geom, rayon_couverture_m, snapshot_date
  FROM emetteurs_radio;
  GET DIAGNOSTICS archived_count = ROW_COUNT;

  DELETE FROM emetteurs_radio_archive WHERE archived_at < now() - INTERVAL '12 months';
  GET DIAGNOSTICS purged_count = ROW_COUNT;

  RETURN jsonb_build_object('archived', archived_count, 'purged', purged_count, 'timestamp', now());
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────
-- 8. Fonction get_radio_stats
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_radio_stats() RETURNS JSONB AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_emetteurs', (SELECT COUNT(*) FROM emetteurs_radio),
    'emetteurs_fm', (SELECT COUNT(*) FROM emetteurs_radio WHERE systeme = 'FM'),
    'emetteurs_dab', (SELECT COUNT(*) FROM emetteurs_radio WHERE systeme = 'DAB+'),
    'total_radios', (SELECT COUNT(*) FROM radios),
    'emetteurs_matches', (SELECT COUNT(*) FROM emetteurs_radio WHERE radio_id IS NOT NULL),
    'emetteurs_orphelins', (SELECT COUNT(*) FROM emetteurs_radio WHERE radio_id IS NULL),
    'pct_matching', (
      SELECT ROUND(COUNT(*) FILTER (WHERE radio_id IS NOT NULL)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 1)
      FROM emetteurs_radio
    ),
    'par_categorie', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(categorie_arcom, 'inconnu'), cnt), '{}'::jsonb)
      FROM (SELECT categorie_arcom, COUNT(*) as cnt FROM radios GROUP BY categorie_arcom) sub
    ),
    'par_portee', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(portee, 'inconnu'), cnt), '{}'::jsonb)
      FROM (SELECT portee, COUNT(*) as cnt FROM radios GROUP BY portee) sub
    ),
    'par_genre', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(genre, 'inconnu'), cnt), '{}'::jsonb)
      FROM (SELECT genre, COUNT(*) as cnt FROM radios GROUP BY genre) sub
    ),
    'derniere_maj_anfr', (SELECT MAX(snapshot_date) FROM emetteurs_radio),
    'archives_count', (SELECT COUNT(*) FROM emetteurs_radio_archive)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ────────────────────────────────────────────────────────────
-- 9. Row Level Security
-- ────────────────────────────────────────────────────────────

ALTER TABLE radios ENABLE ROW LEVEL SECURITY;
ALTER TABLE emetteurs_radio ENABLE ROW LEVEL SECURITY;
ALTER TABLE emetteurs_radio_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE radio_imports_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "radios_read" ON radios FOR SELECT TO authenticated USING (true);
CREATE POLICY "emetteurs_read" ON emetteurs_radio FOR SELECT TO authenticated USING (true);
CREATE POLICY "archive_read" ON emetteurs_radio_archive FOR SELECT TO authenticated USING (true);
CREATE POLICY "imports_log_read" ON radio_imports_log FOR SELECT TO authenticated USING (true);

-- ────────────────────────────────────────────────────────────
-- 10. Vue matérialisée radio_couvertures_agg
-- ────────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS radio_couvertures_agg AS
SELECT
  r.id as radio_id, r.nom, r.categorie_arcom, r.portee, r.genre,
  COUNT(e.id) as nb_emetteurs,
  ST_Union(ST_Buffer(e.geom::geography, e.rayon_couverture_m)::geometry) as couverture_geom
FROM radios r
JOIN emetteurs_radio e ON e.radio_id = r.id
WHERE e.geom IS NOT NULL AND e.rayon_couverture_m IS NOT NULL
GROUP BY r.id, r.nom, r.categorie_arcom, r.portee, r.genre;

CREATE INDEX IF NOT EXISTS idx_radio_couvertures_geom ON radio_couvertures_agg USING GIST (couverture_geom);
