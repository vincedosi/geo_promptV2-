# Mission : système de périmètres préventifs autour des sites Seveso (paliers, typage, cibles, priorisation)


## Cas d'usage (à ne pas confondre avec de la simulation d'accident)
On fait des **campagnes de prévention** : informer, avant tout accident, les populations vivant ou travaillant autour d'un site à risque des bons réflexes (sirène, confinement, ne pas aller chercher les enfants à l'école, où s'informer). Cadre existant : campagne d'information préventive quinquennale obligatoire autour des sites seuil haut, territoire de référence = périmètre PPI.
Conséquences pour la modélisation :
- Pas de vent, pas de panache, pas de direction : **géométrie concentrique uniquement**.
- Ce qui varie selon la distance : l'intensité du message (pression) et les cibles.
- Le KPI final est la couverture de la population exposée par palier, pas le CPM.

---

## PHASE 0 : AUDIT (si non fait)
Inventaire lecture seule (MCP Supabase + grep repo, hors node_modules) de tout ce qui touche : `seveso`, `icpe`, `pprt`, `ppi`, `risque`, `danger`, `alea`, `perimetre`, `exposition`, `georisques`.
Pour chaque table : lignes, colonnes, SRID réel, index GIST, RLS + policies. Pour chaque fichier code : utilisé ou orphelin. Schéma complet de la table des sites Seveso (nom exact, PK, colonnes seuil, rubriques ICPE si présentes, géométrie). Noms exacts des colonnes de `carreaux_filosofi` (population, tranches d'âge, ménages) et des colonnes `iris` pertinentes (emplois, ancienneté d'emménagement si importée).
Livrable `docs/AUDIT_SEVESO_PPRT.md` en trois sections : à conserver / à nettoyer (avec preuve et action) / inconnues. **STOP**, attends validation item par item avant toute suppression.

---

## PHASE 1 : TYPAGE DES SITES PAR FAMILLE DE DANGER

Objectif : chaque site reçoit une ou plusieurs familles parmi E (explosion), T (toxique), F (inflammable/incendie), et une famille dominante.

1. Source : rubriques ICPE du site. Si elles ne sont pas en base, récupère-les via l'API Géorisques "Installations classées" (données GUNenv, endpoint JSON ou CSV) en matchant sur le code AIOT / identifiant ICPE / nom + commune. Stocke le résultat brut dans `seveso_rubriques (site_id, rubrique, alinea, regime, quantite, unite, raw jsonb)`.
2. Table de mapping **non hardcodée** `icpe_rubrique_famille (rubrique text pk, famille char(1), coef_danger int, libelle text, source text, a_verifier boolean)`. Seed initial à construire à partir de la nomenclature ICPE (rubriques 4xxx substances Seveso) selon ce cadre, **à vérifier contre la nomenclature officielle avant insertion et à marquer `a_verifier = true` en cas de doute** :
   - E : explosifs et nitrate d'ammonium (rubriques 42xx, 4701 à 4703, et toute rubrique dont le libellé officiel mentionne explosif / explosible / nitrate d'ammonium). coef 3
   - T : toxicité aiguë et toxiques spécifiques (411x à 415x, ammoniac, chlore, phosgène et rubriques dédiées). coef 2
   - F : gaz et liquides inflammables, aérosols, produits pétroliers (43xx, 47xx pétroliers, 48xx). coef 1
   - Les rubriques 45xx (danger environnement) ne créent pas de famille à elles seules ; coef 0.
   Loggue les rubriques rencontrées mais absentes du mapping dans `docs/RUBRIQUES_NON_MAPPEES.md` au lieu de planter.
3. Colonnes ajoutées à la table des sites (migration idempotente) : `familles text[]`, `famille_dominante char(1)`, `coef_danger int`, `typage_source text` ('rubriques', 'manuel', 'defaut'), `typage_confiance text` ('haute','moyenne','faible'). Dominante = famille au coef le plus élevé présent ; à égalité E > T > F. Site sans rubrique exploitable : dominante 'T' par défaut (hypothèse conservatrice), `typage_source = 'defaut'`, confiance faible.
4. RPC `compute_seveso_typage()` rejouable (upsert) + rapport de synthèse (nb sites par famille, par confiance).

---

## PHASE 2 : PARAMÈTRES DE PALIERS (table, jamais en dur)

