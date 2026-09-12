-- sql/141 — Restauration des tables du clustering POI (k-means POI x Filosofi).
-- Applique le 2026-09-12 (MCP Supabase). Rejouable.
--
-- CONTEXTE. La feature a ete supprimee le 2026-07-05 (commit 9213439, merge
-- c14fe9f) avec quatre autres sous-systemes « etudes » juges obsoletes face a
-- la boucle de pilotage MAGELIAN, et les tables droppees dans la foulee.
-- Vincent la redemande le 2026-09-12. On restaure d'abord en local, pour juger
-- de ce qu'elle produit sur les donnees d'aujourd'hui avant tout portage.
--
-- ── LA LECON DE CETTE MIGRATION ────────────────────────────────────────────
--
-- Les definitions viennent de sql/046, sql/050 et sql/055. Elles etaient
-- INCOMPLETES : quatre colonnes vivaient en base sans avoir jamais figure dans
-- une migration, posees a la main a l'epoque. Le drop les a donc emportees sans
-- laisser de trace reconstructible, et chacune s'est rappelee a nous par un
-- canal different :
--
--   `clustering_models.analysis`          revelee par le type-checker
--   `clustering_models.feature_themes`    revelee par un 500 au navigateur
--   `poi_clusters.imputed_features`       trouvee en lisant ce que le script ECRIT
--   `poi_cluster_history.duration_minutes`
--   `poi_cluster_history.mode`            revelees au bout de la chaine, APRES
--                                         qu'un clustering complet ait tourne
--
-- Une colonne posee hors migration n'existe que tant que la table vit. C'est
-- exactement ce que la regle « SQL uniquement via MCP, migrations versionnees »
-- de CLAUDE.md sert a eviter.
--
-- ── DEUX ECARTS ASSUMES par rapport aux migrations d'origine ───────────────
--
--   1. RLS deny-all sur les quatre tables, et non une policy « service_role »
--      sur clustering_jobs. C'est la convention des tables recentes
--      (campaign_*_rollup, campaign_dsp_report) : les routes passent par
--      createAdminClient(), qui contourne RLS de toute facon, et une policy qui
--      NOMME service_role laisse croire a une protection qui n'existe pas.
--      Voir ARCHITECTURE.md, section « RLS — DORMANTES ».
--
--   2. `poi_clusters.poi_id` reference `poi_france(id)` : c'est la table reelle,
--      il n'existe AUCUNE table `poi` (ARCHITECTURE.md, 2026-09-11).
--
-- Ce que la restauration NE ramene PAS : les donnees. Aucun modele n'a ete
-- sauvegarde avant le drop. Il faut relancer un calcul pour voir des clusters.
--
-- VALIDATION (2026-09-12) : un full-retrain sur 96 CIRFA a 15 min voiture,
-- entierement servi par le cache d'isochrones (aucun appel ORS), a produit
-- 7 clusters, silhouette 0,3248, 95 POI classes et 95 lignes d'historique.

