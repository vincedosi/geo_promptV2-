# Indicateur civique "Santé environnementale" — Design

> Date : 2026-05-05
> Auteur : brainstorming Claude / vincent.sidoli
> Status : draft, en attente validation

---

## 1. Contexte et objectif

MAGELIAN affiche déjà des indicateurs civiques par layer (sous-section "Indicateurs civiques" dans la catégorie **Données terrain** du `FilterPanel`). On ajoute un nouvel indicateur **zone-spécifique** qui montre, pour la commune dont relève l'IRIS sélectionné :

1. **Indice ATMO du jour** — qualité de l'air, échelle 1 à 6 (bon → extrêmement mauvais)
2. **Indice pollen du jour** — risque allergique, échelle 0 à 6, par espèce (ambroisie, armoise, aulne, bouleau, graminées, olivier)

Source unique : **Atmo Data v2** (`https://admindata.atmo-france.org`). Open data, licence ODbL → mention obligatoire `Source : Atmo France et les AASQA`.

### Décisions de scope (validées en brainstorming)

- **Provider** : abstraction `provider` avec deux backends — `mock` (par défaut, dev sans creds) et `atmofrance` (production, requiert `ATMO_FRANCE_USERNAME` + `ATMO_FRANCE_PASSWORD` dans `.env.local`). L'utilisateur doit créer un compte sur https://admindata.atmo-france.org/inscription-api ; la bascule se fait par variable d'env, sans changement de code.
- **Intégration UI** : section "Santé environnementale" en bas de la catégorie **Données terrain** dans `FilterPanel.tsx`, **pliée par défaut**, qui se déplie automatiquement à la première sélection d'IRIS. Quand rien n'est sélectionné, placeholder discret `Cliquez sur un IRIS pour voir l'air et les pollens`.
- **Prévisions** : J par défaut. Sous-toggle `Voir prévisions` qui révèle J+1 (air) et J+1, J+2 (pollen). Pas affiché en initial pour préserver la densité du DESIGN_SYSTEM dark minimal.
- **Granularité v1** : IRIS-only. La logique IRIS → commune passe par la colonne `code_commune` de la table `iris` (déjà présente, pas besoin de jointure ni de RPC dédiée). Les zones polygonales custom et le viewport-fallback sont **out-of-scope v1**, documentés en § 12.

---

