# Clustering POI × Filosofi — restauration et suite

> État au 2026-09-12. Étape 1 faite et vérifiée de bout en bout.

## Ce que c'est

Un k-means sur les POI, décrits par le profil sociodémographique Filosofi de
leur **isochrone** (ce qu'on atteint en N minutes autour du point). Deux POI se
retrouvent dans le même cluster quand les gens qui vivent autour se ressemblent
— pas quand les points sont proches.

Chaîne réelle :

```
POI → isochrone ORS (mise en cache) → compute_filosofi_profiles_batch (PostGIS)
    → matrice POI × variables → StandardScaler → PCA (85 % variance)
    → KMeans (K choisi par silhouette, 3..10) → libellés Gemini → Supabase
```

Le Python n'est **pas** le moteur : le calcul géographique est une RPC PostGIS,
les isochrones viennent d'ORS, les libellés de Gemini. Ce qui reste vraiment en
Python, c'est `sklearn` (scaler, PCA, k-means, silhouette) et un
`scipy.optimize.linear_sum_assignment` pour rattacher les clusters d'une version
à la suivante.

## Histoire courte

- **2026-07-05** — supprimée (commit `9213439`, merge `c14fe9f`) avec quatre
  autres sous-systèmes « études » : `geography_sets`, Couverture Filosofi,
  Corrélation IRIS×POI, Scoring OOH. Critère de l'audit
  (`docs/AUDIT_OBSOLETE.md`, commit `4fe31c5`) : *« jamais lu par la boucle »*.
  89 fichiers, −19 266 lignes. Tables droppées.
- **2026-09-12** — restaurée à la demande de Vincent, **étape 1 seulement**.

## Étape 1 — restauration locale ✅ FAIT

### Ce qui a été restauré

25 fichiers avaient été supprimés ; 22 sont revenus. Les trois autres sont des
choix explicites, détaillés plus bas.

| Domaine | Contenu |
|---|---|
| Base | `sql/141` — 4 tables + 5 colonnes jamais versionnées |
| API | 13 routes `/api/poi-clusters/*`, protégées |
| Carte | sources `clusters-source` et `wizard-highlight`, popup, capture de zone |
| Panneau | `filter-panel/ClusteringSection.tsx` dans la catégorie Analyses |
| Rapport | `ClusterDetails` en tiroir, via `ClusterResultsOverlay` |
| Moteur | `scripts/clustering_poi_filosofi.py` (3 288 lignes), inchangé |

### Vérification de bout en bout

Un `full-retrain` sur les CIRFA à 15 min voiture, **entièrement servi par le
cache d'isochrones** (aucun appel ORS) :

```
96 POI → 7 clusters · silhouette 0,3248 · 95 POI classés · 95 lignes d'historique
Libellés : « Précarité élevée / Mono-parentales », « Seniors actifs / Grand âge
/ Propriétaires », « Revenus élevés / Petits logements »…
Contrôles de cohérence intégrés : 8/9 OK, 4 avertissements
```

Le modèle apparaît dans le panneau (`v2 · SIL 0.325 · 7 clusters · 95 POI ·
15min drive`) et le rapport s'ouvre en tiroir.

### Ce qui n'a PAS été restauré, et pourquoi

**La page autonome `/clusters`.** La règle du projet, posée après la
suppression : *« tout passe par /map et ses overlays, pas de page métier
standalone »*. Le clustering existait déjà comme entrée dans la section
Analyses ; c'est cette porte-là qui est revenue.

**L'agent smart-prompt `poi_clustering`.** `detectSmartMode()` retourne `false`
sans condition depuis la V2 : c'était du code mort avant même la suppression.
Le restaurer aurait ramené du code inatteignable.

**Les exports XLSX et PDF** — arbitrage de Vincent : hors priorité. Voir la
section « Reste à faire » ci-dessous. Les deux boutons sont visibles mais
désactivés, avec la raison en infobulle : une fonction annoncée qui ne fait
rien est pire qu'une fonction visiblement indisponible.

### Défauts trouvés en restaurant

Restaurer du code de deux mois sur une base qui a bougé, ce n'est pas un
`git checkout`. Quatre choses ont dû être corrigées :

1. **`params` est devenu asynchrone** (Next 15, bumpé après la suppression) —
   6 routes migrées au patron du projet.
2. **La XSS des popups avait été fermée entre-temps.** Le popup de cluster
   interpolait `poi_name`, `ville` et `cluster_label` dans `setHTML` sans
   échappement. Restauré tel quel, il rouvrait la faille. Chaque valeur passe
   maintenant par `esc()`, et `cluster_color` n'est acceptée que si c'est un
   hexadécimal — elle entre dans un attribut `style`.
3. **Le tiroir de résultats était en `position: fixed` dans un ancêtre animé.**
   Les overlays du panneau ont gagné une animation depuis juillet, ce qui crée
   un bloc conteneur : le tiroir de 900 px se retrouvait comprimé dans une
   colonne de 280 px. Il passe maintenant par un portail vers `<body>`.
4. **La route `run` lisait son corps sans validation** — refusée par le garde
   SEC-001 du projet. Elle a désormais un schéma Zod, ce qui n'est pas un
   formalisme : ces valeurs partent en arguments de ligne de commande.

Et un défaut **dans mon propre garde-fou** : `tests/unit/api/routes-publiques.test.ts`
lisait `middleware.ts` avec une expression qui prend toute apostrophe pour un
délimiteur de chaîne. Les commentaires du fichier sont en français (« à
l'identique »…) : un nombre impair d'apostrophes décalait toute la liste lue.
Le test a déclaré non protégées quatre routes `isochrone-battle` qui l'étaient
depuis toujours. Corrigé — et la correction elle-même a buté sur le fait que
`.` ne franchit pas un `\r` en JavaScript, sur un dépôt en CRLF.

## Étape 2 — le faire marcher en production ⬜ À FAIRE

### Le problème

Le calcul est lancé par `child_process.spawn('python', …)` depuis une route API.
Il n'y a **aucun runtime Python sur Vercel**, et plus aucun `spawn` ailleurs
dans le code vivant. En production, la route crée un job qui échoue.

Elle le dit maintenant franchement (503 + message) au lieu de laisser un job
`failed` sans explication — mais elle ne le répare pas.

### La solution retenue : porter sur Modal

Le projet exploite déjà **Modal**, un service Python serverless déployé hors
Vercel (`modal/bidding_ml/`, 3 endpoints HTTPS, lecture Supabase en HTTPS).
`MODAL_BIDDING_ML_URL` est renseignée.

Pourquoi Modal plutôt qu'une réécriture TypeScript :

- **Zéro réécriture numérique.** sklearn et scipy restent ; les clusters seront
  identiques. Pas de « on a réimplémenté la PCA et les résultats ont bougé ».
- **Pas de limite de durée.** Un clustering enchaîne des centaines d'appels
  ORS ; Vercel coupe entre 60 et 300 s.
- **L'alternative TypeScript est bloquée.** Elle imposerait Inngest pour le job
  long, et **les clés Inngest sont absentes** — c'est déjà ce qui gèle pollen et
  ATMO en production.

### Ce qu'il faut faire

1. `modal/clustering_poi/app.py` — exposer `run_full_retrain`,
   `run_cache_isochrones` et `run_generate_analysis` en endpoints HTTPS, sur le
   patron de `modal/bidding_ml/app.py`.
2. Remplacer le `spawn` de `/api/poi-clusters/run` par un appel HTTPS, et faire
   écrire l'avancement dans `clustering_jobs` par Modal (le polling client
   existe déjà et n'a pas à changer).
3. Variable `MODAL_CLUSTERING_URL`, documentée dans `ARCHITECTURE.md`.

### Bloqué par

`MODAL_TOKEN_ID` et `MODAL_TOKEN_SECRET` sont **absentes de `.env.local`**.
Sans elles, impossible de déployer sur Modal. Action Vincent.

## Performance du profilage — mesurée, et une piste à 7,8×

### Le coût réel

`compute_filosofi_profiles_batch` est la phase lourde. Mesuré au
`EXPLAIN (ANALYZE, BUFFERS)` le 2026-09-12, sur 5 POI BMW à 30 min voiture :

```
19 818 ms pour 5 POI  →  ~4 s par POI
15 852 lectures disque + débordement en temp (3 256 lus / 3 263 écrits)
```

Extrapolation : 96 POI ≈ 6 min (le calcul de validation l'a confirmé), 254 POI
> 17 min (mon délai de 9 min l'a tué en pleine phase), un clustering national se
compte en heures.

**C'est la preuve chiffrée que le calcul ne peut pas vivre dans une fonction
Vercel** (60 à 300 s) : le plafond est atteint entre 15 et 75 POI.

### La cause n'est pas la géométrie

C'est le **jsonb**. La fonction joint `carreaux_filosofi` (2,3 M lignes, 4,6 Go)
et extrait **vingt-six champs** de `metadata` par carreau — chacun détoasté,
parsé, casté. Exactement le goulot que le projet avait déjà mesuré sur les
tuiles : *« son jsonb de 806 o/ligne impose un plancher d'environ 4 s par tuile
froide »* (`ARCHITECTURE.md`).

### La piste : profiler sur le palier 2 km

`carreaux_2km` porte **exactement les mêmes grandeurs en colonnes typées** —
122 018 lignes, aucun jsonb. Une variante a été écrite (`sql/142`,
`compute_filosofi_profiles_batch_2km`) et comparée à l'originale sur les mêmes
POI :

| | 200 m (actuel) | 2 km |
|---|---|---|
| Temps, 5 POI | 19 818 ms | **2 543 ms** (7,8×) |
| Lectures disque | 15 852 | **2 636** (6×) |
| Débordement temp | oui | **non** |

Écart sur les valeurs, moyenne / max :

| Variable | Écart moyen | Max |
|---|---|---|
| `revenu_moyen` | 0,52 % | 0,95 % |
| `pct_55_79` | 0,59 % | 1,34 % |
| `pct_0_17` | 0,61 % | 1,74 % |
| `pct_18_39` | 0,70 % | 2,00 % |
| `pct_40_54` | 0,71 % | 1,59 % |
| `taux_pauvrete` | 2,04 % | 3,91 % |
| `surface_moyenne` | 2,24 % | 3,53 % |
| `taux_isoles` | 2,91 % | 5,46 % |
| `taux_proprietaires` | 3,30 % | 5,36 % |
| `taux_collectif` | 7,85 % | 14,16 % |
| **`population_totale`** | **11,79 %** | **21,80 %** |

### Ce que ça veut dire

Les **seize variables du modèle** (`FEATURE_NAMES`) sont **toutes des ratios**,
et dérivent de moins de 3,5 % — sauf `taux_collectif`, plus sensible parce que
collectif/individuel bascule vite sur les mailles de bord.

`population_totale`, la seule grandeur à dériver fortement, **n'est pas une
variable du modèle** : elle est affichée
(`poi_clusters.population_totale_couverte`). Une maille de 2 km inclut ou exclut
en bloc, d'où les 12 %.

### Recommandation

**Profiler au 2 km, et recalculer la population au 200 m à la demande**, pour le
seul POI que l'utilisateur consulte. On paie 4 s une fois à la consultation, au
lieu de 4 s × N à chaque entraînement.

Ce n'est **pas** appliqué : substituer un palier d'agrégation change les
résultats, et ce n'est pas un choix à faire en silence. La variante est en base,
mesurée, prête à être branchée — la décision revient à Vincent.

Bénéfice secondaire, et il compte : sur Supabase **Nano**, 15 852 lectures
disque pour 5 POI est le profil d'usage qui a déjà épuisé le budget d'I/O trois
fois. Diviser par six le coût d'un job de plusieurs centaines de POI n'est pas
un luxe.

## Reste à faire — hors priorité

### Exports du rapport

- **XLSX** — `xlsx` a été retiré **délibérément** au profit d'exceljs
  (commit `3ed1eee`). Ne pas le réintroduire : l'export est à réécrire avec
  exceljs, comme le reste du projet.
- **PDF** — `@react-pdf/renderer` est tombé en dommage collatéral de la
  suppression du clustering (commit `7192c68`, « 4 deps ») : il n'avait aucun
  autre consommateur. `ARCHITECTURE.md` le liste pourtant encore comme
  dépendance — doc à corriger, ou dépendance à réinstaller au moment de
  restaurer le rapport. Le composant est récupérable :
  `git show 9213439^:components/ClusteringPDFReport.tsx`.

### Qualité du modèle

Le calcul de validation rend 8/9 contrôles au vert et 4 avertissements, dont
« couverture données : 69 % en moyenne, 15 POI sous 50 % ». Le script conclut
lui-même « clustering à revoir ». Avant d'investir dans l'étape 2, il vaut la
peine de regarder si ces avertissements viennent des données (isochrones
incomplètes) ou du paramétrage (variables retenues, durée).

### Une piste, si la feature est reprise sérieusement

Le clustering décrit les POI par le profil **Filosofi** de leur isochrone. La
cascade IRIS construite le 2026-09-12 (`sql/138-140`) donne accès aux mêmes
territoires avec **43 indicateurs INSEE** déjà agrégés, normalisés et bornés
nationalement. C'est une base plus riche que le couple POI × Filosofi d'origine,
et elle n'existait pas quand la feature a été écrite.
