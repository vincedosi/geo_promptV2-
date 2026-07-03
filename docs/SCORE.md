# Mission — Notebook Jupyter d'exploration du score d'alignement géo

## Contexte

Le script CLI `scripts/scoring/geo_alignment.py` que tu as déjà produit fonctionne (validé sur 1 campagne, score 94.5 sur Marine Q2). Maintenant je veux **passer en mode exploration** : un notebook Jupyter qui permet de tester rapidement plein de cibles socio-démo sur le batch complet de campagnes, avec viz et comparatif.

**1 vague = 1 fichier Excel = 1 campagne.** Le notebook scanne tous les fichiers présents dans `C:\GENESIS\genesis_app\TEST\`.

## Étape 0 — Lis ces skills + le code existant

- `dsp-campaigns`, `geomatik-metier`, `supabase-geomatik`
- Réutilise les fonctions du script CLI existant (`scripts/scoring/geo_alignment.py`) : load Excel, matching postal→IRIS, calcul affinity. Si besoin, **refactore le script** pour exposer les fonctions clés en module importable (`from scripts.scoring.geo_alignment import load_campaigns, match_iris, compute_affinity, score_campaign`), puis le notebook les importe.

## Bug à corriger d'abord

Dans le calcul d'affinity, **filtrer les IRIS à très faible population**. Sur la première run, l'IRIS de Viroflay (786860101) est sorti avec affinity = 497.5 et 0 imp → outlier statistique parce que sa pop totale est ridicule.

→ **Ajouter un filtre `pop_totale_iris >= 200` dans le calcul de la baseline nationale ET dans le compute par campagne.** Paramètre exposé (`min_population=200` par défaut, modifiable).

## Livrable

Un notebook **`notebooks/geo_alignment_explorer.ipynb`** structuré en sections claires avec markdown intermédiaire.

## Architecture du notebook

### Section 1 — Setup
- Import libs (pandas, numpy, plotly, ipywidgets, psycopg2, dotenv, jinja2 pour le dashboard HTML)
- Connexion Supabase via `SUPABASE_DB_URL`
- Définition du dossier d'input (par défaut `C:\GENESIS\genesis_app\TEST`)

### Section 2 — Chargement des campagnes (1 fois)
- Scan dynamique du dossier
- Lecture de l'onglet `Sheet` de chaque fichier (Postal Code en string, Tracked Ads nettoyé)
- Concaténation en un seul DataFrame `df_raw` avec colonne `source_file`
- Affiche un résumé : nombre de fichiers, nombre de campagnes uniques, total imp

### Section 3 — Matching postal → IRIS (1 fois, avec cache local)
- Une seule grosse requête Postgres avec la liste distincte des `(postal_code, city)` du batch
- **Cache le résultat en parquet** dans `notebooks/.cache/iris_match.parquet` pour éviter de retaper Supabase aux runs suivants. Invalidation cache si nouveau fichier détecté dans TEST/.
- Distribution des `tracked_ads` au prorata pop quand multi-IRIS par postal
- DataFrame résultat `df_matched` (1 ligne par campagne × IRIS)
- Affiche le `iris_match_rate` global

### Section 4 — Découverte des colonnes IRIS (1 fois)
- Query `information_schema.columns` pour récupérer les colonnes numériques de `iris`
- Filtrage colonnes techniques
- Groupement par préfixe (`pop_*`, `cs_*`, `men_*`, `rev_*`)
- Affiche la liste lisible

### Section 5 — Sélecteur de cible interactif (ipywidgets)
- Widget `SelectMultiple` (avec recherche idéalement) listant les colonnes dispos, groupées par catégorie
- Champ `min_population` (slider, défaut 200, range 0-1000)
- Bouton "Calculer le score"
- Affichage du label de cible sélectionné + référence nationale calculée

### Section 6 — Compute du score (cellule rerunnable)
- Prend la cible courante (depuis le widget ou variable Python si on veut scripter)
- Calcule baseline nationale (sur IRIS filtrés `pop_totale >= min_population` ET `is_true_iris = true`)
- Calcule affinity par IRIS
- Joint avec `df_matched`
- Calcule par campagne : `score_alignment`, `pct_imp_on_target`, `pct_imp_neutral`, `pct_imp_off_target`, `gini_concentration`, `top3_*`
- Stocke le résultat dans un dict `runs[target_label] = df_results` pour pouvoir comparer plusieurs cibles plus tard
- Affiche le DataFrame résultat avec couleur conditionnelle (rouge si <90, vert si >110)

### Section 7 — Viz exploratoire (par cible)
- **Scatter** `affinity_iris × tracked_ads` par campagne (Plotly, hover avec ville/code IRIS) → permet de voir d'un coup où les imp atterrissent
- **Histogramme** distribution des affinity par campagne (subplots)
- **Barchart horizontal** classement campagnes par score
- **Carte de France** choroplèthe par département (moyenne affinity pondérée par imp) — si simple à faire avec Plotly, sinon skip

### Section 8 — Comparaison multi-cibles
- Une fois plusieurs runs faits (ex : pop_18_24, pop_25_34, cs_cadres), produit la **matrice campagne × cible** :

| campaign | pop_18_24 | pop_25_34 | cs_cadres | best_target |
|---|---|---|---|---|
| MARINE-Q2 | 94.5 | 102.1 | 88.3 | pop_25_34 |
| ... | | | | |

- Heatmap Plotly de cette matrice
- Pour chaque campagne : auto-détection de la **meilleure cible** (= score max parmi les vagues testées)

### Section 9 — Export CSV + Dashboard HTML
- Export `_output/score_campaigns_<target_label>.csv` pour la dernière vague
- Export `_output/score_matrix_multi_target.csv` pour le comparatif
- **Génère un dashboard HTML autonome** `_output/dashboard.html` :
  - Template Jinja2 inliné dans le notebook (CSS + JS embarqués, pas de CDN externe pour que ça marche offline)
  - Inclut : heatmap matrice, top/flop campagnes, scatter de la dernière cible, top3 dérives
  - Plotly figs converties en HTML autonome via `fig.to_html(include_plotlyjs='inline')`
  - Le dashboard doit s'ouvrir directement dans un navigateur sans serveur

## Contraintes

- ⛔ Ne JAMAIS modifier `/api/isochrone-battle/route.ts` ni les RPC PostGIS battle
- Compute Supabase Nano : tout le matching postal→IRIS doit tenir en 1 requête
- Cache parquet pour ne pas retaper Supabase à chaque relance
- ipywidgets doit être listé dans `requirements.txt` (ou le script t'indique d'installer)
- Notebook doit pouvoir tourner de bout en bout (Cell → Run All) sans intervention manuelle, en mode "cible par défaut = pop_18_24" si pas de widget
- Tout chemin via `pathlib.Path`

## Validation à afficher dans le notebook

À la fin de chaque run de cellule de score :
- Cible utilisée (label + ref nationale)
- Score moyen du batch
- 🥇 / 🥉 campagnes
- 3 dérives les plus grosses

À la fin de la section comparaison multi-cibles :
- Matrice complète
- Pour chaque campagne, sa best_target

## Démarrage

Refactore d'abord le script CLI pour extraire les fonctions réutilisables, puis génère le notebook. Pose une question si quelque chose est bloquant.