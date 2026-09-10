-- 123_carreaux_bornes_nationales.sql
-- Requetes de CALCUL des bornes nationales de l'echelle de couleurs des carreaux
-- INSEE, en **log10 de la valeur normalisee**.
--
-- ⚠ Ce fichier ne cree RIEN en base : ni table, ni fonction, ni index. Ce sont
-- des requetes de LECTURE, archivees ici pour etre rejouables. Leur resultat est
-- recopie en constantes dans `lib/carreaux/bornes.ts` — le client ne les
-- interroge jamais a l'execution.
--
-- ════════════════════════════════════════════════════════════════════════════
-- POURQUOI
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Bornes FIXES. L'echelle etait recalculee sur `queryRenderedFeatures` a
--    chaque `idle`/`moveend`, donc sur la seule plage du viewport. En se
--    deplacant de Paris a la Lozere a zoom constant, la zone rurale se
--    recolorait sur elle-meme et paraissait aussi contrastee que Paris : deux
--    territoires ne pouvaient pas etre compares.
--
-- 2. Bornes LOGARITHMIQUES. Premiere tentative : bornes fixes LINEAIRES, p5/p95
--    mesures sur `carreaux_5km`. Resultat mesure en base le 2026-09-10 : avec
--    une borne haute de quelques centaines d'hab/km2, **99,5 % des carreaux de
--    Paris en maille 200 m saturaient** (3 088 / 3 105 ; densite mediane
--    19 775 hab/km2) et 78,7 % de la France. La carte devenait un aplat
--    monochrome au zoom >= 10, exactement la ou un media-planneur travaille.
--
--    La normalisation rend les UNITES comparables, pas les DISTRIBUTIONS : un
--    carreau de 5 km moyenne le coeur dense avec les parcs et les zones laches,
--    un carreau de 200 m en plein 11e est de la densite pure. La meme grandeur
--    couvre plus de 4 decades. En log10, 4 decades deviennent 4 unites
--    d'echelle et chaque palier recupere un vrai degrade.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONSTRUCTION DES BORNES — et les trois mesures qui la justifient
-- ════════════════════════════════════════════════════════════════════════════
--
-- `min` = log10 du p5 du palier 5 km  (requete A, exhaustive, 22 058 lignes)
-- `max` = log10 du p99,9 du palier 200 m pour les EFFECTIFS     (requetes C + D)
--         log10 du p95   du palier 200 m pour les DEUX MOYENNES (requete B)
--
-- Le plancher vient du palier le plus GROSSIER parce que c'est lui qui descend
-- le plus bas : une maille de 25 km2 moyenne de vastes zones vides, alors qu'une
-- maille de 200 m habitee vaut au minimum 25 hab/km2 (1 personne / 0,04 km2).
-- Sans ce plancher, la vue nationale au zoom 6-7 serait presque entierement au
-- ras de l'echelle : mesure, la mediane du 5 km tomberait a 3 % de l'etendue au
-- lieu de 28 %.
--
-- Le plafond vient du palier le plus FIN parce que seul lui porte la queue
-- urbaine dense. Mesure de la saturation restante dans Paris selon le quantile
-- haut retenu sur le 200 m (requete E) :
--     borne = p95   (2 875 hab/km2)  → 89,8 % de Paris sature  ← insuffisant
--     borne = p99   (8 538)          → 76,8 %
--     borne = p99,9 (28 601)         → 31,3 %   pour 0,1 % au niveau national
--     borne = max   (63 388)         →  0,5 %   mais un seul carreau la fixe
-- D'ou le p99,9 : il divise la saturation par 3 sans confier l'echelle a un
-- unique carreau aberrant.
--
-- L'exception des deux MOYENNES (`revenu_median`, `surface_moyenne`) est mesuree
-- elle aussi : leur distribution entiere tient dans ~0,23 decade (revenu 200 m :
-- p5 = 4,2809 soit 19 100 €/hab, p95 = 4,5103 soit 32 380). Leur p99,9 vaut
-- 4,7125, soit 51 600 €/hab — un aberrant qui etirerait l'echelle et tasserait
-- toute la France dans le bas du degrade. Ce sont des RATIOS bornes, pas des
-- densites a queue libre : le p95 leur suffit.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONTRAINTE I/O — pourquoi un echantillon sur le palier 200 m
-- ════════════════════════════════════════════════════════════════════════════
--
-- Un percentile exige un tri complet, donc un full scan. `carreaux_filosofi`
-- compte 2 298 582 lignes / 3 612 Mo de heap (462 336 pages) : c'est exactement
-- l'operation que le budget I/O de Supabase Nano (250 IOPS, 5 Mo/s) interdit.
-- `TABLESAMPLE SYSTEM (1)` tire ~1 % des PAGES (≈ 4 600 pages, ≈ 36 Mo, ≈ 23 000
-- lignes) : assez pour un p99,9 (≈ 23 valeurs au-dela), et a ~5 rows/page les
-- pages tirees sont assez nombreuses pour que la correlation spatiale intra-page
-- ne biaise pas le resultat. Controle : le p5 et la mediane obtenus (1,3979 et
-- 2,1761) sont identiques a ceux d'un echantillonnage independant.
--
-- `carreaux_5km` (22 058 lignes) et `carreaux_2km` (122 018 lignes) sont eux
-- assez petits pour un calcul exhaustif.
--
-- ════════════════════════════════════════════════════════════════════════════
-- NORMALISATION — miroir exact du code client
-- ════════════════════════════════════════════════════════════════════════════
--
-- Reproduit `normaliser(valeur, denominateur)` de `lib/carreaux/normalisation.ts` :
--   * effectifs        → / superficie du palier : 0.04 (200 m) | 4 (2 km) | 25 (5 km)
--   * `revenu_median`  → / `ind`  (ind_snv est une SOMME de niveaux de vie)
--   * `surface_moyenne`→ / `men`  (men_surf est une SOMME de surfaces)
-- et son garde-fou : une valeur ou un denominateur <= 0 est exclu
-- (`case when … end` → NULL, que percentile_cont ignore), jamais converti en
-- 0/Infinity/NaN qui contaminerait les bornes. Le `log()` de PostgreSQL sur un
-- `numeric` est deja en base 10.
--
-- Note : log10(quantile) = quantile(log10) — la transformation est monotone. Les
-- requetes qui renvoient du lineaire (A) et celles qui renvoient du log (B, C, D)
-- sont donc interchangeables a un log10 pres.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CORRESPONDANCE id applicatif ↔ colonne SQL
-- ════════════════════════════════════════════════════════════════════════════
--
-- Elle n'est PAS l'identite. Source de verite : les alias du SELECT de
-- `get_tile` (sql/122_get_tile_superficie.sql). Sur `carreaux_2km`/`carreaux_5km`
-- ce sont des colonnes ; sur `carreaux_filosofi` ce sont des cles du jsonb
-- `metadata`.
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
-- Derniere execution : 2026-09-10 (projet vkkdbygwbrxyogqosten).
-- A rejouer apres tout re-import Filosofi, puis recopier dans lib/carreaux/bornes.ts.


