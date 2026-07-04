# Agent de pilotage (B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un agent IA (Gemini) qui pilote et raconte la boucle du moteur A, en modes guidé et autonome, en appelant les vrais outils.

**Architecture:** Route dédiée `/api/pilot` (réutilise `streamText` + `stopWhen` + Gemini, comme `/api/chat`) avec un system-prompt de pilotage et 4 outils qui importent `lib/demo/controller.ts` (refactoré : `seedDemo`/`applyRebid`/`readDemoPacing` extraits, routes `/api/demo/*` réécrites en enveloppes). UI dédiée `app/demo/pilote` (patron `ChatPanel` + carte pacing).

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Vercel AI SDK (`streamText`, `stepCountIs`, `useChat`), Gemini 2.5 flash, Zod, Vitest.

**Spec source :** `docs/superpowers/specs/2026-07-04-agent-pilotage-B-design.md`.

## Global Constraints

- **Réutiliser l'infra chat** : `streamText({ model, system, messages, stopWhen, tools })` + `result.toUIMessageStreamResponse(...)` (patron `app/api/chat/route.ts`) ; outils = objet `{ [nom]: { description, inputSchema: z.object(...), execute } }` ; rendu UI par `msg.parts` de `type === 'tool-<nom>'` + `state === 'output-available'`.
- **Ne pas toucher le copilote généraliste** (`/api/chat`, `lib/chat/tools/`) — l'agent de pilotage a son registre parallèle sous `lib/chat/pilot/`.
- **Les outils importent le moteur A directement** (`lib/demo/controller.ts` + `createAdminClient`), jamais de fetch interne.
- **Refactor = extraction pure** : le comportement du moteur A ne change pas (couvert par la boucle E2E, à rejouer).
- **Aucune couleur hex en dur** dans l'UI — tokens `var(--…)` (réutiliser `PACING_STATUS_META` de `@/lib/pacing/compute`). Sentence case. `'use client'` sur les composants.
- **Isolation** : `/api/pilot` en `requireAdmin` ; les fonctions du contrôleur gardent `assertDemo`/`is_demo` + scope constante `DEMO_CAMPAIGN_ID`.
- **Constantes tunables** (`lib/demo/constants.ts`) : `CONVERGENCE_TOLERANCE = 2`, `MAX_ROUNDS = 3`, `STEP_CAP_GUIDE = 2`, `STEP_CAP_AUTONOME = 12`.
- TypeScript strict, imports absolus `@/`, routes `export const dynamic = 'force-dynamic'`.
- Commits atomiques `type: description`, terminés par `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Refactor contrôleur — `seedDemo`/`applyRebid`/`readDemoPacing` + mapping pur

**Files:**
- Modify: `lib/demo/constants.ts` (ajout `CONVERGENCE_TOLERANCE`)
- Create: `lib/demo/pilot-types.ts` (types + mapping pur `toPilotPacing`)
- Test: `tests/unit/demo/pilot-pacing.test.ts`
- Modify: `lib/demo/controller.ts` (ajout `readDemoPacing`, `seedDemo`, `applyRebid`)
- Modify: `app/api/demo/seed/route.ts`, `app/api/demo/apply-rebid/route.ts` (enveloppes)

**Interfaces:**
- Produces:
  - `interface PilotItem { item_id; item_name; expected_share; actual_share; delta_pts; status: PacingStatus }`
  - `interface PilotPacing { version: number; mean_delta: number; converged: boolean; items: PilotItem[] }`
  - `interface PilotResult extends PilotPacing { delivery_rows: number }`
  - `toPilotPacing(version: number, items: PacingItem[], tol?: number): PilotPacing` (pur)
  - `readDemoPacing(supabase, version?): Promise<PilotPacing | null>`, `seedDemo(supabase, userId): Promise<PilotResult>`, `applyRebid(supabase, userId): Promise<PilotResult>`

- [ ] **Step 1: Ajouter la constante**

Dans `lib/demo/constants.ts`, ajouter (après les constantes existantes) :
```ts
/** Seuil d'écart moyen (points) sous lequel la boucle est considérée « conforme ». */
export const CONVERGENCE_TOLERANCE = 2;
```

- [ ] **Step 2: Écrire le test du mapping pur**

Créer `tests/unit/demo/pilot-pacing.test.ts` :
```ts
import { describe, it, expect } from 'vitest';
import { toPilotPacing } from '@/lib/demo/pilot-types';
import type { PacingItem } from '@/lib/pacing/compute';

