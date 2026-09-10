-- 123_carreaux_bornes_nationales.sql
-- Requete de CALCUL des bornes nationales p5/p95 des carreaux INSEE.
--
-- ⚠ Ce fichier ne cree RIEN en base : ni table, ni fonction, ni index. C'est
-- une requete de LECTURE, archivee ici pour etre rejouable. Son resultat est
-- recopie en constantes dans `lib/carreaux/bornes.ts` — le client ne
-- l'interroge jamais a l'execution.
--
-- ── Pourquoi des bornes fixes ───────────────────────────────────────────────
-- L'echelle de couleurs des carreaux etait recalculee sur `queryRenderedFeatures`
-- a chaque `idle`/`moveend`, donc sur la seule plage du viewport. En se deplacant
-- de Paris a la Lozere a zoom constant, la zone rurale se recolorait sur
-- elle-meme et paraissait aussi contrastee que Paris : deux territoires ne
-- pouvaient pas etre compares. Des bornes nationales constantes suppriment le
-- probleme a la racine — et, accessoirement, suppriment aussi le
-- queryRenderedFeatures par deplacement.
--
-- ── Pourquoi carreaux_5km et pas carreaux_filosofi ─────────────────────────
-- `carreaux_5km` compte 22 058 lignes ; `carreaux_filosofi` en compte
-- 2 298 582. Un percentile exige un tri complet, donc un full scan : sur la
-- table 200 m ce serait exactement l'operation que le budget I/O de Supabase
-- Nano (250 IOPS, 5 MB/s) interdit. Comme les valeurs servies a la carte sont
-- desormais NORMALISEES (densite/km2, ou moyenne par individu/menage — cf.
-- `lib/carreaux/normalisation.ts`, tache 1), les bornes calculees sur le
-- palier 5 km valent pour les trois paliers.
--
-- ── Normalisation : mirroir exact du code client ────────────────────────────
-- La requete reproduit `normaliser(valeur, denominateur)` :
--   * effectifs        → / 25.0   (superficie d'un carreau 5 km en km2, cf. sql/122)
--   * `revenu_median`  → / `ind`  (ind_snv est une SOMME de niveaux de vie)
--   * `surface_moyenne`→ / `men`  (men_surf est une SOMME de surfaces)
-- et son garde-fou : une valeur ou un denominateur <= 0 est exclu (`case when`
-- → NULL, que percentile_cont ignore), jamais converti en 0/Infinity/NaN qui
-- contaminerait les bornes.
--
-- ── Correspondance id applicatif ↔ colonne carreaux_5km ────────────────────
-- Elle n'est PAS l'identite. Source de verite : les alias du SELECT de la
-- branche `carreaux_5km` de `get_tile` (sql/122_get_tile_superficie.sql).
--   population_totale        → ind         menages_total           → men
--   population_inconnue      → ind_inc     menages_pauvres         → men_pauv
--   ind_0_3 … ind_80p        → idem        menages_1_personne      → men_1ind
--   revenu_median            → ind_snv     menages_5_plus          → men_5ind
--   surface_moyenne          → men_surf    menages_proprietaires   → men_prop
--   logements_avant_1945     → log_av45    familles_monoparentales → men_fmp
--   logements_1945_1970      → log_45_70   menages_maison          → men_mais
--   logements_1970_1990      → log_70_90   menages_collectif       → men_coll
--   logements_apres_1990     → log_ap90    logements_sociaux       → log_soc
--   logements_inconnus       → log_inc
-- Soit les 28 indicateurs de `CARREAUX_INDICATEURS`.
--
-- Une seule passe sur la table : 56 agregats dans un unique SELECT plutot que
-- 28 requetes, pour ne scanner qu'une fois.
--
-- Derniere execution : 2026-09-10 (projet vkkdbygwbrxyogqosten, 22 058 lignes).
-- A rejouer apres tout re-import Filosofi, puis recopier dans lib/carreaux/bornes.ts.

select
  round(percentile_cont(0.05) within group (order by case when c.ind > 0 then c.ind / 25.0 end)::numeric, 4) as "population_totale_p5",
  round(percentile_cont(0.95) within group (order by case when c.ind > 0 then c.ind / 25.0 end)::numeric, 4) as "population_totale_p95",
  round(percentile_cont(0.05) within group (order by case when c.ind_inc > 0 then c.ind_inc / 25.0 end)::numeric, 4) as "population_inconnue_p5",
  round(percentile_cont(0.95) within group (order by case when c.ind_inc > 0 then c.ind_inc / 25.0 end)::numeric, 4) as "population_inconnue_p95",
  round(percentile_cont(0.05) within group (order by case when c.ind_0_3 > 0 then c.ind_0_3 / 25.0 end)::numeric, 4) as "ind_0_3_p5",
  round(percentile_cont(0.95) within group (order by case when c.ind_0_3 > 0 then c.ind_0_3 / 25.0 end)::numeric, 4) as "ind_0_3_p95",
  round(percentile_cont(0.05) within group (order by case when c.ind_4_5 > 0 then c.ind_4_5 / 25.0 end)::numeric, 4) as "ind_4_5_p5",
  round(percentile_cont(0.95) within group (order by case when c.ind_4_5 > 0 then c.ind_4_5 / 25.0 end)::numeric, 4) as "ind_4_5_p95",
  round(percentile_cont(0.05) within group (order by case when c.ind_6_10 > 0 then c.ind_6_10 / 25.0 end)::numeric, 4) as "ind_6_10_p5",
  round(percentile_cont(0.95) within group (order by case when c.ind_6_10 > 0 then c.ind_6_10 / 25.0 end)::numeric, 4) as "ind_6_10_p95",
  round(percentile_cont(0.05) within group (order by case when c.ind_11_17 > 0 then c.ind_11_17 / 25.0 end)::numeric, 4) as "ind_11_17_p5",
  round(percentile_cont(0.95) within group (order by case when c.ind_11_17 > 0 then c.ind_11_17 / 25.0 end)::numeric, 4) as "ind_11_17_p95",
  round(percentile_cont(0.05) within group (order by case when c.ind_18_24 > 0 then c.ind_18_24 / 25.0 end)::numeric, 4) as "ind_18_24_p5",
  round(percentile_cont(0.95) within group (order by case when c.ind_18_24 > 0 then c.ind_18_24 / 25.0 end)::numeric, 4) as "ind_18_24_p95",
  round(percentile_cont(0.05) within group (order by case when c.ind_25_39 > 0 then c.ind_25_39 / 25.0 end)::numeric, 4) as "ind_25_39_p5",
  round(percentile_cont(0.95) within group (order by case when c.ind_25_39 > 0 then c.ind_25_39 / 25.0 end)::numeric, 4) as "ind_25_39_p95",
  round(percentile_cont(0.05) within group (order by case when c.ind_40_54 > 0 then c.ind_40_54 / 25.0 end)::numeric, 4) as "ind_40_54_p5",
  round(percentile_cont(0.95) within group (order by case when c.ind_40_54 > 0 then c.ind_40_54 / 25.0 end)::numeric, 4) as "ind_40_54_p95",
  round(percentile_cont(0.05) within group (order by case when c.ind_55_64 > 0 then c.ind_55_64 / 25.0 end)::numeric, 4) as "ind_55_64_p5",
  round(percentile_cont(0.95) within group (order by case when c.ind_55_64 > 0 then c.ind_55_64 / 25.0 end)::numeric, 4) as "ind_55_64_p95",
  round(percentile_cont(0.05) within group (order by case when c.ind_65_79 > 0 then c.ind_65_79 / 25.0 end)::numeric, 4) as "ind_65_79_p5",
  round(percentile_cont(0.95) within group (order by case when c.ind_65_79 > 0 then c.ind_65_79 / 25.0 end)::numeric, 4) as "ind_65_79_p95",
  round(percentile_cont(0.05) within group (order by case when c.ind_80p > 0 then c.ind_80p / 25.0 end)::numeric, 4) as "ind_80p_p5",
  round(percentile_cont(0.95) within group (order by case when c.ind_80p > 0 then c.ind_80p / 25.0 end)::numeric, 4) as "ind_80p_p95",
  round(percentile_cont(0.05) within group (order by case when c.men > 0 then c.men / 25.0 end)::numeric, 4) as "menages_total_p5",
  round(percentile_cont(0.95) within group (order by case when c.men > 0 then c.men / 25.0 end)::numeric, 4) as "menages_total_p95",
  round(percentile_cont(0.05) within group (order by case when c.men_pauv > 0 then c.men_pauv / 25.0 end)::numeric, 4) as "menages_pauvres_p5",
  round(percentile_cont(0.95) within group (order by case when c.men_pauv > 0 then c.men_pauv / 25.0 end)::numeric, 4) as "menages_pauvres_p95",
  round(percentile_cont(0.05) within group (order by case when c.men_1ind > 0 then c.men_1ind / 25.0 end)::numeric, 4) as "menages_1_personne_p5",
  round(percentile_cont(0.95) within group (order by case when c.men_1ind > 0 then c.men_1ind / 25.0 end)::numeric, 4) as "menages_1_personne_p95",
  round(percentile_cont(0.05) within group (order by case when c.men_5ind > 0 then c.men_5ind / 25.0 end)::numeric, 4) as "menages_5_plus_p5",
  round(percentile_cont(0.95) within group (order by case when c.men_5ind > 0 then c.men_5ind / 25.0 end)::numeric, 4) as "menages_5_plus_p95",
  round(percentile_cont(0.05) within group (order by case when c.men_prop > 0 then c.men_prop / 25.0 end)::numeric, 4) as "menages_proprietaires_p5",
  round(percentile_cont(0.95) within group (order by case when c.men_prop > 0 then c.men_prop / 25.0 end)::numeric, 4) as "menages_proprietaires_p95",
  round(percentile_cont(0.05) within group (order by case when c.men_fmp > 0 then c.men_fmp / 25.0 end)::numeric, 4) as "familles_monoparentales_p5",
  round(percentile_cont(0.95) within group (order by case when c.men_fmp > 0 then c.men_fmp / 25.0 end)::numeric, 4) as "familles_monoparentales_p95",
  round(percentile_cont(0.05) within group (order by case when c.men_mais > 0 then c.men_mais / 25.0 end)::numeric, 4) as "menages_maison_p5",
  round(percentile_cont(0.95) within group (order by case when c.men_mais > 0 then c.men_mais / 25.0 end)::numeric, 4) as "menages_maison_p95",
  round(percentile_cont(0.05) within group (order by case when c.men_coll > 0 then c.men_coll / 25.0 end)::numeric, 4) as "menages_collectif_p5",
  round(percentile_cont(0.95) within group (order by case when c.men_coll > 0 then c.men_coll / 25.0 end)::numeric, 4) as "menages_collectif_p95",
  round(percentile_cont(0.05) within group (order by case when c.log_av45 > 0 then c.log_av45 / 25.0 end)::numeric, 4) as "logements_avant_1945_p5",
  round(percentile_cont(0.95) within group (order by case when c.log_av45 > 0 then c.log_av45 / 25.0 end)::numeric, 4) as "logements_avant_1945_p95",
  round(percentile_cont(0.05) within group (order by case when c.log_45_70 > 0 then c.log_45_70 / 25.0 end)::numeric, 4) as "logements_1945_1970_p5",
  round(percentile_cont(0.95) within group (order by case when c.log_45_70 > 0 then c.log_45_70 / 25.0 end)::numeric, 4) as "logements_1945_1970_p95",
  round(percentile_cont(0.05) within group (order by case when c.log_70_90 > 0 then c.log_70_90 / 25.0 end)::numeric, 4) as "logements_1970_1990_p5",
  round(percentile_cont(0.95) within group (order by case when c.log_70_90 > 0 then c.log_70_90 / 25.0 end)::numeric, 4) as "logements_1970_1990_p95",
  round(percentile_cont(0.05) within group (order by case when c.log_ap90 > 0 then c.log_ap90 / 25.0 end)::numeric, 4) as "logements_apres_1990_p5",
  round(percentile_cont(0.95) within group (order by case when c.log_ap90 > 0 then c.log_ap90 / 25.0 end)::numeric, 4) as "logements_apres_1990_p95",
  round(percentile_cont(0.05) within group (order by case when c.log_soc > 0 then c.log_soc / 25.0 end)::numeric, 4) as "logements_sociaux_p5",
  round(percentile_cont(0.95) within group (order by case when c.log_soc > 0 then c.log_soc / 25.0 end)::numeric, 4) as "logements_sociaux_p95",
  round(percentile_cont(0.05) within group (order by case when c.log_inc > 0 then c.log_inc / 25.0 end)::numeric, 4) as "logements_inconnus_p5",
  round(percentile_cont(0.95) within group (order by case when c.log_inc > 0 then c.log_inc / 25.0 end)::numeric, 4) as "logements_inconnus_p95",
  round(percentile_cont(0.05) within group (order by case when c.ind_snv > 0 and c.ind > 0 then c.ind_snv / c.ind end)::numeric, 4) as "revenu_median_p5",
  round(percentile_cont(0.95) within group (order by case when c.ind_snv > 0 and c.ind > 0 then c.ind_snv / c.ind end)::numeric, 4) as "revenu_median_p95",
  round(percentile_cont(0.05) within group (order by case when c.men_surf > 0 and c.men > 0 then c.men_surf / c.men end)::numeric, 4) as "surface_moyenne_p5",
  round(percentile_cont(0.95) within group (order by case when c.men_surf > 0 and c.men > 0 then c.men_surf / c.men end)::numeric, 4) as "surface_moyenne_p95"
from carreaux_5km c;

-- ── Resultat du 2026-09-10 ─────────────────────────────────────────────────
-- id                          p5            p95
-- population_totale              2.2200      369.1120
-- population_inconnue            0.0320        1.6760
-- ind_0_3                        0.0600       14.4992
-- ind_4_5                        0.0400        8.1680
-- ind_6_10                       0.0920       22.2012
-- ind_11_17                      0.1320       32.6164
-- ind_18_24                      0.1120       27.8176
-- ind_25_39                      0.2480       59.3954
-- ind_40_54                      0.3936       72.8472
-- ind_55_64                      0.3788       50.1412
-- ind_65_79                      0.4800       61.2912
-- ind_80p                        0.1560       22.5922
-- menages_total                  1.0880      165.5352
-- menages_pauvres                0.1840       22.4870
-- menages_1_personne             0.3840       57.4044
-- menages_5_plus                 0.0440        9.4772
-- menages_proprietaires          0.8120      102.7108
-- familles_monoparentales        0.0840       18.6040
-- menages_maison                 0.9440      108.8872
-- menages_collectif              0.0360       62.1488
-- surface_moyenne               82.4312      124.8391
-- revenu_median              20045.5577    28795.3640
-- logements_avant_1945           0.4600       32.7914
-- logements_1945_1970            0.0440       25.4728
-- logements_1970_1990            0.1280       45.8440
-- logements_apres_1990           0.1600       59.9290
-- logements_sociaux              0.0440       50.7800
-- logements_inconnus             0.0200        0.6430
