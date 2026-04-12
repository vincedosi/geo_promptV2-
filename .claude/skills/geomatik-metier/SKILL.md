---
name: geomatik-metier
description: >
  Vocabulaire métier OOH/DOOH, données IRIS INSEE, carreaux Filosofi, tuiles MVT/PMTiles,
  scoring panneaux, isochrones battle. Utilise cette skill pour TOUT travail touchant aux
  données géographiques, à la carte, aux panneaux, aux IRIS, aux carreaux, au scoring,
  aux isochrones, ou au vocabulaire métier géomarketing. Aussi quand le prompt mentionne
  OOH, DOOH, IRIS, Filosofi, choroplèthe, isochrone, battle, scoring, PMTiles, MVT, ou panneaux.
---

# Domaine métier GEOMATIK

## Vocabulaire

| Terme | Définition | Table/Ressource |
|-------|-----------|-----------------|
| **OOH** | Affichage publicitaire extérieur (panneaux, abribus, DOOH digital) | `panneaux` |
| **IRIS** | Découpage INSEE ~2000 hab (~51k zones France) | `iris` |
| **Carreaux Filosofi** | Grille INSEE 200m × 200m, indicateurs socio-démo | `carreaux_filosofi` (~2.3M lignes) |
| **Isochrone** | Zone accessible en N min (pied/vélo/voiture) via OpenRouteService | `isochrones_cache` |
| **Battle** | Découpage territorial sans chevauchement (Voronoï pondéré par isochrones) | `isochrone_battle_results` |
| **Choroplèthe** | Carte colorée par gradient selon un indicateur statistique | Layers MapLibre |
| **Scoring OOH** | Note composite d'un panneau (audience × démographie × trafic × proximité POI) | `scoring_results` |
| **PMTiles** | Tuiles vectorielles statiques, hébergées GitHub Releases | Proxy `/api/iris-tiles-proxy` |

## Données IRIS — Règles

- Colonnes socio-démo **dynamiques** — ajoutées au fil des imports INSEE. JAMAIS hardcoder la liste.
- `is_true_iris` : `true` → vrais IRIS (~16 400), `false` → IRIS communaux (~33 000)
- **Toute analyse statistique** doit filtrer `WHERE is_true_iris = true`
- PMTiles sur **GitHub Releases** (pas Supabase Storage, limite 50 MB)
- Proxy CORS : `/api/iris-tiles-proxy`
- `.trim()` obligatoire sur CSV INSEE (espaces invisibles dans headers/valeurs)
- Import IRIS : 17 colonnes démo, `computeDerived()` pour les colonnes calculées
- Pipeline : CSV → parse headers (.trim()) → validate → batch insert 50 → computeDerived()
- Colonnes hardcodées dans les SQL RPC = bug récurrent. Toujours vérifier.

## Carreaux Filosofi

- ~2.3M lignes, **ne jamais full table scan**
- `geom_3857` pré-calculé (EPSG:3857 pour MVT). Ne pas recalculer à la volée.
- 5 palettes couleur, simplification adaptative par zoom
- Lazy loading par bbox viewport uniquement

## Tuiles MVT

- Endpoint : `/api/tiles/[z]/[x]/[y]`
- `ST_AsMVT` avec colonnes géométrie pré-calculées
- **Gzip obligatoire** — MapLibre 5.x plante silencieusement sans
- LRU cache serveur
- Simplification adaptative par zoom (`ST_SimplifyPreserveTopology`)

## Scoring OOH

- RPC `compute_panneau_scores_v2` — scoring paramétrique
- Profils JSON dans table `scoring_profiles` (3 templates : Recrutement militaire, Commerce/Retail, Auto)
- Données GTFS transport (Bibus, 1039 arrêts)
- Bonus isochrone, résultats dans `scoring_results` (JSONB) + `score_ooh_total` dénormalisé

## Isochrones Battle

- Algo `ST_Subdivide` pour résoudre les chevauchements
- 7 tiers (10, 15, 20, 30, 45, 60, 90 min)
- Fonction `VOLATILE` avec tables temporaires
- Cache dans `isochrones_cache`
- Endpoint streaming NDJSON pour stats de couverture
- `clip_rings_to_france` utilise table `france_boundary`
- ⛔ JAMAIS modifier `get_isochrone_battle` ou `clip_geojson_to_france` sans demande explicite

## Multi-agents IA (GEO.Prompt)

- Routeur multi-agents avec 6 agents spécialisés : demographie, poi_clustering, panneaux, isochrone_battle, benchmark, weblift
- Table `data_registry` — drive les system prompts Mistral ET les dropdowns frontend
- 1 outil = 1 fichier dans `lib/chat/tools/`, retourne données structurées (jamais texte libre)
