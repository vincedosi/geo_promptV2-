# Moteur boucle de pilotage Magelian (A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire tourner la boucle de pilotage Magelian de bout en bout contre une campagne fictive à délivrance simulée réactive (convergence réelle v1→v2→v3), en version prod-correcte (période-aware, source de délivrance swappable).

**Architecture:** Un simulateur seedé (adaptateur ad-server en mode démo) écrit de la délivrance datée dans la VRAIE `dsp_campaign_data` à partir du plan poussé, contre une résistance cachée fixe → le pacing/rebid existants convergent. Le pacing évolue pour mesurer chaque version sur SA période. Un contrôleur `/api/demo/*` orchestre seed/simulate/rebid/reset, isolé par `is_demo` + scope `campaign_id`.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, Supabase (PostgreSQL 15, Nano), Zod, Vitest.

**Spec source :** `docs/superpowers/specs/2026-07-04-moteur-boucle-pilotage-A-design.md`.

## Global Constraints

- **Supabase Nano** : RPC bornées (campagne + version + période), `EXPLAIN ANALYZE` sur la RPC modifiée ; insert/purge par lots de 50 ; purge/scope toujours par `campaign_id` (indexé).
- **Migrations** via MCP Supabase (`apply_migration`), versionnées dans `sql/` (prochain : `sql/097`).
- **Isolation démo NON négociable** : toute écriture/purge du contrôleur exige `dsp_campaigns.is_demo = true` sur la campagne cible (garde dure) ; jamais d'effet sur une campagne réelle.
- **Cœur agnostique** : le simulateur est un adaptateur ; il produit des lignes `dsp_campaign_data` de la même forme qu'un import réel. Ne pas coupler le pacing/rebid au simulateur.
- **Logique pure sans I/O** dans `lib/demo/{rng,simulator}.ts` et `lib/pacing/*` (testable).
- **Déterminisme** : tout l'aléatoire passe par le PRNG seedé (`lib/demo/rng.ts`) ; **ne jamais** utiliser `Math.random()`.
- TypeScript strict, imports absolus `@/`, routes `export const dynamic = 'force-dynamic'`, `requireAdmin`, `createAdminClient`.
- **Constantes tunables** (une seule source, `lib/demo/constants.ts`) : `DEMO_SEED=42`, `PERIOD_LEN_DAYS=30`, `CALENDAR_START='2026-01-01'`, `TOTAL_VOLUME=5_000_000`, `SIM_GAIN=3`, `SIM_NOISE=0.1`, `DEMO_CAMPAIGN_ID`, `DEMO_ORG_ID='00000000-0000-0000-0000-000000000001'`, `DEMO_ZONE_ID='f001b479-b870-4958-978d-e7a98b90de57'` (CIRFA BRETAGNE).
- Commits atomiques `type: description`, terminés par `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: PRNG seedé — `lib/demo/rng.ts`

**Files:**
- Create: `lib/demo/rng.ts`
- Test: `tests/unit/demo/rng.test.ts`

**Interfaces:**
- Produces: `mulberry32(seed: number): () => number`, `hashStr(s: string): number`, `rngFor(seed: number, key: string): number`.

- [ ] **Step 1: Écrire les tests**

Créer `tests/unit/demo/rng.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32, rngFor } from '@/lib/demo/rng';

describe('rng', () => {
  it('mulberry32 est déterministe pour un même seed', () => {
    const a = mulberry32(42); const b = mulberry32(42);
    const seqA = [a(), a(), a()]; const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA[0]).toBeGreaterThanOrEqual(0);
    expect(seqA[0]).toBeLessThan(1);
  });

  it('des seeds différents divergent', () => {
    expect(mulberry32(1)()).not.toEqual(mulberry32(2)());
  });

  it('rngFor est stable par (seed, clé) et varie selon la clé', () => {
    expect(rngFor(42, '75001')).toEqual(rngFor(42, '75001'));
    expect(rngFor(42, '75001')).not.toEqual(rngFor(42, '75002'));
  });
});
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `npx vitest run tests/unit/demo/rng.test.ts`
Expected: FAIL (`Cannot find module '@/lib/demo/rng'`).

- [ ] **Step 3: Implémenter**

Créer `lib/demo/rng.ts` :

```ts
/**
 * PRNG seedé déterministe (mulberry32) — tout l'aléatoire de la démo passe par ici,
 * jamais Math.random(). Même seed → même démo (reproductible sur scène).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a d'une chaîne → uint32, pour dériver un flux stable par clé. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Une valeur [0,1) déterministe pour un couple (seed, clé) — ex. résistance d'un CP. */
export function rngFor(seed: number, key: string): number {
  return mulberry32((seed ^ hashStr(key)) >>> 0)();
}
```

- [ ] **Step 4: Lancer (succès)**

Run: `npx vitest run tests/unit/demo/rng.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/demo/rng.ts tests/unit/demo/rng.test.ts
git commit -m "feat(demo): PRNG seedé déterministe (mulberry32)"
```

---

### Task 2: Simulateur réactif — `lib/demo/simulator.ts`

**Files:**
- Create: `lib/demo/simulator.ts`
- Test: `tests/unit/demo/simulator.test.ts`

**Interfaces:**
- Consumes: `rngFor` (Task 1).
- Produces:
  - `interface SimItem { zone_id: string; item_id: string; expected_share: number; cps: string[] }`
  - `interface SimInput { items: SimItem[]; audienceByCp: Record<string, number>; seed: number; period: number; totalVolume: number; gain?: number; noise?: number }`
  - `interface SimDeliveryRow { postal_code: string; impressions: number; clicks: number; spend: number }`
  - `function simulateDelivery(input: SimInput): SimDeliveryRow[]`

