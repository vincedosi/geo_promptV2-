# GEO.Prompt — AI Media Planning Platform

> Anciennement "GENESIS" — rebaptisé GEO.Prompt en v4.1.0
> Plateforme intelligente de planification media outdoor (OOH).

---

## ⚠️ RÈGLES DE DÉVELOPPEMENT OBLIGATOIRES

### 1. LOGS — Toujours logger les opérations critiques

Toute API route, fonction d'import, ou opération DB **doit** avoir des logs structurés :

```typescript
// ✅ BON — log avec préfixe et contexte
console.log('[INSERTER] Start insertRows: 687 lignes, type="poi"');
console.error('[INSERTER] Erreur SQL ligne #42:', err.message, { id: row.id, lat: row.lat });
console.log('[INSERTER] Résumé: inserted=100, ignored=0, errors=0');

// ❌ MAUVAIS — log sans contexte
console.log('done');
console.error(err);
```

**Format des préfixes :**
| Module | Préfixe |
|--------|---------|
| Import Inserter | `[INSERTER]` |
| Import Execute API | `[EXECUTE]` |
| Organizations API | `[ORGS]` |
| Sources API | `[SOURCES]` |
| Health API | `[HEALTH]` |
| Auth | `[AUTH]` |
| Géocodage BAN | `[GEO]` |

**Logs obligatoires dans chaque import :**
1. Début avec nombre de lignes et type
2. URL DB (masquée)
3. Schema check résultat (colonnes présentes/absentes)
4. Première ligne du premier batch (pour debug)
5. Résumé final (inserted / ignored / errors)
6. Première erreur SQL si erreurs

---

### 2. VERSIONING — Incrémenter à chaque modification

**Fichier central :** `lib/version.ts`

```typescript
export const APP_VERSION = '4.1.0'; // ← TOUJOURS INCRÉMENTER ICI
```

**Règle de versioning (Semantic Versioning) :**

| Type de changement | Version | Exemple |
|-------------------|---------|---------|
| Refonte majeure / breaking change | MAJOR | 4.0.0 → 5.0.0 |
| Nouvelle feature | MINOR | 4.0.0 → 4.1.0 |
| Bugfix / logs / ajustements | PATCH | 4.1.0 → 4.1.1 |

**Procédure à chaque modification :**
1. Modifier le code
2. Incrémenter `APP_VERSION` dans `lib/version.ts`
3. Ajouter une entrée dans `CHANGELOG`
4. Le numéro de version s'affiche automatiquement dans la sidebar

```typescript
// Dans lib/version.ts — toujours ajouter en haut du CHANGELOG :
{
  version: '4.1.1',
  date: '2026-02-25',
  type: 'patch',
  changes: [
    'Fix: description du bug corrigé',
  ],
},
```

---

### 3. ERREURS — Toujours remonter les erreurs SQL au client

Tout `catch` dans un insert DB doit :
1. Logger l'erreur avec `console.error`
2. Capturer `err.message` et le retourner
3. L'afficher dans l'UI (alerte rouge avec message SQL)

```typescript
// ✅ BON — erreur remontée et visible
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[INSERTER] Erreur SQL:', msg, rowData);
  if (!firstError) firstError = msg;
  errors++;
}
// Puis dans le retour : return { ..., firstError }
// Et dans l'API route : send({ type: 'complete', firstError: result.firstError })
```

---

## 🏗️ Architecture

```
genesis_app/
├── app/
│   ├── admin/
│   │   ├── health/          # ← Page diagnostic système
│   │   ├── import/          # ← Import Universel (5 étapes)
│   │   ├── carreaux-import/ # ← Import Carreaux INSEE
│   │   ├── sources/         # ← Gestion des sources de données
│   │   └── organizations/   # ← Gestion multi-tenant
│   ├── api/
│   │   └── admin/
│   │       ├── health/      # ← GET: diagnostic complet
│   │       ├── import-poi/  # ← POST: import + SSE progress
│   │       ├── sources/     # ← CRUD sources
│   │       └── organizations/ # ← CRUD orgs
│   ├── map/                 # ← Carte interactive
│   └── login/               # ← Auth Supabase
├── lib/
│   ├── version.ts           # ← VERSION CENTRALE (TOUJOURS INCRÉMENTER)
│   ├── import/
│   │   ├── inserter.ts      # ← Insert DB avec logs verbose
│   │   ├── validator.ts     # ← Validation + géocodage
│   │   ├── file-parser.ts   # ← Parse CSV/XLSX/GeoJSON
│   │   └── types.ts         # ← Types TypeScript
│   ├── auth.ts              # ← createAdminClient (service_role)
│   └── supabase.ts          # ← Client Supabase public
└── components/
    └── GenesisNav.tsx       # ← Navigation (affiche APP_VERSION)
```