## 2. Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│  CLIENT (app/map)                                                 │
│  ┌──────────────────┐                                             │
│  │ FilterPanel.tsx  │ ─── selectedIrisCode (déjà présent)         │
│  │ ▾ Santé env.     │ ─── code_commune (depuis iris)              │
│  │  ┌────────────┐  │                                             │
│  │  │ Health     │  │ ──────► fetch /api/civic-indicators/        │
│  │  │ Indicator  │  │             health/[code_insee]             │
│  │  │ Card       │  │                                             │
│  │  └────────────┘  │                                             │
│  └──────────────────┘                                             │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  SERVER (app/api/civic-indicators/health/[code_insee]/route.ts)   │
│                                                                   │
│  1. Auth requireAuth()                                            │
│  2. Cache lookup Supabase (civic_health_cache, < 24h ?)           │
│  3. HIT  → return cached payload                                  │
│  4. MISS → call provider.fetchHealth(code_insee)                  │
│            ├─ provider = 'mock'       → mock-data.ts              │
│            └─ provider = 'atmofrance' → atmofrance-client.ts      │
│  5. Stocke réponse dans civic_health_cache                        │
│  6. Si provider échoue ET snapshot < 48h existe :                 │
│         retourne cache avec stale=true                            │
│  7. Sinon : null + message clair                                  │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  EXTERNAL (Atmo Data v2 — admindata.atmo-france.org)              │
│  POST /api/login → JWT (cached in memory, TTL 30min)              │
│  GET  /api/data/112/{filter}?withGeom=false → indice ATMO         │
│  GET  /api/data/122/{filter}?withGeom=false → indice pollen       │
└───────────────────────────────────────────────────────────────────┘
```

---

## 3. Unités logiques

### 3.1 `lib/civic-health/types.ts`
**Quoi** : Types TypeScript partagés client/serveur.
**Comment** : Exports `HealthIndicator`, `AirIndicator`, `PollenIndicator`, `AtmoLevel` (1-6), `PollenLevel` (0-6), `PollenSpecies`.
**Dépend de** : rien.

### 3.2 `lib/civic-health/levels.ts`
**Quoi** : Mappings niveau → couleur officielle Atmo + libellé qualificatif.
**Comment** : Constantes `ATMO_LEVEL_LABELS`, `POLLEN_LEVEL_LABELS`, `LEVEL_COLORS_HEX` (couleurs officielles Atmo, exposées comme tokens `--atmo-level-N` dans `globals.css` pour respecter la règle "no hardcoded colors").
**Dépend de** : `types.ts`.

### 3.3 `lib/civic-health/provider.ts`
**Quoi** : Interface `HealthProvider { fetchHealth(codeInsee: string): Promise<HealthIndicator | null> }` + factory `getProvider()` qui choisit le backend selon `process.env.ATMO_PROVIDER`.
**Comment** : Lit `ATMO_PROVIDER` (default `mock`), retourne instance `MockProvider` ou `AtmoFranceProvider`.
**Dépend de** : `types.ts`, les deux clients.

### 3.4 `lib/civic-health/atmofrance-client.ts`
**Quoi** : Client REST Atmo Data v2 (auth JWT + 2 endpoints).
**Comment** :
- `loginAndCacheToken()` — POST /api/login, garde le token en mémoire avec TTL 30min (module-level cache).
- `fetchAtmo(codeInsee, today)` — GET /api/data/112/...
- `fetchPollen(codeInsee, today)` — GET /api/data/122/...
- `fetchHealth(codeInsee)` — orchestration (Promise.all des 2 calls), normalise vers `HealthIndicator`.
- Throttle interne : max 1 req/sec via `lib/utils/rate-limit-queue.ts` (créer si nécessaire) — protège contre rate limit Atmo lors de batch.
**Dépend de** : `types.ts`, `levels.ts`.

### 3.5 `lib/civic-health/mock-provider.ts`
**Quoi** : Données factices déterministes (hash code_insee) qui retournent un `HealthIndicator` plausible.
**Comment** : Hash modulo → indice 1-5 air, 0-3 pollen, dates J et J+1/J+2 cohérentes. Permet de tester l'UI sans creds Atmo.
**Dépend de** : `types.ts`.

### 3.6 `lib/civic-health/cache.ts`
**Quoi** : Lecture/écriture de la table `civic_health_cache`.
**Comment** :
- `getCachedHealth(codeInsee, maxAgeHours = 24)` — SELECT … WHERE fetched_at >= now() - interval.
- `getStaleCachedHealth(codeInsee, maxAgeHours = 48)` — fallback offline.
- `upsertCachedHealth(codeInsee, payload)` — UPSERT sur PRIMARY KEY.
- Utilise `createAdminClient()` (service role, bypass RLS pour write).
**Dépend de** : `types.ts`, `lib/auth`.

### 3.7 `app/api/civic-indicators/health/[code_insee]/route.ts`
**Quoi** : Endpoint Next.js GET.
**Comment** :
- `export const dynamic = 'force-dynamic'`, `export const revalidate = 3600`.
- `requireAuth(request)` → 401 si non authentifié (cohérent avec les autres `civic-indicators`).
- Validation Zod du `code_insee` (string 5 chars, regex `/^[0-9AB]\d{4}$/i` pour gérer la Corse 2A/2B).
- Pipeline : cache lookup → provider → upsert cache → return JSON.
- En cas d'erreur provider : tente fallback stale, sinon `{ data: null, error: 'unavailable', message: '...' }`.
**Dépend de** : middleware, cache, provider.

### 3.8 `components/donnees-terrain/HealthIndicatorCard.tsx`
**Quoi** : Composant React client.
**Comment** :
- Props : `codeCommune: string | null`, `nomCommune?: string`.
- Si `codeCommune === null` → render placeholder.
- Sinon `useEffect` fetch `/api/civic-indicators/health/${codeCommune}`, `useRef` cache client (clé = code_commune) pour éviter re-fetch lors de toggles UI.
- Layout : 1 carte avec 2 colonnes (Air | Pollen), responsive stack < 320px.
- États : loading (skeleton), error, empty, success.
- Sub-toggle "Voir prévisions" → révèle J+1 air / J+1, J+2 pollen.
- Footer : `Source : Atmo France et AASQA — mis à jour le {date_maj}` + lien externe `map.atmo-france.org/?commune={code_commune}`.
- Couleurs : tokens CSS `--atmo-level-N` et `--pollen-level-N` exposés dans `globals.css` (jamais de hex en dur — feedback memory).
**Dépend de** : types, levels (pour libellés), API endpoint.

### 3.9 `components/donnees-terrain/AirSubBlock.tsx` et `PollenSubBlock.tsx`
**Quoi** : Sous-composants présentation pure.
**Comment** : pastille couleur + libellé + petit barchart sous-indices (air, hover) ou 6 picto par espèce (pollen).
**Dépend de** : types, levels.

### 3.10 Intégration `app/map/_components/FilterPanel.tsx`
**Quoi** : Insérer la nouvelle section après "Indicateurs civiques" (ligne ~2594).
**Comment** : Nouvelle prop `selectedIrisCode?: string | null` + `selectedIrisCommuneCode?: string | null` passées par `app/map/page.tsx`. Section pliée par défaut (`sectionsOpen.civicHealth = false`). Auto-déplie au premier IRIS via `useEffect` qui passe `civicHealth` à `true` si `selectedIrisCommuneCode` change et n'a jamais été déplié.

---

## 4. Schéma SQL et migration

### Table `civic_health_cache`

```sql
CREATE TABLE IF NOT EXISTS public.civic_health_cache (
    code_insee  text PRIMARY KEY,
    payload     jsonb NOT NULL,
    fetched_at  timestamptz NOT NULL DEFAULT now(),
    provider    text NOT NULL DEFAULT 'atmofrance'
                CHECK (provider IN ('atmofrance', 'mock'))
);

