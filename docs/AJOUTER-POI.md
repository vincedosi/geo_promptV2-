# Ajouter un nouveau type de POI au système de clustering

Le système de clustering POI Filosofi est entièrement générique. Aucun type de POI n'est codé en dur — tout est paramétré via la colonne `categorie` de la table `poi_france`.

---

## Procédure complète

### 1. Insérer les POI dans la base

```sql
INSERT INTO poi_france (id, nom, lat, lng, categorie, geom)
VALUES
  (gen_random_uuid(), 'Concession Paris 15', 48.840, 2.300, 'concession',
   ST_SetSRID(ST_MakePoint(2.300, 48.840), 4326)),
  (gen_random_uuid(), 'Concession Lyon Part-Dieu', 45.760, 4.860, 'concession',
   ST_SetSRID(ST_MakePoint(4.860, 45.760), 4326));
```

Le trigger `auto_set_geom` remplit automatiquement `geom` si vous fournissez `lat`/`lng` sans `geom`.

> **Important** : la colonne `categorie` doit être identique à celle utilisée lors de la génération des isochrones battle (via l'interface `/map`).

---

### 2. Calculer les isochrones + clustériser

#### Option A — Pipeline complet (nouveaux POI uniquement)

```bash
# Calculer les isochrones ORS + assigner les clusters pour les "concessions"
python scripts/clustering_poi_filosofi.py \
  --mode pipeline-new \
  --poi-type concession \
  --duration 60 \
  --transport drive
```

Cela :
1. Détecte les POI avec `needs_clustering = TRUE` et `categorie = 'concession'`
2. Appelle ORS pour chaque POI manquant dans le cache isochrone
3. Calcule le profil Filosofi de chaque isochrone
4. Applique le modèle de clustering existant
5. Sauvegarde les résultats dans `poi_clusters`

#### Option B — Full retrain sur un seul type

```bash
# Réentraîner uniquement sur les "concessions"
python scripts/clustering_poi_filosofi.py \
  --mode full-retrain \
  --poi-type concession \
  --duration 60
```

#### Option C — Full retrain sur tous les types ensemble

```bash
# Sans --poi-type = tous les types sont inclus dans un seul modèle
python scripts/clustering_poi_filosofi.py \
  --mode full-retrain \
  --duration 60
```

> Recommandé : clusteriser tous les types ensemble pour une segmentation comparative.

---

### 3. Vérifier les types disponibles

```bash
# Lister tous les types + leur statut de clustering
python scripts/clustering_poi_filosofi.py --mode list-poi-types
```

Sortie attendue :
```
======================================================================
  TYPES DE POI DISPONIBLES
======================================================================
  TYPE                   TOTAL  CLUSTERES  STATUT
  --------------------  -------  ----------  --------------------
  cirfa                      42          42  [OK] tous clusteres
  concession                 18           0  [AUCUN] aucun cluster
  lycee                       8           8  [OK] tous clusteres
======================================================================
```

Ou via API :
```bash
curl http://localhost:3000/api/poi-clusters/poi-types
```

Réponse :
```json
{
  "types": [
    { "type": "cirfa",      "total": 42, "clustered": 42, "has_clusters": true },
    { "type": "concession", "total": 18, "clustered":  0, "has_clusters": false },
    { "type": "lycee",      "total":  8, "clustered":  8, "has_clusters": true }
  ]
}
```

---

### 4. Visualiser sur /map

Après le clustering, ouvrir `/map` et activer le panneau **CLUSTERS**. Le sélecteur de durée (30/45/60 min) fonctionne pour tous les types.

Pour filtrer par type sur la carte, l'API `/api/poi-clusters?duration=60` retourne tous les POI clustérisés (tous types confondus). Le filtrage visuel peut être ajouté ultérieurement via `?poi_type=concession`.

---

## Référence des arguments CLI

| Argument | Description | Exemple |
|----------|-------------|---------|
| `--poi-type` | Filtrer par type(s), séparés par virgule | `--poi-type cirfa` ou `--poi-type cirfa,lycee` |
| `--mode list-poi-types` | Lister les types disponibles | — |
| `--duration` | Durée isochrone en minutes | `30`, `45`, `60`, ou `all` |
| `--transport` | Mode de transport | `drive`, `walk`, `bike` |
| `--dry-run` | Simuler sans écrire en base | — |

## Aucune modification de code requise

Le système est conçu pour être étendu sans toucher au code source :
- Nouveau type → insérer dans `poi_france` avec `categorie = 'mon_type'`
- Lancer `pipeline-new` ou `full-retrain`
- Visible automatiquement dans `list-poi-types` et l'API `/api/poi-clusters/poi-types`
