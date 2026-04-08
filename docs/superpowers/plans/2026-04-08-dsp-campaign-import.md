# DSP Campaign Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Adform DSP campaign exports (CSV/XLSX), store impression data, and auto-match French postal codes to IRIS zones via a La Poste reference table.

**Architecture:** Three Supabase tables (`dsp_campaigns`, `dsp_campaign_data`, `postal_code_commune`) with a PL/pgSQL matching function. A single SSE-streaming API endpoint handles file parsing, bulk insertion, and IRIS matching in one call. Admin UI follows existing GEOMATIK patterns (dark minimal, inline styles, `adminFetch`).

**Tech Stack:** Next.js 14 App Router, Supabase (PostgreSQL 15), papaparse, xlsx (SheetJS), Recharts, MapLibre GL (not used in this phase), TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-04-08-dsp-campaign-import-design.md`

**Branch:** `feat/dsp-campaign-import` (create from `feat/radio-multi-filter`)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260408100000_dsp_campaigns.sql` | Tables + indexes + RPC |
| Create | `types/campaign.ts` | TypeScript interfaces |
| Create | `lib/campaigns/column-mappings.ts` | DSP column mapping definitions |
| Create | `lib/campaigns/parser.ts` | Parse CSV/XLSX + apply column mapping |
| Create | `app/api/admin/campaigns/import/route.ts` | POST — SSE import endpoint |
| Create | `app/api/admin/campaigns/route.ts` | GET — list campaigns |
| Create | `app/api/admin/campaigns/[id]/route.ts` | GET + DELETE — detail + delete |
| Create | `app/admin/campaigns/page.tsx` | Campaign list + import modal |
| Create | `app/admin/campaigns/[id]/page.tsx` | Campaign detail page |
| Modify | `components/AppSidebar.tsx` | Add "Campagnes DSP" nav item |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260408100000_dsp_campaigns.sql`

- [ ] **Step 1: Write migration SQL file**

```sql
-- =============================================
-- DSP Campaign Import — Tables, indexes, RPC
-- =============================================

-- ── Campaigns ────────────────────────────────
CREATE TABLE IF NOT EXISTS dsp_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  dsp_source TEXT NOT NULL DEFAULT 'adform',
  advertiser TEXT,
  date_start DATE,
  date_end DATE,
  total_tracked_ads INTEGER DEFAULT 0,
  countries TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- ── Campaign Data (impressions) ──────────────
CREATE TABLE IF NOT EXISTS dsp_campaign_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES dsp_campaigns(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  city TEXT,
  country TEXT NOT NULL,
  postal_code TEXT,
  region TEXT,
  dma_region TEXT,
  tracked_ads INTEGER NOT NULL DEFAULT 0,
  code_iris TEXT,
  code_commune TEXT,
  matched_at TIMESTAMPTZ,
  UNIQUE(campaign_id, date, postal_code, city)
);

CREATE INDEX idx_dsp_data_campaign ON dsp_campaign_data(campaign_id);
CREATE INDEX idx_dsp_data_country ON dsp_campaign_data(country);
CREATE INDEX idx_dsp_data_postal ON dsp_campaign_data(postal_code);
CREATE INDEX idx_dsp_data_iris ON dsp_campaign_data(code_iris) WHERE code_iris IS NOT NULL;

-- ── Postal Code → Commune reference ──────────
CREATE TABLE IF NOT EXISTS postal_code_commune (
  code_postal TEXT NOT NULL,
  code_commune TEXT NOT NULL,
  nom_commune TEXT,
  PRIMARY KEY (code_postal, code_commune)
);

CREATE INDEX idx_postal_code ON postal_code_commune(code_postal);

-- ── IRIS Matching RPC ────────────────────────
CREATE OR REPLACE FUNCTION match_campaign_postal_to_iris(p_campaign_id UUID)
RETURNS INTEGER AS $$
DECLARE
  matched_count INTEGER;
BEGIN
  UPDATE dsp_campaign_data d
  SET code_commune = sub.code_commune,
      code_iris = sub.code_iris,
      matched_at = NOW()
  FROM (
    SELECT DISTINCT ON (d2.id) d2.id, i.code_commune, i.code_iris
    FROM dsp_campaign_data d2
    JOIN postal_code_commune pc ON pc.code_postal = d2.postal_code
    JOIN iris i ON i.code_commune = pc.code_commune
    WHERE d2.campaign_id = p_campaign_id
      AND d2.country = 'France'
      AND d2.code_iris IS NULL
    ORDER BY d2.id, i.population DESC NULLS LAST
  ) sub
  WHERE d.id = sub.id;

  GET DIAGNOSTICS matched_count = ROW_COUNT;
  RETURN matched_count;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 2: Deploy migration to Supabase**

Run via Supabase MCP tool `execute_sql` or Supabase Dashboard SQL editor. Copy-paste the full SQL.

Expected: Tables `dsp_campaigns`, `dsp_campaign_data`, `postal_code_commune` created. Function `match_campaign_postal_to_iris` available.

- [ ] **Step 3: Verify tables exist**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('dsp_campaigns', 'dsp_campaign_data', 'postal_code_commune')
ORDER BY table_name;
```

Expected: 3 rows returned.

- [ ] **Step 4: Populate postal_code_commune reference table**

Download La Poste open data CSV from `https://datanova.laposte.fr/data-fair/api/v1/datasets/laposte-hexasmal/lines?size=10000&page=1&format=csv` (paginate until exhausted). The CSV has columns: `code_commune_insee`, `nom_de_la_commune`, `code_postal`, `ligne_5`, `libelle_d_acheminement`, `coordonnees_gps`.

Insert into `postal_code_commune`:
```sql
-- Example batch (actual data from La Poste CSV):
INSERT INTO postal_code_commune (code_postal, code_commune, nom_commune)
VALUES
  ('01000', '01053', 'BOURG-EN-BRESSE'),
  ('01000', '01344', 'SAINT-DENIS-LES-BOURG')
  -- ... all rows from CSV
ON CONFLICT (code_postal, code_commune) DO NOTHING;
```

This will be done via a small script or manual SQL. ~40k rows.

- [ ] **Step 5: Verify reference data**

```sql
SELECT COUNT(*) AS total,
       COUNT(DISTINCT code_postal) AS unique_postal,
       COUNT(DISTINCT code_commune) AS unique_commune
FROM postal_code_commune;
```

Expected: ~39k total, ~6k unique postal codes, ~35k unique communes.

- [ ] **Step 6: Commit migration file**