CREATE INDEX civic_health_cache_fetched_at_idx
    ON public.civic_health_cache (fetched_at DESC);

ALTER TABLE public.civic_health_cache ENABLE ROW LEVEL SECURITY;

-- Lecture publique (data ODbL)
CREATE POLICY civic_health_cache_read_anon
    ON public.civic_health_cache
    FOR SELECT
    USING (true);

-- Écriture réservée au service role (route API)
CREATE POLICY civic_health_cache_write_service
    ON public.civic_health_cache
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

COMMENT ON TABLE public.civic_health_cache IS
    'Cache des indicateurs ATMO + pollen par commune INSEE. TTL 24h, fallback 48h. Source : Atmo France et AASQA (ODbL).';
```

Fichier migration : `supabase/migrations/20260505_civic_health_cache.sql`. Application via MCP Supabase `apply_migration` (memory `feedback_supabase_direct`).

---

## 5. Contrat d'API

### `GET /api/civic-indicators/health/[code_insee]`

**Auth** : Bearer token Supabase (cohérent avec autres routes `civic-indicators`).
**Validation** : `code_insee` matched contre `/^[0-9AB]\d{4}$/i` (Corse incluse). 400 sinon.

**Réponse 200 (data fraîche)** :
```json
{
  "data": {
    "code_insee": "75056",
    "commune": "Paris",
    "air": {
      "date": "2026-05-05",
      "indice": 3,
      "qualificatif": "dégradé",
      "sous_indices": { "pm10": 2, "pm25": 3, "no2": 3, "o3": 4, "so2": 1 },
      "previsionJ1": { "indice": 2, "qualificatif": "moyen" }
    },
    "pollen": {
      "date": "2026-05-05",
      "indice_global": 4,
      "especes": {
        "ambroisie": 0, "armoise": 1, "aulne": 0,
        "bouleau": 4, "graminees": 3, "olivier": 0
      },
      "previsionJ1": { "indice": 3 },
      "previsionJ2": { "indice": 2 }
    },
    "fetchedAt": "2026-05-05T14:23:00.000Z",
    "source": "Atmo France et AASQA",
    "stale": false
  },
  "provider": "atmofrance"
}
```

**Réponse 200 (stale, fallback)** : même shape, `stale: true`, `fetchedAt` ancien.

**Réponse 200 (indisponible)** :
```json
{
  "data": null,
  "error": "unavailable",
  "message": "Données ATMO + pollen indisponibles pour cette commune.",
  "provider": "atmofrance"
}
```

**Réponse 400 / 401 / 500** : standard MAGELIAN (`{success:false, error: '...'}`).

### Schéma Zod côté serveur

```ts
const HealthIndicatorSchema = z.object({
  code_insee: z.string().regex(/^[0-9AB]\d{4}$/i),
  commune: z.string(),
  air: z.object({ /* ... */ }).nullable(),
  pollen: z.object({ /* ... */ }).nullable(),
  fetchedAt: z.string().datetime(),
  source: z.literal('Atmo France et AASQA'),
  stale: z.boolean(),
});
```

---

## 6. UI mockup (texte)

### Section pliée (état initial, IRIS non sélectionné)
```
─────────────────────────────────
 ●  Santé environnementale     ▾
─────────────────────────────────
   Cliquez sur un IRIS pour voir
   l'air et les pollens du jour.