const item = (over: Partial<PacingItem>): PacingItem => ({
  zone_id: 'z', zone_name: 'z', item_id: 'z:a', item_name: 'A', item_weight: 25,
  expected_share: 0.25, actual_imp: 0, actual_spend: 0, cp_count: 2,
  actual_share: 0.25, delta_pts: 0, status: 'conforme', ...over,
});

describe('toPilotPacing', () => {
  it('calcule mean_delta et converged, projette les items', () => {
    const out = toPilotPacing(2, [
      item({ item_id: 'z:a', delta_pts: -12, status: 'sous_servi', actual_share: 0.13 }),
      item({ item_id: 'z:b', delta_pts: 8, status: 'sur_servi', actual_share: 0.33 }),
    ], 2);
    expect(out.version).toBe(2);
    expect(out.mean_delta).toBeCloseTo(10, 5);      // (12+8)/2
    expect(out.converged).toBe(false);              // 10 >= 2
    expect(out.items[0]).toMatchObject({ item_id: 'z:a', status: 'sous_servi', delta_pts: -12 });
    expect(out.items[0]).not.toHaveProperty('actual_imp'); // projeté, pas le PacingItem brut
  });

  it('converged=true quand mean_delta < seuil', () => {
    const out = toPilotPacing(3, [item({ delta_pts: 1.4 }), item({ item_id: 'z:b', delta_pts: -0.8 })], 2);
    expect(out.converged).toBe(true);
  });

  it('items vides → mean_delta 0, converged true', () => {
    expect(toPilotPacing(1, [], 2)).toMatchObject({ mean_delta: 0, converged: true, items: [] });
  });
});
```

- [ ] **Step 3: Lancer (échec attendu)**

Run: `npx vitest run tests/unit/demo/pilot-pacing.test.ts`
Expected: FAIL (`Cannot find module '@/lib/demo/pilot-types'`).

- [ ] **Step 4: Écrire les types + le mapping pur**

Créer `lib/demo/pilot-types.ts` :
```ts
/** Types & projection du diagnostic de pilotage — logique pure (zéro I/O). */
import type { PacingItem, PacingStatus } from '@/lib/pacing/compute';
import { CONVERGENCE_TOLERANCE } from '@/lib/demo/constants';

export interface PilotItem {
  item_id: string;
  item_name: string;
  expected_share: number;
  actual_share: number;
  delta_pts: number;
  status: PacingStatus;
}

export interface PilotPacing {
  version: number;
  mean_delta: number;
  converged: boolean;
  items: PilotItem[];
}

export interface PilotResult extends PilotPacing {
  delivery_rows: number;
}

/** Projette le pacing calculé en diagnostic de pilotage (écart moyen + convergence). */
export function toPilotPacing(
  version: number,
  items: PacingItem[],
  tol: number = CONVERGENCE_TOLERANCE,
): PilotPacing {
  const mean_delta = items.length
    ? items.reduce((s, i) => s + Math.abs(i.delta_pts), 0) / items.length
    : 0;
  return {
    version,
    mean_delta: Math.round(mean_delta * 100) / 100,
    converged: mean_delta < tol,
    items: items.map((i) => ({
      item_id: i.item_id,
      item_name: i.item_name,
      expected_share: i.expected_share,
      actual_share: i.actual_share,
      delta_pts: Math.round(i.delta_pts * 10) / 10,
      status: i.status,
    })),
  };
}
```

- [ ] **Step 5: Lancer (succès)**

Run: `npx vitest run tests/unit/demo/pilot-pacing.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Ajouter `readDemoPacing`/`seedDemo`/`applyRebid` au contrôleur**