```bash
git add supabase/migrations/20260408100000_dsp_campaigns.sql
git commit -m "feat: add DSP campaign tables and IRIS matching RPC"
```

---

## Task 2: TypeScript Interfaces

**Files:**
- Create: `types/campaign.ts`

- [ ] **Step 1: Create types file**

```typescript
/**
 * GENESIS — DSP Campaign types
 */

/* ── Database row types ──────────────────────── */

export interface DspCampaign {
  id: string;
  name: string;
  dsp_source: string;
  advertiser: string | null;
  date_start: string | null;
  date_end: string | null;
  total_tracked_ads: number;
  countries: string[] | null;
  created_at: string;
  created_by: string | null;
}

export interface DspCampaignData {
  id: string;
  campaign_id: string;
  date: string;
  city: string | null;
  country: string;
  postal_code: string | null;
  region: string | null;
  dma_region: string | null;
  tracked_ads: number;
  code_iris: string | null;
  code_commune: string | null;
  matched_at: string | null;
}

/* ── API response types ──────────────────────── */

export interface CampaignListItem extends DspCampaign {
  total_rows: number;
  france_rows: number;
  matched_iris: number;
}

export interface CampaignDetail {
  campaign: DspCampaign;
  stats: {
    by_country: { country: string; tracked_ads: number; row_count: number }[];
    by_region: { region: string; tracked_ads: number; row_count: number }[];
    by_department: { code_dept: string; tracked_ads: number; row_count: number }[];
  };
  data: {
    rows: DspCampaignData[];
    total: number;
    page: number;
  };
}

/* ── SSE event types ─────────────────────────── */

export type CampaignImportEvent =
  | { type: 'parsing'; message: string }
  | { type: 'progress'; processed: number; total: number; message: string }
  | { type: 'matching'; matched: number; total_france: number; message: string }
  | { type: 'complete'; report: CampaignImportReport }
  | { type: 'error'; message: string };

export interface CampaignImportReport {
  campaign_id: string;
  campaign_name: string;
  total_rows: number;
  countries: string[];
  total_france: number;
  matched_iris: number;
  pct_matched: number;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: No errors related to `types/campaign.ts`.

- [ ] **Step 3: Commit**

```bash
git add types/campaign.ts
git commit -m "feat: add TypeScript interfaces for DSP campaigns"
```

---

## Task 3: Column Mapping Module

**Files:**
- Create: `lib/campaigns/column-mappings.ts`

- [ ] **Step 1: Create column mapping definitions**

```typescript
/**
 * GENESIS — DSP column mappings
 *
 * Each DSP export has different column names.
 * A mapping converts source column names → our schema fields.
 */

export interface ColumnMapping {
  /** Source column name → target field name */
  [sourceColumn: string]: string;
}

/**
 * Known mappings per DSP source.
 * Keys are lowercase source column names.
 * Values are our dsp_campaign_data field names.
 */
export const DSP_MAPPINGS: Record<string, ColumnMapping> = {
  adform: {
    'campaign':     'campaign_name',
    'date':         'date',
    'city':         'city',
    'country':      'country',
    'postal code':  'postal_code',
    'region':       'region',
    'dma region':   'dma_region',
    'tracked ads':  'tracked_ads',
  },
};

/**
 * Date parsers per DSP source.
 * Adform uses DD/MM/YYYY. Others may differ.
 */
export function parseDate(raw: string, dspSource: string): string | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();

  if (dspSource === 'adform') {
    // DD/MM/YYYY → YYYY-MM-DD
    const match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (match) {
      const [, dd, mm, yyyy] = match;
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
  }

  // Fallback: try ISO format (YYYY-MM-DD)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;

  return null;
}

/**
 * Resolve the column mapping for a given DSP source.
 * Falls back to adform if unknown source.
 */
export function getMappingForSource(dspSource: string): ColumnMapping {
  return DSP_MAPPINGS[dspSource.toLowerCase()] ?? DSP_MAPPINGS.adform;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/campaigns/column-mappings.ts
git commit -m "feat: add DSP column mapping definitions (Adform)"
```

---

## Task 4: File Parser Module

**Files:**
- Create: `lib/campaigns/parser.ts`

- [ ] **Step 1: Create parser module**

```typescript
/**
 * GENESIS — DSP campaign file parser
 *
 * Parses CSV/XLSX files and applies DSP column mapping
 * to produce normalized campaign data rows.
 */

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { getMappingForSource, parseDate } from './column-mappings';

export interface ParsedCampaignRow {
  campaign_name: string;
  date: string | null;
  city: string | null;
  country: string;
  postal_code: string | null;
  region: string | null;
  dma_region: string | null;
  tracked_ads: number;
}

export interface CampaignParseResult {
  rows: ParsedCampaignRow[];
  campaign_name: string;
  countries: string[];
  date_start: string | null;
  date_end: string | null;
  total_tracked_ads: number;
  errors: string[];
}

/**
 * Parse a campaign file (CSV or XLSX buffer) with the given DSP source mapping.
 */
export function parseCampaignFile(
  buffer: Buffer,
  fileName: string,
  dspSource: string
): CampaignParseResult {
  const isXlsx = /\.xlsx?$/i.test(fileName);
  const rawRows = isXlsx ? parseXlsx(buffer) : parseCsv(buffer);

  const mapping = getMappingForSource(dspSource);
  const errors: string[] = [];
  const rows: ParsedCampaignRow[] = [];

  let campaignName = '';
  const countriesSet = new Set<string>();
  let totalTrackedAds = 0;
  const dates: string[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const mapped = applyMapping(raw, mapping);

    // campaign_name: take from first row that has it
    if (mapped.campaign_name && !campaignName) {
      campaignName = mapped.campaign_name;
    }

    // country is required
    if (!mapped.country) {
      errors.push(`Ligne ${i + 2}: pays manquant`);
      continue;
    }

    const date = parseDate(mapped.date_raw ?? '', dspSource);
    const trackedAds = parseInt(String(mapped.tracked_ads_raw ?? '0').replace(/[^0-9-]/g, ''), 10) || 0;

    const row: ParsedCampaignRow = {
      campaign_name: mapped.campaign_name ?? campaignName,
      date,
      city: mapped.city?.trim() || null,
      country: mapped.country.trim(),
      postal_code: mapped.postal_code?.trim() || null,
      region: mapped.region?.trim() || null,
      dma_region: mapped.dma_region?.trim() || null,
      tracked_ads: trackedAds,
    };

    rows.push(row);
    countriesSet.add(row.country);
    totalTrackedAds += trackedAds;
    if (date) dates.push(date);
  }

  dates.sort();

  return {
    rows,
    campaign_name: campaignName || fileName.replace(/\.\w+$/, ''),
    countries: Array.from(countriesSet).sort(),
    date_start: dates[0] ?? null,
    date_end: dates[dates.length - 1] ?? null,
    total_tracked_ads: totalTrackedAds,
    errors,
  };
}

/* ── Internal helpers ────────────────────────── */

function parseCsv(buffer: Buffer): Record<string, string>[] {
  // Try UTF-8 first, fallback to latin-1
  let text = buffer.toString('utf-8');
  if (text.includes('�')) {
    text = buffer.toString('latin1');
  }

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  });

  return result.data;
}