-- ════════════════════════════════════════════════════════════════════════════
-- A — PLANCHER : p5 du palier 5 km (exhaustif, 22 058 lignes)
-- ════════════════════════════════════════════════════════════════════════════
-- Renvoie le p5 LINEAIRE ; `min` = log10(p5). Une seule passe, 28 agregats.
-- Resultat du 2026-09-10 (lineaire → log10 retenu) :
--   population_totale        2.2200    →  0.3464    menages_total            1.0880 →  0.0366
--   population_inconnue      0.0320    → -1.4949    menages_pauvres          0.1840 → -0.7352
--   ind_0_3                  0.0600    → -1.2218    menages_1_personne       0.3840 → -0.4157
--   ind_4_5                  0.0400    → -1.3979    menages_5_plus           0.0440 → -1.3565
--   ind_6_10                 0.0920    → -1.0362    menages_proprietaires    0.8120 → -0.0904
--   ind_11_17                0.1320    → -0.8794    familles_monoparentales  0.0840 → -1.0757
--   ind_18_24                0.1120    → -0.9508    menages_maison           0.9440 → -0.0250
--   ind_25_39                0.2480    → -0.6055    menages_collectif        0.0360 → -1.4437
--   ind_40_54                0.3936    → -0.4049    logements_avant_1945     0.4600 → -0.3372
--   ind_55_64                0.3788    → -0.4216    logements_1945_1970      0.0440 → -1.3565
--   ind_65_79                0.4800    → -0.3188    logements_1970_1990      0.1280 → -0.8928
--   ind_80p                  0.1560    → -0.8069    logements_apres_1990     0.1600 → -0.7959
--   surface_moyenne         82.4312    →  1.9161    logements_sociaux        0.0440 → -1.3565
--   revenu_median        20045.5577    →  4.3020    logements_inconnus       0.0200 → -1.6990
-- Pour les deux MOYENNES, c'est le p5 du 200 m (requete B) qui est retenu comme
-- `min`, legerement plus bas : 1.8940 et 4.2809.

