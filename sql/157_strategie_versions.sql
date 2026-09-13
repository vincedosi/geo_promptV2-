-- ============================================================================
-- sql/157_strategie_versions.sql — une stratégie publiée est figée
-- (Tâche 19, 2026-09-13)
--
-- Le plan réservait `sql/148` à cette tâche ; 146 à 156 ont été pris depuis.
--
-- ── Le problème que cette table résout ────────────────────────────────────
--
-- Une stratégie publiée a envoyé ses enchères au DSP avec une liste de codes
-- postaux issue d'une zone, à un instant donné. Si cette zone est modifiée
-- ensuite — et le lot Zones vient d'ajouter CINQ façons de la modifier :
-- intersection, soustraction, import de CP, rayon, dessin — la campagne en vol
-- diffuse sur un périmètre qui n'est plus celui qu'affiche la carte.
--
-- **Rien ne le signalait.** L'empreinte `{ zone_id: updated_at }` prise à la
-- publication permet de dire « la zone X a changé depuis la v N », donc de
-- proposer une republication au lieu de laisser diverger en silence.
--
-- ── Deux décisions ────────────────────────────────────────────────────────
--
-- 1. `charge_utile` garde l'état COMPLET de la stratégie au moment de la
--    publication. Sans lui, comparer ou rejouer une version dépendrait de
--    l'état courant de `bidding_strategies` — c'est-à-dire de ce qui a pu
--    changer depuis, ce qui vide l'exercice de son sens.
--
-- 2. Le NUMÉRO DE VERSION est attribué en base, dans la même instruction que
--    l'insertion. Le calculer côté applicatif (`SELECT max(version)` puis
--    `INSERT version + 1`) ouvrirait une course entre deux publications
--    simultanées : la contrainte `UNIQUE` les ferait échouer, mais avec un
--    message illisible plutôt qu'un numéro correct.
--
-- `ON DELETE CASCADE` : l'historique d'une stratégie supprimée n'a plus
-- d'objet, et le garder laisserait des lignes orphelines qu'aucun code ne
-- saurait plus rattacher.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.strategie_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategie_id    uuid NOT NULL REFERENCES public.bidding_strategies(id) ON DELETE CASCADE,
  version         integer NOT NULL,
  publiee_le      timestamptz NOT NULL DEFAULT now(),
  publiee_par     uuid NOT NULL,
  /** { zone_id: updated_at } au moment de la publication. */
  empreinte_zones jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** État complet de la stratégie publiée — indépendant de son état courant. */
  charge_utile    jsonb NOT NULL,
  UNIQUE (strategie_id, version)
);

COMMENT ON TABLE public.strategie_versions IS
  'Une strategie publiee est FIGEE : les encheres sont parties au DSP avec une liste de codes postaux issue de zones, a un instant donne. empreinte_zones garde { zone_id: updated_at } au moment de la publication, ce qui permet de dire « la zone X a change depuis la v N » — sans quoi une campagne diffuse sur un perimetre qui n est plus celui qu affiche la carte, et personne ne le voit. Tache 19, sql/157.';

COMMENT ON COLUMN public.strategie_versions.charge_utile IS
  'Etat complet de la strategie au moment de la publication : de quoi rejouer ou comparer, sans dependre de l etat courant de bidding_strategies.';

CREATE INDEX IF NOT EXISTS idx_strategie_versions_strat
  ON public.strategie_versions (strategie_id, version DESC);

-- Deny-all : les routes passent en service_role, comme les autres tables de
-- service du projet.
ALTER TABLE public.strategie_versions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.publier_strategie(
  p_strategie_id uuid,
  p_publiee_par  uuid,
  p_empreinte    jsonb,
  p_charge_utile jsonb
) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
  INSERT INTO public.strategie_versions
    (strategie_id, version, publiee_par, empreinte_zones, charge_utile)
  SELECT p_strategie_id,
         COALESCE((SELECT max(version) FROM public.strategie_versions
                    WHERE strategie_id = p_strategie_id), 0) + 1,
         p_publiee_par, p_empreinte, p_charge_utile
  RETURNING jsonb_build_object(
    'id', id, 'version', version, 'publiee_le', publiee_le,
    'n_zones', (SELECT count(*) FROM jsonb_object_keys(empreinte_zones))
  );
$fn$;

COMMENT ON FUNCTION public.publier_strategie(uuid, uuid, jsonb, jsonb) IS
  'Publie une version de strategie. Le numero est attribue EN BASE dans la meme instruction que l insertion : le calculer cote applicatif ouvrirait une course entre deux publications simultanees. Tache 19, sql/157.';

REVOKE ALL ON FUNCTION public.publier_strategie(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publier_strategie(uuid, uuid, jsonb, jsonb) TO service_role;