---

## 🔑 Variables d'environnement requises

| Variable | Requis | Usage |
|----------|--------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Connexion Supabase (client + serveur) |
| `SUPABASE_ANON_KEY` | ✅ | Requêtes Supabase serveur |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Page Login (côté client) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Admin: bypass RLS, opérations admin |
| `SUPABASE_DB_URL` | ✅ | Insert direct PostgreSQL + PostGIS |
| `MISTRAL_API_KEY` | ⚠️ | Résumés IA sources (optionnel) |

> Vérifier la config : **http://localhost:3000/admin/health**

---

## 🗄️ Tables Supabase (migration SQL)

Tables créées par `genesis_etl/sql/backoffice_tables.sql` :
- `organizations` — clients (multi-tenant)
- `profiles` — utilisateurs avec rôles
- `data_sources` — tracking des imports
- `poi_france` — POI avec `data_source_id` + `organization_id`
- `panneaux_affichage` — panneaux avec `data_source_id` + `organization_id`

> ⚠️ Si colonnes `data_source_id`/`organization_id` manquantes dans poi_france :
```sql
ALTER TABLE poi_france
  ADD COLUMN IF NOT EXISTS data_source_id UUID REFERENCES data_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE panneaux_affichage
  ADD COLUMN IF NOT EXISTS data_source_id UUID REFERENCES data_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
```

---

## 📦 Stack technique

- **Framework** : Next.js 14 App Router + TypeScript
- **DB** : Supabase (PostgreSQL 15 + PostGIS 3.3)
- **Auth** : Supabase Auth (email/password)
- **Carte** : Mapbox GL JS + Leaflet (fallback)
- **IA** : Mistral API (résumés sources)
- **Géocodage** : API BAN (data.gouv.fr — gratuit)
- **UI** : Design system GEO.Prompt (CSS custom, JetBrains Mono)
- **Auth** : Better Auth avec Drizzle ORM (PostgreSQL/Supabase)

---

## 🔐 Authentication (Better Auth)

La plateforme utilise **Better Auth** pour gérer l'authentification SaaS multi-tenant.

### Configuration

Fichiers clés :
- **`lib/better-auth.ts`** — Configuration Better Auth + Drizzle
- **`lib/db/schema.ts`** — Schéma de base de données
- **`app/api/auth/[...auth]/route.ts`** — Endpoint API Auth
- **`lib/auth-client.ts`** — Hooks client (useSession, useSignIn, etc.)
- **`lib/auth-server.ts`** — Utilities serveur (getSession, requireAuth)
- **`middleware.ts`** — Protection des routes

### Démarrage rapide

1. **Définir les variables d'environnement** (`.env.local`) :
   ```env
   DATABASE_URL=postgresql://...
   BETTER_AUTH_SECRET=<random-secret>
   BETTER_AUTH_URL=http://localhost:3000
   ```

2. **Créer les tables** : Exécuter les migrations dans Supabase SQL Editor
   ```sql
   -- Copy from: lib/db/migrations/001_init_better_auth.sql
   ```

3. **Utiliser côté client** :
   ```typescript
   import { useSession, useSignIn } from "@/lib/auth-client";
   const { session } = useSession();
   ```

4. **Protéger les routes serveur** :
   ```typescript
   import { requireAuth } from "@/lib/auth-server";
   const session = await requireAuth(); // Throws si non authentifié
   ```

📚 Voir **[BETTER_AUTH_SETUP.md](./BETTER_AUTH_SETUP.md)** pour la documentation complète.

---

## 🚀 Démarrage

```bash
cd C:/GENESIS/genesis_app
npm install --legacy-peer-deps
npm run dev
# → http://localhost:3000
# → Health check: http://localhost:3000/admin/health
```

---

*GEO.Prompt v4.1.0 — AI Media Planning Platform*