- [ ] **Step 1: Écrire les tests**

Créer `tests/unit/demo/simulator.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { simulateDelivery, type SimItem } from '@/lib/demo/simulator';

const cps = ['10', '20', '30', '40'];
const audience = { '10': 1000, '20': 1000, '30': 1000, '40': 1000 };
const twoItems = (wA: number, wB: number): SimItem[] => [
  { zone_id: 'z', item_id: 'z:a', expected_share: wA, cps: ['10', '20'] },
  { zone_id: 'z', item_id: 'z:b', expected_share: wB, cps: ['30', '40'] },
];

function shareOf(rows: { postal_code: string; impressions: number }[], itemCps: string[]): number {
  const total = rows.reduce((s, r) => s + r.impressions, 0) || 1;
  const inItem = rows.filter(r => itemCps.includes(r.postal_code)).reduce((s, r) => s + r.impressions, 0);
  return inItem / total;
}

describe('simulateDelivery', () => {
  it('est déterministe pour un même seed/période', () => {
    const a = simulateDelivery({ items: twoItems(0.5, 0.5), audienceByCp: audience, seed: 42, period: 1, totalVolume: 10000 });
    const b = simulateDelivery({ items: twoItems(0.5, 0.5), audienceByCp: audience, seed: 42, period: 1, totalVolume: 10000 });
    expect(a).toEqual(b);
  });

  it('normalise au volume total (à l’arrondi près)', () => {
    const rows = simulateDelivery({ items: twoItems(0.5, 0.5), audienceByCp: audience, seed: 42, period: 1, totalVolume: 10000 });
    const sum = rows.reduce((s, r) => s + r.impressions, 0);
    expect(Math.abs(sum - 10000)).toBeLessThanOrEqual(rows.length); // arrondis
  });

  it('monotonie : relever le poids d’un item augmente sa part délivrée', () => {
    const base = simulateDelivery({ items: twoItems(0.5, 0.5), audienceByCp: audience, seed: 42, period: 1, totalVolume: 10000 });
    const boosted = simulateDelivery({ items: twoItems(0.8, 0.2), audienceByCp: audience, seed: 42, period: 1, totalVolume: 10000 });
    expect(shareOf(boosted, ['10', '20'])).toBeGreaterThan(shareOf(base, ['10', '20']));
  });

  it('la résistance seedée crée un écart initial non trivial à poids égaux', () => {
    const rows = simulateDelivery({ items: twoItems(0.5, 0.5), audienceByCp: audience, seed: 42, period: 1, totalVolume: 10000 });
    const sA = shareOf(rows, ['10', '20']);
    expect(Math.abs(sA - 0.5)).toBeGreaterThan(0.02); // pas parfaitement conforme au tour 1
  });
});
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `npx vitest run tests/unit/demo/simulator.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter**

Créer `lib/demo/simulator.ts` :

```ts
/**
 * Simulateur d'ad server (mode démo) — logique pure. À partir du plan poussé (parts
 * par item) + un seed, produit la délivrance datée qu'un ad server reporterait, contre
 * une RÉSISTANCE cachée fixe par CP. La délivrance réagit au poids (monotone) → le rebid
 * fait converger la conformité v1→v2→v3. Déterministe par le seed.
 */
import { rngFor } from '@/lib/demo/rng';

export interface SimItem {
  zone_id: string;
  item_id: string;
  expected_share: number; // part poussée de l'item (intra-zone, depuis le snapshot)
  cps: string[];
}

export interface SimInput {
  items: SimItem[];
  audienceByCp: Record<string, number>; // ex. ref_codes_postaux.pop_total
  seed: number;
  period: number;      // fait varier le bruit d'une période à l'autre (résistance, elle, fixe)
  totalVolume: number; // impressions totales de la période
  gain?: number;       // sensibilité au poids (défaut 3)
  noise?: number;      // amplitude du bruit (défaut 0.1)
}

export interface SimDeliveryRow {
  postal_code: string;
  impressions: number;
  clicks: number;
  spend: number;
}

const saturate = (x: number): number => x / (1 + x); // monotone croissante, bornée à 1

export function simulateDelivery(input: SimInput): SimDeliveryRow[] {
  const gain = input.gain ?? 3;
  const noise = input.noise ?? 0.1;

  // Poids poussé par CP (chaque CP appartient à un item)
  const weightByCp = new Map<string, number>();
  for (const it of input.items) for (const cp of it.cps) weightByCp.set(cp, it.expected_share);

  // Délivrance brute par CP
  const raw: Array<{ cp: string; v: number }> = [];
  for (const [cp, weight] of weightByCp) {
    const audience = input.audienceByCp[cp] ?? 0;
    const resistance = 0.3 + 0.7 * rngFor(input.seed, `res:${cp}`);      // FIXE par (seed, cp)
    const noiseTerm = 1 + (rngFor(input.seed, `noise:${input.period}:${cp}`) - 0.5) * 2 * noise;
    const v = audience * saturate(weight * gain * resistance) * noiseTerm;
    raw.push({ cp, v: Math.max(0, v) });
  }

  const sum = raw.reduce((s, r) => s + r.v, 0) || 1;
  return raw.map(({ cp, v }) => {
    const impressions = Math.round((v / sum) * input.totalVolume);
    const ctr = 0.005 + 0.02 * rngFor(input.seed, `ctr:${cp}`);
    const cpm = 3 + 4 * rngFor(input.seed, `cpm:${cp}`);
    return {
      postal_code: cp,
      impressions,
      clicks: Math.round(impressions * ctr),
      spend: Math.round((impressions / 1000) * cpm * 100) / 100,
    };
  });
}
```

- [ ] **Step 4: Lancer (succès)**