─────────────────────────────────
```

### Section dépliée (IRIS sélectionné, data OK)
```
─────────────────────────────────
 ●  Santé environnementale     ▴
─────────────────────────────────
  ┌──────────────┬──────────────┐
  │ AIR          │ POLLEN       │
  │  ●  Dégradé  │  ●  Élevé    │
  │  3/6         │  4/6         │
  │              │              │
  │ NO2  ▓▓▓░░  │ 🌿Bouleau ▓▓▓│
  │ O3   ▓▓▓▓░  │ 🌾Graminé ▓▓░│
  │ PM10 ▓▓░░░  │ 🌳Aulne   ░░ │
  │ ...          │ ...          │
  └──────────────┴──────────────┘
   ▸ Voir prévisions

   Source : Atmo France et AASQA
   Mis à jour le 5 mai 2026
   ↗ Voir sur map.atmo-france.org
─────────────────────────────────
```

### Section dépliée, prévisions ouvertes
```
   ▾ Voir prévisions
   J+1   Air ●moyen   Pollen ●modéré
   J+2                Pollen ●faible
```

### États
- **Loading** : skeleton 2 colonnes (`<SkeletonText />` du DESIGN_SYSTEM).
- **Error** : `Données indisponibles pour cette zone.` + bouton `Réessayer`.
- **Stale** : badge orange `Données du {date} (cache)` au-dessus du contenu.

### Tokens CSS à ajouter dans `app/globals.css`
```css
:root {
  /* Niveaux ATMO 1→6 (officiels Atmo France) */
  --atmo-level-1: #50f0e6;  /* bon */
  --atmo-level-2: #50ccaa;  /* moyen */
  --atmo-level-3: #f0e641;  /* dégradé */
  --atmo-level-4: #ff5050;  /* mauvais */
  --atmo-level-5: #960032;  /* très mauvais */
  --atmo-level-6: #872181;  /* extrêmement mauvais */
  --atmo-level-na: #888888;

  /* Niveaux pollen 0→6 (officiels Atmo France, RAEP) */
  --pollen-level-0: #dddddd;
  --pollen-level-1: #50f0e6;
  --pollen-level-2: #50ccaa;
  --pollen-level-3: #f0e641;
  --pollen-level-4: #ff5050;
  --pollen-level-5: #960032;
  --pollen-level-6: #872181;
}
```

---

## 7. Variables d'environnement

À ajouter à `.env.example` et documenter :

```
# Atmo Data v2 (santé environnementale)
# Provider : 'mock' (défaut, dev sans creds) ou 'atmofrance' (prod)
ATMO_PROVIDER=mock
# Requis si ATMO_PROVIDER=atmofrance
# Inscription : https://admindata.atmo-france.org/inscription-api
ATMO_FRANCE_USERNAME=
ATMO_FRANCE_PASSWORD=
```

---

## 8. Stratégie de cache

| Couche | TTL | Mécanisme | Justification |
|--------|-----|-----------|---------------|
| Token JWT Atmo | 30 min | `module-level let` | Évite login à chaque requête, JWT valide 1h |
| Cache Supabase | 24 h | Table `civic_health_cache` | Atmo update 12h-15h quotidien |
| Fallback stale | 48 h | Même table, flag `stale: true` | Disponibilité si Atmo Data down |
| Cache HTTP Next.js | `revalidate: 3600` | Built-in | Réduit charge Supabase |
| Cache client React | session | `useRef<Map>` | Évite re-fetch à l'ouverture/fermeture de section |

---

## 9. Gestion d'erreurs

| Cas | Comportement |
|-----|--------------|
| `code_insee` invalide | 400 + message Zod |
| Non authentifié | 401 (`requireAuth`) |
| Provider mock | jamais d'erreur |
| Atmo login 401 | log + retourne stale si dispo, sinon `null + 'unavailable'` |
| Atmo data 500/timeout | idem |
| Atmo `features: []` (data manquante pour la commune) | data partiellement nulle (ex: air OK, pollen null) |
| Cache write fail | log warn, ne pas faire échouer la réponse au client |

---

## 10. Plan de test manuel

Communes témoins (validation finale, à documenter dans le PR) :
- **Paris 1er** — `75101` — grosse ville, données toujours dispo, espèces pollen variées
- **Lyon 3e** — `69383` — autre métropole, ATMO Auvergne-Rhône-Alpes
- **Marseille 1er** — `13201` — Sud, olivier en saison
- **Bonifacio** — `2A041` — Corse, **test Corse 2A/2B**
- **Saint-Méard** — `87164` — village rural, doit retourner data ou null gracieusement

Procédure :
1. `npm run dev`, login en local
2. Pour chaque commune : zoom sur la zone, cliquer un IRIS, vérifier l'auto-déploiement de la section, contenu cohérent
3. Tester provider mock avec `ATMO_PROVIDER=mock` (état initial)
4. Si user fournit creds : tester provider atmofrance (vrai data)
5. Devtools network : confirmer cache HIT au 2e clic même IRIS
6. Couper réseau → vérifier fallback stale + badge orange
7. Couper TOTAL (cache vide) → vérifier état `Données indisponibles`
8. Test Playwright (E2E) : login → click IRIS Paris → assert `[data-testid="civic-health-card"]` visible et contient `Air`

---

## 11. Arborescence — fichiers créés/modifiés

```
genesis_app/
├── app/
│   ├── api/
│   │   └── civic-indicators/
│   │       └── health/
│   │           └── [code_insee]/
│   │               └── route.ts                    [NEW]
│   ├── globals.css                                  [MODIFIED — tokens couleur ATMO/pollen]
│   └── map/
│       ├── _components/
│       │   └── FilterPanel.tsx                     [MODIFIED — nouvelle section + 2 props]
│       └── page.tsx                                [MODIFIED — passe codeCommune à FilterPanel]
├── components/
│   └── donnees-terrain/                            [NEW dir]
│       ├── HealthIndicatorCard.tsx                 [NEW]
│       ├── AirSubBlock.tsx                         [NEW]
│       ├── PollenSubBlock.tsx                      [NEW]
│       └── HealthCardSkeleton.tsx                  [NEW]
├── lib/
│   └── civic-health/                               [NEW dir]
│       ├── types.ts                                [NEW]
│       ├── levels.ts                               [NEW]
│       ├── provider.ts                             [NEW]
│       ├── atmofrance-client.ts                    [NEW]
│       ├── mock-provider.ts                        [NEW]
│       └── cache.ts                                [NEW]
├── supabase/
│   └── migrations/
│       └── 20260505_civic_health_cache.sql         [NEW]
├── tests/
│   └── unit/
│       └── civic-health/
│           ├── mock-provider.test.ts               [NEW]
│           ├── atmofrance-client.test.ts           [NEW — mocked fetch]
│           └── route-handler.test.ts               [NEW]
├── ARCHITECTURE.md                                 [MODIFIED — ajout endpoint + table]
├── .env.example                                    [MODIFIED — ATMO_* vars]
└── README.md                                       [MODIFIED — mention ODbL]
```

---

## 12. Out of scope v1 (futures itérations)

- **Zone polygonale custom (`?customZone=`)** — RPC PostGIS centroïde + nearest commune. À ajouter quand le besoin métier émerge.
- **Viewport fallback** — afficher data de la commune au centre du viewport quand rien n'est sélectionné. Risque de noise UI.
- **Layer cartographique choroplèthe ATMO** — hériter du pattern `Indicateurs civiques` existant (`get_civic_layer_geojson`). À envisager si la donnée s'étend à plus de communes (épisodes pollution).
- **Notifications** — alerter l'utilisateur quand un IRIS sélectionné a un indice ≥ 5. Nécessite système push.
- **Historique** — colonne `payload` jsonb conserve l'archive ; pourrait servir à un graphe temporel.
- **Migration vers Atmo Data WMS/WFS** — si Atmo France ouvre des layers OGC publics sans auth, on simplifie le provider.

---

## 13. Conformité MAGELIAN

- [x] DESIGN_SYSTEM respecté (dark minimal, sentence case, dot teal sur titre, pas de gradient/shadow/glow, fonts Inter + JetBrains Mono)
- [x] Pas de hex en dur (tokens CSS)
- [x] Pas de modif de `app/api/isochrone-battle/route.ts`
- [x] Pas de modif des fonctions PostGIS battle
- [x] Pas de modif du multi-agent prompt router
- [x] TypeScript strict, pas de `any`
- [x] RLS : lecture publique, écriture service role
- [x] Migration via MCP Supabase `apply_migration` (pas de SQL manuel)
- [x] Cache client `useRef` avant fetch
- [x] Pas de bbox France entière (granularité commune unique)
- [x] Pas de `Promise.all > 3` (au pire 2 : air + pollen)
- [x] Lazy : section pliée par défaut, data fetched à l'ouverture seulement
- [x] Mention ODbL ajoutée au README