Dans `lib/demo/controller.ts`, ajouter les imports en tête :
```ts
import { computePacing, type PacingItemInput } from '@/lib/pacing/compute';
import { computeRebidWeights, type RebidItemInput } from '@/lib/pacing/rebid';
import { ensureDemoCampaign, ensureDemoPlan } from '@/lib/demo/fixtures';
import { toPilotPacing, type PilotPacing, type PilotResult } from '@/lib/demo/pilot-types';
```
Puis, en fin de fichier, ajouter :
```ts
/** Lit le diagnostic de pilotage de la campagne démo (dernière version si version omise). */
export async function readDemoPacing(
  supabase: SupabaseClient, version?: number | null,
): Promise<PilotPacing | null> {
  const { data } = await supabase.rpc('get_campaign_pacing', {
    p_campaign_id: DEMO_CAMPAIGN_ID, p_metric_field: 'impressions', p_version: version ?? null,
  });
  const rpc = (typeof data === 'string' ? JSON.parse(data) : data) as { version: number; items: PacingItemInput[] } | null;
  if (!rpc) return null;
  return toPilotPacing(rpc.version, computePacing(rpc.items ?? []));
}

/** Démarre la campagne fictive : fixtures → snapshot v1 → délivrance période 1 → diagnostic. */
export async function seedDemo(supabase: SupabaseClient, userId: string): Promise<PilotResult> {
  await ensureDemoCampaign(supabase);
  await assertDemo(supabase, DEMO_CAMPAIGN_ID);
  await purgeDemo(supabase);
  const { items } = await ensureDemoPlan(supabase, userId);
  await createPeriodSnapshot(supabase, userId, items, 1);
  const { rows } = await simulateCurrentPeriod(supabase);
  const pacing = await readDemoPacing(supabase, 1);
  if (!pacing) throw new Error('seed_no_pacing');
  return { ...pacing, delivery_rows: rows };
}

/** Applique le rebid : cible fixe reportée, enchère mise à jour, nouvelle période simulée → diagnostic. */
export async function applyRebid(supabase: SupabaseClient, userId: string): Promise<PilotResult> {
  await assertDemo(supabase, DEMO_CAMPAIGN_ID);
  const version = await latestVersion(supabase);
  if (version === 0) throw new Error('no_snapshot');
  const { data } = await supabase.rpc('get_campaign_pacing', {
    p_campaign_id: DEMO_CAMPAIGN_ID, p_metric_field: 'impressions', p_version: version,
  });
  const rpc = (typeof data === 'string' ? JSON.parse(data) : data) as { items: PacingItemInput[] } | null;
  if (!rpc?.items?.length) throw new Error('no_pacing');
  const pacing = computePacing(rpc.items);
  const rebid = computeRebidWeights(pacing.map<RebidItemInput>((p) => ({
    zone_id: p.zone_id, item_id: p.item_id, item_weight: p.item_weight,
    expected_share: p.expected_share, actual_share: p.actual_share,
  })));
  const items = rebid.map((r) => {
    const src = pacing.find((p) => p.item_id === r.item_id)!;
    return { item_id: r.item_id, item_name: src.item_name,
      target_share: src.expected_share, bid_weight: Math.round(r.new_weight * 10) / 10 };
  });
  const newVersion = await createPeriodSnapshot(supabase, userId, items, version + 1);
  const { rows } = await simulateCurrentPeriod(supabase);
  const next = await readDemoPacing(supabase, newVersion);
  if (!next) throw new Error('rebid_no_pacing');
  return { ...next, delivery_rows: rows };
}
```

- [ ] **Step 7: Réécrire les routes en enveloppes**

`app/api/demo/seed/route.ts` — remplacer le corps du `try` :
```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { seedDemo } from '@/lib/demo/controller';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    const res = await seedDemo(supabase, profile.id);
    return NextResponse.json({ ok: true, version: res.version, delivery_rows: res.delivery_rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'seed_failed' }, { status: 400 });
  }
}
```

`app/api/demo/apply-rebid/route.ts` — remplacer entièrement par :
```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { applyRebid } from '@/lib/demo/controller';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    const res = await applyRebid(supabase, profile.id);
    return NextResponse.json({ ok: true, version: res.version, delivery_rows: res.delivery_rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'rebid_failed' }, { status: 400 });
  }
}
```

- [ ] **Step 8: Type-check + commit**