Run: `npx vitest run tests/unit/demo/simulator.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/demo/simulator.ts tests/unit/demo/simulator.test.ts
git commit -m "feat(demo): simulateur réactif seedé (délivrance vs résistance cachée)"
```

---

### Task 3: Test de convergence (acceptation, pur) — `tests/unit/demo/convergence.test.ts`

**Files:**
- Create: `tests/unit/demo/convergence.test.ts`

**Interfaces:**
- Consumes: `simulateDelivery` (Task 2), `computeRebidWeights` de `@/lib/pacing/rebid`, `computePacing` de `@/lib/pacing/compute`.

**Note :** ce test compose les briques PURES (simulateur + rebid + pacing) pour prouver que la boucle converge, sans DB. C'est le test d'acceptation qui protège la promesse « vraie boucle ».

- [ ] **Step 1: Écrire le test**

Créer `tests/unit/demo/convergence.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { simulateDelivery, type SimItem } from '@/lib/demo/simulator';
import { computeRebidWeights } from '@/lib/pacing/rebid';
import { computePacing, type PacingItemInput } from '@/lib/pacing/compute';

// 4 items d'une zone, poids initiaux égaux (25 chacun), 2 CP par item.
const ITEMS = [
  { item_id: 'z:a', cps: ['1', '2'] },
  { item_id: 'z:b', cps: ['3', '4'] },
  { item_id: 'z:c', cps: ['5', '6'] },
  { item_id: 'z:d', cps: ['7', '8'] },
];
const audienceByCp: Record<string, number> = Object.fromEntries(
  ['1','2','3','4','5','6','7','8'].map((cp, i) => [cp, 800 + i * 120]),
);

function sharesFromWeights(weights: Record<string, number>): SimItem[] {
  const total = Object.values(weights).reduce((s, w) => s + w, 0) || 1;
  return ITEMS.map(it => ({ zone_id: 'z', item_id: it.item_id, expected_share: weights[it.item_id] / total, cps: it.cps }));
}

/** Écart absolu moyen (points) entre part réelle et part planifiée, intra-zone. */
function meanAbsDelta(weights: Record<string, number>, period: number): number {
  const items = sharesFromWeights(weights);
  const rows = simulateDelivery({ items, audienceByCp, seed: 42, period, totalVolume: 1_000_000 });
  const impByCp = new Map(rows.map(r => [r.postal_code, r.impressions]));
  const pacingInput: PacingItemInput[] = items.map(it => ({
    zone_id: 'z', zone_name: 'z', item_id: it.item_id, item_name: it.item_id, item_weight: 0,
    expected_share: it.expected_share,
    actual_imp: it.cps.reduce((s, cp) => s + (impByCp.get(cp) ?? 0), 0),
    actual_spend: 0, cp_count: it.cps.length,
  }));
  const out = computePacing(pacingInput);
  return out.reduce((s, i) => s + Math.abs(i.delta_pts), 0) / out.length;
}

describe('convergence de la boucle (simulateur + rebid + pacing)', () => {
  it('l’écart absolu moyen décroît de v1 à v3', () => {
    let weights: Record<string, number> = { 'z:a': 25, 'z:b': 25, 'z:c': 25, 'z:d': 25 };
    const errs: number[] = [];
    for (let period = 1; period <= 3; period++) {
      errs.push(meanAbsDelta(weights, period));
      // rebid : recalcule les poids depuis le diagnostic de cette période
      const items = sharesFromWeights(weights);
      const rows = simulateDelivery({ items, audienceByCp, seed: 42, period, totalVolume: 1_000_000 });
      const impByCp = new Map(rows.map(r => [r.postal_code, r.impressions]));
      const zoneTotal = rows.reduce((s, r) => s + r.impressions, 0) || 1;
      const rebid = computeRebidWeights(items.map(it => ({
        zone_id: 'z', item_id: it.item_id, item_weight: weights[it.item_id],
        expected_share: it.expected_share,
        actual_share: it.cps.reduce((s, cp) => s + (impByCp.get(cp) ?? 0), 0) / zoneTotal,
      })));
      weights = Object.fromEntries(rebid.map(r => [r.item_id, r.new_weight]));
    }
    // Déterministe (seed 42). On prouve la convergence sans exiger une monotonie
    // pas-à-pas parfaite (le bruit varie par période) : écart initial réel, puis
    // convergence nette au bout de 2 rebids.
    expect(errs[0]).toBeGreaterThan(3);            // écart sous/sur-servi réel au tour 1
    expect(errs[2]).toBeLessThan(errs[0] * 0.8);   // a convergé d'au moins 20 %
    expect(errs[2]).toBeLessThan(errs[0]);         // strictement mieux qu'au départ
  });
});
```

- [ ] **Step 2: Lancer**

Run: `npx vitest run tests/unit/demo/convergence.test.ts`
Expected: PASS. **Si le test échoue** (pas de convergence), c'est un signal que le modèle du simulateur ou le rebid doit être ajusté (ex. `SIM_GAIN`, `REBID_CAP`) — ne pas contourner le test, corriger le modèle jusqu'à convergence monotone.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/demo/convergence.test.ts
git commit -m "test(demo): convergence de la boucle (écart moyen décroît v1→v3)"
```

---

### Task 4: Migration `sql/097` — pacing période-aware + endpoint snapshot étendu

**Files:**
- Create: `sql/097_campaign_plan_snapshot_periods.sql`
- Modify: `app/api/custom-geo/media-plan/snapshot/route.ts`

**Interfaces:**
- Produces : colonnes `period_start date`, `period_end date` sur `campaign_plan_snapshot` ; `get_campaign_pacing` filtre la délivrance par la période de la version ; l'endpoint snapshot accepte `period_start`/`period_end` optionnels.

- [ ] **Step 1: Écrire la migration**

Créer `sql/097_campaign_plan_snapshot_periods.sql` :

```sql
-- ============================================================
-- 097 — Pacing période-aware : chaque version mesurée sur SA période
-- ============================================================
-- Appliquée le 2026-07-04 via MCP Supabase.
--
-- Une version de plan est active sur [period_start, period_end). get_campaign_pacing
-- filtre la délivrance (dsp_campaign_data.date) à cette fenêtre. period_* NULL →
-- fenêtre ouverte = comportement d'origine (rétrocompat : aucun snapshot en prod).