select
  round(percentile_cont(0.05) within group (order by case when c.ind > 0 then c.ind / 25.0 end)::numeric, 4)           as "population_totale",
  round(percentile_cont(0.05) within group (order by case when c.ind_inc > 0 then c.ind_inc / 25.0 end)::numeric, 4)   as "population_inconnue",
  round(percentile_cont(0.05) within group (order by case when c.ind_0_3 > 0 then c.ind_0_3 / 25.0 end)::numeric, 4)   as "ind_0_3",
  round(percentile_cont(0.05) within group (order by case when c.ind_4_5 > 0 then c.ind_4_5 / 25.0 end)::numeric, 4)   as "ind_4_5",
  round(percentile_cont(0.05) within group (order by case when c.ind_6_10 > 0 then c.ind_6_10 / 25.0 end)::numeric, 4) as "ind_6_10",
  round(percentile_cont(0.05) within group (order by case when c.ind_11_17 > 0 then c.ind_11_17 / 25.0 end)::numeric, 4) as "ind_11_17",
  round(percentile_cont(0.05) within group (order by case when c.ind_18_24 > 0 then c.ind_18_24 / 25.0 end)::numeric, 4) as "ind_18_24",
  round(percentile_cont(0.05) within group (order by case when c.ind_25_39 > 0 then c.ind_25_39 / 25.0 end)::numeric, 4) as "ind_25_39",
  round(percentile_cont(0.05) within group (order by case when c.ind_40_54 > 0 then c.ind_40_54 / 25.0 end)::numeric, 4) as "ind_40_54",
  round(percentile_cont(0.05) within group (order by case when c.ind_55_64 > 0 then c.ind_55_64 / 25.0 end)::numeric, 4) as "ind_55_64",
  round(percentile_cont(0.05) within group (order by case when c.ind_65_79 > 0 then c.ind_65_79 / 25.0 end)::numeric, 4) as "ind_65_79",
  round(percentile_cont(0.05) within group (order by case when c.ind_80p > 0 then c.ind_80p / 25.0 end)::numeric, 4)   as "ind_80p",
  round(percentile_cont(0.05) within group (order by case when c.men > 0 then c.men / 25.0 end)::numeric, 4)           as "menages_total",
  round(percentile_cont(0.05) within group (order by case when c.men_pauv > 0 then c.men_pauv / 25.0 end)::numeric, 4) as "menages_pauvres",
  round(percentile_cont(0.05) within group (order by case when c.men_1ind > 0 then c.men_1ind / 25.0 end)::numeric, 4) as "menages_1_personne",
  round(percentile_cont(0.05) within group (order by case when c.men_5ind > 0 then c.men_5ind / 25.0 end)::numeric, 4) as "menages_5_plus",
  round(percentile_cont(0.05) within group (order by case when c.men_prop > 0 then c.men_prop / 25.0 end)::numeric, 4) as "menages_proprietaires",
  round(percentile_cont(0.05) within group (order by case when c.men_fmp > 0 then c.men_fmp / 25.0 end)::numeric, 4)   as "familles_monoparentales",
  round(percentile_cont(0.05) within group (order by case when c.men_mais > 0 then c.men_mais / 25.0 end)::numeric, 4) as "menages_maison",
  round(percentile_cont(0.05) within group (order by case when c.men_coll > 0 then c.men_coll / 25.0 end)::numeric, 4) as "menages_collectif",
  round(percentile_cont(0.05) within group (order by case when c.log_av45 > 0 then c.log_av45 / 25.0 end)::numeric, 4) as "logements_avant_1945",
  round(percentile_cont(0.05) within group (order by case when c.log_45_70 > 0 then c.log_45_70 / 25.0 end)::numeric, 4) as "logements_1945_1970",
  round(percentile_cont(0.05) within group (order by case when c.log_70_90 > 0 then c.log_70_90 / 25.0 end)::numeric, 4) as "logements_1970_1990",
  round(percentile_cont(0.05) within group (order by case when c.log_ap90 > 0 then c.log_ap90 / 25.0 end)::numeric, 4) as "logements_apres_1990",
  round(percentile_cont(0.05) within group (order by case when c.log_soc > 0 then c.log_soc / 25.0 end)::numeric, 4)   as "logements_sociaux",
  round(percentile_cont(0.05) within group (order by case when c.log_inc > 0 then c.log_inc / 25.0 end)::numeric, 4)   as "logements_inconnus",
  round(percentile_cont(0.05) within group (order by case when c.ind_snv > 0 and c.ind > 0 then c.ind_snv / c.ind end)::numeric, 4)      as "revenu_median",
  round(percentile_cont(0.05) within group (order by case when c.men_surf > 0 and c.men > 0 then c.men_surf / c.men end)::numeric, 4)   as "surface_moyenne"