Run: `npx tsc --noEmit` (attendu : 0 erreur). Run: `npx vitest run tests/unit/demo/` (attendu : pacing/rebid/simulator/rng/pilot-pacing verts).
```bash
git add lib/demo/constants.ts lib/demo/pilot-types.ts tests/unit/demo/pilot-pacing.test.ts lib/demo/controller.ts "app/api/demo/seed/route.ts" "app/api/demo/apply-rebid/route.ts"
git commit -m "refactor(demo): extraire seedDemo/applyRebid/readDemoPacing + mapping pilotage pur"
```

> **Note contrôle** : la boucle E2E du moteur A (seed → rebid → rebid via les routes) doit redonner 13.9→4.6→0.79 — à rejouer au contrôle final.

---

### Task 2: Outils de pilotage — `lib/chat/pilot/{tools,schemas}.ts`

**Files:**
- Create: `lib/chat/pilot/tools.ts`, `lib/chat/pilot/schemas.ts`

**Interfaces:**
- Consumes: `seedDemo`, `applyRebid`, `readDemoPacing`, `purgeDemo` (Task 1 / contrôleur), `createAdminClient`.
- Produces: `buildPilotTools(userId: string)` → objet `{ [nom]: { description, inputSchema, execute } }` pour `streamText`.

- [ ] **Step 1: Écrire les handlers d'outils**

Créer `lib/chat/pilot/tools.ts` :
```ts
/**
 * Handlers des outils de pilotage — importent le moteur A directement (server-side).
 * Chaque handler retourne un objet structuré (PilotResult/PilotPacing) ou { error }.
 */
import { createAdminClient } from '@/lib/auth';
import { seedDemo, applyRebid, readDemoPacing, purgeDemo, assertDemo } from '@/lib/demo/controller';
import { DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';

function wrap<T>(p: Promise<T>): Promise<T | { error: string }> {
  return p.catch((e) => ({ error: e instanceof Error ? e.message : 'pilot_tool_failed' }));
}

export async function demarrerPilotage(userId: string) {
  const supabase = createAdminClient();
  return wrap(seedDemo(supabase, userId));
}

export async function mesurer(userId: string, version?: number) {
  const supabase = createAdminClient();
  return wrap((async () => {
    const p = await readDemoPacing(supabase, version ?? null);
    if (!p) return { error: 'aucun_plan_figé' };
    return p;
  })());
}

export async function corrigerEnchere(userId: string) {
  const supabase = createAdminClient();
  return wrap(applyRebid(supabase, userId));
}

export async function reinitialiser(userId: string) {
  const supabase = createAdminClient();
  return wrap((async () => {
    await assertDemo(supabase, DEMO_CAMPAIGN_ID);
    await purgeDemo(supabase);
    return { ok: true };
  })());
}
```

- [ ] **Step 2: Écrire les schémas (binding SDK)**

Créer `lib/chat/pilot/schemas.ts` :
```ts
/** Schémas Zod des outils de pilotage — injectés dans streamText via /api/pilot. */
import { z } from 'zod';
import { demarrerPilotage, mesurer, corrigerEnchere, reinitialiser } from './tools';

export function buildPilotTools(userId: string) {
  return {
    demarrer_pilotage: {
      description: "Démarre (ou redémarre) la campagne fictive de pilotage : fige le plan v1 et simule la première période. Retourne le diagnostic initial (écart par item). À appeler en premier.",
      inputSchema: z.object({}),
      execute: () => demarrerPilotage(userId),
    },
    mesurer: {
      description: "Lit le diagnostic de pilotage (écart cible vs réel par item, sous/sur-servi, écart moyen, converged). Version optionnelle ; par défaut la dernière.",
      inputSchema: z.object({ version: z.number().optional().describe('Numéro de version (déf : dernière).') }),
      execute: (args: Record<string, unknown>) => mesurer(userId, typeof args.version === 'number' ? args.version : undefined),
    },
    corriger_enchere: {
      description: "Applique une correction d'enchère (rebid) : relève les items sous-servis, abaisse les sur-servis, resimule la période suivante. Retourne le nouveau diagnostic. À rappeler tant que non conforme.",
      inputSchema: z.object({}),
      execute: () => corrigerEnchere(userId),
    },
    reinitialiser: {
      description: "Efface toute la délivrance et les versions de la campagne fictive (retour à zéro). N'appeler que si l'utilisateur le demande.",
      inputSchema: z.object({}),
      execute: () => reinitialiser(userId),
    },
  };
}
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit` (attendu : 0 erreur).
```bash
git add lib/chat/pilot/tools.ts lib/chat/pilot/schemas.ts
git commit -m "feat(pilot): 4 outils de pilotage (démarrer/mesurer/corriger/réinitialiser) sur le moteur A"
```

