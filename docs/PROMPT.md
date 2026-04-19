# GEOMATIK — Custom Geo Zones / Étape 2 : Module galerie `/map/custom-geo` (V2)

> Réfère-toi à `CLAUDE.md` et `DESIGN_SYSTEM.md` à la racine avant de commencer.

## SKILLS OBLIGATOIRES

@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design @geomatik-metier @supabase-geomatik

---

## ⚠️ INFOS CRITIQUES — LIRE EN PREMIER

### Backend déjà prêt

**Les 2 RPC nécessaires à l'Étape 2 ont déjà été créées, testées et sécurisées.** Tu n'as pas à les recréer. Tu les appelles simplement via `supabase.rpc(...)` dans les routes API.

**RPC 1 : `get_custom_geo_zones_stats(p_org_id uuid) → jsonb`**

Shape du retour (testée, stable) :
```json
{
  "total": 3,
  "total_iris": 1931,
  "total_cp": 239,
  "most_recent_at": "2026-04-19T09:51:07.454531+00:00",
  "by_source_type": [
    { "source_type": "iris_selection", "count": 1 },
    { "source_type": "meteo_forecast", "count": 1 },
    { "source_type": "radio_coverage", "count": 1 }
  ]
}
```

Cas edge org vide testé : retourne `{ total: 0, total_iris: 0, total_cp: 0, most_recent_at: null, by_source_type: [] }`.

**RPC 2 : `list_custom_geo_source_types(p_org_id uuid) → jsonb`**

Shape :
```json
{ "source_types": ["iris_selection", "meteo_forecast", "radio_coverage"] }
```

Cas edge org vide : `{ "source_types": [] }`.

Sécurité : `SECURITY INVOKER`, RLS appliquée automatiquement via `get_user_org()`. Grants : `authenticated` + `service_role` uniquement. Pas d'`anon`.

### Rappel sécurité

**Problème découvert en Étape 1** : Claude Code avait laissé les grants `EXECUTE` à `anon` sur les RPC. Un superviseur a corrigé via migration `custom_geo_revoke_anon_from_rpcs`.

**Pour cette étape** : si tu crées une nouvelle RPC (à éviter, les 2 ci-dessus suffisent), applique toujours :
```sql
REVOKE EXECUTE ON FUNCTION public.<nom>(<args>) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.<nom>(<args>) TO authenticated;
```

---

## CONTEXTE

L'Étape 1 (fondations Custom Geo Zones) a livré :
- Tables `custom_geo_zones` + `custom_geo_zone_codes`
- RPC `create_custom_geo_zone`, `resolve_custom_geo_zone_codes`, `get_custom_geo_zone_feature`, `get_custom_geo_zones_stats`, `list_custom_geo_source_types`
- 7 routes API sous `/api/custom-geo/*`
- Composant `<SaveAsCustomZoneButton />` (standalone)

**Cette étape (Étape 2) construit l'interface utilisateur de gestion des zones custom.** C'est le cœur de la UX : la page où l'user voit toutes ses zones sauvegardées, les inspecte sur carte, les renomme, les supprime, les exporte, et les réutilise.

L'intégration dans `/map/analyse/digital` est une Étape 3 séparée.

---

## PRINCIPE UX

**C'est une page de galerie, pas un tableau administratif.**

L'user doit voir ses zones visuellement (preview carte inline) et pouvoir les manipuler. Rendu plus "Figma / Linear" que "phpMyAdmin" — visuel, dense, efficace.

Structure 3 panneaux :
1. **Sidebar gauche (260px)** : filtres `source_type` + stats + recherche textuelle
2. **Grille centrale (flex-1)** : cards des zones avec mini-preview carte, nom, compteurs IRIS/CP, date
3. **Panneau droit (480px, optionnel)** : détail d'une zone avec carte plein écran + actions

Route : `/map/custom-geo`

Ajout d'un lien dans la navigation principale `/map` (à côté de `analyse/digital`).

---

## PHASE 0 — RECONNAISSANCE

```bash
# Structure /map existante
ls app/map/
cat app/map/layout.tsx 2>/dev/null || echo "pas de layout"

# Comment /map/analyse/digital est structuré (server/client/hooks)
ls app/map/analyse/ 2>/dev/null
cat app/map/analyse/digital/page.tsx 2>/dev/null | head -50

# Navigation existante
grep -rn "GenesisNav\|MapNav" components/ app/ --include="*.tsx" | head -10

# Style MapLibre utilisé
grep -rn "geomatik-style\|MapContainer" lib/ components/ app/ --include="*.ts" --include="*.tsx" | head -10

# Helper auth SSR pour page server component
grep -rn "requireAuthPage\|getServerUser\|getCurrentUser" lib/ --include="*.ts" | head -10
```