ALTER TABLE public.campaign_plan_snapshot
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end   date;

CREATE OR REPLACE FUNCTION public.get_campaign_pacing(
  p_campaign_id uuid,
  p_metric_field text,
  p_version int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_version int;
  v_pstart date;
  v_pend date;
  v_result jsonb;
  v_in_plan_imp numeric;
  v_total_imp numeric;
  v_total_spend numeric;
  v_in_plan_spend numeric;
BEGIN
  v_version := COALESCE(
    p_version,
    (SELECT max(version) FROM public.campaign_plan_snapshot WHERE campaign_id = p_campaign_id)
  );
  IF v_version IS NULL THEN
    RETURN NULL;
  END IF;

  -- Période de la version (NULL → fenêtre ouverte)
  SELECT max(period_start), max(period_end) INTO v_pstart, v_pend
  FROM public.campaign_plan_snapshot
  WHERE campaign_id = p_campaign_id AND version = v_version;

  WITH real_cp AS (
    SELECT d.postal_code,
           SUM(CASE p_metric_field
                 WHEN 'tracked_ads' THEN d.tracked_ads
                 WHEN 'unique_impressions' THEN d.unique_impressions
                 ELSE d.impressions END)::numeric AS imp,
           SUM(COALESCE(d.spend, 0))::numeric AS spend
    FROM public.dsp_campaign_data d
    WHERE d.campaign_id = p_campaign_id
      AND (v_pstart IS NULL OR d.date >= v_pstart)
      AND (v_pend   IS NULL OR d.date <  v_pend)
    GROUP BY d.postal_code
  ),
  snap AS (
    SELECT zone_id, zone_name, item_id, item_name,
           max(item_weight) AS item_weight,
           max(expected_share) AS expected_share,
           array_agg(DISTINCT postal_code) AS cps,
           count(DISTINCT postal_code) AS cp_count
    FROM public.campaign_plan_snapshot
    WHERE campaign_id = p_campaign_id AND version = v_version
    GROUP BY zone_id, zone_name, item_id, item_name
  ),
  per_item AS (
    SELECT s.zone_id, s.zone_name, s.item_id, s.item_name, s.item_weight,
           s.expected_share, s.cp_count,
           COALESCE(SUM(rc.imp), 0)   AS actual_imp,
           COALESCE(SUM(rc.spend), 0) AS actual_spend
    FROM snap s
    LEFT JOIN real_cp rc ON rc.postal_code = ANY(s.cps)
    GROUP BY s.zone_id, s.zone_name, s.item_id, s.item_name, s.item_weight, s.expected_share, s.cp_count
  )
  SELECT
    jsonb_agg(jsonb_build_object(
      'zone_id', zone_id, 'zone_name', zone_name,
      'item_id', item_id, 'item_name', item_name,
      'item_weight', item_weight, 'expected_share', expected_share,
      'actual_imp', actual_imp, 'actual_spend', actual_spend, 'cp_count', cp_count
    )),
    COALESCE(SUM(actual_imp), 0),
    COALESCE(SUM(actual_spend), 0)
  INTO v_result, v_in_plan_imp, v_in_plan_spend
  FROM per_item;

  SELECT
    COALESCE(SUM(CASE p_metric_field
                   WHEN 'tracked_ads' THEN d.tracked_ads
                   WHEN 'unique_impressions' THEN d.unique_impressions
                   ELSE d.impressions END), 0)::numeric,
    COALESCE(SUM(COALESCE(d.spend, 0)), 0)::numeric
  INTO v_total_imp, v_total_spend
  FROM public.dsp_campaign_data d
  WHERE d.campaign_id = p_campaign_id
    AND (v_pstart IS NULL OR d.date >= v_pstart)
    AND (v_pend   IS NULL OR d.date <  v_pend);

  RETURN jsonb_build_object(
    'version', v_version,
    'items', COALESCE(v_result, '[]'::jsonb),
    'in_plan_imp', v_in_plan_imp,
    'total_imp', v_total_imp,
    'spillover', jsonb_build_object(
      'imp', GREATEST(v_total_imp - v_in_plan_imp, 0),
      'spend', GREATEST(v_total_spend - v_in_plan_spend, 0)
    )
  );
END $$;
```

- [ ] **Step 2: Appliquer via MCP + vérifier**

Appeler `apply_migration` (project `vkkdbygwbrxyogqosten`, name `campaign_plan_snapshot_periods`) avec le SQL ci-dessus. Puis `execute_sql` :
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='campaign_plan_snapshot' AND column_name IN ('period_start','period_end');
```
Attendu : 2 lignes. `EXPLAIN` de la RPC est prévu au Task 8 (avec des données seedées).

- [ ] **Step 3: Étendre l'endpoint snapshot pour accepter la période**

Dans `app/api/custom-geo/media-plan/snapshot/route.ts` :

(a) Ajouter à `BodySchema` (après `cible`) :
```ts
  period_start: z.string().nullable().optional(),
  period_end: z.string().nullable().optional(),
```
(b) Extraire dans le destructuring :
```ts
  const { campaign_id, dsp, budget, cpm, cible, zones, period_start, period_end } = parsed.data;
```
(c) Ajouter les deux champs à chaque ligne poussée (dans le `rows.push({...})`) :
```ts
            item_weight: item.item_weight, expected_share: item.expected_share, postal_code: cp,
            period_start: period_start ?? null, period_end: period_end ?? null,
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 5: Commit**

```bash
git add sql/097_campaign_plan_snapshot_periods.sql "app/api/custom-geo/media-plan/snapshot/route.ts"
git commit -m "feat(pacing): période-aware — get_campaign_pacing filtré par période + snapshot périodé"
```

---

### Task 5: Constantes & fixtures démo — `lib/demo/constants.ts` + `lib/demo/fixtures.ts`

**Files:**
- Create: `lib/demo/constants.ts`, `lib/demo/fixtures.ts`

**Interfaces:**
- Produces:
  - `constants` : `DEMO_SEED`, `PERIOD_LEN_DAYS`, `CALENDAR_START`, `TOTAL_VOLUME`, `SIM_GAIN`, `SIM_NOISE`, `DEMO_CAMPAIGN_ID`, `DEMO_ORG_ID`, `DEMO_ZONE_ID`, `DEMO_ZONE_NAME`, `periodBounds(period: number): { start: string; end: string }`.
  - `fixtures` : `ensureDemoCampaign(supabase): Promise<void>` (idempotent), `ensureDemoPlan(supabase): Promise<{ items: {item_id, item_name, weight}[] }>`.

- [ ] **Step 1: Écrire les constantes**

Créer `lib/demo/constants.ts` :

```ts
/** Constantes de la démo — source unique, tunables. */
export const DEMO_SEED = 42;
export const PERIOD_LEN_DAYS = 30;
export const CALENDAR_START = '2026-01-01';
export const TOTAL_VOLUME = 5_000_000;
export const SIM_GAIN = 3;
export const SIM_NOISE = 0.1;

export const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000001'; // GENESIS (Global)
export const DEMO_ZONE_ID = 'f001b479-b870-4958-978d-e7a98b90de57'; // CIRFA BRETAGNE (existe)
export const DEMO_ZONE_NAME = 'CIRFA BRETAGNE';
export const DEMO_CAMPAIGN_ID = 'dede0000-0000-4000-8000-000000000001';

/** Bornes date d'une période (1-based) du calendrier synthétique. */
export function periodBounds(period: number): { start: string; end: string } {
  const base = new Date(`${CALENDAR_START}T00:00:00Z`);
  const start = new Date(base); start.setUTCDate(base.getUTCDate() + (period - 1) * PERIOD_LEN_DAYS);
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + PERIOD_LEN_DAYS);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
```

- [ ] **Step 2: Écrire les fixtures**

Créer `lib/demo/fixtures.ts` :

```ts
/**
 * Fixtures de la campagne fictive (idempotentes, IDs stables). Réutilise l'org
 * GENESIS (Global) et la zone battle CIRFA BRETAGNE existante ; crée une campagne
 * is_demo dédiée + un plan média initial (poids égaux sur les 4 items).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEMO_CAMPAIGN_ID, DEMO_ORG_ID, DEMO_ZONE_ID, DEMO_ZONE_NAME } from '@/lib/demo/constants';

/** Crée (ou garantit) la campagne démo is_demo. Idempotent (upsert par id fixe).
 *  NOTE implémenteur : vérifier les colonnes réelles de `dsp_campaigns` avant
 *  (`SELECT column_name FROM information_schema.columns WHERE table_name='dsp_campaigns'`)
 *  et ajouter date_start/date_end/country SI le schéma les impose NOT NULL. Le set
 *  minimal ci-dessous (id, organization_id, name, is_demo) suffit au moteur. */
export async function ensureDemoCampaign(supabase: SupabaseClient): Promise<void> {
  await supabase.from('dsp_campaigns').upsert({
    id: DEMO_CAMPAIGN_ID,
    organization_id: DEMO_ORG_ID,
    name: 'Démo — pilotage CIRFA (fictive)',
    is_demo: true,
  }, { onConflict: 'id' });
}

/** Récupère les items de la zone CIRFA depuis get_zone_items_export et pose un plan
 *  média initial à poids égaux. Retourne les items pour le snapshot v1. */
export async function ensureDemoPlan(
  supabase: SupabaseClient,
  callerUserId: string,
): Promise<{ items: Array<{ item_id: string; item_name: string; weight: number }> }> {
  const { data } = await supabase.rpc('get_zone_items_export', {
    p_zone_id: DEMO_ZONE_ID, p_caller_user_id: callerUserId,
  }) as { data: { items: Array<{ poi_id: string; poi_name: string }> } | null };
  const raw = data?.items ?? [];
  if (raw.length === 0) throw new Error('demo_zone_not_expandable');

  const w = Math.round((100 / raw.length) * 10) / 10;
  const items = raw.map(it => ({ item_id: `${DEMO_ZONE_ID}:${it.poi_id}`, item_name: it.poi_name, weight: w }));

  // Persiste le plan média sur la campagne (geo_strategy.media_plan)
  const weights: Record<string, number> = Object.fromEntries(items.map(it => [it.item_id, it.weight]));
  const { data: camp } = await supabase.from('dsp_campaigns').select('geo_strategy').eq('id', DEMO_CAMPAIGN_ID).single();
  const existing = (camp?.geo_strategy ?? {}) as Record<string, unknown>;
  await supabase.from('dsp_campaigns').update({
    geo_strategy: { ...existing, media_plan: { zones: [{ id: DEMO_ZONE_ID, name: DEMO_ZONE_NAME }], budget: 100000, cpm: 5, cible: 'total', weights, updated_at: new Date().toISOString() } },
  }).eq('id', DEMO_CAMPAIGN_ID);

  return { items };
}
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit` (attendu : 0 erreur).
```bash
git add lib/demo/constants.ts lib/demo/fixtures.ts
git commit -m "feat(demo): constantes + fixtures idempotentes (campagne fictive CIRFA)"
```

---

### Task 6: Contrôleur démo — routes `/api/demo/*`

**Files:**
- Create: `lib/demo/controller.ts` (helpers partagés), `app/api/demo/seed/route.ts`, `app/api/demo/simulate-period/route.ts`, `app/api/demo/apply-rebid/route.ts`, `app/api/demo/reset/route.ts`, `app/api/demo/teardown/route.ts`

**Interfaces:**
- Consumes: `simulateDelivery`, `computeRebidWeights`, `computePacing`, fixtures, constants, endpoint snapshot (via appel interne ou insert direct).

**Note d'implémentation** : pour éviter un aller-retour HTTP interne, ces routes utilisent `createAdminClient()` directement (pas de fetch vers `/media-plan/snapshot`). La création de snapshot réutilise `buildZoneSnapshotItems` + insert direct (même logique que l'endpoint), avec les bornes de période.

- [ ] **Step 1: Helpers partagés `lib/demo/controller.ts`**

Créer `lib/demo/controller.ts` :

```ts
/**
 * Helpers du contrôleur démo — garde is_demo, création de snapshot périodé,
 * simulation d'une période, purge. Toute écriture exige is_demo=true.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildZoneSnapshotItems } from '@/lib/pacing/snapshot';
import { simulateDelivery, type SimItem } from '@/lib/demo/simulator';
import { DEMO_CAMPAIGN_ID, DEMO_ZONE_ID, DEMO_ZONE_NAME, DEMO_SEED, TOTAL_VOLUME, SIM_GAIN, SIM_NOISE, periodBounds } from '@/lib/demo/constants';

/** Garde dure : refuse d'agir sur une campagne non-démo. */
export async function assertDemo(supabase: SupabaseClient, campaignId: string): Promise<void> {
  const { data } = await supabase.from('dsp_campaigns').select('is_demo').eq('id', campaignId).single();
  if (!data?.is_demo) throw new Error('not_a_demo_campaign');
}

/** Dernière version de snapshot de la campagne démo (0 si aucune). */
export async function latestVersion(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.from('campaign_plan_snapshot').select('version')
    .eq('campaign_id', DEMO_CAMPAIGN_ID).order('version', { ascending: false }).limit(1);
  return (data?.[0]?.version as number | undefined) ?? 0;
}

/** Crée un snapshot périodé pour la campagne démo à partir de poids par item. */
export async function createPeriodSnapshot(
  supabase: SupabaseClient, callerUserId: string,
  items: Array<{ item_id: string; item_name: string; weight: number }>, period: number,
): Promise<number> {
  const version = (await latestVersion(supabase)) + 1;
  const { start, end } = periodBounds(period);
  const { data } = await supabase.rpc('get_zone_items_export', {
    p_zone_id: DEMO_ZONE_ID, p_caller_user_id: callerUserId,
  }) as { data: { items: Array<{ poi_id: string; cps: string[] }> } | null };
  const cpsByPoi = new Map((data?.items ?? []).map(it => [it.poi_id, it.cps]));
  const snapshotItems = buildZoneSnapshotItems(DEMO_ZONE_ID, items, cpsByPoi);

  const rows: Array<Record<string, unknown>> = [];
  for (const it of snapshotItems) for (const cp of it.cps) {
    rows.push({
      campaign_id: DEMO_CAMPAIGN_ID, version, created_by: callerUserId, dsp: 'dv360',
      budget: 100000, cpm: 5, cible: 'total', zone_id: DEMO_ZONE_ID, zone_name: DEMO_ZONE_NAME,
      item_id: it.item_id, item_name: it.item_name, item_weight: it.item_weight,
      expected_share: it.expected_share, postal_code: cp, period_start: start, period_end: end,
    });
  }
  if (rows.length === 0) throw new Error('no_expandable_items');
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase.from('campaign_plan_snapshot').insert(rows.slice(i, i + 50));
    if (error) { await supabase.from('campaign_plan_snapshot').delete().eq('campaign_id', DEMO_CAMPAIGN_ID).eq('version', version); throw error; }
  }
  return version;
}