```sql
seveso_palier_params (
  id serial primary key,
  famille char(1),             -- E, T, F
  palier smallint,             -- 1 cœur, 2 riverains, 3 bassin
  libelle text,                -- 'Cœur', 'Riverains', 'Bassin'
  rayon_defaut_m int,          -- utilisé seulement si ni PPI ni PPRT
  pression text,               -- 'forte', 'moyenne', 'legere'
  objectif_reach numeric,      -- 0.80, 0.50, 0.20
  message_cle text,            -- résumé du message préventif attendu
  couleur_hex text,
  ordre int
)
```
Seed :
| famille | palier | rayon_defaut_m | pression | objectif_reach |
|---|---|---|---|---|
| E | 1 | 1000 | forte | 0.80 |
| E | 2 | 3000 | moyenne | 0.50 |
| E | 3 | 7000 | legere | 0.20 |
| T | 1 | 1000 | forte | 0.80 |
| T | 2 | 2000 | moyenne | 0.50 |
| T | 3 | 5000 | legere | 0.20 |
| F | 1 | 500 | forte | 0.80 |
| F | 2 | 1500 | moyenne | 0.50 |
| F | 3 | 5000 | legere | 0.20 |
Messages clés : palier 1 = réflexes précis (sirène, confinement, école) ; palier 2 = connaître le risque et les 3 gestes ; palier 3 = savoir que le site existe et où s'informer.
Justification à documenter : palier 3 calibré sur les retours d'expérience AZF (vitres à 7 km, 25 000 logements) et Lubrizol (13 communes concernées hors Rouen, prélèvements à 15 km).

---

## PHASE 3 : PÉRIMÈTRES PAR SITE (règle de priorité des sources)

Pour chaque site, le palier 1 et le palier 2 viennent de la meilleure source disponible, dans cet ordre :
1. **PPI** : rayon ou polygone du plan particulier d'intervention. Il n'existe pas de jeu national homogène : ajoute une colonne `ppi_rayon_m int` et `ppi_geom_2154 geometry` sur la table des sites, alimentées manuellement ou par import départemental (geo.data.gouv / flux WFS geo-ide des DDT quand disponibles). Si présent : palier 1 = 0 à ppi_rayon/3 (ou zone PPRT si elle existe), palier 2 = reste du PPI.
2. **PPRT** approuvé (table `pprt_zones` si déjà importée, sinon import selon le prompt précédent : couche Géorisques `PPRT_ZONE_RISQIND_FXX`) : palier 1 = zones R, r, B ; palier 2 = zone b + périmètre d'exposition aux risques.
3. **Défaut** : `seveso_palier_params.rayon_defaut_m` selon la famille dominante.
Le palier 3 est **toujours** un buffer défaut (le PPI et le PPRT ne couvrent pas le bassin).

Table de sortie :
```sql
seveso_perimetres (
  id bigserial primary key,
  site_id ... references <table sites>,
  palier smallint,
  source text,                 -- 'ppi', 'pprt', 'defaut'
  indicatif boolean,           -- true si 'defaut'
  rayon_m int,                 -- null si polygone PPRT/PPI
  geom_2154 geometry(MultiPolygon, 2154),   -- COURONNE (palier n moins palier n-1), jamais un disque plein
  geom_3857 geometry(MultiPolygon, 3857),
  computed_at timestamptz,
  unique (site_id, palier)
)
```
Règles : buffers calculés en 2154 (`ST_Buffer(site.geom_2154, r)`), couronnes par `ST_Difference`, `ST_MakeValid`, `ST_Multi`, puis `geom_3857` dérivé une fois. Index GIST sur les deux géométries. RLS + policy lecture `authenticated`.

**Chevauchements multi-sites (Fos, Le Havre, Dunkerque, Lyon sud, Rouen)** : table `seveso_perimetres_fusion (palier, geom_2154, geom_3857)` = dissolution nationale par palier avec règle "un point appartient au palier le plus contraignant" (palier 1 prime sur 2 prime sur 3). Utilisée pour la carte nationale et pour compter chaque habitant une seule fois.

RPC `compute_seveso_perimetres(p_site_id default null)` : recalcule un site ou tous, `VOLATILE`, rejouable.

---

## PHASE 4 : POPULATION ET CIBLES PAR PALIER

