# Suivi campagne (bilan + chat IA) & nettoyage cockpit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirer les phases Pilotage/Bilan du cockpit de création, et donner à l'onglet « Suivi campagne » de l'overlay MAGELIAN un bilan + un chat IA streaming qui interroge les données réelles de la campagne.

**Architecture:** Le cockpit (`CampaignCockpit`) redevient un pur wizard 5 étapes. Un nouveau composant client `CampaignSuivi` (bilan à gauche, chat à droite) est branché dans l'onglet Suivi de l'overlay, avec le sélecteur de campagne remonté au-dessus des tabs. Le chat appelle un nouveau endpoint `POST /api/digital/[campaignId]/campaign-chat` (pattern copié de `/api/bidding/strategies/[id]/chat` : contexte injecté dans le system prompt, `streamText` Gemini, `toTextStreamResponse()`), avec historique éphémère envoyé par le client. La logique testable (Zod + troncature + construction du prompt) vit dans `lib/campaigns/suivi-chat.ts`.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Vercel AI SDK (`streamText` + `createModel('gemini')`), Supabase RPC existantes, Zod, Vitest.

## Global Constraints

- Spec source : `docs/superpowers/specs/2026-07-07-suivi-campagne-chat-design.md`.
- Supabase Nano : jamais plus de 3 requêtes Supabase en parallèle ; uniquement des RPC/requêtes agrégées bornées ; AUCUN scan de `dsp_campaign_data` brut ; aucune nouvelle requête PostGIS.
- Couleurs : uniquement `var(--…)` (jamais de hex nu). Fonts : Inter + JetBrains Mono. Sentence case. Flat total.
- Pas d'exemple de marque dans les placeholders/suggestions — génériques descriptifs uniquement.
- Routes API : `export const dynamic = 'force-dynamic'`, validation Zod, `createAdminClient()` de `@/lib/auth`, `requireAuth` de `@/lib/api/middleware`.
- Fichiers protégés intouchables : `app/api/isochrone-battle/route.ts`, fonctions PostGIS battle, `middleware.ts`.
- Ne PAS toucher : `StrategyDetail`/`PilotageOverlay`, `FinalReport` (réutilisé tel quel), routes bidding existantes.
- Code complet, jamais de `// ... rest of the code`. Commits atomiques `type: description`.
- Branche de travail : `feat/magelian-overlay`.

---

### Task 1: Nettoyage cockpit — retrait Pilotage/Bilan

**Files:**
- Modify: `components/campaign/CampaignCockpit.tsx`
- Modify: `app/campaigns/[id]/_components/FilAriane.tsx`

**Interfaces:**
- Consumes: rien (premier task).
- Produces: `CampaignCockpit` sans vues `pilotage`/`bilan` (`CockpitView = 'overview' | 'prog'`) ; `FilAriane` avec props `phases?: FilArianeStep[]` et `unlockedPiloter?: boolean` optionnelles.

- [ ] **Step 1: FilAriane — rendre `phases` et `unlockedPiloter` optionnelles**

Dans `app/campaigns/[id]/_components/FilAriane.tsx`, remplacer l'interface et la signature :

```tsx
interface FilArianeProps {
  /** Étapes "programmer" de la campagne, dans l'ordre (Cible/Zones/Budget/Stratégie/Lancement). */
  steps: FilArianeStep[];
  /** Phases "piloter" optionnelles — plus utilisées par le cockpit, conservées pour compat. */
  phases?: FilArianeStep[];
  /** Clé de l'étape/phase actuellement sélectionnée. */
  activeKey: string;
  /** Index dans `steps` de l'étape la plus avancée déjà atteinte (pour le style done/active). */
  currentStepIndex: number;
  /** Si faux, les phases piloter s'affichent verrouillées (🔒) et ne sont pas cliquables. */
  unlockedPiloter?: boolean;
  onSelect: (key: string) => void;
}

export function FilAriane({ steps, phases = [], activeKey, currentStepIndex, unlockedPiloter = false, onSelect }: FilArianeProps) {
```

Puis, dans le JSX de retour, ne rendre le séparateur vertical et les nodes de phase que si `phases.length > 0` :

```tsx
          {programmerNodes.map((node, i) => (
            <StepNode key={node.key} node={node} showLine={i > 0} onSelect={onSelect} />
          ))}
          {phaseNodes.length > 0 && (
            <>
              <div
                aria-hidden
                style={{ width: 1, alignSelf: 'stretch', background: C.borderDefault, margin: '0 10px', position: 'relative', top: -2 }}
              />
              {phaseNodes.map((node) => (
                <StepNode key={node.key} node={node} showLine onSelect={onSelect} />
              ))}
            </>
          )}
```

- [ ] **Step 2: CampaignCockpit — retirer phases, vues pilotage/bilan et code mort**

Dans `components/campaign/CampaignCockpit.tsx` :

a) Supprimer les imports devenus inutiles (lignes 12-13) :

```tsx
import { StrategyDetail } from '@/components/map/overlays/PilotageOverlay';
import { FinalReport } from '@/app/custom-bidding/[strategyId]/_components/FinalReport';
```

b) Supprimer la constante `COCKPIT_PHASES` (lignes 42-45) et réduire le type de vue :

```tsx
type CockpitView = 'overview' | 'prog';
```

