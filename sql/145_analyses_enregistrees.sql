-- sql/145_analyses_enregistrees.sql
-- Une analyse lancee est un objet : nom, parametres, maillage, date, rejouable.
-- N'existait que pour le clustering (clustering_models / clustering_jobs) ; les
-- battles, voronois et isochrones ne laissaient aucune trace.
CREATE TABLE IF NOT EXISTS public.analyses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by   uuid NOT NULL,
  type         text NOT NULL CHECK (type IN ('clusters','score','battle','voronoi','correlation','elm')),
  nom          text NOT NULL,
  -- Parametres COMPLETS du lancement : c'est ce qui rend l'analyse rejouable.
  parametres   jsonb NOT NULL,
  -- Palier de maille ('200m','1km','2km','5km','20km','iris','commune','departement').
  maillage     text,
  -- Perimetre : le filtre ou la zone au moment du lancement.
  perimetre    jsonb,
  -- Resultat leger (resume, bornes, compteurs). Les gros volumes restent dans
  -- leurs tables dediees (poi_clusters...), referencees par `parametres`.
  resultat     jsonb,
  statut       text NOT NULL DEFAULT 'termine' CHECK (statut IN ('en_cours','termine','echec')),
  erreur       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analyses_org_date ON public.analyses (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_type     ON public.analyses (org_id, type);

-- RLS deny-all : toutes les routes passent par service_role, comme les rollups.
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;