function parseXlsx(buffer: Buffer): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
}

interface MappedFields {
  campaign_name?: string;
  date_raw?: string;
  city?: string;
  country?: string;
  postal_code?: string;
  region?: string;
  dma_region?: string;
  tracked_ads_raw?: string;
}

function applyMapping(
  raw: Record<string, string>,
  mapping: Record<string, string>
): MappedFields {
  const result: Record<string, string> = {};

  // Build a lowercase lookup for the raw row's keys
  const rawLower: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    rawLower[key.toLowerCase().trim()] = raw[key];
  }

  for (const [sourceCol, targetField] of Object.entries(mapping)) {
    const value = rawLower[sourceCol.toLowerCase()];
    if (value !== undefined) {
      if (targetField === 'date') {
        result['date_raw'] = value;
      } else if (targetField === 'tracked_ads') {
        result['tracked_ads_raw'] = value;
      } else {
        result[targetField] = value;
      }
    }
  }

  return result as MappedFields;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/campaigns/parser.ts
git commit -m "feat: add DSP campaign CSV/XLSX file parser"
```

---

## Task 5: Import API Route (SSE Streaming)

**Files:**
- Create: `app/api/admin/campaigns/import/route.ts`

- [ ] **Step 1: Create the import endpoint**

```typescript
/**
 * GENESIS — DSP Campaign Import (SSE streaming)
 * Route: POST /api/admin/campaigns/import
 *
 * Accepts multipart/form-data with:
 *   - file: CSV or XLSX
 *   - dsp_source: string (default "adform")
 *
 * Streams NDJSON progress events to client.
 */