---

### Task 3: System-prompt de pilotage — `lib/chat/pilot/system-prompt.ts`

**Files:**
- Modify: `lib/demo/constants.ts` (ajout `MAX_ROUNDS`, `STEP_CAP_GUIDE`, `STEP_CAP_AUTONOME`)
- Create: `lib/chat/pilot/system-prompt.ts`

**Interfaces:**
- Produces: `type PilotMode = 'guide' | 'autonome'`, `buildPilotSystemPrompt(mode: PilotMode): string`, `stepCapFor(mode: PilotMode): number`.

- [ ] **Step 1: Ajouter les constantes**

Dans `lib/demo/constants.ts`, ajouter :
```ts
export const MAX_ROUNDS = 3;
export const STEP_CAP_GUIDE = 2;
export const STEP_CAP_AUTONOME = 12;
```

- [ ] **Step 2: Écrire le system-prompt**

Créer `lib/chat/pilot/system-prompt.ts` :
```ts
import { MAX_ROUNDS, CONVERGENCE_TOLERANCE, STEP_CAP_GUIDE, STEP_CAP_AUTONOME } from '@/lib/demo/constants';

export type PilotMode = 'guide' | 'autonome';

export function stepCapFor(mode: PilotMode): number {
  return mode === 'autonome' ? STEP_CAP_AUTONOME : STEP_CAP_GUIDE;
}

const BASE = `Tu es le copilote de pilotage de campagne de Magelian. Tu pilotes une campagne digitale fictive (CIRFA Bretagne, 4 items : Brest, Rennes, Saint-Brieuc, Vannes) via une boucle : plan → mesure → correction → convergence.

Modèle : chaque item a une CIBLE fixe (part de délivrance voulue) et une ENCHÈRE ajustable. Le rebid déplace l'enchère pour rapprocher la délivrance réelle de la cible. Tu disposes des outils : demarrer_pilotage, mesurer, corriger_enchere, reinitialiser.

Chaque résultat d'outil te donne, par item : la part cible (expected_share), la part réelle (actual_share), l'écart delta_pts et le status (sous_servi/sur_servi/conforme). Plus mean_delta (écart moyen) et converged (vrai si mean_delta < ${CONVERGENCE_TOLERANCE} pts).