c) Supprimer entièrement le composant `CockpitLockedState` (lignes 248-264, commentaire inclus).

d) Supprimer la ligne `const unlockedPiloter = ...` (ligne 346) et simplifier le deep-link (remplacer le useEffect lignes 354-361) :

```tsx
  // Deep-link initial : ?view=prog (pilotage/bilan supprimés → repli silencieux
  // sur overview). Appliqué une seule fois, au montage.
  const viewParamAppliedRef = useRef(false);
  useEffect(() => {
    if (viewParamAppliedRef.current || !strategyLoaded) return;
    viewParamAppliedRef.current = true;
    if (searchParams.get('view') === 'prog') setView('prog');
  }, [strategyLoaded, searchParams]);
```

e) Remplacer `handleFilArianeSelect` (lignes 363-368) :

```tsx
  const handleFilArianeSelect = useCallback((key: string) => {
    if (COCKPIT_STEP_KEYS.has(key)) { setProgStep(key as ProgStepKey); setView('prog'); }
  }, []);
```

f) Remplacer l'appel `<FilAriane …>` (lignes 472-479) :

```tsx
        <FilAriane
          steps={COCKPIT_STEPS}
          activeKey={filArianeActiveKey}
          currentStepIndex={currentStepIndex}
          onSelect={handleFilArianeSelect}
        />
```

et simplifier `filArianeActiveKey` (ligne 348) :

```tsx
  const filArianeActiveKey = view === 'prog' ? progStep : '';
```

g) Dans le header overview, supprimer le bouton « Voir la stratégie » (le bloc `{strategyId ? (<button onClick={() => setView('pilotage')} …>Voir la stratégie</button>) : null}`, lignes 534-547).

h) `StepLancement` : remplacer `onCompleted={() => { fetchStrategy(); setView('pilotage'); }}` par :

```tsx
              onCompleted={() => { fetchStrategy(); setView('overview'); }}
```

i) Supprimer les deux blocs de rendu `{view === 'pilotage' && (…)}` et `{view === 'bilan' && (…)}` (lignes 688-714).

`strategyId`, `strategyStatus`, `strategyLoaded` et `fetchStrategy` RESTENT (préremplissage du wizard + `existingStrategyId`).

- [ ] **Step 3: Vérifier compilation et absence de références mortes**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `grep -n "pilotage\|bilan\|Pilotage\|Bilan\|unlockedPiloter\|CockpitLockedState\|StrategyDetail\|FinalReport" components/campaign/CampaignCockpit.tsx`
Expected: aucune occurrence (le commentaire de tête des COCKPIT_STEPS peut être reformulé si besoin : « Fil d'Ariane cockpit — étapes "programmer" »).

- [ ] **Step 4: Commit**

```bash
git add components/campaign/CampaignCockpit.tsx "app/campaigns/[id]/_components/FilAriane.tsx"
git commit -m "refactor: retire les phases Pilotage/Bilan du cockpit de création"
```

---

### Task 2: Lib testable `lib/campaigns/suivi-chat.ts` (TDD)

**Files:**
- Create: `lib/campaigns/suivi-chat.ts`
- Test: `tests/unit/campaigns/suivi-chat.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces (consommé par Task 3) :
  - `CampaignChatBodySchema` : Zod pour `{ message: string(1..2000), history?: Array<{ role: 'user'|'assistant', content: string(1..4000) }>(max 40) }`, `history` défaut `[]`.
  - `type ChatTurn = { role: 'user' | 'assistant'; content: string }`
  - `MAX_HISTORY_TURNS = 20` et `truncateHistory(history: ChatTurn[]): ChatTurn[]` (garde les N derniers).
  - `type StatRow = { label: string; tracked_ads: number; row_count: number }`
  - `type JournalLine = { at: string; kind: string; title: string; body: string }`
  - `type StrategyMeta = { name: string; status: string; algorithm_code: string; objective_code: string; execution_mode: string; total_budget: number | null; forecast_cpm: number | null; start_date: string | null; end_date: string | null }`
  - `buildSuiviChatSystemPrompt(input: SuiviChatPromptInput): string` avec
    `type SuiviChatPromptInput = { campaign: { name: string; dsp_source: string; date_start: string | null; date_end: string | null; total_tracked_ads: number; countries: string[] | null; status_override: string | null }; byCountry: StatRow[]; byRegion: StatRow[]; breakdownDept: Array<Record<string, unknown>>; strategy: StrategyMeta | null; journal: JournalLine[] }`.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `tests/unit/campaigns/suivi-chat.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  CampaignChatBodySchema, truncateHistory, buildSuiviChatSystemPrompt,
  MAX_HISTORY_TURNS, type ChatTurn,
} from '@/lib/campaigns/suivi-chat';

