# Health Check Admin — Database Overview

## 📊 Vue d'ensemble

La page `/admin/health` affiche maintenant une **vue complète de votre base de données Supabase**, incluant :

- ✅ **Liste de toutes les tables** du schéma public
- 📈 **Nombre de lignes** dans chaque table  
- 💾 **Espace occupé** par chaque table (données + index)
- 🔢 **Statistiques globales** (total tables, total lignes, espace total)

---

## 🚀 Installation

### 1. Fonction SQL pour les tailles (Optionnel mais recommandé)

Pour afficher les tailles des tables, exécutez le script SQL suivant dans **Supabase SQL Editor** :

```bash
# Chemin du script
genesis_app/sql/004_get_table_sizes_function.sql
```

**Étapes :**
1. Ouvrir Supabase Dashboard
2. Aller dans **SQL Editor**
3. Copier-coller le contenu du fichier `004_get_table_sizes_function.sql`
4. Cliquer sur **Run**

Cette fonction PostgreSQL (`get_table_sizes()`) utilise les tables système PostgreSQL pour calculer :
- Taille totale de chaque table (données + index)
- Taille des données seules  
- Taille des index

---

## 📋 Tables analysées

Le health check interroge automatiquement ces tables (si elles existent) :

- `organizations`
- `profiles`
- `data_sources`
- `panneaux`
- `poi`
- `carreaux_insee`
- `carreaux_filosofi`
- `isochrones_cache`
- `saved_maps`
- `org_memberships`
- `poi_sources`
- `voronoi_cells`

> **Note :** Les tables inexistantes sont ignorées silencieusement.

---

## 🔧 Personnalisation

Pour ajouter d'autres tables à surveiller, modifiez le tableau `tablesToCheck` dans :

```typescript
// genesis_app/app/api/admin/health/route.ts
const tablesToCheck = [
  'organizations',
  'profiles',
  // ... ajoutez vos tables ici
];
```

---

## 📊 Exemple de sortie

### Statistiques globales

```
Tables:         12
Lignes totales: 45,892
Espace total:   234.56 MB
```

### Détail par table

| Table             | Lignes  | Taille totale | Table  | Index  |
|-------------------|---------|---------------|--------|--------|
| panneaux          | 25,432  | 128 MB        | 115 MB | 13 MB  |
| poi               | 12,890  | 67 MB         | 58 MB  | 9 MB   |
| carreaux_filosofi | 5,234   | 28 MB         | 24 MB  | 4 MB   |
| ...               | ...     | ...           | ...    | ...    |

---

## 🐛 Troubleshooting

### Les tailles affichent "N/A"

**Cause :** La fonction SQL `get_table_sizes()` n'est pas installée.

**Solution :** Exécutez le script `sql/004_get_table_sizes_function.sql` dans Supabase.

### Certaines tables n'apparaissent pas

**Cause :** La table n'existe pas ou n'est pas accessible avec le service role key.

**Solution :** 
1. Vérifiez que la table existe dans Supabase
2. Vérifiez les permissions RLS (Row Level Security)
3. Vérifiez que `SUPABASE_SERVICE_ROLE_KEY` est configuré

### Erreur "Failed to fetch table stats"

**Cause :** Problème de connexion à Supabase.

**Solution :**
1. Vérifiez la configuration dans `.env.local`
2. Testez la connexion dans la section "Connectivité Supabase"

---

## 🔐 Sécurité

- La fonction `get_table_sizes()` utilise `SECURITY DEFINER` pour accéder aux tables système PostgreSQL
- Seuls les utilisateurs authentifiés (`authenticated` role) peuvent l'appeler
- Le service role key est requis pour interroger toutes les tables

---

## 🎯 Utilisation

1. Ouvrir **http://localhost:3000/admin/health**
2. Voir la section **"Database Overview"**
3. Cliquer sur **"Re-tester"** pour rafraîchir les données

---

## 📝 Développement

### Types TypeScript

```typescript
// types/admin.ts
interface TableStats {
  table_name: string;
  row_count: number;
  total_size: string;
  total_size_bytes: number;
  table_size: string;
  indexes_size: string;
}

interface DatabaseOverview {
  total_tables: number;
  total_rows: number;
  total_size: string;
  total_size_bytes: number;
  tables: TableStats[];
}
```

### API Response

```json
{
  "success": true,
  "status": "OK",
  "summary": "Tout est OK",
  "checks": [...],
  "database": {
    "total_tables": 12,
    "total_rows": 45892,
    "total_size": "234.56 MB",
    "total_size_bytes": 245987328,
    "tables": [...]
  },
  "timestamp": "2026-03-04T..."
}
```

---

## 🎨 UI Components

La page utilise les composants Genesis standard :

- `.g-card` — Carte principale
- `.g-card-header` — En-tête avec icône et titre
- `.g-card-body` — Contenu
- `JetBrains Mono` — Police monospace pour les chiffres

---

## 🚀 Performance

- Les requêtes sont exécutées en parallèle pour chaque table  
- Les tables inexistantes sont ignorées (pas d'erreur)
- Le cache n'est pas utilisé (données en temps réel)
- Temps moyen : ~1-2 secondes pour 12 tables

---

## 📚 Références

- [PostgreSQL pg_stat_user_tables](https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-ALL-TABLES-VIEW)
- [PostgreSQL pg_total_relation_size](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-DBSIZE)
- [Supabase Database Functions](https://supabase.com/docs/guides/database/functions)

---

✨ **Maintenant vous avez une vue complète de votre base de données Supabase !**