RÈGLES DE NARRATION : parle avec les chiffres, en français, concis. Nomme les items et leurs écarts (« Vannes sous-servi de 12 pts »). Explique ce que tu fais et pourquoi (« je relève l'enchère de Vannes »). Ne jamais inventer de chiffres — n'utilise que ceux des résultats d'outils.`;

const GUIDE = `\n\nMODE GUIDÉ : fais UNE seule action (un appel d'outil), puis ARRÊTE-TOI. Décris ce que tu observes et propose la prochaine étape, puis attends que l'utilisateur te dise de continuer.`;

const AUTONOME = `\n\nMODE AUTONOME : déroule la boucle toi-même. Si aucun plan n'existe encore, commence par demarrer_pilotage. Puis, tant que converged est faux ET que tu as fait moins de ${MAX_ROUNDS} corrections, appelle corriger_enchere, et commente le résultat à chaque tour (« écart tombé à X »). ARRÊTE-TOI dès que converged est vrai OU après ${MAX_ROUNDS} corrections, avec une synthèse finale. N'appelle JAMAIS reinitialiser sauf demande explicite.`;

export function buildPilotSystemPrompt(mode: PilotMode): string {
  return BASE + (mode === 'autonome' ? AUTONOME : GUIDE);
}
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit` (attendu : 0 erreur).
```bash
git add lib/demo/constants.ts lib/chat/pilot/system-prompt.ts
git commit -m "feat(pilot): system-prompt de pilotage (modes guidé/autonome, bornage MAX_ROUNDS)"
```

---

### Task 4: Route `/api/pilot`

**Files:**
- Create: `app/api/pilot/route.ts`

**Interfaces:**
- Consumes: `buildPilotTools` (Task 2), `buildPilotSystemPrompt`/`stepCapFor`/`PilotMode` (Task 3), `createModel` (`@/lib/chat/providers`).

- [ ] **Step 1: Écrire la route**

Créer `app/api/pilot/route.ts` :
```ts
import { NextRequest } from 'next/server';
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai';
import { requireAdmin } from '@/lib/api/middleware';
import { createModel } from '@/lib/chat/providers';
import { buildPilotTools } from '@/lib/chat/pilot/schemas';
import { buildPilotSystemPrompt, stepCapFor, type PilotMode } from '@/lib/chat/pilot/system-prompt';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const body = await request.json() as { messages: UIMessage[]; mode?: PilotMode };
    const mode: PilotMode = body.mode === 'autonome' ? 'autonome' : 'guide';
    const modelMessages = await convertToModelMessages(body.messages);

    const result = streamText({
      model: createModel('gemini'),
      system: buildPilotSystemPrompt(mode),
      messages: modelMessages,
      stopWhen: stepCountIs(stepCapFor(mode)),
      temperature: 0.1,
      maxRetries: 0,
      tools: buildPilotTools(profile.id),
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Erreur inconnue';
    console.error('[pilot]', msg.substring(0, 200));
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
```

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit` (attendu : 0 erreur).
```bash
git add "app/api/pilot/route.ts"
git commit -m "feat(pilot): route /api/pilot (streamText + stopWhen selon mode, Gemini)"
```

---

### Task 5: UI — page + `PilotChatPanel` + `PacingCard`

**Files:**
- Create: `app/demo/pilote/page.tsx`, `app/demo/pilote/_components/PilotChatPanel.tsx`, `app/demo/pilote/_components/PacingCard.tsx`

**Interfaces:**
- Consumes: `useChat` + `DefaultChatTransport` (`ai` / `@ai-sdk/react`), `PACING_STATUS_META` (`@/lib/pacing/compute`), type `PilotPacing` (`@/lib/demo/pilot-types`).

- [ ] **Step 1: `PacingCard`**

Créer `app/demo/pilote/_components/PacingCard.tsx` :
```tsx
'use client';
import { PACING_STATUS_META } from '@/lib/pacing/compute';
import type { PilotPacing } from '@/lib/demo/pilot-types';

const fInter = 'Inter, sans-serif';

export function PacingCard({ p }: { p: PilotPacing }) {
  return (
    <div style={{ background: 'var(--card)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: 12, fontFamily: fInter, marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
        <span>Version <strong style={{ color: 'var(--text-primary)' }}>v{p.version}</strong></span>
        <span>Écart moyen <strong style={{ color: 'var(--text-primary)' }}>{p.mean_delta.toFixed(1)}</strong> pts</span>
        {p.converged && <span style={{ color: 'var(--brand-teal)' }}>conforme</span>}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <tbody>
          {[...p.items].sort((a, b) => a.delta_pts - b.delta_pts).map((i) => {
            const meta = PACING_STATUS_META[i.status];
            return (
              <tr key={i.item_id} style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                <td style={{ padding: '4px 6px', color: 'var(--text-primary)' }}>{i.item_name}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{(i.expected_share * 100).toFixed(0)}%</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{(i.actual_share * 100).toFixed(0)}%</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: meta.colorVar }}>{i.delta_pts >= 0 ? '+' : ''}{i.delta_pts.toFixed(1)}</td>
                <td style={{ padding: '4px 6px', color: meta.colorVar }}>{meta.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: `PilotChatPanel`**

Créer `app/demo/pilote/_components/PilotChatPanel.tsx` :
```tsx
'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { createClient } from '@supabase/supabase-js';
import { PacingCard } from './PacingCard';
import type { PilotPacing } from '@/lib/demo/pilot-types';

const fInter = 'Inter, sans-serif';
let _sb: ReturnType<typeof createClient> | null = null;
function sb() { return _sb ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!); }
const PILOT_TOOLS = ['tool-demarrer_pilotage', 'tool-mesurer', 'tool-corriger_enchere'];

export function PilotChatPanel() {
  const [mode, setMode] = useState<'guide' | 'autonome'>('guide');
  const [input, setInput] = useState('');
  const modeRef = useMemo(() => ({ current: mode }), []);
  modeRef.current = mode;

  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/pilot',
    headers: async () => {
      const { data: { session } } = await sb().auth.getSession();
      return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
    },
    prepareSendMessagesRequest: ({ messages, body }) => ({ body: { ...body, messages, mode: modeRef.current } }),
  }), [modeRef]);

  const { messages, sendMessage, status } = useChat({ transport });
  const isLoading = status === 'submitted' || status === 'streaming';

  const submit = (e: FormEvent) => { e.preventDefault(); if (!input.trim() || isLoading) return; sendMessage({ text: input }); setInput(''); };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 16, fontFamily: fInter, color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['guide', 'autonome'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} style={{
            padding: '6px 12px', fontSize: 12, fontFamily: fInter, cursor: 'pointer', borderRadius: 6,
            background: 'transparent', border: `0.5px solid ${mode === m ? 'var(--brand-teal)' : 'var(--border-default)'}`,
            color: mode === m ? 'var(--brand-teal)' : 'var(--text-secondary)',
          }}>{m === 'guide' ? 'Guidé' : 'Autonome'}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {messages.map((msg) => {
          const text = msg.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('');
          const pacingParts = msg.role === 'assistant'
            ? (msg.parts as Array<{ type: string; state?: string; output?: unknown }>).filter((p) =>
                PILOT_TOOLS.includes(p.type) && p.state === 'output-available' && p.output && !(p.output as { error?: string }).error)
            : [];
          return (
            <div key={msg.id} style={{ fontSize: 13, color: msg.role === 'user' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {text && <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>}
              {pacingParts.map((p, i) => <PacingCard key={i} p={p.output as PilotPacing} />)}
            </div>
          );
        })}
        {isLoading && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Pilotage en cours…</div>}
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ex. « lance le pilotage »"
          style={{ flex: 1, background: 'var(--elevated)', border: '0.5px solid var(--border-subtle)', borderRadius: 6, padding: '8px 12px', fontFamily: fInter, fontSize: 13, color: 'var(--text-primary)' }} />
        <button type="submit" disabled={isLoading} style={{ background: 'var(--brand-teal)', color: '#050505', border: 'none', borderRadius: 6, padding: '8px 16px', fontFamily: fInter, fontSize: 13, cursor: 'pointer' }}>Envoyer</button>
      </form>
    </div>
  );
}
```
(`#050505` = texte foncé sur teal, constante design system — seule exception hex tolérée.)

