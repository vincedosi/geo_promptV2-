# GEOMATIK — Back-office `/admin/sources/zones-personnalisees`

## OBJECTIF

Créer une page d'administration qui liste toutes les **zones personnalisées** (sets GeoJSON importés par les utilisateurs côté `/map/analyse/digital`), filtrables **par workspace**, avec possibilité de **visualiser** et **supprimer** chaque set.

C'est le pendant back-office de l'UI digital où l'utilisateur importe ses zones custom.

---

## PHASE 0 — RECONNAISSANCE (à faire AVANT de coder)

**Ne modifie rien tant que tu n'as pas répondu à ces questions.**

### 0.1 — Trouver où sont stockées les zones personnalisées

```bash
# Les zones personnalisées sont probablement dans une de ces tables.
# Identifie laquelle :
grep -rn "custom_zones\|zone_sets\|geography.*setId\|zones_personnalisees" --include="*.ts" --include="*.sql" app/ lib/ supabase/ sql/
```

Via MCP Supabase :
```
list_tables({ schemas: ["public"] })
```
Cherche toute table dont le nom contient `zone`, `custom`, `geography`, `set`.

### 0.2 — Identifier le schéma de la table

Une fois la table trouvée, récupère son schéma exact :
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = '<nom_trouvé>'
ORDER BY ordinal_position;
```

On a besoin de savoir précisément :
- La colonne qui identifie le **workspace / organization** (probablement `org_id` ou `organization_id` ou `workspace_id`)
- La colonne qui identifie le **user** qui a créé la zone
- La colonne qui contient le **nom** du set
- La colonne qui contient la **géométrie** ou le **geojson**
- La colonne de **date de création**
- Le nombre de **features** (si stocké, sinon à calculer)

### 0.3 — Vérifier comment les zones sont lues côté `/map/analyse/digital`

```bash
grep -rn "setId\|geography/\[setId\]" app/ --include="*.tsx" --include="*.ts" | head -20
```

Identifie la route API qui lit ces zones (probablement `/api/digital/[id]/geography/[setId]`). Lis son code pour comprendre la shape exacte.

### 0.4 — Vérifier la page `/admin/sources/` existante

```bash
ls app/admin/sources/
cat app/admin/sources/page.tsx
```

On doit **s'aligner** sur le pattern existant (layout, composants, auth, style).

### 0.5 — Identifier le pattern d'auth admin

```bash
grep -rn "requireAdmin\|adminFetch" app/admin/sources/ lib/ --include="*.ts" | head -10
```

**STOP. Partage-moi :**
1. Le nom exact de la table des zones personnalisées
2. Son schéma (colonnes)
3. Les routes API qui la lisent
4. Le layout/style de `/admin/sources/page.tsx` (juste un résumé)

**Puis attends ma validation avant de coder.**

---

## PHASE 1 — ROUTE API `/api/admin/custom-zones`

Créer `app/api/admin/custom-zones/route.ts` :

### GET — Liste des sets avec filtre workspace

Query params :
- `org_id` (optionnel) — filtre par organisation/workspace
- `q` (optionnel) — recherche textuelle sur le nom

Réponse :
```ts
{
  sets: Array<{
    id: string;
    name: string;
    org_id: string;
    org_name: string;       // JOIN sur organizations
    created_at: string;
    created_by: string | null;
    feature_count: number;  // COUNT des features du set
    bbox: [number, number, number, number] | null; // ST_Envelope
  }>;
  total: number;
}
```

Implémentation :
- `requireAdmin()` en tête
- `createAdminClient()` (service role)
- JOIN sur `organizations` pour récupérer `org_name`
- Tri par `created_at DESC` par défaut

### DELETE — Route séparée `/api/admin/custom-zones/[id]/route.ts`

- `requireAdmin()`
- Vérifier que le set existe
- Supprimer les features associées (si table séparée)
- Supprimer le set
- Retourner `{ deleted: true, id }`

**⚠️ Contrainte RLS :** utiliser le **service role key** car l'admin peut supprimer des sets de n'importe quel workspace. Ne jamais exposer ce pouvoir à une anon key.

---

## PHASE 2 — ROUTE API `/api/admin/organizations/list` (si pas déjà existante)

On a besoin de la liste des workspaces pour le filtre. Si une route existe déjà (`/api/admin/organizations`), la réutiliser. Sinon :

```ts
GET /api/admin/organizations/list
→ { organizations: [{ id, name, slug }] }
```

---

## PHASE 3 — PAGE `/admin/sources/zones-personnalisees/page.tsx`

### Structure (Next.js App Router, TypeScript strict, Tailwind)

```
app/admin/sources/zones-personnalisees/
├── page.tsx                    # Page principale (server component léger)
├── _components/
│   ├── ZonesList.tsx          # Client component : tableau + filtre workspace
│   ├── ZoneDeleteDialog.tsx   # Confirmation de suppression
│   └── WorkspaceFilter.tsx    # Select multi ou single workspace
└── _hooks/
    └── useCustomZones.ts      # Hook de fetch + refresh
```

### `page.tsx` (server component)

- Vérifie l'auth admin via `requireAdmin()` côté serveur
- Rend `<ZonesList />` (client component)
- Breadcrumb : `Admin > Sources > Zones personnalisées`

### `ZonesList.tsx` (client component)

Layout :
```
┌────────────────────────────────────────────────────────────┐
│ Zones personnalisées                                       │
│ Liste des sets GeoJSON importés par les utilisateurs       │
├────────────────────────────────────────────────────────────┤
│ [Filtre workspace: Tous ▼]  [🔍 Rechercher…]  [↻ Refresh]  │
├────────────────────────────────────────────────────────────┤
│ Nom            │ Workspace  │ Features │ Créé le   │       │
├────────────────────────────────────────────────────────────┤
│ Zones Paris    │ Acme Corp  │   42     │ 14/04/26  │ 🗑️   │
│ Quartiers Lyon │ Acme Corp  │   18     │ 13/04/26  │ 🗑️   │
│ Campagne Q2    │ DentsuFr   │  127     │ 10/04/26  │ 🗑️   │
└────────────────────────────────────────────────────────────┘
     12 sets — 4 287 features au total
