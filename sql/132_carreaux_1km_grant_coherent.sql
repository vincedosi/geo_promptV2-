-- 132 — carreaux_1km : le GRANT contredisait la RLS (`MAINT-007`)
--
-- La table a ete creee le 2026-09-11 (sql/129) avec, en meme temps :
--   ENABLE ROW LEVEL SECURITY
--   aucune policy
--   GRANT SELECT ... TO authenticated, service_role
--
-- RLS active + zero policy = refus total, sauf pour les roles qui contournent
-- les RLS. Le role `authenticated` ne lisait donc AUCUNE ligne, malgre le GRANT.
-- Les deux se contredisent : le GRANT ment sur l'intention.
--
-- La verite du fonctionnement : seul `service_role` accede a cette table, via
-- `get_tile`, et c'est voulu — toutes les tuiles passent par createAdminClient.
--
-- Retirer le GRANT ne change RIEN au comportement observable (le role lisait
-- deja zero ligne) et rend l'intention lisible.
--
-- Constat sur du code ecrit le jour meme, dans cette session.

REVOKE SELECT ON public.carreaux_1km FROM authenticated;
REVOKE ALL ON public.carreaux_1km_bandes FROM authenticated;

COMMENT ON TABLE public.carreaux_1km IS
  'Agregation 1 km des carreaux Filosofi 200 m. Sommes brutes (densite calculee cote client). Sert les tuiles z9-z11 via get_tile. RLS active sans policy = acces service_role uniquement, deliberement.';