- [ ] **Step 3: La page**

Créer `app/demo/pilote/page.tsx` :
```tsx
import { PilotChatPanel } from './_components/PilotChatPanel';

export const dynamic = 'force-dynamic';

export default function PilotePage() {
  return <PilotChatPanel />;
}
```

- [ ] **Step 4: Type-check + commit**

Run: `npx tsc --noEmit` (attendu : 0 erreur). Vérif navigateur (contrôle final) : `/demo/pilote`, guidé (une action/tour) puis autonome (boucle + arrêt à convergence), cartes pacing + narration, console sans erreur.
```bash
git add "app/demo/pilote"
git commit -m "feat(pilot): UI /demo/pilote (PilotChatPanel + PacingCard, modes guidé/autonome)"
```

---

## Notes transverses

- **Non-régression moteur A** : Task 1 est une extraction ; rejouer la boucle E2E (seed → rebid → rebid) doit redonner 13.9→4.6→0.79.
- **Auth** : `/api/pilot` en `requireAdmin` ; `profile.id` = `userId` passé aux outils (garde is_demo + expansion CIRFA org).
- **Cohérence des types** : `PilotPacing`/`PilotItem`/`PilotResult` de `lib/demo/pilot-types.ts` circulent contrôleur → outils → route → UI ; `status` = `PacingStatus` ; `PACING_STATUS_META` réutilisé pour les couleurs.
- **Reste** : brique C (bilan/report PDF).
```
