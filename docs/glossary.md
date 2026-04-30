# Glossaire métier — GEOMATIK

Pour un dev qui prend la main sur le projet sans connaître le métier OOH/DOOH/DSP.

## OOH / DOOH / Display

| Terme | Définition |
|---|---|
| **OOH** | Out-of-Home — affichage extérieur classique (panneaux, abribus, MUPI) |
| **DOOH** | Digital Out-of-Home — écrans LED/numériques en extérieur (gares, centres co, panneaux digitaux) |
| **Display** | Publicité bannière sur web/mobile (par opposition à OOH/DOOH physiques) |
| **Programmatic** | Achat publicitaire automatisé via plateforme algorithmique (DSP) |

## Acteurs

| Terme | Définition |
|---|---|
| **DSP** | Demand-Side Platform — plateforme côté annonceur qui achète des impressions en temps réel. Ex: TTD (The Trade Desk), DV360 (Google), Adform, Meta Ads |
| **SSP** | Supply-Side Platform — plateforme côté éditeur qui vend ses inventaires |
| **DMP** | Data Management Platform — gère les segments d'audience |
| **Adserver** | Ancien modèle (non programmatic) — Adform legacy GEOMATIK |
| **Planner** | Personne (côté agence) qui pilote la stratégie média d'une campagne |
| **Annonceur** | Marque qui achète la campagne (ex: Renault) |
| **Régie** | Vendeur d'espace pub (ex: Mediatransports) — terme français pour SSP/network |

## Bidding

| Terme | Définition |
|---|---|
| **Bid** | Enchère unitaire pour une impression (cents d'€) |
| **Bid multiplier** | Coefficient appliqué au bid de base pour une zone/cible (ex: 1.5x = +50%) |
| **Floor bid** | Bid minimum accepté par le SSP |
| **Ceiling bid** | Bid maximum que le DSP accepte de pousser |
| **Bid request** | Le SSP demande "qui veut bidder sur cette impression ?" |
| **Bid won** | L'annonceur a gagné l'enchère et l'impression a été délivrée |
| **Win rate** | bid_won / bid_requests — taux de succès des enchères |
| **Custom Bidding** | Système GEOMATIK qui ajuste les bid_multipliers par CP/zone via ML (Hoeffding) |

## Métriques classiques

| Sigle | Sens |
|---|---|
| **CPM** | Coût pour mille impressions |
| **CPC** | Coût par clic |
| **CPL** | Coût par lead (conversion) |
| **CPA** | Coût par action / acquisition |
| **CTR** | Click-through rate (clicks / impressions) |
| **ROAS** | Return on ad spend (revenue / spend) |
| **Tracked ads** | Ads avec tracking pixel — métrique Adform |
| **Unique impressions** | Impressions dédupliquées par utilisateur |

## Concepts ML

| Terme | Définition |
|---|---|
| **Online learning** | Apprentissage incrémental (1 sample à la fois, pas de batch) |
| **Concept drift** | Changement de la distribution sous-jacente des données dans le temps (ex: covid → comportement consommateur change) |
| **ADWIN** | Adaptive Windowing — détecteur de drift utilisé par river / Hoeffding |
| **Drift event** | Détection d'un drift → row dans `bidding_drift_events` |
| **Hoeffding Adaptive Tree** | Arbre de décision online qui s'adapte au drift (Domingos & Hulten 2000) |
| **Reward** | Signal de récompense pour l'algo (GEOMATIK : `leads − (1/12.5) * spend`) |
| **Lift** | Différence relative entre prédiction et baseline (en %) |
| **Bandit (LinUCB, Thompson)** | Famille d'algos exploration/exploitation — concurrent de Hoeffding |

## Géographie INSEE

| Terme | Définition |
|---|---|
| **IRIS** | Îlot Regroupé pour l'Information Statistique — zonage INSEE (~51k en France, ~2000 hab par IRIS) |
| **CP** | Code postal (~6000 en France) |
| **Carreaux Filosofi** | Grille INSEE 200m × 200m avec stats socio-démo (population, revenu, ménages) — 2.3M cells |
| **Tier de zone** | Catégorie géo : `premium_urban` / `urban` / `suburban` / `rural` (déduit du CP) |
| **TMJA** | Trafic Moyen Journalier Annuel — comptages routiers |
| **DROM** | Départements et Régions d'Outre-Mer (Guadeloupe, Martinique, etc.) |

## DSP sources GEOMATIK

| Source | Type | Statut |
|---|---|---|
| `adform` | Adserver | Legacy (4 campagnes, 294k rows, intactes) |
| `ttd` | DSP The Trade Desk | Actif (campagne démo Renault Captur) |
| `dv360` | DSP Google | Supporté côté schema, pas de campagne en base |
| `xandr` | DSP Microsoft | Supporté côté schema |
| `amazon_dsp` | DSP Amazon | Supporté côté schema |
| `other` | Autre | Fallback |

## Acronymes spécifiques GEOMATIK

| Sigle | Sens |
|---|---|
| **GeoAgent** | Agent IA superviseur (chantier A4.5) |
| **Custom Geo Capture** | Système de captures de zones personnalisées (chantier earlier) |
| **Pilotage ML** | UI Custom Bidding dans `/custom-bidding` (chantier A4.4) |
| **PMTiles** | Format de tiles MapLibre (utilisé pour IRIS bas zoom) |
| **MVT** | Mapbox Vector Tiles — format binaire pour tiles vectorielles |