/** Simule la délivrance de la période courante (dernière version) et l'écrit (idempotent). */
export async function simulateCurrentPeriod(supabase: SupabaseClient): Promise<{ rows: number }> {
  const version = await latestVersion(supabase);
  if (version === 0) throw new Error('no_snapshot');

  const { data: snap } = await supabase.from('campaign_plan_snapshot')
    .select('zone_id, item_id, expected_share, postal_code, period_start, period_end')
    .eq('campaign_id', DEMO_CAMPAIGN_ID).eq('version', version);
  const rows = snap ?? [];
  if (rows.length === 0) throw new Error('empty_snapshot');
  const period = version; // 1 version ↔ 1 période dans la démo
  const periodStart = rows[0].period_start as string;

  // Reconstruire les SimItem (item → cps + expected_share)
  const byItem = new Map<string, SimItem>();
  const cps = new Set<string>();
  for (const r of rows) {
    cps.add(r.postal_code as string);
    const it = byItem.get(r.item_id as string) ?? { zone_id: r.zone_id as string, item_id: r.item_id as string, expected_share: r.expected_share as number, cps: [] };
    it.cps.push(r.postal_code as string);
    byItem.set(r.item_id as string, it);
  }

  // Audience par CP
  const { data: refs } = await supabase.from('ref_codes_postaux')
    .select('code_postal, pop_total').in('code_postal', Array.from(cps));
  const audienceByCp: Record<string, number> = Object.fromEntries((refs ?? []).map(r => [r.code_postal as string, Number(r.pop_total) || 0]));

  const delivery = simulateDelivery({
    items: Array.from(byItem.values()), audienceByCp, seed: DEMO_SEED, period,
    totalVolume: TOTAL_VOLUME, gain: SIM_GAIN, noise: SIM_NOISE,
  });

  // Idempotence : purge la délivrance de cette période avant réinsertion
  const { end } = periodBounds(period);
  await supabase.from('dsp_campaign_data').delete()
    .eq('campaign_id', DEMO_CAMPAIGN_ID).gte('date', periodStart).lt('date', end);

  const dataRows = delivery.map(d => ({
    campaign_id: DEMO_CAMPAIGN_ID, country: 'France', dsp_source: 'simulator', media: 'sim',
    date: periodStart, postal_code: d.postal_code,
    impressions: d.impressions, clicks: d.clicks, spend: d.spend, metrics: {},
  }));
  for (let i = 0; i < dataRows.length; i += 50) {
    const { error } = await supabase.from('dsp_campaign_data').insert(dataRows.slice(i, i + 50));
    if (error) throw error;
  }
  return { rows: dataRows.length };
}