**STOP. Partage-moi :**
1. Layout `/map` (composant nav partagé ?)
2. Structure de `/map/analyse/digital/page.tsx` (server/client, hooks principaux)
3. Composant MapLibre utilisé (`MapContainer`, `MapPanel`, `Map` ?) + le fichier de style (`geomatik-style.ts` ?)
4. Helper auth côté server component (si différent de `requireAuth()` qui est côté API)
5. Existence d'un composant mini-preview carte réutilisable

Attends validation avant Phase 1.

---

## PHASE 1 — ROUTES API

**Deux routes, chacune est un wrapper minimal autour des RPC existantes.**

### 1.1 — `GET /api/custom-geo/stats`

Fichier : `app/api/custom-geo/stats/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/api/middleware';
import { createClient } from '@/lib/supabase/server'; // adapter

const QuerySchema = z.object({
  org_id: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({ org_id: searchParams.get('org_id') });
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_custom_geo_zones_stats', {
      p_org_id: parsed.data.org_id,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

### 1.2 — `GET /api/custom-geo/source-types`

Même pattern, appelle `list_custom_geo_source_types`.

**C'est tout pour le backend.** Pas de RPC à créer. Pas de SQL à écrire.

---

## PHASE 2 — PAGE `/map/custom-geo`

### 2.1 — Structure fichiers

```
app/map/custom-geo/
├── page.tsx                         # Server component léger (auth + org_id)
├── CustomGeoPageClient.tsx          # Client orchestrateur
├── _components/
│   ├── ZonesSidebar.tsx             # Filtres + stats
│   ├── ZonesGrid.tsx                # Grille de cards
│   ├── ZoneCard.tsx                 # Card avec mini-preview
│   ├── ZoneDetailPanel.tsx          # Slide-in droite
│   ├── ZoneMapPreview.tsx           # Mini-carte non-interactive
│   ├── ZoneFullMap.tsx              # Carte interactive détail
│   ├── ZoneActionsMenu.tsx          # Dropdown ⋮
│   ├── ZoneRenameDialog.tsx         # Modal renommage
│   ├── ZoneDeleteDialog.tsx         # Confirmation suppression
│   └── EmptyState.tsx
└── _hooks/
    ├── useZonesList.ts              # GET /list + refresh
    ├── useZoneDetail.ts             # GET /[id] + /geometry
    ├── useZonesStats.ts             # GET /stats
    ├── useSourceTypes.ts            # GET /source-types
    └── useZoneActions.ts            # rename / delete / export
```

### 2.2 — `page.tsx`

```tsx
import { redirect } from 'next/navigation';
import { requireAuthPage } from '@/lib/api/middleware'; // adapter selon ce qui existe
import { CustomGeoPageClient } from './CustomGeoPageClient';

export default async function CustomGeoPage() {
  const user = await requireAuthPage();
  if (!user?.org_id) redirect('/dashboard');
  return <CustomGeoPageClient orgId={user.org_id} />;
}
```

### 2.3 — `CustomGeoPageClient.tsx`

Orchestre 3 panneaux. State global :
- `sourceTypeFilter: string | null`
- `searchQuery: string` (debounce 200ms sur le hook)
- `selectedZoneId: string | null`

Layout Tailwind (DESIGN_SYSTEM.md — dark minimal, flat, pas de gradient/ombre) :

```
┌───────────┬─────────────────────────────┬─────────────────────┐
│  Sidebar  │       Grid centrale         │  Detail panel       │
│  260px    │  flex-1, scrollable         │  480px (optionnel)  │
│           │                             │                     │
│  Filters  │  Grid 3 colonnes de cards   │  Full map + actions │
│  Stats    │  Responsive : 2 puis 1      │  Slide-in droite    │
└───────────┴─────────────────────────────┴─────────────────────┘
```

### 2.4 — `ZonesSidebar.tsx`

```
Zones personnalisées
─────────────────────
12 zones   4 287 IRIS   892 CP
─────────────────────
Type de source
○ Tous (12)
○ radio_coverage (3)
○ meteo_forecast (2)
○ iris_selection (4)
○ manual_draw (3)
─────────────────────
🔍 Rechercher…
```

- Stats en haut via `useZonesStats()`
- Liste `source_type` dynamique via `useSourceTypes()` (avec compteurs dérivés de `stats.by_source_type`)
- Labels `source_type` : afficher **la clé technique telle quelle** en JetBrains Mono (principe GEOMATIK)
- Recherche : input avec icône, clear au focus

### 2.5 — `ZonesGrid.tsx` + `ZoneCard.tsx`

Card (300px large) :

```
┌────────────────────────────────┐
│ [Mini-preview carte 300x160]   │  ← ZoneMapPreview
├────────────────────────────────┤
│ Zone Scoop Lyon           ⋮    │
│ radio_coverage                 │  ← JetBrains Mono, teal
│                                │
│ 1 247 IRIS  •  284 CP          │
│ Créé le 19 avril               │
└────────────────────────────────┘
```

Hover : teal border (`#4ecdc4`), cursor pointer.
Clic card → `selectedZoneId = zone.id` → ouvre panneau détail.
Clic menu ⋮ → dropdown (Renommer, Exporter CSV CP, Exporter CSV IRIS, Exporter GeoJSON, Supprimer).