RPC `compute_seveso_exposition(p_site_id default null)` alimentant :
```sql
seveso_exposition (
  site_id ..., palier smallint, indicatif boolean,
  pop_totale numeric,
  pop_0_17 numeric,            -- ménages avec enfants : réflexe école
  pop_65_plus numeric,         -- confinement, isolement
  menages numeric,
  menages_1pers numeric,
  emplois numeric,             -- population présente en journée, via IRIS
  pop_emmenages_recents numeric,  -- via IRIS si la colonne existe, sinon null
  nb_carreaux int, surface_m2 numeric,
  computed_at timestamptz,
  unique (site_id, palier)
)
```
Règles de calcul :
- Carreaux Filosofi au prorata de surface : `valeur * ST_Area(ST_Intersection(c.geom_3857, p.geom_3857)) / ST_Area(c.geom_3857)`, toujours précédé de `c.geom_3857 && p.geom_3857`. Jamais de full scan.
- Noms de colonnes Filosofi (population, tranches d'âge, ménages) lus depuis le schéma réel constaté en phase 0. Les tranches d'âge Filosofi sont à agréger (ex. 0-17 = somme des tranches enfants disponibles). Ne rien inventer : si une tranche manque, la colonne reste null et c'est documenté.
- Emplois et emménagés récents : via `iris` (`WHERE is_true_iris = true`) au prorata de surface, colonnes découvertes dynamiquement (jamais hardcoder la liste, règle du repo).
- Cohérence : pop palier 1 + 2 + 3 d'un site = pop du disque palier 3 complet (test obligatoire).
- Vue nationale dédupliquée `v_seveso_exposition_nationale` calculée sur `seveso_perimetres_fusion`.

---

## PHASE 5 : SCORE DE PRIORITÉ PAR SITE

Colonne `score_priorite numeric` sur la table des sites, RPC `compute_seveso_priorite()` :
```
score = pop_totale(palier 1) * coef_danger * facteur_contexte
facteur_contexte = 1.0
  + 0.5 si aucun PPRT approuvé (ou abrogé)
  + 0.3 si seuil haut
  + 0.2 si date_derniere_campagne_info null ou > 5 ans (colonne `date_derniere_campagne_info date` à ajouter, saisie manuelle)
```
Coefficients dans une table `seveso_priorite_params (cle text pk, valeur numeric)`, pas en dur. Rang national et rang par département stockés.

---

## PHASE 6 : EXPOSITION DANS L'APP

1. **Tuiles** : layers `seveso_perimetres` (par site) et `seveso_perimetres_fusion` (national) dans `/api/tiles/[z]/[x]/[y]`. `ST_AsMVT` sur `geom_3857`, simplification adaptative par zoom, gzip obligatoire, LRU cache. Attributs : `site_id`, `palier`, `source`, `indicatif`.
2. **Calque MapLibre** "Périmètres de prévention Seveso" dans Calques, masqué par défaut, couleur depuis `seveso_palier_params.couleur_hex` (chargé dynamiquement), hachures ou opacité réduite si `indicatif = true`. Toggle vue par site / vue fusionnée.
3. **Panneau site** au clic : famille(s) et confiance du typage, source du périmètre (PPI / PPRT / défaut avec mention "périmètre indicatif calibré sur retours d'expérience"), tableau des 3 paliers avec pop totale, 0-17, 65+, emplois, objectif de reach, score de priorité et rang.
4. **Zones** : un périmètre (site + palier, ou fusion nationale par palier) doit pouvoir être ajouté comme zone de campagne dans le module Zones, comme un IRIS ou un isochrone. Réutilise le mécanisme existant de composition de zones, ne crée pas un chemin parallèle.
5. **Suivi de campagne** : le score d'alignement géographique existant doit accepter un périmètre Seveso comme référence, avec un KPI "couverture de la population exposée par palier" comparé à `objectif_reach`. Si l'intégration au score existant est trop invasive, expose un endpoint séparé `app/api/seveso/couverture/route.ts` et documente le choix.
6. **Routes API** : `app/api/seveso/[id]/perimetres`, `app/api/seveso/[id]/exposition`, `app/api/seveso/priorites?departement=`.
7. **GEO.Prompt** : outil `get_seveso_exposition(site_id | departement)` dans `lib/chat/tools/` (1 outil = 1 fichier, retour structuré JSON) et entrées `data_registry` pour `seveso_perimetres`, `seveso_exposition`, `score_priorite`.

---

## PHASE 7 : VALIDATION ET DOCUMENTATION

- Tests SQL sur 4 sites : un E avec PPRT, un T sans PPRT, un F seuil bas, un site en zone multi-sites (Fos ou Le Havre). Vérifie : couronnes disjointes, somme des paliers = disque complet, fusion nationale sans double comptage, aucun site sans typage ni périmètre.
- `get_advisors` Supabase propre après migrations (ignore le faux positif `spatial_ref_sys`).
- `npm run build` et `npm run lint` verts.
- `docs/SEVESO_PREVENTION.md` : méthodologie (cas d'usage préventif, pourquoi concentrique, familles E/T/F, règle de priorité PPI > PPRT > défaut, paliers et justification AZF/Lubrizol, cibles, score de priorité, KPI de couverture), limites (seuls ~400 sites ont un PPRT, PPI non homogène, rayons défaut = ordres de grandeur), et un encart "comment le présenter à un client" en trois zones (Cœur / Riverains / Bassin, une phrase chacune).

## Interdits absolus
- Ne touche pas à `/api/isochrone-battle/route.ts`, `get_isochrone_battle`, `clip_geojson_to_france`, `clip_rings_to_france`.
- Aucun rayon, coefficient, code rubrique ou nom de colonne Filosofi en dur dans le SQL ou le front : tout passe par les tables de paramètres ou la découverte de schéma.
- Aucune notion de vent, panache ou direction.
- Aucune suppression sans validation explicite.

## Méthode de travail
- Un commit par phase, messages conventionnels en anglais.
- À chaque décision non couverte, pose la question au lieu de deviner.
- Réutilise l'existant validé par l'audit (import PPRT, RPC de bascule) au lieu de le réécrire.
- Commence par la Phase 0 si l'audit n'existe pas, sinon par la Phase 1, et fais un point à la fin de chaque phase.