from carreaux_5km c;


-- ════════════════════════════════════════════════════════════════════════════
-- B — PROFIL du palier 200 m en log10 : p5 / p50 / p95 (echantillon 1 %)
-- ════════════════════════════════════════════════════════════════════════════
-- Sert a deux choses : le `min` des deux MOYENNES (p5) et leur `max` (p95), et le
-- controle de contraste (ou tombe la mediane de chaque palier sur l'echelle).
-- Resultat du 2026-09-10, n = 22 789 :
--   population_totale   p5 1.3979  p50 2.1761  p95 3.4586   (25 / 150 / 2 875 hab/km2)
--   revenu_median       p5 4.2809  p50 4.3883  p95 4.5103   ← p5 et p95 retenus
--   surface_moyenne     p5 1.8940  p50 2.0399  p95 2.1434   ← p5 et p95 retenus
-- Controle de contraste avec les bornes finales de population_totale
-- [0.3464 ; 4.4670], etendue 4,12 decades :
--   mediane 5 km  (1.4890) → 27,7 %     mediane 200 m (2.1761) → 44,4 %
--   p95 5 km      (2.5670) → 53,9 %     mediane Paris (4.2961) → 95,9 %
-- Les deux paliers occupent une plage large et distincte : aucun n'est ecrase.
--
-- (Requete : le meme SELECT que A, avec `log(… / 0.04)` au lieu de `… / 25.0`,
--  les colonnes lues en `(cf.metadata->>'cle')::numeric`, et les trois
--  percentiles 0.05 / 0.50 / 0.95. Voir le modele de la requete C.)


-- ════════════════════════════════════════════════════════════════════════════
-- C — PLAFOND des effectifs : p99,9 log10 du palier 200 m — population & revenus
-- ════════════════════════════════════════════════════════════════════════════
-- Scinde en deux requetes (C et D) uniquement pour tenir dans le delai d'une
-- seule execution : un SELECT de 28 percentiles sur l'echantillon a expire une
-- fois. Chaque moitie tire son propre echantillon (~23 000 lignes), ce qui donne
-- au passage un controle de stabilite : population_totale vaut 4.4670 ici et
-- 4.4564 sur un tirage independant.
-- Resultat du 2026-09-10, n = 23 384 :
--   population_totale 4.4670   ind_25_39 3.8538   ind_65_79 3.5218
--   population_inconnue 2.8856 ind_40_54 3.7807   ind_80p   3.2309
--   ind_0_3 3.2537             ind_55_64 3.4949   revenu_median 4.7125 (NON retenu,
--   ind_4_5 3.0279  ind_6_10 3.3537  ind_11_17 3.4426  ind_18_24 3.3843
--                                      ← aberrant : cf. l'exception des moyennes)

with ech as (
  select cf.metadata as m
  from carreaux_filosofi cf tablesample system (1)
  where cf.resolution = '200m'
)
select
  count(*) as n_echantillon,
  round(percentile_cont(0.999) within group (order by case when (m->>'ind')::numeric       > 0 then log((m->>'ind')::numeric       / 0.04) end)::numeric, 4) as "population_totale",
  round(percentile_cont(0.999) within group (order by case when (m->>'ind_inc')::numeric   > 0 then log((m->>'ind_inc')::numeric   / 0.04) end)::numeric, 4) as "population_inconnue",
  round(percentile_cont(0.999) within group (order by case when (m->>'ind_0_3')::numeric   > 0 then log((m->>'ind_0_3')::numeric   / 0.04) end)::numeric, 4) as "ind_0_3",
  round(percentile_cont(0.999) within group (order by case when (m->>'ind_4_5')::numeric   > 0 then log((m->>'ind_4_5')::numeric   / 0.04) end)::numeric, 4) as "ind_4_5",
  round(percentile_cont(0.999) within group (order by case when (m->>'ind_6_10')::numeric  > 0 then log((m->>'ind_6_10')::numeric  / 0.04) end)::numeric, 4) as "ind_6_10",
  round(percentile_cont(0.999) within group (order by case when (m->>'ind_11_17')::numeric > 0 then log((m->>'ind_11_17')::numeric / 0.04) end)::numeric, 4) as "ind_11_17",
  round(percentile_cont(0.999) within group (order by case when (m->>'ind_18_24')::numeric > 0 then log((m->>'ind_18_24')::numeric / 0.04) end)::numeric, 4) as "ind_18_24",
  round(percentile_cont(0.999) within group (order by case when (m->>'ind_25_39')::numeric > 0 then log((m->>'ind_25_39')::numeric / 0.04) end)::numeric, 4) as "ind_25_39",
  round(percentile_cont(0.999) within group (order by case when (m->>'ind_40_54')::numeric > 0 then log((m->>'ind_40_54')::numeric / 0.04) end)::numeric, 4) as "ind_40_54",
  round(percentile_cont(0.999) within group (order by case when (m->>'ind_55_64')::numeric > 0 then log((m->>'ind_55_64')::numeric / 0.04) end)::numeric, 4) as "ind_55_64",
  round(percentile_cont(0.999) within group (order by case when (m->>'ind_65_79')::numeric > 0 then log((m->>'ind_65_79')::numeric / 0.04) end)::numeric, 4) as "ind_65_79",
  round(percentile_cont(0.999) within group (order by case when (m->>'ind_80p')::numeric   > 0 then log((m->>'ind_80p')::numeric   / 0.04) end)::numeric, 4) as "ind_80p",
  round(percentile_cont(0.999) within group (order by case when (m->>'ind_snv')::numeric > 0 and (m->>'ind')::numeric > 0 then log((m->>'ind_snv')::numeric / (m->>'ind')::numeric) end)::numeric, 4) as "revenu_median"
from ech;


-- ════════════════════════════════════════════════════════════════════════════
-- D — PLAFOND des effectifs : p99,9 log10 du palier 200 m — menages & logements
-- ════════════════════════════════════════════════════════════════════════════
-- Resultat du 2026-09-10, n = 22 456 :
--   menages_total 4.1095          menages_collectif 4.2437      logements_1970_1990 3.7543
--   menages_pauvres 3.5896        logements_avant_1945 3.7332    logements_apres_1990 3.7394
--   menages_1_personne 3.8101     logements_1945_1970 3.7863     logements_sociaux 4.2200
--   menages_5_plus 3.1673         menages_proprietaires 3.7255   logements_inconnus 2.5675
--   familles_monoparentales 3.2933  menages_maison 3.3802

with ech as (
  select cf.metadata as m
  from carreaux_filosofi cf tablesample system (1)
  where cf.resolution = '200m'
)
select
  count(*) as n_echantillon,
  round(percentile_cont(0.999) within group (order by case when (m->>'men')::numeric       > 0 then log((m->>'men')::numeric       / 0.04) end)::numeric, 4) as "menages_total",
  round(percentile_cont(0.999) within group (order by case when (m->>'men_pauv')::numeric  > 0 then log((m->>'men_pauv')::numeric  / 0.04) end)::numeric, 4) as "menages_pauvres",
  round(percentile_cont(0.999) within group (order by case when (m->>'men_1ind')::numeric  > 0 then log((m->>'men_1ind')::numeric  / 0.04) end)::numeric, 4) as "menages_1_personne",
  round(percentile_cont(0.999) within group (order by case when (m->>'men_5ind')::numeric  > 0 then log((m->>'men_5ind')::numeric  / 0.04) end)::numeric, 4) as "menages_5_plus",
  round(percentile_cont(0.999) within group (order by case when (m->>'men_prop')::numeric  > 0 then log((m->>'men_prop')::numeric  / 0.04) end)::numeric, 4) as "menages_proprietaires",
  round(percentile_cont(0.999) within group (order by case when (m->>'men_fmp')::numeric   > 0 then log((m->>'men_fmp')::numeric   / 0.04) end)::numeric, 4) as "familles_monoparentales",
  round(percentile_cont(0.999) within group (order by case when (m->>'men_mais')::numeric  > 0 then log((m->>'men_mais')::numeric  / 0.04) end)::numeric, 4) as "menages_maison",
  round(percentile_cont(0.999) within group (order by case when (m->>'men_coll')::numeric  > 0 then log((m->>'men_coll')::numeric  / 0.04) end)::numeric, 4) as "menages_collectif",
  round(percentile_cont(0.999) within group (order by case when (m->>'log_av45')::numeric  > 0 then log((m->>'log_av45')::numeric  / 0.04) end)::numeric, 4) as "logements_avant_1945",
  round(percentile_cont(0.999) within group (order by case when (m->>'log_45_70')::numeric > 0 then log((m->>'log_45_70')::numeric / 0.04) end)::numeric, 4) as "logements_1945_1970",
  round(percentile_cont(0.999) within group (order by case when (m->>'log_70_90')::numeric > 0 then log((m->>'log_70_90')::numeric / 0.04) end)::numeric, 4) as "logements_1970_1990",
  round(percentile_cont(0.999) within group (order by case when (m->>'log_ap90')::numeric  > 0 then log((m->>'log_ap90')::numeric  / 0.04) end)::numeric, 4) as "logements_apres_1990",
  round(percentile_cont(0.999) within group (order by case when (m->>'log_soc')::numeric   > 0 then log((m->>'log_soc')::numeric   / 0.04) end)::numeric, 4) as "logements_sociaux",
  round(percentile_cont(0.999) within group (order by case when (m->>'log_inc')::numeric   > 0 then log((m->>'log_inc')::numeric   / 0.04) end)::numeric, 4) as "logements_inconnus"
from ech;


-- ════════════════════════════════════════════════════════════════════════════
-- E — CONTROLE : la saturation restante, selon le quantile haut retenu
-- ════════════════════════════════════════════════════════════════════════════
-- C'est cette requete qui a tranche le choix du p99,9. Elle compare la
-- distribution nationale du palier 200 m a celle de Paris intra-muros, et mesure
-- la part de carreaux qui saturerait pour chaque candidat de borne haute.
--
-- Paris est lu par un bbox sur `geom` et NON sur `geom_centroid` : cette derniere
-- colonne est NULL sur la totalite de la table (verifie sur echantillon ;
-- consequence a signaler hors de cette tache — la branche z >= 10 de `get_tile`
-- joint `ref_departements` via `ST_Intersects(rd.geom, cf.geom_centroid)` et
-- renvoie donc toujours code_dept/code_region NULL au zoom >= 10).
--
-- Resultat du 2026-09-10 (n_france = 23 749 ; n_paris = 3 249) :
--   quantile national 200 m      lineaire   log10    % France sature   % Paris sature
--     p95                           2 875   3.4586             5,0 %           89,8 %
--     p99                           8 538   3.9313               —             76,8 %
--     p99,9                        28 601   4.4564             0,1 %           31,3 %
--     max                          63 388   4.8020               —              0,5 %
--   Paris : p5 2.8663 | mediane 4.2961 (19 775 hab/km2) | p95 4.6810

with ech as (
  select (cf.metadata->>'ind')::numeric / 0.04 as d
  from carreaux_filosofi cf tablesample system (1)
  where cf.resolution = '200m' and (cf.metadata->>'ind')::numeric > 0
),
paris as (
  select (cf.metadata->>'ind')::numeric / 0.04 as d
  from carreaux_filosofi cf
  where cf.resolution = '200m'
    and cf.geom && ST_MakeEnvelope(2.25, 48.81, 2.43, 48.91, 4326)
    and (cf.metadata->>'ind')::numeric > 0
),
qn as (
  select count(*) as n_france,
    percentile_cont(0.95)  within group (order by d) as p95,
    percentile_cont(0.99)  within group (order by d) as p99,
    percentile_cont(0.999) within group (order by d) as p999,
    max(d) as pmax
  from ech
)
select
  qn.n_france,
  (select count(*) from paris) as n_paris,
  round(log(qn.p95)::numeric,  4) as log_p95,  round(qn.p95::numeric,  0) as lin_p95,
  round(log(qn.p99)::numeric,  4) as log_p99,  round(qn.p99::numeric,  0) as lin_p99,
  round(log(qn.p999)::numeric, 4) as log_p999, round(qn.p999::numeric, 0) as lin_p999,
  round(log(qn.pmax)::numeric, 4) as log_max,  round(qn.pmax::numeric,  0) as lin_max,
  round(log((select percentile_cont(0.50) within group (order by d) from paris))::numeric, 4) as log_med_paris,
  round((select percentile_cont(0.50) within group (order by d) from paris)::numeric, 0)      as lin_med_paris,
  round(log((select percentile_cont(0.05) within group (order by d) from paris))::numeric, 4) as log_p5_paris,
  round(log((select percentile_cont(0.95) within group (order by d) from paris))::numeric, 4) as log_p95_paris,
  (select round(100.0*count(*) filter (where d >= qn.p95 )/count(*),1) from ech)   as pct_fr_sat_p95,
  (select round(100.0*count(*) filter (where d >= qn.p999)/count(*),1) from ech)   as pct_fr_sat_p999,
  (select round(100.0*count(*) filter (where d >= qn.p95 )/count(*),1) from paris) as pct_paris_sat_p95,
  (select round(100.0*count(*) filter (where d >= qn.p99 )/count(*),1) from paris) as pct_paris_sat_p99,
  (select round(100.0*count(*) filter (where d >= qn.p999)/count(*),1) from paris) as pct_paris_sat_p999,
  (select round(100.0*count(*) filter (where d >= qn.pmax)/count(*),1) from paris) as pct_paris_sat_max
from qn;
