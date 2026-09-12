-- sql/143 — Tracer LE PALIER qui a produit chaque profil de clustering.
-- Applique le 2026-09-12 (MCP Supabase). Depend de sql/141 et sql/142.
--
-- Le profilage bascule de `carreaux_filosofi` (200 m, jsonb) vers
-- `carreaux_2km` (colonnes typees). Mesure sur le MEME calcul, 95 CIRFA a
-- 15 min voiture :
--
--   phase de profilage   ~6 min  ->  6,5 s   (69 ms/POI, soit ~25x)
--   calcul complet       ~6-7 min -> 17 s
--   K retenu                  7  ->  4
--   silhouette            0,3248  ->  0,2992
--
-- Les seize variables du modele derivent de moins de 3,5 % entre les paliers.
-- L'accord des partitions est modere (Rand ajuste 0,489) mais leur structure
-- est EMBOITEE : cinq des sept clusters du 200 m atterrissent en bloc dans un
-- seul cluster du 2 km. Le 2 km regroupe plus grossierement la meme structure.
--
-- ── CE QUE LE 2 km N'EST PAS ───────────────────────────────────────────────
-- Le controle de coherence n8 passe de 69 % a 98 % de « couverture ». Il
-- compte des CARREAUX, pas des habitants : mesure sur un isochrone CIRFA de
-- 15 min, le filtre du secret statistique (ind > 11) ecarte 10 % des carreaux
-- mais 0,18 % de la population — les carreaux exclus sont quasi vides, c'est
-- leur raison d'etre. Ce controle ne dit donc PAS que le 2 km apporte plus de
-- donnees.
--
-- Dans l'autre sens, le 2 km compte 5,6 % de population EN MOINS sur ce meme
-- isochrone : une maille de 2 km est incluse ou exclue par son centroide.
-- C'est le cout reel de l'approximation, et il est sur les bords.
--
-- Le 2 km est donc un RACCOURCI assume, pas une correction.
--
-- ── POURQUOI CES COLONNES ──────────────────────────────────────────────────
-- Sans elles, deux modeles calcules sur des paliers differents seraient
-- indiscernables en base, et leurs effectifs compares comme s'ils etaient de
-- meme nature. Une valeur dont on ignore la provenance est une valeur qu'on
-- finira par mal lire.
--
-- `population_totale_couverte` n'est affichee NULLE PART aujourd'hui (declaree
-- dans les types de ClusterDetails, renvoyee par l'API, jamais rendue) : c'est
-- ce qui rend la bascule acceptable sans machinerie de recalcul. Le jour ou ce
-- chiffre sera affiche, il faudra soit le recalculer au 200 m a la demande pour
-- le seul POI consulte (~4 s), soit l'annoncer comme approche.

ALTER TABLE public.poi_clusters
  ADD COLUMN IF NOT EXISTS profil_palier TEXT;

ALTER TABLE public.clustering_models
  ADD COLUMN IF NOT EXISTS profil_palier TEXT;

COMMENT ON COLUMN public.poi_clusters.profil_palier IS
  'Palier de carreaux ayant produit le profil : ''200m'' (carreaux_filosofi) ou ''2km'' (carreaux_2km). Les ratios sont equivalents a 3,5 % pres ; population_totale_couverte derive de ~6 a 12 % au 2 km.';

COMMENT ON COLUMN public.clustering_models.profil_palier IS
  'Palier de carreaux ayant produit la matrice d''entrainement. Deux modeles de paliers differents ne se comparent pas terme a terme sur les effectifs.';

-- Les modeles existants viennent du 200 m : on le dit, plutot que de laisser
-- NULL se faire interpreter comme « inconnu donc probablement le defaut ».
UPDATE public.poi_clusters      SET profil_palier = '200m' WHERE profil_palier IS NULL;
UPDATE public.clustering_models SET profil_palier = '200m' WHERE profil_palier IS NULL;
