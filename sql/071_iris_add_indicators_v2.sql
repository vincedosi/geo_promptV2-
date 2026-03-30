-- Migration 071 — Nouveaux indicateurs dérivés IRIS (v2)
-- Ajouter après 070_iris_add_missing_columns.sql

ALTER TABLE iris ADD COLUMN IF NOT EXISTS densite_pop               NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS indice_jeunesse           NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS part_pop_etrangere        NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS part_residences_principales NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS part_appartements         NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS part_logements_sociaux    NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS part_menages_emmenages_2ans NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS part_familles_monoparentales NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS part_couples_avec_enfants NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS part_actifs_marche_velo   NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS part_actifs_transport_commun NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS part_hommes_actifs        NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS part_femmes_actives       NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS part_pop_moins_18         NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS part_pop_65_plus          NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS part_sans_diplome         NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS nb_emplois_commune        NUMERIC;

COMMENT ON COLUMN iris.densite_pop               IS 'Densité de population (hab/km²)';
COMMENT ON COLUMN iris.indice_jeunesse           IS 'Indice de jeunesse (pop 0-14 / pop 60+)';
COMMENT ON COLUMN iris.part_pop_etrangere        IS 'Part de la population étrangère (%)';
COMMENT ON COLUMN iris.part_residences_principales IS 'Part des résidences principales (%)';
COMMENT ON COLUMN iris.part_appartements         IS 'Part des appartements parmi les logements (%)';
COMMENT ON COLUMN iris.part_logements_sociaux    IS 'Part des logements sociaux HLM (%)';
COMMENT ON COLUMN iris.part_menages_emmenages_2ans IS 'Part des ménages emménagés depuis moins de 2 ans (%)';
COMMENT ON COLUMN iris.part_familles_monoparentales IS 'Part des familles monoparentales (%)';
COMMENT ON COLUMN iris.part_couples_avec_enfants IS 'Part des couples avec enfants (%)';
COMMENT ON COLUMN iris.part_actifs_marche_velo   IS 'Part des actifs utilisant la marche ou le vélo (%)';
COMMENT ON COLUMN iris.part_actifs_transport_commun IS 'Part des actifs utilisant les transports en commun (%)';
COMMENT ON COLUMN iris.part_hommes_actifs        IS 'Part des hommes actifs 15-64 ans (%)';
COMMENT ON COLUMN iris.part_femmes_actives       IS 'Part des femmes actives 15-64 ans (%)';
COMMENT ON COLUMN iris.part_pop_moins_18         IS 'Part de la population de moins de 18 ans (%, approx. pop 0-14)';
COMMENT ON COLUMN iris.part_pop_65_plus          IS 'Part de la population de 65 ans et plus (%, approx. pop 60+)';
COMMENT ON COLUMN iris.part_sans_diplome         IS 'Part des 15+ sans diplôme ou CEP (%)';
COMMENT ON COLUMN iris.nb_emplois_commune        IS 'Nombre emplois au lieu de travail (donnée communale imputée)';

NOTIFY pgrst, 'reload schema';
