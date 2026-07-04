# Bilan de campagne (Brique C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un dashboard « Bilan » dans `/demo/pilote` qui synthétise une boucle de pilotage déjà exécutée (snapshots v1→vN) en quatre blocs : courbe de conformité, zone-par-zone avant/après, budget planifié vs dépensé, KPI + synthèse Gemini optionnelle.

**Architecture:** Une couche d'agrégation TS pure (`lib/report/`) rejoue `get_campaign_pacing` sur chaque version et assemble un objet `CampaignReport` ; deux routes GET/POST l'exposent (report + narration Gemini) ; un dashboard React (Recharts + composants présentational) le rend derrière un nouvel onglet, sans toucher `PilotChatPanel`.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (RPC `get_campaign_pacing`), Vercel AI SDK (`generateText` + Gemini 2.5 flash), Recharts, Vitest.

## Global Constraints

- **Supabase Nano I/O** : l'agrégateur boucle `get_campaign_pacing` **séquentiellement** (jamais `Promise.all`). Appels = nb de versions (≈3) + 2 requêtes légères. Aucun fan-out parallèle.
- **Design System** : couleurs via `var(--token)` UNIQUEMENT (jamais de hex en dur), pas de violet, accent `var(--brand-teal)`, statut via `PACING_STATUS_META[status].colorVar`. Fonts `Inter` (UI) + `JetBrains Mono` (données). Sentence case. Flat (pas de shadow/gradient/blur).
- **TypeScript strict**, imports absolus `@/`.
- **Routes API** : `export const dynamic = 'force-dynamic'` ; `requireAdmin` depuis `@/lib/api/middleware` + `adminUnauthorized()` ; `createAdminClient()` depuis `@/lib/auth` ; `assertDemo(supabase, DEMO_CAMPAIGN_ID)` depuis `@/lib/demo/controller` (fail-closed) ; AUCUNE `campaign_id` lue du body/query (tout scopé à la constante) ; réponses `Cache-Control: no-store` ; catch → `{ error }` status 400.
- **`PilotChatPanel` NON modifié** (export nommé `export function PilotChatPanel`). Pas de PDF. Pas de nouvelle table SQL. Ne pas modifier `middleware.ts` (couvre déjà `/demo/*`).
- **Spec** : `docs/superpowers/specs/2026-07-05-bilan-report-C-design.md`. Branche `feat/bilan-report-C` (spec commité `77b21c3`).

---

### Task 1: Couche d'agrégation (`lib/report/`)

**Files:**
- Create: `lib/report/types.ts`
- Create: `lib/report/aggregate.ts`
- Test: `tests/unit/report/aggregate.test.ts`

**Interfaces:**
- Consumes : `computePacing`, `PacingItemInput`, `PacingStatus` de `@/lib/pacing/compute` ; `CONVERGENCE_TOLERANCE`, `DEMO_CAMPAIGN_ID` de `@/lib/demo/constants`.
- Produces :
  - Types (dans `lib/report/types.ts`) : `SnapshotMeta`, `RawVersionPacing`, `ReportHeader`, `ConvergencePoint`, `ZoneBeforeAfter`, `BudgetSummary`, `ReportKpis`, `CampaignReport`.
  - `assembleReport(campaignName: string, meta: SnapshotMeta[], pacings: RawVersionPacing[]): CampaignReport | null` (PUR).
  - `buildCampaignReport(supabase: SupabaseClient, campaignId: string, metric?: string): Promise<CampaignReport | null>` (I/O).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/report/aggregate.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { assembleReport } from '@/lib/report/aggregate';
import type { SnapshotMeta, RawVersionPacing } from '@/lib/report/types';
import type { PacingItemInput } from '@/lib/pacing/compute';

// Deux items A/B, cible 50/50. v1 déséquilibrée (80/20), v2 (60/40), v3 convergée (51/49).
const item = (id: string, imp: number, spend: number): PacingItemInput => ({
  zone_id: 'z1', zone_name: 'Z', item_id: id, item_name: id.toUpperCase(),
  item_weight: 50, expected_share: 0.5, actual_imp: imp, actual_spend: spend, cp_count: 1,
});