```

Comportements :
- Au chargement : fetch `/api/admin/custom-zones` (tous workspaces)
- Changement du filtre workspace → re-fetch avec `org_id=...`
- Recherche : filtre côté client sur `name` (debounce 200ms)
- Clic sur 🗑️ → ouvre `ZoneDeleteDialog`
- Après suppression confirmée → refresh de la liste + toast `Set supprimé`
- État vide : message clair `Aucun set de zones personnalisées pour ce workspace`

### `ZoneDeleteDialog.tsx`

Modal de confirmation :
```
Supprimer "Zones Paris" ?
Workspace : Acme Corp
Features : 42

⚠️ Cette action est irréversible. Les utilisateurs de ce workspace
ne pourront plus utiliser ce set dans leurs analyses.

[Annuler]  [Supprimer définitivement]
```

Bouton principal en rouge. Loading state pendant la requête. Gestion d'erreur avec toast.

### `useCustomZones.ts`

```ts
export function useCustomZones() {
  const [sets, setSets] = useState<CustomZoneSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgFilter, setOrgFilter] = useState<string | null>(null);

  const fetchSets = useCallback(async () => {
    setLoading(true);
    const url = new URL('/api/admin/custom-zones', window.location.origin);
    if (orgFilter) url.searchParams.set('org_id', orgFilter);
    const res = await adminFetch(url.toString());
    const data = await res.json();
    setSets(data.sets);
    setLoading(false);
  }, [orgFilter]);

  const deleteSet = useCallback(async (id: string) => {
    await adminFetch(`/api/admin/custom-zones/${id}`, { method: 'DELETE' });
    await fetchSets();
  }, [fetchSets]);

  useEffect(() => { fetchSets(); }, [fetchSets]);

  return { sets, loading, orgFilter, setOrgFilter, deleteSet, refresh: fetchSets };
}
```

---

## PHASE 4 — LIEN DEPUIS `/admin/sources/`

Ajouter une carte / un lien sur la page `/admin/sources/page.tsx` :

```
┌──────────────────────────────────┐
│ 🗺️  Zones personnalisées         │
│ Sets GeoJSON importés par les    │
│ utilisateurs (côté digital)      │
│                                  │
│ 12 sets • 4 287 features         │
│                                  │
│ [Gérer →]                        │
└──────────────────────────────────┘
```

Pattern cohérent avec les autres cartes de la page (POI, OOH, IRIS…).

---

## PHASE 5 — DESIGN SYSTEM

**Respect strict de DESIGN_SYSTEM.md :**
- Dark mode uniquement (background `#0a0a0a`, surface `#1a1a1a`)
- Typo : Inter (UI), JetBrains Mono (tableaux chiffres, dates ISO, IDs)
- Couleurs : accent teal GEOMATIK pour les CTAs, rouge pour les actions destructives
- Densité d'info élevée (pas de padding excessif)
- Tableau propre, pas de bordures visibles, séparateurs subtils
- Hover row : léger éclaircissement

**Composants réutilisés :**
- Si `/admin/sources/page.tsx` utilise déjà un composant `<AdminTable />` ou `<AdminCard />`, les réutiliser, ne pas dupliquer.

---

## PHASE 6 — TESTS MANUELS

1. Se logger en admin, aller sur `/admin/sources/zones-personnalisees`
2. Vérifier que la liste charge tous les sets, tous workspaces confondus
3. Filtrer par workspace → seuls les sets de ce workspace apparaissent
4. Cliquer 🗑️ sur un set de test → confirmer → le set disparaît
5. Retourner sur `/map/analyse/digital` depuis le workspace concerné → vérifier que le set supprimé n'apparaît plus dans le fil d'Ariane
6. Tester avec un user non-admin → doit être bloqué (403)

---

## CONTRAINTES CRITIQUES

- **NE PAS toucher** aux routes `/api/digital/[id]/geography/[setId]` ni à la logique d'affichage côté map — on ne fait que lire et supprimer depuis le back-office
- **NE PAS toucher** à `/api/isochrone-battle/route.ts` (périmètre protégé)
- **Toujours** passer par `requireAdmin()` sur toutes les routes `/api/admin/custom-zones/*`
- **Toujours** utiliser le service role key côté serveur (jamais côté client)
- Respecter TypeScript strict (pas de `any`)
- Incrémenter `APP_VERSION` dans `lib/version.ts` à la fin

---

## LIVRABLES ATTENDUS

1. `app/api/admin/custom-zones/route.ts` (GET list)
2. `app/api/admin/custom-zones/[id]/route.ts` (DELETE)
3. `app/admin/sources/zones-personnalisees/page.tsx`
4. `app/admin/sources/zones-personnalisees/_components/ZonesList.tsx`
5. `app/admin/sources/zones-personnalisees/_components/ZoneDeleteDialog.tsx`
6. `app/admin/sources/zones-personnalisees/_components/WorkspaceFilter.tsx`
7. `app/admin/sources/zones-personnalisees/_hooks/useCustomZones.ts`
8. Lien ajouté dans `app/admin/sources/page.tsx`
9. Version bumpée dans `lib/version.ts`

---

## RAPPEL — ordre d'exécution

1. Phase 0 (reconnaissance) → **STOP, partage les infos**
2. J'adapte le prompt si nécessaire
3. Phases 1 → 6 en séquence
4. Test manuel final