-- ── Modeles persistes (StandardScaler + PCA + KMeans) ──────────────────────
CREATE TABLE IF NOT EXISTS public.clustering_models (
  id                   SERIAL PRIMARY KEY,
  version              INTEGER UNIQUE NOT NULL,
  k                    INTEGER NOT NULL,
  silhouette_score     NUMERIC,
  n_pca_components     INTEGER,
  variance_explained   NUMERIC,
  feature_names        JSONB NOT NULL,
  feature_themes       JSONB DEFAULT NULL,
  scaler_mean          JSONB NOT NULL,
  scaler_scale         JSONB NOT NULL,
  pca_components       JSONB NOT NULL,
  pca_mean             JSONB NOT NULL,
  centroids            JSONB NOT NULL,
  cluster_labels       JSONB NOT NULL,
  cluster_avg_profiles JSONB NOT NULL,
  n_poi_trained        INTEGER,
  duration_minutes     INTEGER NOT NULL DEFAULT 60,
  mode                 TEXT    NOT NULL DEFAULT 'drive',
  cluster_mapping_from_previous JSONB DEFAULT NULL,
  analysis             JSONB DEFAULT NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.clustering_models IS
  'Modeles KMeans persistes pour le clustering POI par profil Filosofi. Le modele est stocke assez completement (scaler + pca + centroides) pour rejouer une prediction avec numpy seul, sans sklearn.';
COMMENT ON COLUMN public.clustering_models.analysis IS
  'Analyse redigee par Gemini (schema : lib/clustering/types.ts#GeminiAnalysis).';
COMMENT ON COLUMN public.clustering_models.feature_themes IS
  'Themes des variables du modele (lib/clustering/feature-themes.ts).';

-- ── Clusters par POI ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.poi_clusters (
  id                         SERIAL PRIMARY KEY,
  poi_id                     UUID NOT NULL REFERENCES public.poi_france(id) ON DELETE CASCADE,
  cluster_id                 INTEGER NOT NULL,
  cluster_label              TEXT,
  pca_components             JSONB,
  profile_features           JSONB,
  cluster_avg_profile        JSONB,
  imputed_features           JSONB DEFAULT NULL,
  n_carreaux_intersected     INTEGER,
  population_totale_couverte NUMERIC,
  model_version              INTEGER NOT NULL DEFAULT 1,
  duration_minutes           INTEGER NOT NULL DEFAULT 60,
  mode                       TEXT    NOT NULL DEFAULT 'drive',
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (poi_id, duration_minutes, mode)
);

COMMENT ON TABLE public.poi_clusters IS
  'Resultats du clustering POI Filosofi — un enregistrement par POI x duree x mode.';
COMMENT ON COLUMN public.poi_clusters.imputed_features IS
  'Variables imputees pour ce POI (donnee Filosofi absente dans son isochrone). Une valeur imputee n''est pas une valeur mesuree : l''UI la signale.';

CREATE INDEX IF NOT EXISTS idx_poi_clusters_poi_id        ON public.poi_clusters(poi_id);
CREATE INDEX IF NOT EXISTS idx_poi_clusters_cluster_id    ON public.poi_clusters(cluster_id);
CREATE INDEX IF NOT EXISTS idx_poi_clusters_model_version ON public.poi_clusters(model_version);
CREATE INDEX IF NOT EXISTS idx_poi_clusters_duration      ON public.poi_clusters(duration_minutes, mode);

CREATE OR REPLACE FUNCTION public.fn_poi_clusters_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_poi_clusters_updated_at ON public.poi_clusters;
CREATE TRIGGER trg_poi_clusters_updated_at
  BEFORE UPDATE ON public.poi_clusters
  FOR EACH ROW EXECUTE FUNCTION public.fn_poi_clusters_updated_at();

-- ── Historique des assignations ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.poi_cluster_history (
  id                   SERIAL PRIMARY KEY,
  poi_id               UUID NOT NULL,
  cluster_id           INTEGER NOT NULL,
  cluster_label        TEXT,
  model_version        INTEGER NOT NULL,
  profile_features     JSONB,
  pca_components       JSONB,
  distance_to_centroid NUMERIC,
  action               TEXT NOT NULL,
  previous_cluster_id  INTEGER,
  changed              BOOLEAN DEFAULT FALSE,
  duration_minutes     INTEGER,
  mode                 TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cluster_history_poi     ON public.poi_cluster_history(poi_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cluster_history_version ON public.poi_cluster_history(model_version);

COMMENT ON TABLE public.poi_cluster_history IS
  'Historique des assignations de cluster par POI. `previous_cluster_id` est exprime dans le numbering de l''ANCIEN modele, NULL a la premiere assignation.';
COMMENT ON COLUMN public.poi_cluster_history.duration_minutes IS
  'Duree d''isochrone de cette assignation. Meme granularite que la contrainte UNIQUE de poi_clusters.';

-- ── Jobs declenches depuis l'UI ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clustering_jobs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','running','done','failed')),
  poi_types   TEXT[]      NOT NULL,
  geo_filter  JSONB,
  params      JSONB,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  log_tail    TEXT,
  error       TEXT,
  result_meta JSONB
);

CREATE INDEX IF NOT EXISTS clustering_jobs_status_idx ON public.clustering_jobs (status, started_at DESC);

COMMENT ON TABLE public.clustering_jobs IS
  'Suivi des jobs de clustering lances depuis l''UI. status: pending -> running -> done | failed.';

-- ── RLS deny-all sur les quatre tables ─────────────────────────────────────
-- Aucune policy : les routes passent par createAdminClient() (service_role),
-- qui contourne RLS. Une policy nommant service_role serait decorative.
ALTER TABLE public.clustering_models    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poi_clusters         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poi_cluster_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clustering_jobs      ENABLE ROW LEVEL SECURITY;