### 2.6 — `ZoneMapPreview.tsx`

**Mini-carte MapLibre non-interactive** pour éviter la charge navigateur.

```tsx
interface Props {
  zoneId: string;
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat depuis /list
}
```

Au montage :
1. Init MapLibre avec `geomatik-style` dark + `interactive: false`
2. Fetch `/api/custom-geo/[zoneId]/geometry`
3. Layers : fill teal semi-transparent (`#4ecdc4` @ 30%) + line teal (`#4ecdc4` @ 80%)
4. `fitBounds(bbox, { padding: 20, animate: false })`

Skeleton gris 300×160 pendant le fetch.

**Limitation perf** : max ~12-15 MapLibre simultanées. Si la grille dépasse, implémente une simple virtualisation (seules les cards dans le viewport + buffer 1 écran rendent la carte ; les autres affichent un placeholder).

### 2.7 — `ZoneDetailPanel.tsx`

Slide-in droite (480px), bouton ✕ pour fermer. Contenu :

```
┌─────────────────────────────────────┐
│ Zone Scoop Lyon                 ✕  │
├─────────────────────────────────────┤
│ [Carte MapLibre interactive 100%]   │
├─────────────────────────────────────┤
│ Source         radio_coverage       │
│ IRIS           1 247                │
│ Codes postaux  284                  │
│ Créé le        19 avril 2026, 14:32 │
│ Par            [user email]         │
├─────────────────────────────────────┤
│ Métadonnées source (JSON)           │
│ { "radio_id": "scoop-lyon",         │
│   "frequency": 94.3 }               │
├─────────────────────────────────────┤
│ [Renommer]  [Exporter ▼]            │
│ [Utiliser dans Digital]             │
│ [Supprimer] (rouge, en bas)         │
└─────────────────────────────────────┘
```

**"Utiliser dans Digital"** : `router.push('/map/analyse/digital?customZone=' + zoneId)`. L'Étape 3 gérera la préselection côté Digital.

**Export** : dropdown → déclenche `window.location.href = /api/custom-geo/[id]/export?format=...` ou `<a href download>`.

**Renommer** : ouvre `ZoneRenameDialog` (champs `name` + `description`, appel `PATCH /api/custom-geo/[id]`, refresh liste).

**Supprimer** : `ZoneDeleteDialog` avec confirmation (bouton rouge, cursor-not-allowed pendant loading, toast succès).

### 2.8 — `ZoneFullMap.tsx`

Carte MapLibre interactive. Charge géométrie via `/api/custom-geo/[id]/geometry`, ajoute layers fill + line teal, `fitBounds`. Contrôles : zoom +/-, recenter, plein écran optionnel.

### 2.9 — `EmptyState.tsx`

```
Pas encore de zone personnalisée

Sauvegardez vos premières zones depuis :
• Le module radio
• Les isochrones
• La sélection d'IRIS
• Le dessin libre

[Découvrir les modules →]
```

---

## PHASE 3 — HOOKS

### 3.1 — `useZonesList.ts`

```ts
export function useZonesList(params: {
  orgId: string;
  sourceType?: string | null;
  searchQuery?: string;
}) {
  // Fetch /api/custom-geo/list?org_id=...&source_type=...&q=...
  // Debounce searchQuery 200ms
  // Retour : { zones, loading, error, refetch }
}
```

### 3.2 — `useZoneDetail.ts`

```ts
export function useZoneDetail(zoneId: string | null) {
  // Si zoneId null → ne fetch pas
  // Sinon fetch /[id] + /geometry en parallèle avec Promise.all
  // Retour : { zone, geometry, loading, error }
}
```