/** Purge délivrance + snapshots de la campagne démo. */
export async function purgeDemo(supabase: SupabaseClient): Promise<void> {
  await supabase.from('dsp_campaign_data').delete().eq('campaign_id', DEMO_CAMPAIGN_ID);
  await supabase.from('campaign_plan_snapshot').delete().eq('campaign_id', DEMO_CAMPAIGN_ID);
}
```

- [ ] **Step 2: Route `seed`**

Créer `app/api/demo/seed/route.ts` :

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { ensureDemoCampaign, ensureDemoPlan } from '@/lib/demo/fixtures';
import { createPeriodSnapshot, simulateCurrentPeriod, purgeDemo, assertDemo } from '@/lib/demo/controller';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    await ensureDemoCampaign(supabase);
    await assertDemo(supabase, (await import('@/lib/demo/constants')).DEMO_CAMPAIGN_ID);
    await purgeDemo(supabase);                                    // repart propre
    const { items } = await ensureDemoPlan(supabase, profile.id);
    const version = await createPeriodSnapshot(supabase, profile.id, items, 1);
    const { rows } = await simulateCurrentPeriod(supabase);
    return NextResponse.json({ ok: true, version, delivery_rows: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'seed_failed' }, { status: 400 });
  }
}
```

- [ ] **Step 3: Routes `simulate-period`, `apply-rebid`, `reset`, `teardown`**