const META: SnapshotMeta[] = [
  { version: 1, budget: 100000, cpm: 5, cible: 'total', dsp: 'dv360', zone_name: 'Z', period_start: '2026-01-01', period_end: '2026-01-31' },
  { version: 2, budget: 100000, cpm: 5, cible: 'total', dsp: 'dv360', zone_name: 'Z', period_start: '2026-01-31', period_end: '2026-03-02' },
  { version: 3, budget: 100000, cpm: 5, cible: 'total', dsp: 'dv360', zone_name: 'Z', period_start: '2026-03-02', period_end: '2026-04-01' },
];
const PACINGS: RawVersionPacing[] = [
  { version: 1, items: [item('a', 800, 0), item('b', 200, 0)], in_plan_imp: 1000, total_imp: 1000, spillover_imp: 0 },
  { version: 2, items: [item('a', 600, 0), item('b', 400, 0)], in_plan_imp: 1000, total_imp: 1000, spillover_imp: 0 },
  { version: 3, items: [item('a', 510, 300), item('b', 490, 290)], in_plan_imp: 1000, total_imp: 1000, spillover_imp: 0 },
];

describe('assembleReport', () => {
  it('assemble un report convergent depuis 3 versions', () => {
    const r = assembleReport('Démo', META, PACINGS)!;
    expect(r).not.toBeNull();

    // convergence : mean_delta décroissant, dernier converged
    expect(r.convergence.map((c) => c.version)).toEqual([1, 2, 3]);
    expect(r.convergence[0].mean_delta).toBe(30);
    expect(r.convergence[2].mean_delta).toBe(1);
    expect(r.convergence[2].converged).toBe(true);
    expect(r.convergence[0].converged).toBe(false);

    // zones : cible fixe, avant/après par item
    const a = r.zones.find((z) => z.item_id === 'a')!;
    expect(a.expected_share).toBe(0.5);
    expect(a.delta_first).toBe(30);
    expect(a.delta_last).toBe(1);
    expect(a.status_first).toBe('sur_servi');
    expect(a.status_last).toBe('conforme');

    // budget : planned = 3×100000 ; spent = fallback(v1,v2) + direct(v3)
    // v1 fallback = 1000×5/1000 = 5 ; v2 = 5 ; v3 direct = 300+290 = 590 → total 600
    expect(r.budget.planned_total).toBe(300000);
    expect(r.budget.spent_total).toBe(600);
    expect(r.budget.spent_last).toBe(590);
    expect(r.budget.planned_last).toBe(100000);
    expect(r.budget.spillover_pct).toBe(0);

    // kpis
    expect(r.kpis.corrections).toBe(2);
    expect(r.kpis.improvement_pts).toBe(29);
    expect(r.kpis.converged).toBe(true);
    expect(r.kpis.conforming_items_last).toBe(2);
    expect(r.kpis.total_items).toBe(2);

    // header
    expect(r.header.period_start).toBe('2026-01-01');
    expect(r.header.period_end).toBe('2026-04-01');
    expect(r.header.version_count).toBe(3);
    expect(r.header.zone_name).toBe('Z');
  });

  it('retourne null sans snapshot', () => {
    expect(assembleReport('Démo', [], [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/report/aggregate.test.ts`
Expected: FAIL — `Cannot find module '@/lib/report/aggregate'` (et `@/lib/report/types`).

- [ ] **Step 3: Write the types**

Create `lib/report/types.ts` :

```ts
import type { PacingItemInput, PacingStatus } from '@/lib/pacing/compute';

/** Entête de snapshot dédupliquée par version (colonnes répétées sur chaque ligne). */
export interface SnapshotMeta {
  version: number;
  budget: number;
  cpm: number;
  cible: string;
  dsp: string;
  zone_name: string;
  period_start: string | null;
  period_end: string | null;
}

/** Pacing brut d'une version, tel que renvoyé par get_campaign_pacing (avant computePacing). */
export interface RawVersionPacing {
  version: number;
  items: PacingItemInput[];
  in_plan_imp: number;
  total_imp: number;
  spillover_imp: number;
}

export interface ReportHeader {
  campaign_id: string;
  campaign_name: string;
  zone_name: string;
  dsp: string;
  cible: string;
  period_start: string;
  period_end: string;
  version_count: number;
}

export interface ConvergencePoint {
  version: number;
  mean_delta: number;   // moyenne |delta_pts|, 2 décimales
  converged: boolean;   // mean_delta < CONVERGENCE_TOLERANCE
}

export interface ZoneBeforeAfter {
  item_id: string;
  item_name: string;
  expected_share: number;     // cible fixe [0,1]
  actual_share_first: number; // v1 [0,1]
  actual_share_last: number;  // dernière version [0,1]
  delta_first: number;        // points, 1 décimale
  delta_last: number;         // points, 1 décimale
  status_first: PacingStatus;
  status_last: PacingStatus;
}

export interface BudgetSummary {
  planned_total: number;
  spent_total: number;
  variance_pct: number;
  planned_last: number;
  spent_last: number;
  variance_last_pct: number;
  in_plan_imp_total: number;
  total_imp_total: number;
  spillover_imp_total: number;
  spillover_pct: number;
}

export interface ReportKpis {
  corrections: number;
  delta_first: number;
  delta_last: number;
  improvement_pts: number;
  converged: boolean;
  conforming_items_last: number;
  total_items: number;
}

export interface CampaignReport {
  header: ReportHeader;
  convergence: ConvergencePoint[];
  zones: ZoneBeforeAfter[];
  budget: BudgetSummary;
  kpis: ReportKpis;
  narrative?: string | null;
}
```

- [ ] **Step 4: Write the aggregator**

Create `lib/report/aggregate.ts` :

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { computePacing, type PacingItemInput } from '@/lib/pacing/compute';
import { CONVERGENCE_TOLERANCE, DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';
import type {
  SnapshotMeta, RawVersionPacing, CampaignReport,
  ConvergencePoint, ZoneBeforeAfter, BudgetSummary, ReportKpis,
} from '@/lib/report/types';

const round = (n: number, d: number) => { const f = 10 ** d; return Math.round(n * f) / f; };

/** Dépense d'une version : Σ actual_spend ; sinon fallback déterministe Σ actual_imp × cpm / 1000. */
function versionSpend(items: PacingItemInput[], cpm: number): number {
  const spend = items.reduce((s, it) => s + (it.actual_spend ?? 0), 0);
  if (spend > 0) return spend;
  const imp = items.reduce((s, it) => s + (it.actual_imp ?? 0), 0);
  return (imp * cpm) / 1000;
}

/** Assemble le CampaignReport à partir des données déjà lues (PUR, testable). */
export function assembleReport(
  campaignName: string, meta: SnapshotMeta[], pacings: RawVersionPacing[],
): CampaignReport | null {
  if (meta.length === 0 || pacings.length === 0) return null;

  const metaByV = new Map(meta.map((m) => [m.version, m]));
  const computedByV = new Map(pacings.map((p) => [p.version, computePacing(p.items)]));
  const pacingByV = new Map(pacings.map((p) => [p.version, p]));

  const versions = pacings.map((p) => p.version).sort((a, b) => a - b);
  const firstV = versions[0];
  const lastV = versions[versions.length - 1];

  const convergence: ConvergencePoint[] = versions.map((v) => {
    const items = computedByV.get(v) ?? [];
    const mean = items.length ? items.reduce((s, it) => s + Math.abs(it.delta_pts), 0) / items.length : 0;
    const mean_delta = round(mean, 2);
    return { version: v, mean_delta, converged: mean_delta < CONVERGENCE_TOLERANCE };
  });

  const firstItems = computedByV.get(firstV) ?? [];
  const lastById = new Map((computedByV.get(lastV) ?? []).map((it) => [it.item_id, it]));
  const zones: ZoneBeforeAfter[] = firstItems.map((f) => {
    const l = lastById.get(f.item_id) ?? f;
    return {
      item_id: f.item_id, item_name: f.item_name,
      expected_share: f.expected_share,
      actual_share_first: f.actual_share, actual_share_last: l.actual_share,
      delta_first: round(f.delta_pts, 1), delta_last: round(l.delta_pts, 1),
      status_first: f.status, status_last: l.status,
    };
  });

  const spentByV = (v: number) => versionSpend(pacingByV.get(v)!.items, metaByV.get(v)?.cpm ?? 0);
  const planned_total = meta.reduce((s, m) => s + (m.budget ?? 0), 0);
  const spent_total = round(versions.reduce((s, v) => s + spentByV(v), 0), 2);
  const planned_last = metaByV.get(lastV)?.budget ?? 0;
  const spent_last = round(spentByV(lastV), 2);
  const in_plan_imp_total = pacings.reduce((s, p) => s + (p.in_plan_imp ?? 0), 0);
  const total_imp_total = pacings.reduce((s, p) => s + (p.total_imp ?? 0), 0);
  const spillover_imp_total = pacings.reduce((s, p) => s + (p.spillover_imp ?? 0), 0);
  const budget: BudgetSummary = {
    planned_total, spent_total,
    variance_pct: planned_total > 0 ? round(((spent_total - planned_total) / planned_total) * 100, 1) : 0,
    planned_last, spent_last,
    variance_last_pct: planned_last > 0 ? round(((spent_last - planned_last) / planned_last) * 100, 1) : 0,
    in_plan_imp_total, total_imp_total, spillover_imp_total,
    spillover_pct: total_imp_total > 0 ? round((spillover_imp_total / total_imp_total) * 100, 1) : 0,
  };

  const delta_first = convergence[0].mean_delta;
  const delta_last = convergence[convergence.length - 1].mean_delta;
  const kpis: ReportKpis = {
    corrections: versions.length - 1,
    delta_first, delta_last, improvement_pts: round(delta_first - delta_last, 2),
    converged: convergence[convergence.length - 1].converged,
    conforming_items_last: zones.filter((z) => z.status_last === 'conforme').length,
    total_items: zones.length,
  };

  const m0 = metaByV.get(firstV)!;
  const mN = metaByV.get(lastV)!;
  return {
    header: {
      campaign_id: DEMO_CAMPAIGN_ID, campaign_name: campaignName,
      zone_name: m0.zone_name, dsp: m0.dsp, cible: m0.cible,
      period_start: m0.period_start ?? '', period_end: mN.period_end ?? '',
      version_count: versions.length,
    },
    convergence, zones, budget, kpis, narrative: undefined,
  };
}

/** Lit les snapshots + le pacing par version (séquentiel, Nano) puis assemble le report. */
export async function buildCampaignReport(
  supabase: SupabaseClient, campaignId: string, metric = 'impressions',
): Promise<CampaignReport | null> {
  const { data: camp } = await supabase.from('dsp_campaigns').select('name').eq('id', campaignId).single();
  const campaignName = (camp?.name as string | undefined) ?? 'Campagne';

  const { data: rows } = await supabase.from('campaign_plan_snapshot')
    .select('version, budget, cpm, cible, dsp, zone_name, period_start, period_end')
    .eq('campaign_id', campaignId).order('version', { ascending: true });
  if (!rows?.length) return null;

  const metaByV = new Map<number, SnapshotMeta>();
  for (const r of rows as Array<Record<string, unknown>>) {
    const v = Number(r.version);
    if (!metaByV.has(v)) metaByV.set(v, {
      version: v, budget: Number(r.budget ?? 0), cpm: Number(r.cpm ?? 0),
      cible: (r.cible as string) ?? '', dsp: (r.dsp as string) ?? '', zone_name: (r.zone_name as string) ?? '',
      period_start: (r.period_start as string) ?? null, period_end: (r.period_end as string) ?? null,
    });
  }
  const meta = [...metaByV.values()].sort((a, b) => a.version - b.version);

  const pacings: RawVersionPacing[] = [];
  for (const m of meta) {
    const { data } = await supabase.rpc('get_campaign_pacing', {
      p_campaign_id: campaignId, p_metric_field: metric, p_version: m.version,
    });
    const rpc = (typeof data === 'string' ? JSON.parse(data) : data) as
      { items?: PacingItemInput[]; in_plan_imp?: number; total_imp?: number; spillover?: { imp?: number } } | null;
    if (!rpc) continue;
    pacings.push({
      version: m.version, items: rpc.items ?? [],
      in_plan_imp: Number(rpc.in_plan_imp ?? 0), total_imp: Number(rpc.total_imp ?? 0),
      spillover_imp: Number(rpc.spillover?.imp ?? 0),
    });
  }
  return assembleReport(campaignName, meta, pacings);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/report/aggregate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 7: Commit**

```bash
git add lib/report/types.ts lib/report/aggregate.ts tests/unit/report/aggregate.test.ts
git commit -m "feat(bilan): couche d'agrégation report (assembleReport pur + buildCampaignReport)"
```

---

### Task 2: Route `GET /api/demo/report`

**Files:**
- Create: `app/api/demo/report/route.ts`

**Interfaces:**
- Consumes : `buildCampaignReport` de `@/lib/report/aggregate` ; `assertDemo` de `@/lib/demo/controller` ; `DEMO_CAMPAIGN_ID` de `@/lib/demo/constants` ; `requireAdmin`/`adminUnauthorized` de `@/lib/api/middleware` ; `createAdminClient` de `@/lib/auth`.
- Produces : `GET /api/demo/report` → `{ report: CampaignReport | null }`, `no-store`.

- [ ] **Step 1: Write the route**

Create `app/api/demo/report/route.ts` :

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { assertDemo } from '@/lib/demo/controller';
import { DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';
import { buildCampaignReport } from '@/lib/report/aggregate';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    await assertDemo(supabase, DEMO_CAMPAIGN_ID);
    const report = await buildCampaignReport(supabase, DEMO_CAMPAIGN_ID);
    return NextResponse.json({ report: report ?? null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'report_failed' }, { status: 400 });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add app/api/demo/report/route.ts
git commit -m "feat(bilan): route GET /api/demo/report"
```

---

### Task 3: Route `POST /api/demo/report/narrative` (Gemini)

**Files:**
- Create: `app/api/demo/report/narrative/route.ts`

**Interfaces:**
- Consumes : `buildCampaignReport` ; `assertDemo` ; `DEMO_CAMPAIGN_ID` ; `requireAdmin`/`adminUnauthorized` ; `createAdminClient` ; `createModel` de `@/lib/chat/providers` ; `generateText` de `ai`.
- Produces : `POST /api/demo/report/narrative` → `{ narrative: string }` ou `{ error }`.

- [ ] **Step 1: Write the route**

Create `app/api/demo/report/narrative/route.ts` :

```ts
import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { createModel } from '@/lib/chat/providers';
import { assertDemo } from '@/lib/demo/controller';
import { DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';
import { buildCampaignReport } from '@/lib/report/aggregate';

export const dynamic = 'force-dynamic';

const SYSTEM = [
  'Tu es analyste media chez une regie publicitaire.',
  'On te donne le bilan chiffre d\'une campagne pilotee (courbe de conformite par version,',
  'zone par zone avant/apres, budget planifie vs depense, KPI).',
  'Redige une synthese factuelle de 3 a 4 phrases en francais, en sentence case, sans superlatif.',
  'Cite les chiffres reels (ecart moyen, nombre de corrections, zones conformes, budget).',
  'Ne fais pas de liste, un seul paragraphe.',
].join(' ');

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    await assertDemo(supabase, DEMO_CAMPAIGN_ID);
    const report = await buildCampaignReport(supabase, DEMO_CAMPAIGN_ID);
    if (!report) return NextResponse.json({ error: 'no_snapshot' }, { status: 400 });
    const { text } = await generateText({
      model: createModel('gemini'),
      system: SYSTEM,
      prompt: JSON.stringify({
        convergence: report.convergence, zones: report.zones,
        budget: report.budget, kpis: report.kpis,
      }),
      temperature: 0.2,
      maxRetries: 0,
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
    });
    return NextResponse.json({ narrative: text.trim() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'narrative_failed' }, { status: 400 });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add app/api/demo/report/narrative/route.ts
git commit -m "feat(bilan): route POST /api/demo/report/narrative (synthese Gemini)"
```

---

### Task 4: Util auth + composants présentational du dashboard

**Files:**
- Create: `app/demo/pilote/_lib/authHeader.ts`
- Create: `app/demo/pilote/_components/ConvergenceChart.tsx`
- Create: `app/demo/pilote/_components/ZoneBeforeAfterTable.tsx`
- Create: `app/demo/pilote/_components/BudgetCard.tsx`
- Create: `app/demo/pilote/_components/KpiStrip.tsx`

**Interfaces:**
- Consumes : types de `@/lib/report/types` ; `PACING_STATUS_META` de `@/lib/pacing/compute` ; `CONVERGENCE_TOLERANCE` de `@/lib/demo/constants` ; `recharts`.
- Produces :
  - `demoAuthHeader(): Record<string, string>` (util partagé).
  - `ConvergenceChart({ points: ConvergencePoint[] })`, `ZoneBeforeAfterTable({ zones: ZoneBeforeAfter[] })`, `BudgetCard({ budget: BudgetSummary })`, `KpiStrip({ kpis: ReportKpis })` — tous exports nommés.

> Tous les composants : `'use client'`, styles inline avec `var(--token)` uniquement (jamais de hex), fonts `Inter, sans-serif` (UI) et `JetBrains Mono, monospace` (données), sentence case.

- [ ] **Step 1: Write the auth util**

Create `app/demo/pilote/_lib/authHeader.ts` (extrait de la logique inline de PilotChatPanel — PilotChatPanel n'est PAS modifié) :

```ts
/** Bearer lu depuis le cookie session @supabase/ssr (sb-<ref>-auth-token). */
export function demoAuthHeader(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return {};
  const ref = new URL(url).hostname.split('.')[0];
  const c = document.cookie.split('; ').find((x) => x.startsWith(`sb-${ref}-auth-token=`));
  if (!c) return {};
  let val = decodeURIComponent(c.substring(c.indexOf('=') + 1));
  if (val.startsWith('base64-')) { try { val = atob(val.slice(7)); } catch { return {}; } }
  try {
    const token = JSON.parse(val).access_token as string | undefined;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}
```

- [ ] **Step 2: Write ConvergenceChart**

Create `app/demo/pilote/_components/ConvergenceChart.tsx` :

```tsx
'use client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { CONVERGENCE_TOLERANCE } from '@/lib/demo/constants';
import type { ConvergencePoint } from '@/lib/report/types';

export function ConvergenceChart({ points }: { points: ConvergencePoint[] }) {
  const data = points.map((p) => ({ name: `v${p.version}`, ecart: p.mean_delta }));
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
          <XAxis dataKey="name" stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} />
          <YAxis stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: 'var(--card)', border: '0.5px solid var(--border-default)', color: 'var(--text-primary)', fontSize: 12 }}
            labelStyle={{ color: 'var(--text-tertiary)' }}
            formatter={(v: number) => [`${v} pts`, 'écart moyen']}
          />
          <ReferenceLine y={CONVERGENCE_TOLERANCE} stroke="var(--brand-teal)" strokeDasharray="4 4"
            label={{ value: 'seuil', fill: 'var(--text-tertiary)', fontSize: 10, position: 'right' }} />
          <Line type="monotone" dataKey="ecart" stroke="var(--brand-teal)" strokeWidth={2} dot={{ r: 3, fill: 'var(--brand-teal)' }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Write ZoneBeforeAfterTable**

Create `app/demo/pilote/_components/ZoneBeforeAfterTable.tsx` :

```tsx
'use client';
import { PACING_STATUS_META } from '@/lib/pacing/compute';
import type { ZoneBeforeAfter } from '@/lib/report/types';

const pct = (n: number) => `${Math.round(n * 100)}%`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
const mono = 'JetBrains Mono, monospace';

export function ZoneBeforeAfterTable({ zones }: { zones: ZoneBeforeAfter[] }) {
  const sorted = [...zones].sort((a, b) => b.delta_last - a.delta_last);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ color: 'var(--text-tertiary)', textAlign: 'left' }}>
          <th style={{ padding: '6px 8px', fontWeight: 400 }}>Zone</th>
          <th style={{ fontWeight: 400 }}>Cible</th>
          <th style={{ fontWeight: 400 }}>Réel v1</th>
          <th style={{ fontWeight: 400 }}>Réel final</th>
          <th style={{ fontWeight: 400 }}>Δ v1</th>
          <th style={{ fontWeight: 400 }}>Δ final</th>
          <th style={{ fontWeight: 400 }}>Statut</th>
        </tr>
      </thead>
      <tbody style={{ fontFamily: mono }}>
        {sorted.map((z) => (
          <tr key={z.item_id} style={{ borderTop: '0.5px solid var(--border-subtle)' }}>
            <td style={{ padding: '6px 8px', fontFamily: 'Inter, sans-serif', color: 'var(--text-primary)' }}>{z.item_name}</td>
            <td>{pct(z.expected_share)}</td>
            <td>{pct(z.actual_share_first)}</td>
            <td>{pct(z.actual_share_last)}</td>
            <td style={{ color: PACING_STATUS_META[z.status_first].colorVar }}>{signed(z.delta_first)}</td>
            <td style={{ color: PACING_STATUS_META[z.status_last].colorVar }}>{signed(z.delta_last)}</td>
            <td style={{ color: PACING_STATUS_META[z.status_last].colorVar }}>{PACING_STATUS_META[z.status_last].label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Write BudgetCard**

Create `app/demo/pilote/_components/BudgetCard.tsx` :

```tsx
'use client';
import type { BudgetSummary } from '@/lib/report/types';

const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const signedPct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
const mono = 'JetBrains Mono, monospace';

export function BudgetCard({ budget }: { budget: BudgetSummary }) {
  const over = budget.variance_pct > 0;
  const row = { display: 'flex', justifyContent: 'space-between' } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
      <div style={row}>
        <span>Budget planifié (vol)</span>
        <strong style={{ fontFamily: mono, color: 'var(--text-primary)' }}>{eur(budget.planned_total)}</strong>
      </div>
      <div style={row}>
        <span>Dépensé (vol)</span>
        <strong style={{ fontFamily: mono, color: over ? 'var(--warning)' : 'var(--brand-teal)' }}>
          {eur(budget.spent_total)} ({signedPct(budget.variance_pct)})
        </strong>
      </div>
      <div style={{ ...row, color: 'var(--text-tertiary)', fontSize: 12 }}>
        <span>État final (dernière période)</span>
        <span style={{ fontFamily: mono }}>{eur(budget.spent_last)} / {eur(budget.planned_last)}</span>
      </div>
      <div style={{ ...row, color: 'var(--text-tertiary)', fontSize: 12 }}>
        <span>Hors-plan (spillover)</span>
        <span style={{ fontFamily: mono }}>{budget.spillover_pct.toFixed(1)}%</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write KpiStrip**

Create `app/demo/pilote/_components/KpiStrip.tsx` :

```tsx
'use client';
import { useState } from 'react';
import { demoAuthHeader } from '../_lib/authHeader';
import type { ReportKpis } from '@/lib/report/types';

const mono = 'JetBrains Mono, monospace';

export function KpiStrip({ kpis }: { kpis: ReportKpis }) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/demo/report/narrative', { method: 'POST', headers: demoAuthHeader() });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'narrative_failed');
      setNarrative(json.narrative as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'narrative_failed');
    } finally {
      setLoading(false);
    }
  }

  const items = [
    { label: 'Corrections', value: String(kpis.corrections) },
    { label: 'Écart v1 → final', value: `${kpis.delta_first.toFixed(1)} → ${kpis.delta_last.toFixed(1)} pts` },
    { label: 'Gain', value: `${kpis.improvement_pts.toFixed(1)} pts` },
    { label: 'Zones conformes', value: `${kpis.conforming_items_last}/${kpis.total_items}` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {items.map((k) => (
          <div key={k.label} style={{ flex: '1 1 120px', background: 'var(--card)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{k.label}</div>
            <div style={{ fontSize: 15, fontFamily: mono, color: 'var(--text-primary)' }}>{k.value}</div>
          </div>
        ))}
        {kpis.converged && (
          <div style={{ alignSelf: 'center', fontSize: 12, color: 'var(--brand-teal)', border: '0.5px solid var(--brand-teal)', borderRadius: 4, padding: '2px 8px' }}>convergé</div>
        )}
      </div>
      <div>
        <button onClick={generate} disabled={loading}
          style={{ background: 'transparent', border: '0.5px solid var(--brand-teal)', color: 'var(--brand-teal)', borderRadius: 6, padding: '8px 16px', fontSize: 12, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Génération…' : 'Synthèse IA'}
        </button>
        {error && <span style={{ marginLeft: 8, color: 'var(--danger)', fontSize: 12 }}>{error}</span>}
        {narrative && (
          <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', background: 'var(--card)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: '12px 14px' }}>{narrative}</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 7: Commit**

```bash
git add app/demo/pilote/_lib/authHeader.ts app/demo/pilote/_components/ConvergenceChart.tsx app/demo/pilote/_components/ZoneBeforeAfterTable.tsx app/demo/pilote/_components/BudgetCard.tsx app/demo/pilote/_components/KpiStrip.tsx
git commit -m "feat(bilan): util auth + composants dashboard (courbe, table, budget, KPI)"
```

---

### Task 5: BilanPanel + onglets (PiloteWorkspace) + intégration page

**Files:**
- Create: `app/demo/pilote/_components/BilanPanel.tsx`
- Create: `app/demo/pilote/_components/PiloteWorkspace.tsx`
- Modify: `app/demo/pilote/page.tsx`

**Interfaces:**
- Consumes : `demoAuthHeader` ; `CampaignReport` de `@/lib/report/types` ; `ConvergenceChart`, `ZoneBeforeAfterTable`, `BudgetCard`, `KpiStrip` (Task 4) ; `PilotChatPanel` (export nommé, inchangé).
- Produces : `BilanPanel` (export nommé), `PiloteWorkspace` (export default), page rendant `<PiloteWorkspace />`.

- [ ] **Step 1: Write BilanPanel**

Create `app/demo/pilote/_components/BilanPanel.tsx` :

```tsx
'use client';
import { useEffect, useState } from 'react';
import { demoAuthHeader } from '../_lib/authHeader';
import type { CampaignReport } from '@/lib/report/types';
import { ConvergenceChart } from './ConvergenceChart';
import { ZoneBeforeAfterTable } from './ZoneBeforeAfterTable';
import { BudgetCard } from './BudgetCard';
import { KpiStrip } from './KpiStrip';

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--elevated)', borderTop: '1px solid var(--border-subtle)', padding: '10px 14px' }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{title}</span>
    </div>
  );
}

const info = (msg: string, color = 'var(--text-tertiary)') =>
  <div style={{ padding: 24, color, fontSize: 13 }}>{msg}</div>;

export function BilanPanel() {
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch('/api/demo/report', { headers: demoAuthHeader() });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'report_failed');
        if (alive) setReport(json.report ?? null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'report_failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return info('Chargement du bilan…');
  if (error) return info(`Erreur : ${error}`, 'var(--danger)');
  if (!report) return info('Lance d’abord le pilotage dans l’onglet Pilotage.');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }}>
      <div style={{ padding: '16px 14px 0' }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)' }}>{report.header.campaign_name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {report.header.zone_name} · {report.header.dsp} · {report.header.period_start} → {report.header.period_end}
        </div>
      </div>
      <div style={{ padding: '0 14px' }}><KpiStrip kpis={report.kpis} /></div>
      <div>
        <SectionHeader title="Courbe de conformité" />
        <div style={{ padding: '12px 14px' }}><ConvergenceChart points={report.convergence} /></div>
      </div>
      <div>
        <SectionHeader title="Zone par zone — avant / après" />
        <div style={{ padding: '12px 14px' }}><ZoneBeforeAfterTable zones={report.zones} /></div>
      </div>
      <div>
        <SectionHeader title="Budget planifié vs dépensé" />
        <div style={{ padding: '12px 14px' }}><BudgetCard budget={report.budget} /></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write PiloteWorkspace**

Create `app/demo/pilote/_components/PiloteWorkspace.tsx`. PilotChatPanel reste monté (masqué en CSS) pour préserver l'état du chat ; BilanPanel est monté/démonté → re-fetch à chaque activation de l'onglet.

```tsx
'use client';
import { useState } from 'react';
import { PilotChatPanel } from './PilotChatPanel';
import { BilanPanel } from './BilanPanel';

type Tab = 'pilotage' | 'bilan';

export default function PiloteWorkspace() {
  const [tab, setTab] = useState<Tab>('pilotage');
  const tabStyle = (active: boolean) => ({
    padding: '10px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
    background: 'transparent', border: 'none',
    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
    borderBottom: active ? '2px solid var(--brand-teal)' : '2px solid transparent',
  } as const);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: '0.5px solid var(--border-subtle)', flexShrink: 0 }}>
        <button style={tabStyle(tab === 'pilotage')} onClick={() => setTab('pilotage')}>Pilotage</button>
        <button style={tabStyle(tab === 'bilan')} onClick={() => setTab('bilan')}>Bilan</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <div style={{ display: tab === 'pilotage' ? 'block' : 'none', height: '100%' }}>
          <PilotChatPanel />
        </div>
        {tab === 'bilan' && <BilanPanel />}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update page.tsx**

Replace `app/demo/pilote/page.tsx` :

```tsx
import PiloteWorkspace from './_components/PiloteWorkspace';

export const dynamic = 'force-dynamic';

export default function PilotePage() {
  return <PiloteWorkspace />;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 5: Commit**

```bash
git add app/demo/pilote/_components/BilanPanel.tsx app/demo/pilote/_components/PiloteWorkspace.tsx app/demo/pilote/page.tsx
git commit -m "feat(bilan): onglet Bilan (BilanPanel) + workspace onglets pilotage/bilan"
```

---

## Vérification finale (après les 5 tâches)

Vérification navigateur (Playwright authentifié, dev server localhost:3000) :
1. `/demo/pilote` → onglet Pilotage, lancer un pilotage autonome (« Lance le pilotage et fais converger »), attendre la convergence.
2. Basculer sur l'onglet Bilan → confirmer les 4 blocs : courbe décroissante avec ligne seuil, table zone avant/après (couleurs statut), budget plan vs dépensé, KPI corrects et cohérents avec les PacingCards du chat.
3. Cliquer « Synthèse IA » → un paragraphe factuel apparaît avec les vrais chiffres.
4. Console navigateur : 0 erreur ; `GET /api/demo/report` et `POST /api/demo/report/narrative` → 200.
5. Teardown de la DB démo (`POST /api/demo/teardown`) après vérification.