import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { parseCampaignFile } from '@/lib/campaigns/parser';
import type { CampaignImportEvent } from '@/types/campaign';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 50;

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: CampaignImportEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        } catch { /* stream closed */ }
      };

      try {
        /* ── 1. Parse form data ─────────────────────── */
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const dspSource = (formData.get('dsp_source') as string) || 'adform';

        if (!file) {
          send({ type: 'error', message: 'Aucun fichier fourni' });
          controller.close();
          return;
        }

        send({ type: 'parsing', message: `Lecture de ${file.name}...` });

        const buffer = Buffer.from(await file.arrayBuffer());
        const parsed = parseCampaignFile(buffer, file.name, dspSource);

        if (parsed.rows.length === 0) {
          send({ type: 'error', message: 'Fichier vide ou format non reconnu' });
          controller.close();
          return;
        }

        send({
          type: 'parsing',
          message: `${parsed.rows.length} lignes parsées, ${parsed.countries.length} pays détectés`,
        });

        /* ── 2. Create campaign record ──────────────── */
        const supabase = createAdminClient();

        const { data: campaign, error: campaignErr } = await supabase
          .from('dsp_campaigns')
          .insert({
            name: parsed.campaign_name,
            dsp_source: dspSource,
            advertiser: null,
            date_start: parsed.date_start,
            date_end: parsed.date_end,
            total_tracked_ads: parsed.total_tracked_ads,
            countries: parsed.countries,
            created_by: profile.id,
          })
          .select('id')
          .single();

        if (campaignErr || !campaign) {
          send({ type: 'error', message: `Erreur création campagne: ${campaignErr?.message}` });
          controller.close();
          return;
        }

        const campaignId = campaign.id;

        /* ── 3. Batch insert campaign data ──────────── */
        let inserted = 0;
        let errors = 0;
        const total = parsed.rows.length;

        for (let i = 0; i < total; i += BATCH_SIZE) {
          const batch = parsed.rows.slice(i, i + BATCH_SIZE).map(row => ({
            campaign_id: campaignId,
            date: row.date,
            city: row.city,
            country: row.country,
            postal_code: row.postal_code,
            region: row.region,
            dma_region: row.dma_region,
            tracked_ads: row.tracked_ads,
          }));

          const { error: insertErr, count } = await supabase
            .from('dsp_campaign_data')
            .upsert(batch, { onConflict: 'campaign_id,date,postal_code,city', count: 'exact' });

          if (insertErr) {
            errors += batch.length;
            console.error(`[dsp-import] Batch error at row ${i}:`, insertErr.message);
          } else {
            inserted += count ?? batch.length;
          }

          send({
            type: 'progress',
            processed: Math.min(i + BATCH_SIZE, total),
            total,
            message: `${Math.min(i + BATCH_SIZE, total)}/${total} lignes insérées`,
          });
        }

        /* ── 4. IRIS matching for France rows ───────── */
        const { data: franceCount } = await supabase
          .from('dsp_campaign_data')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', campaignId)
          .eq('country', 'France');

        const totalFrance = franceCount ?? 0;
        let matchedIris = 0;

        if (totalFrance > 0) {
          send({ type: 'matching', matched: 0, total_france: totalFrance, message: 'Matching IRIS en cours...' });

          const { data: matchResult } = await supabase.rpc('match_campaign_postal_to_iris', {
            p_campaign_id: campaignId,
          });

          matchedIris = matchResult ?? 0;

          send({
            type: 'matching',
            matched: matchedIris,
            total_france: totalFrance,
            message: `${matchedIris}/${totalFrance} lignes France matchées IRIS`,
          });
        }

        /* ── 5. Final report ────────────────────────── */
        const pctMatched = totalFrance > 0
          ? Math.round((matchedIris / totalFrance) * 1000) / 10
          : 0;

        send({
          type: 'complete',
          report: {
            campaign_id: campaignId,
            campaign_name: parsed.campaign_name,
            total_rows: inserted,
            countries: parsed.countries,
            total_france: totalFrance,
            matched_iris: matchedIris,
            pct_matched: pctMatched,
          },
        });

        if (parsed.errors.length > 0) {
          console.warn(`[dsp-import] ${parsed.errors.length} parse warnings:`, parsed.errors.slice(0, 10));
        }
      } catch (err) {
        send({ type: 'error', message: `Erreur inattendue: ${err instanceof Error ? err.message : String(err)}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/campaigns/import/route.ts
git commit -m "feat: add DSP campaign import endpoint with SSE streaming"
```

---

## Task 6: List & Detail API Routes

**Files:**
- Create: `app/api/admin/campaigns/route.ts`
- Create: `app/api/admin/campaigns/[id]/route.ts`

- [ ] **Step 1: Create list endpoint**

```typescript
/**
 * GENESIS — DSP Campaigns list
 * Route: GET /api/admin/campaigns
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();

  // Fetch campaigns
  const { data: campaigns, error } = await supabase
    .from('dsp_campaigns')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Fetch aggregated stats per campaign in one query
  const campaignIds = (campaigns ?? []).map(c => c.id);

  if (campaignIds.length === 0) {
    return NextResponse.json({ success: true, campaigns: [] });
  }

  const { data: stats } = await supabase
    .from('dsp_campaign_data')
    .select('campaign_id, country, code_iris')
    .in('campaign_id', campaignIds);

  // Aggregate in JS (avoids complex SQL, small dataset)
  const statsMap: Record<string, { total: number; france: number; iris: number }> = {};
  for (const row of stats ?? []) {
    if (!statsMap[row.campaign_id]) {
      statsMap[row.campaign_id] = { total: 0, france: 0, iris: 0 };
    }
    statsMap[row.campaign_id].total++;
    if (row.country === 'France') {
      statsMap[row.campaign_id].france++;
      if (row.code_iris) statsMap[row.campaign_id].iris++;
    }
  }

  const enriched = (campaigns ?? []).map(c => ({
    ...c,
    total_rows: statsMap[c.id]?.total ?? 0,
    france_rows: statsMap[c.id]?.france ?? 0,
    matched_iris: statsMap[c.id]?.iris ?? 0,
  }));

  return NextResponse.json({ success: true, campaigns: enriched });
}
```

- [ ] **Step 2: Create detail + delete endpoint**

```typescript
/**
 * GENESIS — DSP Campaign detail & delete
 * Route: GET|DELETE /api/admin/campaigns/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();
  const campaignId = params.id;

  // Campaign metadata
  const { data: campaign, error } = await supabase
    .from('dsp_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (error || !campaign) {
    return NextResponse.json({ success: false, error: 'Campagne non trouvée' }, { status: 404 });
  }

  // Stats by country
  const { data: byCountry } = await supabase.rpc('', {}).catch(() => ({ data: null }));
  // Use raw SQL via supabase — we'll do aggregation queries directly
  const { data: countryStats } = await supabase
    .from('dsp_campaign_data')
    .select('country')
    .eq('campaign_id', campaignId);

  const countryAgg: Record<string, { tracked_ads: number; row_count: number }> = {};
  const regionAgg: Record<string, { tracked_ads: number; row_count: number }> = {};
  const deptAgg: Record<string, { tracked_ads: number; row_count: number }> = {};

  // Fetch all data for this campaign (campaigns are bounded in size — max ~100k rows)
  const { data: allData } = await supabase
    .from('dsp_campaign_data')
    .select('country, region, tracked_ads, code_iris')
    .eq('campaign_id', campaignId);

  for (const row of allData ?? []) {
    // By country
    if (!countryAgg[row.country]) countryAgg[row.country] = { tracked_ads: 0, row_count: 0 };
    countryAgg[row.country].tracked_ads += row.tracked_ads;
    countryAgg[row.country].row_count++;

    // By region (France only)
    if (row.country === 'France' && row.region) {
      if (!regionAgg[row.region]) regionAgg[row.region] = { tracked_ads: 0, row_count: 0 };
      regionAgg[row.region].tracked_ads += row.tracked_ads;
      regionAgg[row.region].row_count++;
    }

    // By department (from code_iris first 2 digits)
    if (row.code_iris) {
      const codeDept = row.code_iris.startsWith('97') ? row.code_iris.slice(0, 3) : row.code_iris.slice(0, 2);
      if (!deptAgg[codeDept]) deptAgg[codeDept] = { tracked_ads: 0, row_count: 0 };
      deptAgg[codeDept].tracked_ads += row.tracked_ads;
      deptAgg[codeDept].row_count++;
    }
  }

  const toArray = (agg: Record<string, { tracked_ads: number; row_count: number }>, keyName: string) =>
    Object.entries(agg)
      .map(([key, val]) => ({ [keyName]: key, ...val }))
      .sort((a, b) => b.tracked_ads - a.tracked_ads);

  // Paginated data rows
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const from = (page - 1) * limit;

  const { data: rows, count } = await supabase
    .from('dsp_campaign_data')
    .select('*', { count: 'exact' })
    .eq('campaign_id', campaignId)
    .order('date', { ascending: false })
    .range(from, from + limit - 1);

  return NextResponse.json({
    success: true,
    campaign,
    stats: {
      by_country: toArray(countryAgg, 'country'),
      by_region: toArray(regionAgg, 'region'),
      by_department: toArray(deptAgg, 'code_dept'),
    },
    data: {
      rows: rows ?? [],
      total: count ?? 0,
      page,
    },
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();

  const { error } = await supabase
    .from('dsp_campaigns')
    .delete()
    .eq('id', params.id);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Clean up dead code in detail route**

Remove the unused `byCountry` and `countryStats` queries — the aggregation uses `allData` only. The final GET handler should fetch `campaign` + `allData` + paginated `rows`, nothing else.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/campaigns/route.ts app/api/admin/campaigns/\[id\]/route.ts
git commit -m "feat: add campaign list, detail, and delete API routes"
```

---

## Task 7: Sidebar Navigation Entry

**Files:**
- Modify: `components/AppSidebar.tsx` (~line 56, in Admin section items array)

- [ ] **Step 1: Add import for BarChart3 icon**

In `components/AppSidebar.tsx`, find the lucide-react import line and add `BarChart3`:

```typescript
// Find the existing import:
import { MapPin, Share2, LayoutGrid, Upload, PlusCircle, FileUp, Monitor, Layers, Radio, Database, Users, Lock, Activity, ... } from 'lucide-react';

// Add BarChart3 to the import list
```

- [ ] **Step 2: Add nav item to Admin section**

In the `navItems` array, in the `section: 'Admin'` items array, add after the Radio entry:

```typescript
{ href: '/admin/campaigns', label: 'Campagnes DSP', icon: BarChart3, badge: 'DSP' },
```

- [ ] **Step 3: Verify visually**

Run: `npm run dev`

Navigate to any page. Confirm "Campagnes DSP" appears in the sidebar Admin section with the BarChart3 icon and "DSP" badge.

- [ ] **Step 4: Commit**

```bash
git add components/AppSidebar.tsx
git commit -m "feat: add Campagnes DSP to admin sidebar navigation"
```

---

## Task 8: Campaign List Page + Import Modal

**Files:**
- Create: `app/admin/campaigns/page.tsx`

- [ ] **Step 1: Create the campaign list page with import modal**

This is a large component. Key sections:

1. **Color constants** — Same `C` object as other admin pages
2. **State** — campaigns list, loading, import modal state (step, file, progress, report)
3. **fetchCampaigns()** — `adminFetch('/api/admin/campaigns')` in useEffect
4. **handleImport()** — FormData with file + dsp_source, stream NDJSON from `/api/admin/campaigns/import`
5. **Render** — Table + modal overlay

```typescript
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import type { CampaignListItem, CampaignImportEvent, CampaignImportReport } from '@/types/campaign';

/* ── Design tokens ─────────────────────────── */
const C = {
  bg: '#050505', bgElevated: '#0a0a0a', bgSurface: '#111111',
  border: '#1a1a1a', borderLight: 'rgba(78,205,196,0.2)',
  accent: '#4ecdc4', accentDim: 'rgba(78,205,196,0.08)',
  text: '#f0f0f0', textDim: '#a0a0a0', textSec: '#666666',
  green: '#3dffa0', greenDim: 'rgba(61,255,160,0.12)',
  red: '#f87171', redDim: 'rgba(248,113,113,0.1)',
  warn: '#fbbf24', warnDim: 'rgba(251,191,36,0.1)',
};
const fontMono = "'JetBrains Mono', monospace";
const fontInter = "'Inter', system-ui, sans-serif";

/* ── DSP options ───────────────────────────── */
const DSP_OPTIONS = [
  { value: 'adform', label: 'Adform' },
  { value: 'dv360', label: 'DV360' },
  { value: 'ttd', label: 'The Trade Desk' },
  { value: 'other', label: 'Autre' },
];

export default function CampaignsPage() {
  const router = useRouter();

  /* ── List state ────────────────────────────── */
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  /* ── Import modal state ────────────────────── */
  const [showImport, setShowImport] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'progress' | 'done'>('upload');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [dspSource, setDspSource] = useState('adform');
  const [importProgress, setImportProgress] = useState({ processed: 0, total: 0, message: '' });
  const [importReport, setImportReport] = useState<CampaignImportReport | null>(null);
  const [importError, setImportError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const [logs, setLogs] = useState<string[]>([]);

  /* ── Delete state ──────────────────────────── */
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  /* ── Fetch campaigns ───────────────────────── */
  const fetchCampaigns = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await adminFetch('/api/admin/campaigns');
      const data = await res.json();
      if (data.success) setCampaigns(data.campaigns ?? []);
      else setError(data.error || 'Erreur');
    } catch (e) { setError(String(e)); }
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  /* ── Import handler ────────────────────────── */
  const handleImport = async () => {
    if (!importFile) return;
    setImportStep('progress');
    setIsImporting(true);
    setImportError('');
    setLogs([]);
    setImportProgress({ processed: 0, total: 0, message: '' });

    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('dsp_source', dspSource);

      const res = await adminFetch('/api/admin/campaigns/import', {
        method: 'POST',
        body: formData,
      });

      if (!res.body) {
        setImportError('Pas de réponse du serveur');
        setIsImporting(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as CampaignImportEvent;

            if (event.type === 'parsing' || event.type === 'matching') {
              setLogs(prev => [...prev, event.message]);
            } else if (event.type === 'progress') {
              setImportProgress({ processed: event.processed, total: event.total, message: event.message });
            } else if (event.type === 'complete') {
              setImportReport(event.report);
              setImportStep('done');
            } else if (event.type === 'error') {
              setImportError(event.message);
            }
          } catch { /* skip malformed line */ }
        }
      }
    } catch (e) {
      setImportError(String(e));
    }
    setIsImporting(false);
  };

  /* ── Delete handler ────────────────────────── */
  const handleDelete = async () => {
    if (!deleteId) return;
    setIsDeleting(true);
    try {
      const res = await adminFetch(`/api/admin/campaigns/${deleteId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setCampaigns(prev => prev.filter(c => c.id !== deleteId));
        setDeleteId(null);
      }
    } catch (e) { console.error(e); }
    setIsDeleting(false);
  };

  /* ── Reset import modal ────────────────────── */
  const resetImport = () => {
    setShowImport(false);
    setImportStep('upload');
    setImportFile(null);
    setDspSource('adform');
    setImportProgress({ processed: 0, total: 0, message: '' });
    setImportReport(null);
    setImportError('');
    setLogs([]);
  };

  /* ── Auto-scroll logs ──────────────────────── */
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  /* ── Format number ─────────────────────────── */
  const fmt = (n: number) => n.toLocaleString('fr-FR');

  /* ── Render ────────────────────────────────── */
  return (
    <div style={{ maxWidth: 1200, padding: '24px 20px', fontFamily: fontInter, color: C.text, background: C.bg, minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent }} />
          <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Campagnes DSP</h1>
        </div>
        <button
          onClick={() => setShowImport(true)}
          style={{ padding: '8px 20px', background: C.text, color: C.bg, border: 'none', borderRadius: 2, fontSize: 12, fontWeight: 600, fontFamily: fontInter, cursor: 'pointer' }}
        >
          Importer une campagne
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 14px', background: C.redDim, border: `1px solid ${C.red}`, borderRadius: 2, fontSize: 12, color: C.red, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {isLoading && <div style={{ color: C.textDim, fontSize: 12 }}>Chargement...</div>}

      {/* Empty state */}
      {!isLoading && campaigns.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: C.textSec }}>
          <div style={{ fontSize: 14, marginBottom: 12 }}>Aucune campagne importée</div>
          <button
            onClick={() => setShowImport(true)}
            style={{ padding: '8px 20px', background: 'transparent', color: C.accent, border: `0.5px solid ${C.accent}`, borderRadius: 2, fontSize: 12, fontFamily: fontInter, cursor: 'pointer' }}
          >
            Importer votre première campagne
          </button>
        </div>
      )}

      {/* Campaign table */}
      {campaigns.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {['Nom', 'DSP', 'Période', 'Pays', 'Impressions', 'France', 'IRIS matchés', ''].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontFamily: fontInter, fontSize: 11, color: C.textDim, fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {campaigns.map(c => {
              const francePct = c.total_rows > 0 ? Math.round((c.france_rows / c.total_rows) * 100) : 0;
              const irisPct = c.france_rows > 0 ? Math.round((c.matched_iris / c.france_rows) * 100) : 0;
              return (
                <tr
                  key={c.id}
                  style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.bgSurface)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => router.push(`/admin/campaigns/${c.id}`)}
                >
                  <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 500 }}>{c.name}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ padding: '2px 8px', background: C.accentDim, color: C.accent, fontSize: 10, fontFamily: fontMono, borderRadius: 2 }}>
                      {c.dsp_source.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: fontMono, fontSize: 11, color: C.textDim }}>
                    {c.date_start ?? '?'} → {c.date_end ?? '?'}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: C.textDim }}>{(c.countries ?? []).join(', ')}</td>
                  <td style={{ padding: '10px 12px', fontFamily: fontMono, fontSize: 12 }}>{fmt(c.total_tracked_ads)}</td>
                  <td style={{ padding: '10px 12px', fontFamily: fontMono, fontSize: 12, color: francePct > 50 ? C.accent : C.textDim }}>{francePct}%</td>
                  <td style={{ padding: '10px 12px', fontFamily: fontMono, fontSize: 12, color: irisPct >= 80 ? C.green : irisPct < 50 ? C.warn : C.textDim }}>{irisPct}%</td>
                  <td style={{ padding: '10px 12px' }}>
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteId(c.id); }}
                      style={{ padding: '4px 10px', background: C.redDim, color: C.red, border: 'none', borderRadius: 2, fontSize: 10, fontFamily: fontInter, cursor: 'pointer' }}
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Delete confirm modal */}
      <ConfirmModal
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Supprimer la campagne"
        message="Cette action supprimera la campagne et toutes ses données d'impressions. Êtes-vous sûr ?"
        confirmLabel="Supprimer"
        variant="danger"
        loading={isDeleting}
      />

      {/* Import modal overlay */}
      {showImport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget && !isImporting) resetImport(); }}>
          <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 4, width: 520, maxHeight: '80vh', overflow: 'auto', padding: 24 }}>

            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Importer une campagne</h2>
              {!isImporting && (
                <button onClick={resetImport} style={{ background: 'none', border: 'none', color: C.textSec, fontSize: 18, cursor: 'pointer' }}>×</button>
              )}
            </div>

            {/* Step 1: Upload */}
            {importStep === 'upload' && (
              <>
                {/* Drop zone */}
                <label
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    padding: '32px 20px', border: `1px dashed ${importFile ? C.accent : C.border}`,
                    borderRadius: 4, cursor: 'pointer', marginBottom: 16,
                    background: importFile ? C.accentDim : 'transparent',
                    transition: 'border-color 0.2s, background 0.2s',
                  }}
                >
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    style={{ display: 'none' }}
                    onChange={e => setImportFile(e.target.files?.[0] ?? null)}
                  />
                  {importFile ? (
                    <span style={{ fontSize: 13, color: C.accent }}>{importFile.name} ({(importFile.size / 1024).toFixed(0)} KB)</span>
                  ) : (
                    <>
                      <span style={{ fontSize: 13, color: C.textDim, marginBottom: 4 }}>Glissez un fichier CSV ou XLSX</span>
                      <span style={{ fontSize: 11, color: C.textSec }}>ou cliquez pour parcourir</span>
                    </>
                  )}
                </label>

                {/* DSP source */}
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 11, color: C.textDim, display: 'block', marginBottom: 6 }}>Source DSP</label>
                  <select
                    value={dspSource}
                    onChange={e => setDspSource(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, color: C.text, fontSize: 12, fontFamily: fontInter }}
                  >
                    {DSP_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                {/* Import button */}
                <button
                  onClick={handleImport}
                  disabled={!importFile}
                  style={{
                    width: '100%', padding: '10px', background: importFile ? C.text : C.bgSurface,
                    color: importFile ? C.bg : C.textSec, border: 'none', borderRadius: 2,
                    fontSize: 12, fontWeight: 600, fontFamily: fontInter, cursor: importFile ? 'pointer' : 'not-allowed',
                  }}
                >
                  Importer
                </button>
              </>
            )}

            {/* Step 2: Progress */}
            {importStep === 'progress' && (
              <>
                <div style={{ fontSize: 12, color: C.textDim, marginBottom: 12 }}>{importFile?.name}</div>

                {/* Progress bar */}
                {importProgress.total > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.textDim, marginBottom: 4 }}>
                      <span>{importProgress.message}</span>
                      <span style={{ fontFamily: fontMono }}>{fmt(importProgress.processed)}/{fmt(importProgress.total)}</span>
                    </div>
                    <div style={{ height: 4, background: C.bgSurface, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(importProgress.processed / importProgress.total) * 100}%`, background: C.accent, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}

                {/* Log area */}
                <div ref={logRef} style={{ maxHeight: 200, overflow: 'auto', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2, padding: 10, fontFamily: fontMono, fontSize: 10, color: C.textDim }}>
                  {logs.map((line, i) => <div key={i}>{line}</div>)}
                  {isImporting && <div style={{ color: C.accent }}>...</div>}
                </div>

                {importError && (
                  <div style={{ marginTop: 12, padding: '8px 12px', background: C.redDim, color: C.red, fontSize: 11, borderRadius: 2 }}>{importError}</div>
                )}
              </>
            )}

            {/* Step 3: Done */}
            {importStep === 'done' && importReport && (
              <>
                <div style={{ background: C.greenDim, border: `1px solid rgba(61,255,160,0.3)`, borderRadius: 2, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.green, marginBottom: 12 }}>Import terminé</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                    <div><span style={{ color: C.textDim }}>Campagne:</span> <span style={{ color: C.text }}>{importReport.campaign_name}</span></div>
                    <div><span style={{ color: C.textDim }}>Lignes:</span> <span style={{ fontFamily: fontMono, color: C.text }}>{fmt(importReport.total_rows)}</span></div>
                    <div><span style={{ color: C.textDim }}>Pays:</span> <span style={{ color: C.text }}>{importReport.countries.join(', ')}</span></div>
                    <div><span style={{ color: C.textDim }}>France:</span> <span style={{ fontFamily: fontMono, color: C.text }}>{fmt(importReport.total_france)}</span></div>
                    <div><span style={{ color: C.textDim }}>IRIS matchés:</span> <span style={{ fontFamily: fontMono, color: C.green }}>{fmt(importReport.matched_iris)} ({importReport.pct_matched}%)</span></div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => { resetImport(); router.push(`/admin/campaigns/${importReport.campaign_id}`); }}
                    style={{ flex: 1, padding: '10px', background: 'transparent', color: C.accent, border: `0.5px solid ${C.accent}`, borderRadius: 2, fontSize: 12, fontFamily: fontInter, cursor: 'pointer' }}
                  >
                    Voir la campagne
                  </button>
                  <button
                    onClick={() => { resetImport(); fetchCampaigns(); }}
                    style={{ flex: 1, padding: '10px', background: C.bgSurface, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 2, fontSize: 12, fontFamily: fontInter, cursor: 'pointer' }}
                  >
                    Fermer
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Visual verification**

Run: `npm run dev`

1. Navigate to `/admin/campaigns`
2. Verify empty state displays
3. Click "Importer une campagne" — modal opens
4. Select a file, verify DSP dropdown works
5. Close modal

- [ ] **Step 4: Commit**

```bash
git add app/admin/campaigns/page.tsx
git commit -m "feat: add campaign list page with import modal"
```

---

## Task 9: Campaign Detail Page

**Files:**
- Create: `app/admin/campaigns/[id]/page.tsx`

- [ ] **Step 1: Create the detail page**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { DspCampaign, DspCampaignData } from '@/types/campaign';

/* ── Design tokens ─────────────────────────── */
const C = {
  bg: '#050505', bgElevated: '#0a0a0a', bgSurface: '#111111',
  border: '#1a1a1a', borderLight: 'rgba(78,205,196,0.2)',
  accent: '#4ecdc4', accentDim: 'rgba(78,205,196,0.08)',
  text: '#f0f0f0', textDim: '#a0a0a0', textSec: '#666666',
  green: '#3dffa0', greenDim: 'rgba(61,255,160,0.12)',
  red: '#f87171', redDim: 'rgba(248,113,113,0.1)',
  warn: '#fbbf24',
};
const fontMono = "'JetBrains Mono', monospace";
const fontInter = "'Inter', system-ui, sans-serif";

interface Stats {
  by_country: { country: string; tracked_ads: number; row_count: number }[];
  by_region: { region: string; tracked_ads: number; row_count: number }[];
  by_department: { code_dept: string; tracked_ads: number; row_count: number }[];
}

export default function CampaignDetailPage() {
  const { id } = useParams();
  const router = useRouter();

  const [campaign, setCampaign] = useState<DspCampaign | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<DspCampaignData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    const fetchDetail = async () => {
      setIsLoading(true);
      setError('');
      try {
        const res = await adminFetch(`/api/admin/campaigns/${id}?page=${page}`);
        const data = await res.json();
        if (data.success) {
          setCampaign(data.campaign);
          setStats(data.stats);
          setRows(data.data.rows);
          setTotal(data.data.total);
        } else {
          setError(data.error || 'Erreur');
        }
      } catch (e) { setError(String(e)); }
      setIsLoading(false);
    };
    fetchDetail();
  }, [id, page]);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await adminFetch(`/api/admin/campaigns/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) router.push('/admin/campaigns');
    } catch (e) { console.error(e); }
    setIsDeleting(false);
  };

  const fmt = (n: number) => n.toLocaleString('fr-FR');
  const totalPages = Math.ceil(total / 50);

  if (isLoading) return <div style={{ padding: 40, color: C.textDim, fontFamily: fontInter }}>Chargement...</div>;
  if (error || !campaign) return <div style={{ padding: 40, color: C.red, fontFamily: fontInter }}>{error || 'Campagne non trouvée'}</div>;

  /* ── Compute summary metrics ─────────────── */
  const totalRows = stats?.by_country.reduce((s, c) => s + c.row_count, 0) ?? 0;
  const franceRows = stats?.by_country.find(c => c.country === 'France')?.row_count ?? 0;
  const matchedIris = stats?.by_department.reduce((s, d) => s + d.row_count, 0) ?? 0;
  const francePct = totalRows > 0 ? Math.round((franceRows / totalRows) * 100) : 0;
  const irisPct = franceRows > 0 ? Math.round((matchedIris / franceRows) * 100) : 0;

  return (
    <div style={{ maxWidth: 1200, padding: '24px 20px', fontFamily: fontInter, color: C.text, background: C.bg, minHeight: '100vh' }}>

      {/* Back + header */}
      <button
        onClick={() => router.push('/admin/campaigns')}
        style={{ background: 'none', border: 'none', color: C.textDim, fontSize: 12, cursor: 'pointer', marginBottom: 16, padding: 0, fontFamily: fontInter }}
      >
        ← Campagnes DSP
      </button>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{campaign.name}</h1>
            <span style={{ padding: '2px 8px', background: C.accentDim, color: C.accent, fontSize: 10, fontFamily: fontMono, borderRadius: 2 }}>
              {campaign.dsp_source.toUpperCase()}
            </span>
          </div>
          <div style={{ fontSize: 11, color: C.textSec }}>
            {campaign.date_start ?? '?'} → {campaign.date_end ?? '?'}
            {campaign.advertiser && <> · {campaign.advertiser}</>}
          </div>
        </div>
        <button
          onClick={() => setShowDelete(true)}
          style={{ padding: '6px 14px', background: C.redDim, color: C.red, border: 'none', borderRadius: 2, fontSize: 11, fontFamily: fontInter, cursor: 'pointer' }}
        >
          Supprimer
        </button>
      </div>

      {/* Summary metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Impressions', value: fmt(campaign.total_tracked_ads), color: C.text },
          { label: 'Lignes', value: fmt(totalRows), color: C.text },
          { label: 'Pays', value: String((campaign.countries ?? []).length), color: C.text },
          { label: 'France', value: `${francePct}%`, color: francePct > 50 ? C.accent : C.textDim },
          { label: 'IRIS matchés', value: `${irisPct}%`, color: irisPct >= 80 ? C.green : irisPct < 50 ? C.warn : C.textDim },
        ].map(m => (
          <div key={m.label} style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 600, fontFamily: fontMono, color: m.color }}>{m.value}</div>
            <div style={{ fontSize: 10, color: C.textSec, marginTop: 4 }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Charts section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Country breakdown */}
        {stats && stats.by_country.length > 0 && (
          <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.accent }} />
              Répartition par pays
            </div>
            <ResponsiveContainer width="100%" height={Math.max(120, stats.by_country.slice(0, 10).length * 28)}>
              <BarChart data={stats.by_country.slice(0, 10)} layout="vertical" margin={{ left: 80, right: 20, top: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fill: C.textSec, fontSize: 10, fontFamily: fontMono }} />
                <YAxis type="category" dataKey="country" tick={{ fill: C.textDim, fontSize: 11, fontFamily: fontInter }} width={80} />
                <Tooltip
                  contentStyle={{ background: C.bgSurface, border: `1px solid ${C.border}`, fontSize: 11, fontFamily: fontMono }}
                  labelStyle={{ color: C.text }}
                  formatter={(v: number) => [fmt(v), 'Impressions']}
                />
                <Bar dataKey="tracked_ads" radius={[0, 2, 2, 0]}>
                  {stats.by_country.slice(0, 10).map((_, i) => (
                    <Cell key={i} fill={i === 0 ? C.accent : 'rgba(78,205,196,0.3)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Region breakdown (France) */}
        {stats && stats.by_region.length > 0 && (
          <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.accent }} />
              Répartition par région (France)
            </div>
            <ResponsiveContainer width="100%" height={Math.max(120, stats.by_region.slice(0, 12).length * 28)}>
              <BarChart data={stats.by_region.slice(0, 12)} layout="vertical" margin={{ left: 120, right: 20, top: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fill: C.textSec, fontSize: 10, fontFamily: fontMono }} />
                <YAxis type="category" dataKey="region" tick={{ fill: C.textDim, fontSize: 11, fontFamily: fontInter }} width={120} />
                <Tooltip
                  contentStyle={{ background: C.bgSurface, border: `1px solid ${C.border}`, fontSize: 11, fontFamily: fontMono }}
                  labelStyle={{ color: C.text }}
                  formatter={(v: number) => [fmt(v), 'Impressions']}
                />
                <Bar dataKey="tracked_ads" radius={[0, 2, 2, 0]}>
                  {stats.by_region.slice(0, 12).map((_, i) => (
                    <Cell key={i} fill={i === 0 ? C.accent : 'rgba(78,205,196,0.3)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Department table */}
      {stats && stats.by_department.length > 0 && (
        <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: 16, marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.accent }} />
            Répartition par département (IRIS matchés)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Département', 'Impressions', 'Lignes', ''].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, color: C.textSec, fontWeight: 400 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.by_department.slice(0, 20).map(d => {
                const maxAds = stats.by_department[0]?.tracked_ads ?? 1;
                return (
                  <tr key={d.code_dept} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '6px 12px', fontFamily: fontMono, fontSize: 12 }}>{d.code_dept}</td>
                    <td style={{ padding: '6px 12px', fontFamily: fontMono, fontSize: 12 }}>{fmt(d.tracked_ads)}</td>
                    <td style={{ padding: '6px 12px', fontFamily: fontMono, fontSize: 11, color: C.textDim }}>{fmt(d.row_count)}</td>
                    <td style={{ padding: '6px 12px', width: '40%' }}>
                      <div style={{ height: 4, background: C.bgSurface, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${(d.tracked_ads / maxAds) * 100}%`, background: C.accent, borderRadius: 2 }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Data table */}
      <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.accent }} />
            Données ({fmt(total)} lignes)
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{ padding: '4px 8px', background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, color: page <= 1 ? C.textSec : C.text, fontSize: 11, fontFamily: fontInter, cursor: page <= 1 ? 'default' : 'pointer' }}
              >
                ←
              </button>
              <span style={{ fontFamily: fontMono, color: C.textDim }}>{page}/{totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{ padding: '4px 8px', background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, color: page >= totalPages ? C.textSec : C.text, fontSize: 11, fontFamily: fontInter, cursor: page >= totalPages ? 'default' : 'pointer' }}
              >
                →
              </button>
            </div>
          )}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {['Date', 'Ville', 'Code postal', 'Région', 'Pays', 'Impressions', 'IRIS'].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, color: C.textSec, fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: '6px 12px', fontFamily: fontMono, fontSize: 11, color: C.textDim }}>{r.date}</td>
                <td style={{ padding: '6px 12px', fontSize: 12 }}>{r.city ?? '—'}</td>
                <td style={{ padding: '6px 12px', fontFamily: fontMono, fontSize: 11 }}>{r.postal_code ?? '—'}</td>
                <td style={{ padding: '6px 12px', fontSize: 11, color: C.textDim }}>{r.region ?? '—'}</td>
                <td style={{ padding: '6px 12px', fontSize: 11 }}>{r.country}</td>
                <td style={{ padding: '6px 12px', fontFamily: fontMono, fontSize: 12 }}>{fmt(r.tracked_ads)}</td>
                <td style={{ padding: '6px 12px', fontFamily: fontMono, fontSize: 10, color: r.code_iris ? C.green : C.textSec }}>{r.code_iris ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete modal */}
      <ConfirmModal
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title="Supprimer la campagne"
        message={`Supprimer "${campaign.name}" et toutes ses données ?`}
        confirmLabel="Supprimer"
        variant="danger"
        loading={isDeleting}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/campaigns/\[id\]/page.tsx
git commit -m "feat: add campaign detail page with charts and data table"
```

---

## Task 10: End-to-End Test with Adform File

- [ ] **Step 1: Run dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify sidebar entry**

Navigate to any page. Confirm "Campagnes DSP" is in the Admin sidebar section.

- [ ] **Step 3: Test empty state**

Navigate to `/admin/campaigns`. Confirm empty state message with CTA.

- [ ] **Step 4: Test import flow**

1. Click "Importer une campagne"
2. Upload an Adform CSV export
3. Select "Adform" as DSP source
4. Click "Importer"
5. Watch progress bar and logs fill
6. Verify "Import terminé" card with stats
7. Click "Voir la campagne" → redirects to detail page

- [ ] **Step 5: Test detail page**

1. Verify campaign metadata header
2. Verify country bar chart renders
3. Verify region bar chart renders (France data)
4. Verify department table with bars
5. Verify data table pagination
6. Verify IRIS matched codes appear in green

- [ ] **Step 6: Test delete**

1. Click "Supprimer" on detail page
2. Confirm in modal
3. Verify redirect to list page
4. Verify campaign is gone

- [ ] **Step 7: Verify database**

```sql
SELECT COUNT(*) FROM dsp_campaign_data;
-- Should be 0 after delete

SELECT COUNT(*) FROM dsp_campaigns;
-- Should be 0 after delete
```

- [ ] **Step 8: Type-check full build**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 9: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address issues found during e2e testing"
```