Créer `app/api/demo/simulate-period/route.ts` :

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { assertDemo, simulateCurrentPeriod } from '@/lib/demo/controller';
import { DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    await assertDemo(supabase, DEMO_CAMPAIGN_ID);
    const { rows } = await simulateCurrentPeriod(supabase);
    return NextResponse.json({ ok: true, delivery_rows: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'simulate_failed' }, { status: 400 });
  }
}
```

Créer `app/api/demo/apply-rebid/route.ts` :

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { computeRebidWeights, type RebidItemInput } from '@/lib/pacing/rebid';
import { computePacing, type PacingItemInput } from '@/lib/pacing/compute';
import { assertDemo, latestVersion, createPeriodSnapshot, simulateCurrentPeriod } from '@/lib/demo/controller';
import { DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    await assertDemo(supabase, DEMO_CAMPAIGN_ID);
    const version = await latestVersion(supabase);
    if (version === 0) return NextResponse.json({ error: 'no_snapshot' }, { status: 400 });

    // Diagnostic de la version courante via la vraie RPC
    const { data } = await supabase.rpc('get_campaign_pacing', {
      p_campaign_id: DEMO_CAMPAIGN_ID, p_metric_field: 'impressions', p_version: version,
    });
    const rpc = (typeof data === 'string' ? JSON.parse(data) : data) as { items: PacingItemInput[] } | null;
    if (!rpc?.items?.length) return NextResponse.json({ error: 'no_pacing' }, { status: 400 });

    const pacing = computePacing(rpc.items);
    const rebid = computeRebidWeights(pacing.map<RebidItemInput>(p => ({
      zone_id: p.zone_id, item_id: p.item_id, item_weight: p.item_weight,
      expected_share: p.expected_share, actual_share: p.actual_share,
    })));

    const items = rebid.map(r => {
      const src = pacing.find(p => p.item_id === r.item_id)!;
      return { item_id: r.item_id, item_name: src.item_name, weight: Math.round(r.new_weight * 10) / 10 };
    });
    const newVersion = await createPeriodSnapshot(supabase, profile.id, items, version + 1);
    const { rows } = await simulateCurrentPeriod(supabase);
    return NextResponse.json({ ok: true, version: newVersion, delivery_rows: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'rebid_failed' }, { status: 400 });
  }
}
```

Créer `app/api/demo/reset/route.ts` :

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { assertDemo, purgeDemo, createPeriodSnapshot, simulateCurrentPeriod } from '@/lib/demo/controller';
import { ensureDemoPlan } from '@/lib/demo/fixtures';
import { DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    await assertDemo(supabase, DEMO_CAMPAIGN_ID);
    await purgeDemo(supabase);
    const { items } = await ensureDemoPlan(supabase, profile.id);
    const version = await createPeriodSnapshot(supabase, profile.id, items, 1);
    await simulateCurrentPeriod(supabase);
    return NextResponse.json({ ok: true, version });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'reset_failed' }, { status: 400 });
  }
}
```

Créer `app/api/demo/teardown/route.ts` :

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { assertDemo, purgeDemo } from '@/lib/demo/controller';
import { DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    await assertDemo(supabase, DEMO_CAMPAIGN_ID);
    await purgeDemo(supabase);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'teardown_failed' }, { status: 400 });
  }
}
```