describe('CampaignChatBodySchema', () => {
  it('accepte un body valide et défaut history=[]', () => {
    const r = CampaignChatBodySchema.safeParse({ message: 'Quelles zones ont performé ?' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.history).toEqual([]);
  });
  it('rejette message vide ou > 2000 caractères', () => {
    expect(CampaignChatBodySchema.safeParse({ message: '' }).success).toBe(false);
    expect(CampaignChatBodySchema.safeParse({ message: 'x'.repeat(2001) }).success).toBe(false);
  });
  it('rejette un rôle inconnu dans history', () => {
    const r = CampaignChatBodySchema.safeParse({
      message: 'ok',
      history: [{ role: 'system', content: 'hack' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('truncateHistory', () => {
  it('garde uniquement les MAX_HISTORY_TURNS derniers tours', () => {
    const h: ChatTurn[] = Array.from({ length: 35 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const out = truncateHistory(h);
    expect(out).toHaveLength(MAX_HISTORY_TURNS);
    expect(out[out.length - 1].content).toBe('msg-34');
    expect(out[0].content).toBe(`msg-${35 - MAX_HISTORY_TURNS}`);
  });
  it('ne modifie pas un historique court', () => {
    const h: ChatTurn[] = [{ role: 'user', content: 'a' }];
    expect(truncateHistory(h)).toEqual(h);
  });
});

describe('buildSuiviChatSystemPrompt', () => {
  const base = {
    campaign: {
      name: 'Campagne test', dsp_source: 'adform', date_start: '2026-06-01', date_end: '2026-06-30',
      total_tracked_ads: 123456, countries: ['France'], status_override: null,
    },
    byCountry: [{ label: 'France', tracked_ads: 123456, row_count: 4000 }],
    byRegion: [{ label: 'Île-de-France', tracked_ads: 60000, row_count: 1500 }],
    breakdownDept: [{ nom: 'Paris', code: '75', metric: 50000 }],
    strategy: null,
    journal: [],
  };
  it('contient le nom de la campagne et les stats', () => {
    const p = buildSuiviChatSystemPrompt(base);
    expect(p).toContain('Campagne test');
    expect(p).toContain('Île-de-France');
    expect(p).toContain('Paris');
  });
  it('signale l’absence de stratégie', () => {
    expect(buildSuiviChatSystemPrompt(base)).toContain('Aucune stratégie de bidding');
  });
  it('inclut stratégie et journal quand présents', () => {
    const p = buildSuiviChatSystemPrompt({
      ...base,
      strategy: {
        name: 'Strat A', status: 'completed', algorithm_code: 'ml_v2', objective_code: 'impressions',
        execution_mode: 'auto', total_budget: 10000, forecast_cpm: 4.5,
        start_date: '2026-06-01', end_date: '2026-06-30',
      },
      journal: [{ at: '2026-06-15T10:00:00Z', kind: 'action', title: 'Ajustement de la courbe', body: 'Multiplicateurs relevés sur le 93' }],
    });
    expect(p).toContain('Strat A');
    expect(p).toContain('Ajustement de la courbe');
  });
  it('borne le breakdown à 30 lignes', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ nom: `Dept-${i}` }));
    const p = buildSuiviChatSystemPrompt({ ...base, breakdownDept: many });
    expect(p).toContain('Dept-29');
    expect(p).not.toContain('Dept-30');
  });
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `npx vitest run tests/unit/campaigns/suivi-chat.test.ts`
Expected: FAIL — `Cannot find module '@/lib/campaigns/suivi-chat'` (ou équivalent).

- [ ] **Step 3: Implémenter la lib**

Créer `lib/campaigns/suivi-chat.ts` :

```ts
/**
 * Suivi campagne — chat IA : validation du body, troncature d'historique,
 * construction du system prompt à partir de données agrégées bornées.
 * Logique pure (testable Vitest), aucune dépendance Supabase/réseau.
 */
import { z } from 'zod';

export const ChatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

export const CampaignChatBodySchema = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(ChatTurnSchema).max(40).optional().default([]),
});
export type CampaignChatBody = z.infer<typeof CampaignChatBodySchema>;

/** Nombre max de tours renvoyés au LLM — au-delà on tronque (les plus anciens sautent). */
export const MAX_HISTORY_TURNS = 20;

export function truncateHistory(history: ChatTurn[]): ChatTurn[] {
  return history.length > MAX_HISTORY_TURNS ? history.slice(-MAX_HISTORY_TURNS) : history;
}

export interface StatRow { label: string; tracked_ads: number; row_count: number }
export interface JournalLine { at: string; kind: string; title: string; body: string }
export interface StrategyMeta {
  name: string; status: string; algorithm_code: string; objective_code: string;
  execution_mode: string; total_budget: number | null; forecast_cpm: number | null;
  start_date: string | null; end_date: string | null;
}
export interface SuiviChatPromptInput {
  campaign: {
    name: string; dsp_source: string; date_start: string | null; date_end: string | null;
    total_tracked_ads: number; countries: string[] | null; status_override: string | null;
  };
  byCountry: StatRow[];
  byRegion: StatRow[];
  breakdownDept: Array<Record<string, unknown>>;
  strategy: StrategyMeta | null;
  journal: JournalLine[];
}

const MAX_COUNTRY_ROWS = 15;
const MAX_REGION_ROWS = 20;
const MAX_BREAKDOWN_ROWS = 30;
const MAX_JOURNAL_LINES = 50;

function fmtStatRows(rows: StatRow[], max: number): string {
  if (rows.length === 0) return '  (aucune donnée)';
  return rows.slice(0, max)
    .map((r) => `  ${r.label} : ${r.tracked_ads.toLocaleString('fr-FR')} tracked ads (${r.row_count.toLocaleString('fr-FR')} lignes)`)
    .join('\n');
}

export function buildSuiviChatSystemPrompt(input: SuiviChatPromptInput): string {
  const { campaign, byCountry, byRegion, breakdownDept, strategy, journal } = input;

  const strategyBlock = strategy
    ? `Stratégie de bidding rattachée :
- Nom : ${strategy.name} · Statut : ${strategy.status}
- Algorithme : ${strategy.algorithm_code} · Objectif : ${strategy.objective_code} · Mode : ${strategy.execution_mode}
- Budget : ${strategy.total_budget ?? '—'} € · CPM prévisionnel : ${strategy.forecast_cpm ?? '—'} €
- Période : ${strategy.start_date ?? '—'} → ${strategy.end_date ?? '—'}

Journal de pilotage (${Math.min(journal.length, MAX_JOURNAL_LINES)} dernières entrées) :
${journal.slice(-MAX_JOURNAL_LINES).map((e) => `  [${e.at.slice(0, 10)}] (${e.kind}) ${e.title} — ${e.body}`).join('\n') || '  (journal vide)'}`
    : 'Aucune stratégie de bidding rattachée à cette campagne (pas de journal de pilotage disponible).';

  return `Tu es un analyste média senior intégré au module « Suivi campagne » de MAGELIAN.
Tu réponds aux questions du media planner sur ce qu'il s'est passé pendant cette campagne DSP.

Règles :
- Réponds en français, ton factuel et concis.
- Cite les chiffres exacts depuis les données ci-dessous, ne les invente jamais.
- Si la donnée demandée est absente du contexte, dis clairement « je n'ai pas cette donnée ».
- Aucune action destructive proposée.

DONNÉES CAMPAGNE (seule source de vérité) :
- Nom : ${campaign.name}
- DSP source : ${campaign.dsp_source}
- Période : ${campaign.date_start ?? '—'} → ${campaign.date_end ?? '—'}
- Total tracked ads : ${campaign.total_tracked_ads.toLocaleString('fr-FR')}
- Pays : ${campaign.countries?.join(', ') ?? '—'}
- Statut forcé : ${campaign.status_override ?? 'aucun'}

Répartition par pays :
${fmtStatRows(byCountry, MAX_COUNTRY_ROWS)}

Répartition par région :
${fmtStatRows(byRegion, MAX_REGION_ROWS)}

Croisement départements × indicateur INSEE (top ${MAX_BREAKDOWN_ROWS}, JSON brut par ligne) :
${breakdownDept.slice(0, MAX_BREAKDOWN_ROWS).map((r) => `  ${JSON.stringify(r)}`).join('\n') || '  (aucune donnée)'}

${strategyBlock}`;
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run tests/unit/campaigns/suivi-chat.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/suivi-chat.ts tests/unit/campaigns/suivi-chat.test.ts
git commit -m "feat: lib suivi-chat (validation, troncature, system prompt) avec tests"
```

---

### Task 3: Endpoint `POST /api/digital/[campaignId]/campaign-chat`

**Files:**
- Create: `app/api/digital/[campaignId]/campaign-chat/route.ts`

**Interfaces:**
- Consumes (Task 2) : `CampaignChatBodySchema`, `truncateHistory`, `buildSuiviChatSystemPrompt`, `type StatRow`, `type JournalLine`, `type StrategyMeta`.
- Consumes (existant) : `requireAuth`/`authUnauthorized` (`@/lib/api/middleware`), `createAdminClient` (`@/lib/auth`), `createModel` (`@/lib/chat/providers`), `streamText` (`ai`).
- Produces (consommé par Task 4) : `POST /api/digital/{campaignId}/campaign-chat` body `{ message, history }` → stream texte brut (mêmes mécaniques de lecture que le chat stratégie) ; erreurs JSON `{ error }` en 400/401/404/500.

- [ ] **Step 1: Créer la route**

Créer `app/api/digital/[campaignId]/campaign-chat/route.ts` :

```ts
/**
 * POST /api/digital/[campaignId]/campaign-chat
 * Chat IA « Suivi campagne » : interroge ce qu'il s'est passé dans la campagne.
 * Historique ÉPHÉMÈRE (renvoyé par le client dans le body) — aucun stockage.
 * Contexte injecté dans le system prompt (pattern /api/bidding/strategies/[id]/chat) :
 * stats géo agrégées, journal de la stratégie si elle existe, croisement IRIS borné.
 * Budget I/O Nano : uniquement des RPC/agrégats bornés, max 3 requêtes en parallèle.
 */
import { NextRequest, NextResponse } from 'next/server';
import { streamText } from 'ai';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { createModel } from '@/lib/chat/providers';
import {
  CampaignChatBodySchema, truncateHistory, buildSuiviChatSystemPrompt,
  type StatRow, type JournalLine, type StrategyMeta,
} from '@/lib/campaigns/suivi-chat';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function toStatRows(rows: unknown, labelKeys: string[]): StatRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((raw) => {
    const r = raw as Record<string, unknown>;
    const label = labelKeys.map((k) => r[k]).find((v) => typeof v === 'string' && v.length > 0);
    return {
      label: (label as string | undefined) ?? '(vide)',
      tracked_ads: Number(r.tracked_ads ?? 0),
      row_count: Number(r.row_count ?? 0),
    };
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = CampaignChatBodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { message } = parsed.data;
  const history = truncateHistory(parsed.data.history);

  const supabase = createAdminClient();

  const { data: campaign } = await supabase
    .from('dsp_campaigns')
    .select('id, name, dsp_source, date_start, date_end, total_tracked_ads, countries, status_override')
    .eq('id', campaignId)
    .single();
  if (!campaign) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  // Stats géo agrégées (RPC existantes) — 2 appels en parallèle (< 3, contrainte Nano).
  const [countryRes, regionRes] = await Promise.all([
    supabase.rpc('get_campaign_stats_by_field', { p_campaign_id: campaignId, p_field: 'country' }).select('*'),
    supabase.rpc('get_campaign_stats_by_field', { p_campaign_id: campaignId, p_field: 'region' }).select('*'),
  ]);
  const byCountry = toStatRows(countryRes.data, ['country', 'field_value']);
  const byRegion = toStatRows(regionRes.data, ['region', 'field_value']);

  // Croisement IRIS : une seule RPC déjà bornée (30 départements max), pas de boucle cp-detail.
  const metricField = campaign.dsp_source === 'adform' ? 'tracked_ads' : 'impressions';
  const { data: breakdownRaw } = await supabase.rpc('get_digital_analysis_breakdown_v2', {
    p_campaign_id: campaignId,
    p_aggregation: 'dept',
    p_indicator: 'population',
    p_media: null,
    p_limit: 30,
    p_pop_min: 0,
    p_metric_field: metricField,
    p_parent_type: null,
    p_parent_code: null,
  });
  const breakdownDept = (
    typeof breakdownRaw === 'string' ? JSON.parse(breakdownRaw) : (breakdownRaw ?? [])
  ) as Array<Record<string, unknown>>;

  // Stratégie de bidding rattachée (facultative) + journal borné.
  const { data: strategyRow } = await supabase
    .from('bidding_strategies')
    .select('id, name, status, algorithm_code, objective_code, execution_mode, total_budget, forecast_cpm, start_date, end_date')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let strategy: StrategyMeta | null = null;
  const journal: JournalLine[] = [];
  if (strategyRow) {
    strategy = {
      name: strategyRow.name,
      status: strategyRow.status,
      algorithm_code: strategyRow.algorithm_code,
      objective_code: strategyRow.objective_code,
      execution_mode: strategyRow.execution_mode,
      total_budget: strategyRow.total_budget,
      forecast_cpm: strategyRow.forecast_cpm,
      start_date: strategyRow.start_date ? String(strategyRow.start_date).slice(0, 10) : null,
      end_date: strategyRow.end_date ? String(strategyRow.end_date).slice(0, 10) : null,
    };
    // 3 requêtes bornées en parallèle (= max Nano), mêmes tables que la route journal.
    const [actionsRes, driftsRes, recosRes] = await Promise.all([
      supabase.from('bidding_agent_actions')
        .select('intent, agent_response, applied_at, created_at')
        .eq('strategy_id', strategyRow.id)
        .order('created_at', { ascending: false })
        .limit(25),
      supabase.from('bidding_drift_events')
        .select('postal_code, drift_type, description, detected_at')
        .eq('strategy_id', strategyRow.id)
        .order('detected_at', { ascending: false })
        .limit(15),
      supabase.from('agent_recommendations')
        .select('title, body, generated_at')
        .eq('strategy_id', strategyRow.id)
        .order('generated_at', { ascending: false })
        .limit(10),
    ]);
    for (const a of (actionsRes.data ?? []) as Array<{ intent: string; agent_response: string | null; applied_at: string | null; created_at: string }>) {
      journal.push({ at: a.applied_at ?? a.created_at, kind: 'action', title: a.intent, body: a.agent_response ?? '' });
    }
    for (const d of (driftsRes.data ?? []) as Array<{ postal_code: string; drift_type: string; description: string; detected_at: string }>) {
      journal.push({ at: d.detected_at, kind: 'drift', title: `Drift ${d.drift_type} · CP ${d.postal_code}`, body: d.description });
    }
    for (const r of (recosRes.data ?? []) as Array<{ title: string; body: string; generated_at: string }>) {
      journal.push({ at: r.generated_at, kind: 'recommendation', title: r.title, body: r.body });
    }
    journal.sort((a, b) => a.at.localeCompare(b.at));
  }

  const systemPrompt = buildSuiviChatSystemPrompt({
    campaign: {
      name: campaign.name,
      dsp_source: campaign.dsp_source,
      date_start: campaign.date_start,
      date_end: campaign.date_end,
      total_tracked_ads: campaign.total_tracked_ads ?? 0,
      countries: campaign.countries,
      status_override: campaign.status_override,
    },
    byCountry,
    byRegion,
    breakdownDept,
    strategy,
    journal,
  });

  try {
    const result = streamText({
      model: createModel('gemini'),
      system: systemPrompt,
      messages: [...history, { role: 'user' as const, content: message }],
      temperature: 0.3,
    });
    return result.toTextStreamResponse();
  } catch (e) {
    console.error('[campaign-chat]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'llm_error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: exit 0. Si les colonnes de `bidding_strategies` remontent `any`/erreurs de type (client non typé), caster la ligne : `const s = strategyRow as { name: string; status: string; algorithm_code: string; objective_code: string; execution_mode: string; total_budget: number | null; forecast_cpm: number | null; start_date: string | null; end_date: string | null; id: string };` et construire `strategy` depuis `s`.

- [ ] **Step 3: Test manuel rapide (dev server requis)**

Run (dev server déjà lancé, session admin dans le navigateur — sinon reporter au Task 6) :

```bash
# Vérifie juste que la route existe et refuse un body invalide sans auth → 401 attendu
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/digital/00000000-0000-4000-8000-000000000000/campaign-chat -H "Content-Type: application/json" -d '{}'
```

Expected: `401` (pas de session) — confirme que la route est montée et protégée.

- [ ] **Step 4: Commit**

```bash
git add "app/api/digital/[campaignId]/campaign-chat/route.ts"
git commit -m "feat: endpoint campaign-chat (Gemini streaming, contexte campagne+stratégie+IRIS)"
```

---

### Task 4: Composant `components/campaign/CampaignSuivi.tsx`

**Files:**
- Create: `components/campaign/CampaignSuivi.tsx`

**Interfaces:**
- Consumes (Task 3) : `POST /api/digital/{campaignId}/campaign-chat` (stream texte).
- Consumes (existant) : `adminFetch` (`@/lib/admin-fetch`), `FinalReport` (`@/app/custom-bidding/[strategyId]/_components/FinalReport`, prop `strategyId: string`), `GET /api/admin/campaigns/{id}` (shape `CampaignDetail` de `@/types/campaign`), `GET /api/bidding/strategies` (shape `{ strategies: Array<{ id, campaign_id, status }> }`), `CampaignStatusBadge` + `effectiveCampaignStatus` (mêmes imports que le cockpit).
- Produces (consommé par Task 5) : `export function CampaignSuivi({ campaignId }: { campaignId: string })`.

- [ ] **Step 1: Créer le composant**

Créer `components/campaign/CampaignSuivi.tsx` :

```tsx
'use client';

/**
 * CampaignSuivi — onglet « Suivi campagne » de l'overlay MAGELIAN.
 * Gauche : bilan (FinalReport si stratégie terminée, sinon KPI + état d'attente).
 * Droite : chat IA streaming sur les données de la campagne (historique éphémère,
 * envoyé au serveur à chaque tour — rien n'est persisté).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { FinalReport } from '@/app/custom-bidding/[strategyId]/_components/FinalReport';
import { CampaignStatusBadge } from '@/components/campaigns/CampaignStatusBadge';
import { effectiveCampaignStatus } from '@/lib/campaigns/status';
import type { CampaignDetail } from '@/types/campaign';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Msg { role: 'user' | 'assistant'; content: string; pending?: boolean }

const SUGGESTIONS = [
  'Quelles zones ont le mieux performé ?',
  'Résume les décisions de pilotage',
  'Où le budget a-t-il été le plus efficace ?',
  'Quelles zones sous-performent par rapport à leur population ?',
];

function fmtNum(n: number) { return n.toLocaleString('fr-FR'); }
function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function CampaignSuivi({ campaignId }: { campaignId: string }) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [strategyStatus, setStrategyStatus] = useState<string | null>(null);
  const [strategyLoaded, setStrategyLoaded] = useState(false);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingDetail(true);
      try {
        const res = await adminFetch(`/api/admin/campaigns/${campaignId}?page=1`, { cache: 'no-store' });
        if (!cancelled && res.ok) setDetail(await res.json());
      } catch { /* ignore */ }
      if (!cancelled) setLoadingDetail(false);
    })();
    (async () => {
      try {
        const r = await adminFetch('/api/bidding/strategies', { cache: 'no-store' });
        const d = r.ok ? await r.json() : { strategies: [] };
        const match = (d.strategies ?? []).find(
          (s: { campaign_id: string; status?: string }) => s.campaign_id === campaignId,
        );
        if (!cancelled) {
          setStrategyId(match?.id ?? null);
          setStrategyStatus(match?.status ?? null);
        }
      } catch { /* ignore */ }
      if (!cancelled) setStrategyLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = useCallback(async (text?: string) => {
    const txt = (text ?? input).trim();
    if (!txt || sending) return;
    setSending(true);
    setChatError(null);
    setInput('');
    // Historique éphémère : les tours précédents partent dans le body.
    const priorHistory = messages
      .filter((m) => !m.pending && m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: txt }, { role: 'assistant', content: '', pending: true }]);
    try {
      const res = await adminFetch(`/api/digital/${campaignId}/campaign-chat`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: txt, history: priorHistory }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: acc, pending: false };
          return copy;
        });
      }
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e));
      setMessages((m) => m.filter((x) => !x.pending));
    } finally {
      setSending(false);
    }
  }, [campaignId, input, messages, sending]);

  const camp = detail?.campaign ?? null;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap' }}>
      {/* ── Colonne bilan ── */}
      <div style={{ flex: '1 1 380px', minWidth: 320 }}>
        <div style={{
          background: 'var(--bg-level-2)', borderTop: '1px solid var(--border-subtle)',
          padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
          <span style={{ fontFamily: fInter, fontWeight: 500, fontSize: 12, color: 'var(--text-primary)' }}>Bilan</span>
        </div>

        {loadingDetail || !strategyLoaded ? (
          <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)', padding: '24px 0' }}>Chargement…</div>
        ) : strategyId && strategyStatus === 'completed' ? (
          <FinalReport strategyId={strategyId} />
        ) : (
          <div style={{
            background: 'var(--bg-surface)', border: '0.5px solid var(--border-subtle)',
            borderRadius: 8, padding: '20px 18px',
          }}>
            {camp && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontFamily: fInter, fontWeight: 500, fontSize: 14, color: 'var(--text-primary)' }}>{camp.name}</span>
                  <CampaignStatusBadge status={effectiveCampaignStatus(camp, today)} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>Tracked ads</div>
                    <div style={{ fontFamily: fMono, fontSize: 16, color: 'var(--text-primary)' }}>{fmtNum(camp.total_tracked_ads)}</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>Période</div>
                    <div style={{ fontFamily: fMono, fontSize: 13, color: 'var(--text-secondary)', paddingTop: 3 }}>
                      {fmtDate(camp.date_start)} → {fmtDate(camp.date_end)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>Lignes</div>
                    <div style={{ fontFamily: fMono, fontSize: 16, color: 'var(--text-primary)' }}>{fmtNum(detail?.data.total ?? 0)}</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>Pays</div>
                    <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-secondary)', paddingTop: 3 }}>
                      {camp.countries?.join(', ') ?? '—'}
                    </div>
                  </div>
                </div>
              </>
            )}
            <div style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
              {strategyId
                ? 'Le bilan complet sera disponible à la fin de la campagne (stratégie encore en cours).'
                : 'Aucune stratégie de bidding rattachée — le bilan complet sera disponible pour les campagnes pilotées.'}
              {' '}En attendant, interroge la campagne via le chat ci-contre.
            </div>
          </div>
        )}
      </div>

      {/* ── Colonne chat ── */}
      <div style={{ flex: '1 1 380px', minWidth: 320, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          background: 'var(--bg-level-2)', borderTop: '1px solid var(--border-subtle)',
          padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
          <span style={{ fontFamily: fInter, fontWeight: 500, fontSize: 12, color: 'var(--text-primary)' }}>Interroger la campagne</span>
          <span style={{ marginLeft: 'auto', fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>gemini-2.5-flash</span>
        </div>

        <div
          ref={scrollRef}
          style={{
            flex: 1, minHeight: 260, maxHeight: 420, overflowY: 'auto', padding: 12,
            background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 8,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}
        >
          {messages.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
              <div style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 2 }}>
                Pose une question sur ce qu&apos;il s&apos;est passé dans cette campagne :
              </div>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { void send(s); }}
                  disabled={sending}
                  style={{
                    textAlign: 'left', background: 'var(--bg-surface)',
                    border: '0.5px solid var(--border-subtle)', borderRadius: 8,
                    padding: '10px 12px', fontFamily: fInter, fontSize: 12,
                    color: 'var(--text-secondary)', cursor: sending ? 'not-allowed' : 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--brand-teal-30)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '85%', padding: '8px 12px', borderRadius: 8,
                background: m.role === 'user' ? 'var(--brand-teal)' : 'var(--bg-surface)',
                color: m.role === 'user' ? 'var(--bg-primary)' : 'var(--text-primary)',
                border: m.role === 'user' ? 'none' : '0.5px solid var(--border-subtle)',
                fontFamily: fInter, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap',
              }}>
                {m.content || (m.pending ? '…' : '')}
              </div>
            </div>
          ))}
        </div>

        {chatError && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--danger)' }}>{chatError}</span>
            <button
              type="button"
              onClick={() => setChatError(null)}
              style={{
                background: 'transparent', border: '0.5px solid var(--border-default)', borderRadius: 4,
                padding: '2px 8px', fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)', cursor: 'pointer',
              }}
            >
              ok
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input
            type="text"
            name="campaign-suivi-message"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            disabled={sending}
            placeholder="Pose une question sur la campagne…"
            style={{
              flex: 1, padding: '8px 12px', fontFamily: fInter, fontSize: 13,
              background: 'var(--bg-level-2)', color: 'var(--text-primary)',
              border: '0.5px solid var(--border-subtle)', borderRadius: 6, outline: 'none',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-teal-50)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
          />
          <button
            type="button"
            onClick={() => { void send(); }}
            disabled={sending || !input.trim()}
            aria-label="Envoyer"
            style={{
              width: 36, height: 36, borderRadius: '50%', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: sending || !input.trim() ? 'var(--bg-level-2)' : 'var(--brand-teal)',
              color: sending || !input.trim() ? 'var(--text-tertiary)' : 'var(--bg-primary)',
              cursor: sending || !input.trim() ? 'not-allowed' : 'pointer', flexShrink: 0,
            }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: exit 0. Si `CampaignStatusBadge`/`effectiveCampaignStatus` ont des signatures différentes, copier EXACTEMENT l'usage du cockpit (`CampaignStatusBadge status={status}` avec `effectiveCampaignStatus(camp, today)`).

- [ ] **Step 3: Commit**

```bash
git add components/campaign/CampaignSuivi.tsx
git commit -m "feat: composant CampaignSuivi (bilan + chat IA streaming)"
```

---

### Task 5: Overlay — sélecteur partagé + branchement Suivi

**Files:**
- Modify: `components/magelian/MagelianOverlay.tsx`

**Interfaces:**
- Consumes (Task 4) : `CampaignSuivi` (`@/components/campaign/CampaignSuivi`).
- Produces: overlay avec sélecteur au-dessus des deux onglets.

- [ ] **Step 1: Ajouter l'import**

```tsx
import { CampaignSuivi } from '@/components/campaign/CampaignSuivi';
```

- [ ] **Step 2: Remonter le sélecteur entre la tab bar et le body**

Insérer ce bloc juste APRÈS la fermeture du `<div>` « Tab bar » et AVANT le `<div>` « Body scrollable » (c'est le bloc sélecteur actuellement dans l'onglet creation, déplacé tel quel avec un padding propre) :

```tsx
      {/* Sélecteur de campagne — partagé entre Création et Suivi */}
      <div style={{ padding: '12px 20px 0', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <label
          htmlFor="magelian-campaign-select"
          style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)' }}
        >
          Campagne
        </label>
        <select
          id="magelian-campaign-select"
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(e.target.value || null)}
          disabled={!campaigns || campaigns.length === 0}
          style={{
            background: 'var(--bg-level-2)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 6,
            padding: '8px 12px',
            fontFamily: fInter,
            fontSize: 13,
            color: 'var(--text-primary)',
            minWidth: 260,
          }}
        >
          {campaigns === null && <option value="">Chargement…</option>}
          {campaigns !== null && campaigns.length === 0 && <option value="">Aucune campagne</option>}
          {campaigns?.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
```

- [ ] **Step 3: Simplifier l'onglet creation et remplacer le placeholder suivi**

Le body devient :

```tsx
        {tab === 'creation' && (
          selectedId ? (
            <CampaignCockpit key={selectedId} campaignId={selectedId} embedded />
          ) : campaigns !== null ? (
            <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)', padding: '24px 0' }}>
              Aucune campagne disponible. Crée d&apos;abord une campagne depuis « Campagnes DSP ».
            </div>
          ) : null
        )}

        {tab === 'suivi' && (
          selectedId ? (
            <CampaignSuivi key={selectedId} campaignId={selectedId} />
          ) : campaigns !== null ? (
            <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)', padding: '24px 0' }}>
              Aucune campagne disponible. Crée d&apos;abord une campagne depuis « Campagnes DSP ».
            </div>
          ) : null
        )}
```

(L'ancien `<div>` sélecteur dans creation et tout le bloc placeholder « À venir » de suivi disparaissent. La constante `fMono` devient inutilisée dans ce fichier si plus référencée — la supprimer dans ce cas.)

- [ ] **Step 4: Vérifier compilation + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0 (une seule warning pré-existante tolérée, aucune nouvelle).

- [ ] **Step 5: Commit**

```bash
git add components/magelian/MagelianOverlay.tsx
git commit -m "feat: overlay MAGELIAN — sélecteur campagne partagé + onglet Suivi branché"
```

---

### Task 6: Vérification finale de bout en bout

**Files:**
- Aucun nouveau fichier (vérification + éventuels fixes).

**Interfaces:**
- Consumes: tout ce qui précède.

- [ ] **Step 1: Suite complète**

Run: `npx tsc --noEmit && npm test -- --run && npm run lint`
Expected: tsc exit 0 ; tous les tests Vitest PASS (dont `tests/unit/campaigns/suivi-chat.test.ts`) ; lint sans nouvelle erreur.

- [ ] **Step 2: Zéro hex nu dans les fichiers touchés**

Run: `grep -n "#[0-9a-fA-F]\{3,6\}" components/campaign/CampaignSuivi.tsx components/magelian/MagelianOverlay.tsx "app/api/digital/[campaignId]/campaign-chat/route.ts" lib/campaigns/suivi-chat.ts`
Expected: aucune occurrence.

- [ ] **Step 3: Vérification navigateur (dev server)**

Run: `npm run dev` (en arrière-plan si pas déjà lancé), puis avec le navigateur (Playwright MCP ou agent-browser), connecté avec les credentials dev locaux :

1. Ouvrir `http://localhost:3000/campaigns`, cliquer le bouton MAGELIAN de la sidebar.
2. Onglet « Création campagne » : le fil d'Ariane n'affiche QUE Cible/Zones/Budget/Stratégie/Lancement (plus de Pilotage/Bilan, plus de bouton « Voir la stratégie »).
3. Le sélecteur de campagne est au-dessus des tabs ; changer d'onglet conserve la campagne sélectionnée.
4. Onglet « Suivi campagne » : colonne bilan (KPI ou FinalReport) + colonne chat avec les 4 suggestions.
5. Cliquer une suggestion sur la campagne démo : la réponse streame progressivement, sans erreur console.
6. Poser une 2e question : la réponse tient compte du contexte (historique envoyé).
7. Vérifier sur `/map` que l'overlay s'ouvre toujours au-dessus de la carte.

Expected: tous les points OK, zéro erreur console.

- [ ] **Step 4: Build de production**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 5: Commit final (si fixes en Step 1-4)**

```bash
git add -A
git commit -m "fix: ajustements vérification suivi campagne"
```

(Sauter ce commit si rien n'a changé.)
