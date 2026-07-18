# Réconciliation DSP ⇔ ad server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relier le flux DSP (buy side, via API — simulé en démo) au flux ad server (déjà importé) et l'afficher dans le cockpit Suivi : taux de mesure, composition de l'achat par canal, et coût/taux par code postal sur la carte.

**Architecture:** Une table `campaign_dsp_report` (miroir buy side des rollups suivi) stockée à deux grains disjoints (date×canal pour le global/tendance, CP pour la carte). Le flux DSP entre par un module `lib/dsp/report` symétrique de `lib/dsp/push` (réel/skipped) ; la démo est générée en SQL set-based depuis les rollups ad server existants. Trois RPC de lecture, trois routes, un panneau dans le cockpit, la couche carte suivi étendue.

**Tech Stack:** Next.js 14 App Router · Supabase (PostgreSQL/PostGIS, Nano) · MapLibre GL · Vitest · Zod.

## Global Constraints

- Supabase Nano : la réconciliation ne lit que des rollups/agrégats — jamais de scan de `dsp_campaign_data` à l'ouverture. La génération démo lit `campaign_daily_rollup` (~30 lignes) et `campaign_cp_rollup` (~6 k lignes), pas les 185 k lignes brutes.
- Source DSP = API uniquement (règle api-first) — jamais d'import fichier. Le fichier/simulé n'est toléré que pour la démo.
- Migrations SQL via MCP Supabase (`apply_migration`) ET copie dans `sql/1xx_*.sql`.
- Design system : tokens `var(--…)` uniquement, sentence case, Inter + JetBrains Mono, flat.
- Auth : routes de lecture `requireAuth` + `checkCampaignAccess` (404 uniforme) ; route de pull `requireAdmin` (déclenche API externe + écriture).
- RPC : `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, GRANT `service_role` uniquement (REVOKE PUBLIC/anon/authenticated) — pattern des RPC suivi.
- Campagne démo : `dccc0000-0000-4000-8000-000000000002`. Ses canaux déclarés (`geo_strategy.channels`) : dsps [dv360, ttd] + socials [tiktok, meta], budgets { dv360 32000, ttd 5000, tiktok 15000 }.
- Convention impressions ad server (déjà dans les rollups 107) : `dsp_source='adform'` → tracked_ads, sinon COALESCE(NULLIF(impressions,0), tracked_ads, 0).
- Spec de référence : `docs/superpowers/specs/2026-07-18-reconciliation-dsp-adserver-design.md`.

---

### Task 1: Table `campaign_dsp_report` (SQL 110)

**Files:**
- Create: `sql/110_campaign_dsp_report.sql`
- Migration MCP : `campaign_dsp_report`

**Interfaces:**
- Produces: table `campaign_dsp_report` à **deux grains disjoints** :
  - grain **daily** (global/tendance/canal) : `date` NOT NULL, `channel` = code canal, `postal_code` = '' ;
  - grain **CP** (carte) : `date` NULL, `channel` = '', `postal_code` = code postal.
  Colonnes : impressions, clicks, spend, source ('api'|'simulated'|'skipped'), pulled_at. `format`/`creative_ref` nullable (plomberie future).
- Unicité : index sur (campaign_id, COALESCE(date,'1900-01-01'), channel, postal_code, COALESCE(format,''), COALESCE(creative_ref,'')).

- [ ] **Step 1: Appliquer la migration** via `mcp__claude_ai_Supabase__apply_migration` (name `campaign_dsp_report`) :

```sql
-- 110 — campaign_dsp_report : flux DSP (buy side) pour la réconciliation.
-- Deux grains disjoints dans une table (Nano : ~6,3 k lignes/campagne démo) :
--   • daily : date NOT NULL, channel=code, postal_code=''  → global/tendance/canal
--   • CP    : date NULL,     channel='',   postal_code=CP   → carte
-- format/creative_ref : plomberie nullable, activés quand l'ingestion ad
-- server conservera ces dimensions.
CREATE TABLE IF NOT EXISTS public.campaign_dsp_report (
  campaign_id  uuid NOT NULL REFERENCES public.dsp_campaigns(id) ON DELETE CASCADE,
  date         date,
  channel      text NOT NULL DEFAULT '',
  postal_code  text NOT NULL DEFAULT '',
  format       text,
  creative_ref text,
  impressions  bigint NOT NULL DEFAULT 0,
  clicks       bigint NOT NULL DEFAULT 0,
  spend        numeric NOT NULL DEFAULT 0,
  source       text NOT NULL DEFAULT 'api',
  pulled_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_dsp_report_unique
  ON public.campaign_dsp_report (
    campaign_id, (COALESCE(date, '1900-01-01'::date)), channel, postal_code,
    (COALESCE(format, '')), (COALESCE(creative_ref, '')));
CREATE INDEX IF NOT EXISTS idx_campaign_dsp_report_campaign
  ON public.campaign_dsp_report (campaign_id);
ALTER TABLE public.campaign_dsp_report ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Vérifier la table** :

```sql
SELECT count(*) AS rows FROM campaign_dsp_report;
```
Expected : `rows = 0`.

- [ ] **Step 3: Copier dans `sql/110_campaign_dsp_report.sql`** (en-tête `-- Appliquée le 2026-07-18 via MCP Supabase`) + commit :

```bash
git add sql/110_campaign_dsp_report.sql
git commit -m "feat(sql): campaign_dsp_report — flux DSP buy side pour la réconciliation (2 grains, Nano-safe)"
```

---

### Task 2: RPC réconciliation + générateur démo (SQL 111)

**Files:**
- Create: `sql/111_reconciliation_rpc.sql`
- Migration MCP : `reconciliation_rpc`

**Interfaces:**
- Consumes: `campaign_dsp_report` (Task 1), `campaign_daily_rollup`/`campaign_cp_rollup` (rollups suivi 107), `dsp_campaigns.geo_strategy.channels`, `ref_codes_postaux.geom_simplified`.
- Produces:
  - `simulate_dsp_report(p_campaign_id uuid) RETURNS jsonb` → `{ daily_rows, cp_rows, channels }` ; set-based depuis les rollups.
  - `get_campaign_reconciliation(p_campaign_id uuid) RETURNS jsonb` (payload panel).
  - `get_campaign_reconciliation_map(p_campaign_id uuid, p_metric text, p_bbox_xmin/ymin/xmax/ymax float8) RETURNS json` (features CP).

- [ ] **Step 1: Appliquer la migration** (name `reconciliation_rpc`). Trois fonctions.

`simulate_dsp_report` — répartit par part de budget, sur-déclaration ×1,03 (global) et jitter déterministe par CP (carte) :

```sql
CREATE OR REPLACE FUNCTION public.simulate_dsp_report(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_channels text[];
  v_budgets jsonb;
  v_total_budget numeric;
  v_daily int := 0; v_cp int := 0;
BEGIN
  SELECT ARRAY(
           SELECT jsonb_array_elements_text(COALESCE(geo_strategy->'channels'->'dsps','[]'::jsonb))
           UNION
           SELECT jsonb_array_elements_text(COALESCE(geo_strategy->'channels'->'socials','[]'::jsonb))),
         COALESCE(geo_strategy->'channels'->'budgets', '{}'::jsonb)
    INTO v_channels, v_budgets
  FROM dsp_campaigns WHERE id = p_campaign_id;

  IF v_channels IS NULL OR array_length(v_channels, 1) IS NULL THEN
    RETURN jsonb_build_object('error', 'no_channels');
  END IF;

  -- Part de budget par canal (fallback part égale si budget absent/0).
  SELECT GREATEST(SUM(COALESCE((v_budgets->>ch)::numeric, 0)), 0)
    INTO v_total_budget FROM unnest(v_channels) ch;

  DELETE FROM campaign_dsp_report WHERE campaign_id = p_campaign_id AND source = 'simulated';

  -- Grain daily : date × canal (depuis campaign_daily_rollup, ~30 lignes).
  WITH ch AS (
    SELECT c AS channel,
           CASE WHEN v_total_budget > 0
                THEN COALESCE((v_budgets->>c)::numeric, 0) / v_total_budget
                ELSE 1.0 / array_length(v_channels, 1) END AS share,
           CASE c WHEN 'dv360' THEN 6.1 WHEN 'ttd' THEN 6.4
                  WHEN 'tiktok' THEN 6.0 WHEN 'meta' THEN 6.6 ELSE 6.2 END AS cpm
    FROM unnest(v_channels) c
  )
  INSERT INTO campaign_dsp_report
    (campaign_id, date, channel, postal_code, impressions, clicks, spend, source, pulled_at)
  SELECT p_campaign_id, r.date, ch.channel, '',
         round(r.impressions * 1.03 * ch.share),
         round(r.clicks * 1.03 * ch.share),
         round(r.impressions * 1.03 * ch.share * ch.cpm / 1000.0, 2),
         'simulated', now()
  FROM campaign_daily_rollup r CROSS JOIN ch
  WHERE r.campaign_id = p_campaign_id;
  GET DIAGNOSTICS v_daily = ROW_COUNT;

  -- Grain CP : postal_code (depuis campaign_cp_rollup, ~6 k lignes).
  -- Sur-déclaration variable par CP (1,01–1,10) → taux de mesure 91–99 %.
  INSERT INTO campaign_dsp_report
    (campaign_id, date, channel, postal_code, impressions, clicks, spend, source, pulled_at)
  SELECT p_campaign_id, NULL, '', c.postal_code,
         round(c.impressions * f.factor),
         round(c.clicks * f.factor),
         round(c.spend * f.factor, 2),
         'simulated', now()
  FROM campaign_cp_rollup c
  CROSS JOIN LATERAL (
    SELECT 1.01 + (('x' || substr(md5(c.postal_code), 1, 4))::bit(16)::int % 10) / 100.0 AS factor
  ) f
  WHERE c.campaign_id = p_campaign_id;
  GET DIAGNOSTICS v_cp = ROW_COUNT;

  RETURN jsonb_build_object('daily_rows', v_daily, 'cp_rows', v_cp,
                            'channels', to_jsonb(v_channels));
END;
$$;
REVOKE ALL ON FUNCTION public.simulate_dsp_report(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_dsp_report(uuid) TO service_role;
```

`get_campaign_reconciliation` — global + par canal + tendance :

```sql
CREATE OR REPLACE FUNCTION public.get_campaign_reconciliation(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_source text;
  v_dsp_imps bigint; v_dsp_spend numeric;
  v_as_imps bigint; v_as_as_of date;
  v_global jsonb; v_by_channel jsonb; v_daily jsonb;
BEGIN
  SELECT source INTO v_source
  FROM campaign_dsp_report WHERE campaign_id = p_campaign_id LIMIT 1;
  IF v_source IS NULL THEN
    RETURN jsonb_build_object('has_dsp_report', false);
  END IF;

  -- DSP total (grain daily).
  SELECT COALESCE(SUM(impressions), 0), COALESCE(SUM(spend), 0)
    INTO v_dsp_imps, v_dsp_spend
  FROM campaign_dsp_report WHERE campaign_id = p_campaign_id AND date IS NOT NULL;

  -- Ad server total + as_of (rollup suivi).
  SELECT COALESCE(SUM(impressions), 0), MAX(date)
    INTO v_as_imps, v_as_as_of
  FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;

  v_global := jsonb_build_object(
    'dsp_impressions', v_dsp_imps,
    'adserver_impressions', v_as_imps,
    'measure_rate', CASE WHEN v_dsp_imps > 0 THEN round(v_as_imps::numeric / v_dsp_imps * 100, 1) END,
    'gap_pct', CASE WHEN v_dsp_imps > 0 THEN round((v_dsp_imps - v_as_imps)::numeric / v_dsp_imps * 100, 1) END,
    'dsp_spend', round(v_dsp_spend, 2),
    'dsp_cpm', CASE WHEN v_dsp_imps > 0 THEN round(v_dsp_spend / v_dsp_imps * 1000, 2) END);

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.impressions DESC), '[]'::jsonb) INTO v_by_channel
  FROM (
    SELECT channel, SUM(impressions) AS impressions, round(SUM(spend), 2) AS spend,
           CASE WHEN SUM(impressions) > 0 THEN round(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm,
           CASE WHEN v_dsp_imps > 0 THEN round(SUM(impressions)::numeric / v_dsp_imps * 100, 1) END AS share_pct
    FROM campaign_dsp_report WHERE campaign_id = p_campaign_id AND date IS NOT NULL
    GROUP BY channel
  ) t;

  -- Pré-agréger chaque côté par date AVANT de joindre (le rollup ad server est
  -- par date×media : joindre brut multiplierait les lignes en multi-média).
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.date), '[]'::jsonb) INTO v_daily
  FROM (
    SELECT a.date,
           a.imps AS adserver_impressions,
           COALESCE(dsp.imps, 0) AS dsp_impressions,
           round(COALESCE(dsp.spend, 0), 2) AS dsp_spend
    FROM (SELECT date, SUM(impressions) AS imps
          FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id GROUP BY date) a
    LEFT JOIN (SELECT date, SUM(impressions) AS imps, SUM(spend) AS spend
               FROM campaign_dsp_report WHERE campaign_id = p_campaign_id AND date IS NOT NULL
               GROUP BY date) dsp ON dsp.date = a.date
  ) t;

  RETURN jsonb_build_object(
    'has_dsp_report', true, 'source', v_source, 'as_of', v_as_as_of,
    'global', v_global, 'by_channel', v_by_channel, 'daily', v_daily);
END;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_reconciliation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_reconciliation(uuid) TO service_role;
```

`get_campaign_reconciliation_map` — par CP, metric measure|dspcpm :

```sql
CREATE OR REPLACE FUNCTION public.get_campaign_reconciliation_map(
  p_campaign_id uuid, p_metric text DEFAULT 'measure',
  p_bbox_xmin float8 DEFAULT -5.5, p_bbox_ymin float8 DEFAULT 41.2,
  p_bbox_xmax float8 DEFAULT 9.8, p_bbox_ymax float8 DEFAULT 51.2)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT dsp.postal_code AS code, rcp.nom_principal AS nom,
           CASE WHEN p_metric = 'dspcpm'
                THEN CASE WHEN dsp.impressions > 0 THEN round(dsp.spend / dsp.impressions * 1000, 2) END
                ELSE CASE WHEN dsp.impressions > 0 THEN round(cp.impressions::numeric / dsp.impressions * 100, 1) END
           END AS value,
           ST_AsGeoJSON(rcp.geom_simplified)::json AS geometry
    FROM campaign_dsp_report dsp
    JOIN campaign_cp_rollup cp
      ON cp.campaign_id = dsp.campaign_id AND cp.postal_code = dsp.postal_code
    JOIN ref_codes_postaux rcp ON rcp.code_postal = dsp.postal_code
    WHERE dsp.campaign_id = p_campaign_id AND dsp.date IS NULL AND dsp.postal_code <> ''
      AND rcp.geom_simplified && ST_MakeEnvelope(p_bbox_xmin, p_bbox_ymin, p_bbox_xmax, p_bbox_ymax, 4326)
  ) t;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_reconciliation_map(uuid, text, float8, float8, float8, float8) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_reconciliation_map(uuid, text, float8, float8, float8, float8) TO service_role;
```

- [ ] **Step 2: Backfill démo + vérifier** :

```sql
SELECT public.simulate_dsp_report('dccc0000-0000-4000-8000-000000000002');
SELECT jsonb_pretty(public.get_campaign_reconciliation('dccc0000-0000-4000-8000-000000000002') - 'daily');
SELECT json_array_length(public.get_campaign_reconciliation_map('dccc0000-0000-4000-8000-000000000002', 'measure', 2.0, 48.6, 2.6, 49.0));
```
Expected : simulate → `daily_rows=120` (30×4), `cp_rows=6186` ; reconciliation `global.measure_rate` ≈ 97 (proche 100/1.03), `by_channel` = 4 lignes triées, `dsp_impressions` ≈ 50,7 M (49,2 M × 1,03) ; map Paris > 0 features.

- [ ] **Step 3: Copier dans `sql/111_reconciliation_rpc.sql`** (en-tête + le SELECT simulate démo en commentaire documenté) + commit :

```bash
git add sql/111_reconciliation_rpc.sql
git commit -m "feat(sql): réconciliation DSP — simulate_dsp_report + get_campaign_reconciliation(_map)"
```

---

### Task 3: Helpers purs + types du payload (TDD)

**Files:**
- Create: `lib/campaigns/reconciliation-metrics.ts`
- Test: `tests/unit/campaigns/reconciliation-metrics.test.ts`

**Interfaces:**
- Produces: types TS miroir du payload Task 2 (`ReconciliationPayload`, `ReconChannelRow`, `ReconDaily`) ; helpers :
  - `measureRateTone(rate: number | null): 'ok' | 'warn' | 'bad'` — ok ≥ 95 ; warn 85–95 ; bad < 85 ; null → 'warn'.
  - réexporte `toneColor`, `fmtPct`, `fmtCpm`, `fmtInt` depuis `suivi-metrics` (DRY).

- [ ] **Step 1: Écrire le test qui échoue** :

```typescript
import { describe, it, expect } from 'vitest';
import { measureRateTone } from '@/lib/campaigns/reconciliation-metrics';

describe('measureRateTone', () => {
  it('≥95 ok · 90 warn · 80 bad · null warn', () => {
    expect(measureRateTone(97)).toBe('ok');
    expect(measureRateTone(95)).toBe('ok');
    expect(measureRateTone(90)).toBe('warn');
    expect(measureRateTone(80)).toBe('bad');
    expect(measureRateTone(null)).toBe('warn');
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run tests/unit/campaigns/reconciliation-metrics.test.ts` (module absent).
- [ ] **Step 3: Implémenter** `lib/campaigns/reconciliation-metrics.ts` :

```typescript
/**
 * Réconciliation DSP ⇔ ad server — types du payload de get_campaign_reconciliation
 * (sql/111) et ton du taux de mesure. Formats réutilisés de suivi-metrics (DRY).
 */
import type { SuiviTone } from './suivi-metrics';
export { toneColor, fmtPct, fmtCpm, fmtInt } from './suivi-metrics';
export type { SuiviTone } from './suivi-metrics';

export interface ReconChannelRow {
  channel: string;
  impressions: number;
  spend: number;
  cpm: number | null;
  share_pct: number | null;
}

export interface ReconDaily {
  date: string;
  dsp_impressions: number;
  adserver_impressions: number;
  dsp_spend: number;
}

export interface ReconciliationPayload {
  has_dsp_report: boolean;
  source?: 'api' | 'simulated' | 'skipped';
  as_of?: string;
  global?: {
    dsp_impressions: number;
    adserver_impressions: number;
    measure_rate: number | null;
    gap_pct: number | null;
    dsp_spend: number;
    dsp_cpm: number | null;
  };
  by_channel?: ReconChannelRow[];
  daily?: ReconDaily[];
}

export function measureRateTone(rate: number | null): SuiviTone {
  if (rate == null) return 'warn';
  if (rate >= 95) return 'ok';
  if (rate >= 85) return 'warn';
  return 'bad';
}
```

- [ ] **Step 4: PASS** puis **commit** :

```bash
git add lib/campaigns/reconciliation-metrics.ts tests/unit/campaigns/reconciliation-metrics.test.ts
git commit -m "feat: types + helper de ton du taux de mesure (réconciliation)"
```

---

### Task 4: Module `lib/dsp/report` + routes API

**Files:**
- Create: `lib/dsp/report/types.ts`
- Create: `lib/dsp/report/index.ts`
- Create: `lib/dsp/report/dv360.ts`
- Create: `app/api/digital/[campaignId]/reconcile/route.ts`
- Create: `app/api/digital/[campaignId]/reconcile/pull/route.ts`
- Create: `app/api/digital/[campaignId]/reconcile/map/route.ts`

**Interfaces:**
- Consumes: RPC Task 2 ; `requireAuth`/`authUnauthorized`, `requireAdmin`/`adminUnauthorized` (`@/lib/api/middleware`), `checkCampaignAccess` (`@/lib/campaigns/access`), `createAdminClient` (`@/lib/auth`).
- Produces (module report, miroir de `lib/dsp/push`) :
  - `DspReportContext`, `DspReportRow`, `DspReportResult`, `DspReporter` (types.ts) ;
  - `selectReporter(channel, hasConnection): DspReporter` + `runReport(ctx): Promise<DspReportResult>` (index.ts) ;
  - `dv360Reporter` (dv360.ts) — réel, renvoie `skipped` tant que Bid Manager non câblé.
- Produces (routes) :
  - `GET /reconcile` → payload `get_campaign_reconciliation` ;
  - `POST /reconcile/pull` (admin) → `{ results: [{channel,status,rows}] }` ;
  - `GET /reconcile/map?metric=measure|dspcpm&bbox=` → `{ metric, features }`.

- [ ] **Step 1: `lib/dsp/report/types.ts`** :

```typescript
/**
 * Reporters DSP (pull des rapports de délivrance/coût) — miroir de lib/dsp/push.
 * Un reporter par canal, même signature. La démo est générée en SQL
 * (simulate_dsp_report), pas ici : ce module porte le chemin API réel.
 */
export type ReportStatus = 'api' | 'skipped' | 'failed';

export interface DspReportRow {
  date: string | null;      // null = grain CP
  channel: string;
  postal_code: string;      // '' = grain daily
  impressions: number;
  clicks: number;
  spend: number;
}

export interface DspReportContext {
  channel: string;
  campaign: { id: string; name: string };
  hasConnection: boolean;
  dateStart: string | null;
  dateEnd: string | null;
}

export interface DspReportResult {
  channel: string;
  status: ReportStatus;
  rows: DspReportRow[];
  detail: string;
}

export interface DspReporter {
  channel: string;
  report(ctx: DspReportContext): Promise<DspReportResult>;
}
```

- [ ] **Step 2: `lib/dsp/report/dv360.ts`** (réel, skipped tant que droits Google bloqués) :

```typescript
/**
 * Reporter DV360 (Bid Manager reporting API). Structure posée ; renvoie
 * `skipped` tant que les droits Google ne sont pas débloqués — exactement
 * comme le push. Point d'ancrage de l'appel réel : voir TODO ci-dessous.
 */
import type { DspReporter, DspReportResult } from './types';

export const dv360Reporter: DspReporter = {
  channel: 'dv360',
  async report(): Promise<DspReportResult> {
    // TODO: brancher DV360 Bid Manager reporting API quand les droits Google
    // sont débloqués (créer un query, récupérer le rapport CSV, mapper en
    // DspReportRow date×channel×CP). Jusque-là : skipped honnête.
    return {
      channel: 'dv360',
      status: 'skipped',
      rows: [],
      detail: 'Reporting DV360 — droits Google en attente (push manuel via export en attendant)',
    };
  },
};
```

- [ ] **Step 3: `lib/dsp/report/index.ts`** :

```typescript
/**
 * Sélection du reporter par canal + exécution avec catch → failed.
 *   connexion + connecteur → réel (api/skipped selon le connecteur)
 *   sinon                  → skipped (connecte un DSP pour réconcilier)
 * La démo NE passe PAS ici : elle est générée en SQL (simulate_dsp_report).
 */
import { dv360Reporter } from './dv360';
import type { DspReportContext, DspReportResult, DspReporter } from './types';

const REAL_REPORTERS: Record<string, DspReporter> = { dv360: dv360Reporter };

function skippedReporter(channel: string, detail: string): DspReporter {
  return { channel, async report() { return { channel, status: 'skipped', rows: [], detail }; } };
}

export function selectReporter(channel: string, hasConnection: boolean): DspReporter {
  if (!hasConnection) return skippedReporter(channel, 'Canal non connecté — connecte un DSP pour réconcilier');
  return REAL_REPORTERS[channel] ?? skippedReporter(channel, `Reporter ${channel} non implémenté`);
}

export async function runReport(ctx: DspReportContext): Promise<DspReportResult> {
  const reporter = selectReporter(ctx.channel, ctx.hasConnection);
  try {
    return await reporter.report(ctx);
  } catch (e) {
    return {
      channel: ctx.channel, status: 'failed', rows: [],
      detail: e instanceof Error ? e.message.slice(0, 300) : 'Erreur inconnue',
    };
  }
}

export type { DspReportContext, DspReportResult, DspReportRow, DspReporter } from './types';
```

- [ ] **Step 4: `app/api/digital/[campaignId]/reconcile/route.ts`** :

```typescript
/**
 * GET /api/digital/[campaignId]/reconcile — payload de réconciliation
 * DSP ⇔ ad server (RPC get_campaign_reconciliation, lecture des agrégats).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const { data, error } = await supabase.rpc('get_campaign_reconciliation', { p_campaign_id: campaignId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
```

- [ ] **Step 5: `app/api/digital/[campaignId]/reconcile/pull/route.ts`** (admin) :

```typescript
/**
 * POST /api/digital/[campaignId]/reconcile/pull — (re)construit le rapport DSP.
 * Démo → RPC set-based simulate_dsp_report. Sinon → runReport par canal
 * déclaré connecté, DELETE ciblé (source api/skipped) + insert idempotent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { runReport } from '@/lib/dsp/report';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const { campaignId } = await params;

  const supabase = createAdminClient();
  const { data: camp } = await supabase
    .from('dsp_campaigns')
    .select('id, name, is_demo, organization_id, geo_strategy, date_start, date_end')
    .eq('id', campaignId).maybeSingle();
  if (!camp) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  if (profile.role !== 'super_admin' && camp.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Démo : génération SQL set-based (pas de connecteur, pas de fichier).
  if (camp.is_demo) {
    const { data, error } = await supabase.rpc('simulate_dsp_report', { p_campaign_id: campaignId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ results: [{ channel: 'all', status: 'simulated', rows: (data?.daily_rows ?? 0) + (data?.cp_rows ?? 0) }] });
  }

  // Prod : reporters par canal déclaré. Connexions de l'org.
  const channels: string[] = [
    ...((camp.geo_strategy?.channels?.dsps as string[] | undefined) ?? []),
    ...((camp.geo_strategy?.channels?.socials as string[] | undefined) ?? []),
  ];
  const { data: conns } = await supabase
    .from('dsp_connections').select('provider').eq('organization_id', camp.organization_id);
  const connected = new Set((conns ?? []).map((c) => c.provider));

  const results = [];
  for (const channel of channels) {
    const res = await runReport({
      channel, campaign: { id: camp.id, name: camp.name },
      hasConnection: connected.has(channel),
      dateStart: camp.date_start, dateEnd: camp.date_end,
    });
    if (res.status === 'api' && res.rows.length > 0) {
      await supabase.from('campaign_dsp_report')
        .delete().eq('campaign_id', campaignId).eq('channel', channel).eq('source', 'api');
      await supabase.from('campaign_dsp_report').insert(
        res.rows.map((r) => ({
          campaign_id: campaignId, date: r.date, channel: r.channel, postal_code: r.postal_code,
          impressions: r.impressions, clicks: r.clicks, spend: r.spend, source: 'api',
        })),
      );
    }
    results.push({ channel: res.channel, status: res.status, rows: res.rows.length });
  }
  return NextResponse.json({ results });
}
```

- [ ] **Step 6: `app/api/digital/[campaignId]/reconcile/map/route.ts`** :

```typescript
/**
 * GET /api/digital/[campaignId]/reconcile/map?metric=measure|dspcpm&bbox=…
 * — features CP pour la choroplèthe de réconciliation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

const METRO_BBOX = [-5.5, 41.2, 9.8, 51.2] as const;
const QuerySchema = z.object({
  metric: z.enum(['measure', 'dspcpm']).default('measure'),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  const sp = request.nextUrl.searchParams;
  const bboxRaw = (sp.get('bbox') ?? METRO_BBOX.join(',')).split(',').map(Number);
  const parsed = QuerySchema.safeParse({ metric: sp.get('metric') ?? 'measure', bbox: bboxRaw });
  if (!parsed.success || parsed.data.bbox.some((v) => !Number.isFinite(v))) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }
  const { metric, bbox } = parsed.data;

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const { data, error } = await supabase.rpc('get_campaign_reconciliation_map', {
    p_campaign_id: campaignId, p_metric: metric,
    p_bbox_xmin: bbox[0], p_bbox_ymin: bbox[1], p_bbox_xmax: bbox[2], p_bbox_ymax: bbox[3],
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ metric, features: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}
```

- [ ] **Step 7: Vérif manuelle** (dev server, session admin dans le navigateur — récupérer le token du cookie `sb-*-auth-token` comme au chantier suivi) :

```js
// dans la console de la page /map connectée
const base = '/api/digital/dccc0000-0000-4000-8000-000000000002/reconcile';
await fetch(base + '/pull', { method: 'POST', headers: H }).then(r => r.json());   // { results: [{channel:'all',status:'simulated',...}] }
await fetch(base, { headers: H }).then(r => r.json());                              // has_dsp_report:true, global.measure_rate ~97
await fetch(base + '/map?metric=measure', { headers: H }).then(r => r.json());      // features > 0
```
Une campagne d'une autre org → 404 sur `/reconcile`.

- [ ] **Step 8: `npx tsc --noEmit` + commit** :

```bash
git add lib/dsp/report "app/api/digital/[campaignId]/reconcile"
git commit -m "feat: module lib/dsp/report (miroir push) + routes réconciliation (payload, pull, carte)"
```

---

### Task 5: ReconciliationPanel + intégration cockpit Suivi

**Files:**
- Create: `components/campaign/suivi/ReconciliationPanel.tsx`
- Modify: `components/campaign/CampaignSuivi.tsx`

**Interfaces:**
- Consumes: `GET /reconcile` (fetch dédié dans CampaignSuivi, `useRef` anti-refetch) ; `POST /reconcile/pull` (bouton admin) ; helpers Task 3.
- Produces: `<ReconciliationPanel payload onPull={...} pulling onShowMap? />` — bandeau section, tuile taux de mesure, tableau par canal (+ ligne mesuré ad server / écart), bouton actualiser, bouton « Voir sur la carte » (si `onShowMap`).

- [ ] **Step 1: Créer `ReconciliationPanel.tsx`** (affichage pur) :

```tsx
'use client';

/**
 * ReconciliationPanel — section « Réconciliation DSP ⇔ mesure » du cockpit
 * Suivi (spec 2026-07-18). Tuile taux de mesure + composition de l'achat par
 * canal + écart vs ad server. Données de get_campaign_reconciliation ; les
 * canaux/format/création restent DSP-only tant que l'ad server ne les porte pas.
 */
import {
  fmtCpm, fmtInt, fmtPct, measureRateTone, toneColor,
  type ReconciliationPayload,
} from '@/lib/campaigns/reconciliation-metrics';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const cellStyle = { padding: '7px 10px', fontFamily: fMono, fontSize: 11.5, color: 'var(--text-secondary)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
const headStyle = { padding: '7px 10px', fontFamily: fInter, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--text-tertiary)', textAlign: 'right' as const };

export function ReconciliationPanel({
  payload, onPull, pulling, canPull, onShowMap,
}: {
  payload: ReconciliationPayload | null;
  onPull: () => void;
  pulling: boolean;
  canPull: boolean;
  onShowMap?: (metric: 'measure' | 'dspcpm') => void;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 8px' }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>
          Réconciliation DSP ⇔ mesure
        </span>
        {canPull && (
          <button type="button" onClick={onPull} disabled={pulling}
            style={{ background: 'transparent', border: '0.5px solid var(--border-default)', color: 'var(--text-secondary)', borderRadius: 6, padding: '5px 12px', fontFamily: fInter, fontSize: 11, cursor: pulling ? 'wait' : 'pointer' }}>
            {pulling ? 'Actualisation…' : 'Actualiser depuis les DSP'}
          </button>
        )}
      </div>

      {!payload || !payload.has_dsp_report ? (
        <div style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: '12px 14px' }}>
          Aucun rapport DSP encore. {canPull ? 'Actualise depuis les DSP connectés pour réconcilier livré vs mesuré.' : 'Un rapport DSP est nécessaire pour réconcilier.'}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10, alignItems: 'stretch' }}>
            <div style={{ flex: '1 1 180px', minWidth: 160, border: '0.5px solid var(--border-subtle)', borderLeft: `2px solid ${toneColor(measureRateTone(payload.global?.measure_rate ?? null))}`, borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontFamily: fInter, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>Taux de mesure</div>
              <div style={{ fontFamily: fMono, fontSize: 15, color: 'var(--text-primary)', margin: '4px 0 2px' }}>{fmtPct(payload.global?.measure_rate ?? null)}</div>
              <div style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)' }}>
                {fmtInt(payload.global?.adserver_impressions ?? null)} mesuré / {fmtInt(payload.global?.dsp_impressions ?? null)} livré{payload.source === 'simulated' ? ' · simulé' : ''}
              </div>
            </div>
            {onShowMap && (
              <button type="button" onClick={() => onShowMap('measure')}
                style={{ alignSelf: 'flex-start', background: 'transparent', border: '0.5px solid var(--brand-teal)', color: 'var(--brand-teal)', borderRadius: 6, padding: '6px 12px', fontFamily: fInter, fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
                Voir sur la carte
              </button>
            )}
          </div>

          <div style={{ overflowX: 'auto', border: '0.5px solid var(--border-subtle)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <th style={{ ...headStyle, textAlign: 'left' }}>Canal</th>
                  <th style={headStyle}>Livré (DSP)</th>
                  <th style={headStyle}>Dépense</th>
                  <th style={headStyle}>CPM DSP</th>
                  <th style={headStyle}>Part</th>
                </tr>
              </thead>
              <tbody>
                {(payload.by_channel ?? []).map((c) => (
                  <tr key={c.channel} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ ...cellStyle, textAlign: 'left', color: 'var(--text-primary)' }}>{c.channel}</td>
                    <td style={cellStyle}>{fmtInt(c.impressions)}</td>
                    <td style={cellStyle}>{fmtInt(c.spend)} €</td>
                    <td style={cellStyle}>{fmtCpm(c.cpm)}</td>
                    <td style={cellStyle}>{fmtPct(c.share_pct)}</td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--bg-level-2)' }}>
                  <td style={{ ...cellStyle, textAlign: 'left', fontFamily: fInter, fontSize: 12, color: 'var(--text-primary)' }}>Mesuré ad server</td>
                  <td style={cellStyle}>{fmtInt(payload.global?.adserver_impressions ?? null)}</td>
                  <td style={cellStyle}>—</td>
                  <td style={cellStyle}>—</td>
                  <td style={cellStyle}>écart {fmtPct(payload.global?.gap_pct ?? null)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Brancher dans `CampaignSuivi.tsx`** — ajouter le fetch + le rendu sous `<SuiviCockpit>` (avant `<SuiviCharts>`). Après le bloc d'état `suivi`, ajouter :

```tsx
// (imports en tête du fichier)
import { ReconciliationPanel } from './suivi/ReconciliationPanel';
import type { ReconciliationPayload } from '@/lib/campaigns/reconciliation-metrics';
```
État + fetch (à côté du fetch `suivi` existant) :

```tsx
const [recon, setRecon] = useState<ReconciliationPayload | null>(null);
const [pulling, setPulling] = useState(false);
const reconFetchedRef = useRef<string | null>(null);

const loadRecon = useCallback(async () => {
  try {
    const res = await adminFetch(`/api/digital/${campaignId}/reconcile`, { cache: 'no-store' });
    if (res.ok) setRecon((await res.json()) as ReconciliationPayload);
  } catch { /* panel affiche l'état vide */ }
}, [campaignId]);

useEffect(() => {
  if (!strategyId || strategyStatus === 'completed') return;
  if (reconFetchedRef.current === campaignId) return;
  reconFetchedRef.current = campaignId;
  void loadRecon();
}, [campaignId, strategyId, strategyStatus, loadRecon]);

const handlePull = useCallback(async () => {
  if (pulling) return;
  setPulling(true);
  try {
    await adminFetch(`/api/digital/${campaignId}/reconcile/pull`, { method: 'POST' });
    await loadRecon();
  } finally { setPulling(false); }
}, [campaignId, pulling, loadRecon]);
```
Rendu (dans la branche `strategyId && suivi`, sous `<SuiviCockpit>`, avant `<SuiviCharts>`) :

```tsx
<ReconciliationPanel
  payload={recon}
  onPull={() => { void handlePull(); }}
  pulling={pulling}
  canPull={!!mapAvailable}
  onShowMap={mapAvailable ? (metric) => {
    window.dispatchEvent(new CustomEvent('magelian:suivi-map', {
      detail: { campaignId, source: 'reconcile', metric, forecastCpm: suivi.cpm.forecast },
    }));
    onShowedMap?.();
  } : undefined}
/>
```
(`canPull` = `mapAvailable` : le pull n'est proposé que sur `/map`, contexte admin ; le scope réel est garanti par `requireAdmin` côté route.)

- [ ] **Step 3: Vérif browser** (dev server, campagne démo, onglet Suivi) : section « Réconciliation DSP ⇔ mesure », tuile taux de mesure ~97 % verte, tableau 4 canaux (dv360/ttd/tiktok/meta) avec livré/dépense/CPM/part, ligne mesuré ad server + écart ~2,9 %. Bouton « Actualiser » relance le pull sans erreur.
- [ ] **Step 4: `npx tsc --noEmit` + commit** :

```bash
git add components/campaign/suivi/ReconciliationPanel.tsx components/campaign/CampaignSuivi.tsx
git commit -m "feat: panneau réconciliation DSP ⇔ mesure dans le cockpit suivi (taux de mesure + par canal)"
```

---

### Task 6: Couche carte réconciliation (extension SuiviMapLayer)

**Files:**
- Modify: `app/map/_components/SuiviMapLayer.tsx`

**Interfaces:**
- Consumes: `GET /reconcile/map` ; l'événement `magelian:suivi-map` gagne un champ `source: 'suivi' | 'reconcile'` (défaut 'suivi') et le type de métrique s'élargit.
- Produces: la couche fetch `/suivi/map` (source suivi, metrics hold|cpm) ou `/reconcile/map` (source reconcile, metrics measure|dspcpm) selon `detail.source`, avec paliers de couleur adaptés (measure : ok ≥ 95, warn 85-95, bad < 85 ; dspcpm : uni teal, pas de référence prévue).

- [ ] **Step 1: Étendre le type d'événement et le fetch** dans `SuiviMapLayer.tsx` :
  - `SuiviMapMetric` devient `'hold' | 'cpm' | 'measure' | 'dspcpm'` ; `SuiviMapEventDetail` gagne `source?: 'suivi' | 'reconcile'`.
  - Dans l'effet de fetch : `const src = active.source ?? 'suivi';` → URL `/api/digital/${id}/${src === 'reconcile' ? 'reconcile' : 'suivi'}/map?metric=${active.metric}`.
  - `fillColorExpression` : ajouter les cas `measure` (`< 85` bad, `< 95` warn, sinon ok) et `dspcpm` (teal uni au-dessus de 0, transparent sinon).
  - Popup : libellé metric — `measure` → `${value} % mesuré`, `dspcpm` → `${value} €`.
  - Légende : titre « Réconciliation » quand source reconcile ; paliers measure (≥ 95 % / 85-95 % / < 85 %) ; toggle des métriques reconcile (Taux de mesure / CPM DSP) au lieu de hold/cpm.

- [ ] **Step 2: Vérif browser** : depuis le panneau réconciliation démo, « Voir sur la carte » → overlay se replie, choroplèthe CP colorée (taux de mesure, dispersion 91-99 %), toggle CPM DSP, popup au clic, fermeture propre.
- [ ] **Step 3: `npx tsc --noEmit` + commit** :

```bash
git add app/map/_components/SuiviMapLayer.tsx
git commit -m "feat: couche carte réconciliation — taux de mesure / CPM DSP par CP (source reconcile)"
```

---

### Task 7: Vérification bout-en-bout + documentation

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Suite complète** — `npx tsc --noEmit` (0 erreur), `npm test` (vert), `npm run lint` (pas de nouvelle erreur).
- [ ] **Step 2: Parcours browser démo** : onglet Suivi (démo pilotage) → section réconciliation remplie, « Actualiser » OK, « Voir sur la carte » → choroplèthe, retour. Vérifier au réseau que l'ouverture ne déclenche que `/reconcile` (pas de scan `dsp_campaign_data`).
- [ ] **Step 3: ARCHITECTURE.md** — routes digital : `/reconcile`, `/reconcile/pull`, `/reconcile/map` ; table `campaign_dsp_report` ; RPC `simulate_dsp_report`, `get_campaign_reconciliation`, `get_campaign_reconciliation_map` ; module `lib/dsp/report` (miroir push) ; description `CampaignSuivi` mise à jour (section réconciliation).
- [ ] **Step 4: Commit + push branche** :

```bash
git add ARCHITECTURE.md
git commit -m "docs: ARCHITECTURE — réconciliation DSP ⇔ ad server (table, RPC, routes, module report)"
git push -u origin feat/reconciliation-dsp-adserver
```