- [ ] **Step 4: Type-check + commit**

Run: `npx tsc --noEmit` (attendu : 0 erreur).
```bash
git add lib/demo/controller.ts "app/api/demo"
git commit -m "feat(demo): contrôleur seed/simulate/apply-rebid/reset/teardown (garde is_demo)"
```

---

### Task 7: Sélecteur de version dans `PacingPanel` (observer la convergence)

**Files:**
- Modify: `app/map/analyse/digital/_components/PacingPanel.tsx`

**Interfaces:**
- Consumes: la route `GET /api/digital/[campaignId]/pacing?version=` (supporte déjà `version`).

- [ ] **Step 1: Ajouter un sélecteur de version**

Dans `PacingPanel.tsx` : ajouter un state `version: number | null` (défaut null = dernière), un `<select>` listant les versions disponibles (1..currentVersion, où currentVersion vient de la réponse `data.version`), et refetch `?version=` au changement. Le rendu du tableau est inchangé ; seul l'ajout du sélecteur au-dessus des KPIs. Tokens `var(--…)`, sentence case, pas de hex.

```tsx
// state
const [version, setVersion] = useState<number | null>(null);
// dans le useEffect de fetch, inclure version dans l'URL :
const url = version ? `/api/digital/${campaignId}/pacing?version=${version}` : `/api/digital/${campaignId}/pacing`;
// dépendance [campaignId, version]
// rendu (au-dessus des KPIs, quand data existe) :
<div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
  <span>Version</span>
  <select value={version ?? d.version}
    onChange={(e) => setVersion(Number(e.target.value))}
    style={{ background: 'var(--elevated)', color: 'var(--text-primary)', border: '0.5px solid var(--border-subtle)', borderRadius: 6, padding: '4px 8px', fontFamily: fInter, fontSize: 12 }}>
    {Array.from({ length: d.version }, (_, i) => i + 1).map(v => (
      <option key={v} value={v}>v{v}</option>
    ))}
  </select>
</div>
```
(Adapter `d`/`data` au nom réel de la variable de réponse dans le composant.)

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit` (attendu : 0 erreur). Vérif navigateur (au contrôle final) : basculer v1/v2/v3 recharge le diagnostic de la version.
```bash
git add "app/map/analyse/digital/_components/PacingPanel.tsx"
git commit -m "feat(demo): sélecteur de version dans PacingPanel (observer la convergence)"
```

---

### Task 8: Boucle E2E réelle + EXPLAIN Nano (vérification)

**Files:** aucun fichier applicatif (vérification via MCP + dev).

**Interfaces:** exerce les routes `/api/demo/*` de bout en bout.

- [ ] **Step 1: Exécuter la boucle via les routes (dev server + session admin)**

`npm run dev`. Avec une session admin (adminFetch), appeler dans l'ordre : `POST /api/demo/seed` → `POST /api/demo/apply-rebid` (×2). À chaque étape, lire `GET /api/digital/<DEMO_CAMPAIGN_ID>/pacing?version=N`. Vérifier que l'écart absolu moyen des items **décroît** v1→v2→v3 (cohérent avec le test pur du Task 3). *(Nécessite dev + session — noter au rapport comme vérif manuelle si l'implémenteur ne peut pas s'authentifier.)*

- [ ] **Step 2: EXPLAIN de la RPC période-aware (Nano)**

Après le seed (des lignes existent), via `execute_sql` :
```sql
EXPLAIN (ANALYZE, BUFFERS)
WITH real_cp AS (
  SELECT d.postal_code, SUM(d.impressions)::numeric AS imp
  FROM dsp_campaign_data d
  WHERE d.campaign_id = 'dede0000-0000-4000-8000-000000000001'
    AND d.date >= '2026-01-01' AND d.date < '2026-01-31'
  GROUP BY d.postal_code
) SELECT count(*) FROM real_cp;
```
Attendu : accès `dsp_campaign_data` via `idx_dsp_data_campaign` (index scan borné campagne), pas de seq scan. Si un index `(campaign_id, date)` améliorerait, le noter (non bloquant : la campagne démo est petite).

- [ ] **Step 3: Nettoyage**

Appeler `POST /api/demo/teardown` (ou `execute_sql` purge par `campaign_id`) pour laisser la base propre. Vérifier `campaign_plan_snapshot` et `dsp_campaign_data` vides pour `DEMO_CAMPAIGN_ID`.

- [ ] **Step 4: Commit (si notes de vérif à versionner)** — sinon rien à committer, la vérif est consignée au rapport.

---

## Notes transverses

- **Swap vers la prod** : remplacer `simulateCurrentPeriod` par un import réel (Adform/CM360) qui écrit les mêmes lignes `dsp_campaign_data` datées ; `apply-rebid` pousse alors vers un vrai DSP (DV360/TikTok, puis autres) au lieu de re-simuler. Le cœur (snapshot, pacing période-aware, rebid) est inchangé.
- **1 version ↔ 1 période** dans la démo (`period = version`). En prod, la période d'une version = de son push au push suivant.
- **Nano** : seule la campagne démo (~132 CP × quelques périodes) est écrite ; purge/scope par `campaign_id` indexé ; batch 50 partout.
- **Cohérence des types** : `SimItem.expected_share` = part intra-zone du snapshot ; `RebidItemInput`/`PacingItemInput` réutilisés tels quels de `@/lib/pacing/*` ; `item_id = zone_id:poi_id` partout.
```