### 3.3 — `useZonesStats.ts`

```ts
export function useZonesStats(orgId: string) {
  // Fetch /api/custom-geo/stats?org_id=...
  // Retour : { stats, loading, refetch }
}
```

### 3.4 — `useSourceTypes.ts`

```ts
export function useSourceTypes(orgId: string) {
  // Fetch /api/custom-geo/source-types?org_id=...
  // Retour : { sourceTypes: string[], loading }
}
```

### 3.5 — `useZoneActions.ts`

```ts
export function useZoneActions(onSuccess?: () => void) {
  return {
    rename: async (id: string, name: string, description?: string) => { ... },
    remove: async (id: string) => { ... },
    exportZone: (id: string, format: CustomGeoExportFormat) => { ... }, // trigger download
  };
}
```

---

## PHASE 4 — NAVIGATION

Ajouter un lien "Zones personnalisées" dans la nav principale (fichier à identifier en Phase 0). Icône SVG inline 16×16 teal (un marqueur géo dans un carré arrondi fait l'affaire).

---

## PHASE 5 — TESTS MANUELS

1. Créer 3-4 zones test via la page dev `/dev/test-save-zone` (ou un script SQL si besoin) avec différents `source_type`
2. `/map/custom-geo` → grille affiche les cards avec mini-preview
3. Filtrer par `source_type` → grille filtrée
4. Rechercher par nom → filtre appliqué
5. Clic card → panneau détail s'ouvre, carte charge, stats affichées
6. Renommer une zone → nom mis à jour
7. Exporter CSV IRIS → fichier téléchargé avec les bons codes
8. Supprimer une zone → disparaît de la grille
9. Responsive : grille passe 3 → 2 → 1 colonne selon largeur

---

## CONTRAINTES

**Performance :**
- Max 12-15 MapLibre simultanées visibles (virtualisation si plus)
- Preview carte : `interactive: false` obligatoire
- Ne pas fetch `geometry` dans `/list` (bbox suffit)

**Fichiers interdits :**
- `/app/api/isochrone-battle/route.ts`
- Fonctions PostGIS `battle_*`

**Principes GEOMATIK :**
- `source_type` listés dynamiquement via RPC, JAMAIS en dur
- Aucun libellé humain hardcodé pour les `source_type` (affiche la clé technique en mono)
- Stats dynamiques via `get_custom_geo_zones_stats`

**Design System :**
- Dark Minimal (Linear/Vercel/Raycast)
- Inter + JetBrains Mono (mono pour codes techniques, dates ISO, IDs)
- Teal `#4ecdc4` unique accent
- Flat (pas de gradient / shadow / glow)
- Sentence case partout
- Section headers fond `#111111` + bande teal dot pattern

**Sécurité :**
- `requireAuth(request)` systématique côté routes API
- `requireAuthPage()` côté page server component (selon nom exact trouvé Phase 0)
- Aucun `any` en TS, Zod sur toute entrée user

**Commit atomique :** `feat(custom-geo): module galerie /map/custom-geo`

---

## POST-LIVRAISON

Après le dernier commit, lance @cleanup-geomatik Partie 2 + Partie 3 sur les fichiers modifiés uniquement. Rapport rapide : failles sécu + any introduits + catch non typés. Corrige avant de considérer la tâche terminée.

---

## LIVRABLES ATTENDUS

1. `app/api/custom-geo/stats/route.ts` (GET, wrapper RPC)
2. `app/api/custom-geo/source-types/route.ts` (GET, wrapper RPC)
3. `app/map/custom-geo/page.tsx`
4. `app/map/custom-geo/CustomGeoPageClient.tsx`
5. 10 composants sous `_components/`
6. 5 hooks sous `_hooks/`
7. Entrée nav principale ajoutée
8. `lib/version.ts` (bump 7.6.0 → 7.7.0)

---

## RAPPEL — ordre d'exécution

1. Phase 0 (reco layout `/map`, composants, nav) → **STOP**
2. Phase 1 (2 routes API wrapper RPC)
3. Phase 2 (page + 10 composants)
4. Phase 3 (5 hooks)
5. Phase 4 (nav)
6. Phase 5 (tests manuels — remonte-moi : nb zones testées, perfs mini-cartes, bugs)
7. Cleanup

**Récap final attendu :** screenshot ou description de la page en état "3 zones créées, filtre appliqué", temps de chargement initial, bundle size du module.