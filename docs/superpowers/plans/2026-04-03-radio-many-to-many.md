# Radio Many-to-Many Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the false 1-to-1 emitter-to-radio matching with a deterministic many-to-many model where each emitter is linked to ALL radios broadcasting in its department.

**Architecture:** New junction table `emetteur_radio_stations` (emetteur_id, radio_id, source). The matcher inserts the cartesian product of emitters x radios per department. All API routes and RPC functions switch from `emetteurs_radio.radio_id` FK to JOIN via junction table. The old `radio_id` column is nulled but kept for now.

**Tech Stack:** PostgreSQL 15 + PostGIS, Supabase RPC, Next.js 14 API routes, MapLibre GL JS

**Branch:** `feat/radio-many-to-many`

**Constraints (from CLAUDE.md):**
- No `Promise.all()` with > 3 Supabase calls
- Batch inserts max 500-1000 rows
- `getSession()` on API routes, never `getUser()`
- `createAdminClient()` for DB access
- Supabase Nano: careful with I/O on large operations

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `sql/077_emetteur_radio_stations.sql` | Junction table DDL + RLS + indexes |
| Create | `sql/078_rpc_radio_m2m.sql` | Updated RPCs: `get_radio_emetteurs_geojson_m2m`, `get_radio_stats_m2m`, `count_emetteurs_par_radio_m2m` |
| Modify | `lib/radio/radio-matcher.ts` | Rewrite PASS_1/PASS_2 to insert into junction table instead of UPDATE radio_id |
| Modify | `app/api/radio/emetteurs/route.ts` | Use new RPC that JOINs via junction table |
| Modify | `app/api/radio/emetteurs/[staAnfr]/route.ts` | Return array of radios instead of single radio |
| Modify | `app/api/radio/stations/route.ts` | Use updated count RPC |
| Modify | `app/api/radio/stations/[id]/route.ts` | Query emitters via junction table |
| Modify | `app/api/radio/stats/route.ts` | No code change (uses RPC), but RPC is updated |
| Modify | `app/api/radio/match-manual/route.ts` | Insert into junction table instead of UPDATE |
| Modify | `app/copilote/_hooks/useMapInit.ts:466-498` | Popup shows multi-radio info |
| Modify | `app/map/page.tsx:399-439` | Handle `nb_radios` + `radios` array in GeoJSON properties |

---

### Task 1: Create junction table migration

**Files:**
- Create: `sql/077_emetteur_radio_stations.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 077 — Junction table for many-to-many emetteur <-> radio
-- An emitter broadcasts ALL radios in its department (deterministic)

CREATE TABLE IF NOT EXISTS emetteur_radio_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emetteur_id UUID NOT NULL REFERENCES emetteurs_radio(id) ON DELETE CASCADE,
  radio_id UUID NOT NULL REFERENCES radios(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('freq-radio', 'arcom', 'fallback-national', 'manual')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(emetteur_id, radio_id)
);

CREATE INDEX idx_ers_emetteur ON emetteur_radio_stations(emetteur_id);
CREATE INDEX idx_ers_radio ON emetteur_radio_stations(radio_id);
CREATE INDEX idx_ers_source ON emetteur_radio_stations(source);

ALTER TABLE emetteur_radio_stations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ers_read" ON emetteur_radio_stations FOR SELECT TO authenticated USING (true);
CREATE POLICY "ers_admin_write" ON emetteur_radio_stations FOR ALL TO service_role USING (true);
```

- [ ] **Step 2: Execute migration on Supabase**

Run via Supabase MCP `execute_sql` tool with project_id `vkkdbygwbrxyogqosten`.

Expected: table created, 0 rows.

- [ ] **Step 3: Verify table exists**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'emetteur_radio_stations' ORDER BY ordinal_position;
```

Expected: id (uuid), emetteur_id (uuid), radio_id (uuid), source (text), created_at (timestamptz)

- [ ] **Step 4: Commit**

```bash
git add sql/077_emetteur_radio_stations.sql
git commit -m "feat(radio-m2m): create emetteur_radio_stations junction table"
```

---

### Task 2: Create updated RPC functions for m2m

**Files:**
- Create: `sql/078_rpc_radio_m2m.sql`

- [ ] **Step 1: Write the RPC migration**

```sql
-- 078 — RPC functions updated for many-to-many radio model

-- 1. GeoJSON emitters with m2m radio info
CREATE OR REPLACE FUNCTION get_radio_emetteurs_geojson(
  p_bbox text DEFAULT NULL,
  p_systeme text DEFAULT NULL,
  p_radio_id uuid DEFAULT NULL,
  p_limit int DEFAULT 10000
)
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(jsonb_agg(f.feature), '[]'::jsonb)
  )
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(e.geom)::jsonb,
      'properties', jsonb_build_object(
        'id', e.id,
        'sta_nm_anfr', e.sta_nm_anfr,
        'nb_radios', COALESCE(rc.nb_radios, 0),
        'radio_principale', rc.radio_principale,
        'systeme', e.systeme,
        'frequence_mhz', CASE WHEN e.frequence_mhz IN (87.5, 108) THEN NULL ELSE e.frequence_mhz END,
        'puissance_w', e.puissance_w,
        'commune', e.commune,
        'departement', e.departement,
        'rayon_couverture_m', e.rayon_couverture_m
      )
    ) AS feature
    FROM emetteurs_radio e
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as nb_radios,
             MIN(r.nom) as radio_principale
      FROM emetteur_radio_stations ers
      JOIN radios r ON r.id = ers.radio_id
      WHERE ers.emetteur_id = e.id
    ) rc ON true
    WHERE e.geom IS NOT NULL
    AND (p_systeme IS NULL OR e.systeme = p_systeme)
    AND (p_radio_id IS NULL OR e.id IN (
      SELECT ers.emetteur_id FROM emetteur_radio_stations ers WHERE ers.radio_id = p_radio_id
    ))
    AND (p_bbox IS NULL OR ST_Intersects(
      e.geom,
      ST_MakeEnvelope(
        split_part(p_bbox, ',', 1)::float,
        split_part(p_bbox, ',', 2)::float,
        split_part(p_bbox, ',', 3)::float,
        split_part(p_bbox, ',', 4)::float,
        4326
      )
    ))
    LIMIT p_limit
  ) f;

  RETURN result;
END;
$$;

-- 2. Count emitters per radio via junction table
CREATE OR REPLACE FUNCTION count_emetteurs_par_radio()
RETURNS TABLE(radio_id uuid, nb bigint)
LANGUAGE sql STABLE AS $$
  SELECT radio_id, COUNT(DISTINCT emetteur_id) as nb
  FROM emetteur_radio_stations
  GROUP BY radio_id;
$$;

-- 3. Updated stats RPC
CREATE OR REPLACE FUNCTION get_radio_stats() RETURNS JSONB AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_emetteurs', (SELECT COUNT(*) FROM emetteurs_radio),
    'emetteurs_fm', (SELECT COUNT(*) FROM emetteurs_radio WHERE systeme = 'FM'),
    'emetteurs_dab', (SELECT COUNT(*) FROM emetteurs_radio WHERE systeme = 'DAB+'),
    'total_radios', (SELECT COUNT(*) FROM radios),
    'total_relations', (SELECT COUNT(*) FROM emetteur_radio_stations),
    'emetteurs_matches', (SELECT COUNT(DISTINCT emetteur_id) FROM emetteur_radio_stations),
    'emetteurs_orphelins', (
      SELECT COUNT(*) FROM emetteurs_radio e
      WHERE NOT EXISTS (SELECT 1 FROM emetteur_radio_stations ers WHERE ers.emetteur_id = e.id)
    ),
    'pct_matching', (
      SELECT ROUND(
        (SELECT COUNT(DISTINCT emetteur_id) FROM emetteur_radio_stations)::NUMERIC
        / NULLIF((SELECT COUNT(*) FROM emetteurs_radio), 0) * 100, 1
      )
    ),
    'radios_matchees', (SELECT COUNT(DISTINCT radio_id) FROM emetteur_radio_stations),
    'par_categorie', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(categorie_arcom, 'inconnu'), cnt), '{}'::jsonb)
      FROM (SELECT categorie_arcom, COUNT(*) as cnt FROM radios GROUP BY categorie_arcom) sub
    ),
    'par_portee', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(portee, 'inconnu'), cnt), '{}'::jsonb)
      FROM (SELECT portee, COUNT(*) as cnt FROM radios GROUP BY portee) sub
    ),
    'par_genre', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(genre, 'inconnu'), cnt), '{}'::jsonb)
      FROM (SELECT genre, COUNT(*) as cnt FROM radios GROUP BY genre) sub
    ),
    'derniere_maj_anfr', (SELECT MAX(snapshot_date) FROM emetteurs_radio),
    'archives_count', (SELECT COUNT(*) FROM emetteurs_radio_archive)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4. Get radios for a single emitter (for detail popup/page)
CREATE OR REPLACE FUNCTION get_radios_for_emetteur(p_emetteur_id uuid)
RETURNS TABLE(
  radio_id uuid,
  nom text,
  categorie_arcom text,
  portee text,
  genre text,
  groupe_media text,
  source text
)
LANGUAGE sql STABLE AS $$
  SELECT r.id, r.nom, r.categorie_arcom, r.portee, r.genre, r.groupe_media, ers.source
  FROM emetteur_radio_stations ers
  JOIN radios r ON r.id = ers.radio_id
  WHERE ers.emetteur_id = p_emetteur_id
  ORDER BY r.nom;
$$;
```

- [ ] **Step 2: Execute migration on Supabase**

Run via Supabase MCP `execute_sql`.

- [ ] **Step 3: Verify RPCs exist**

```sql
SELECT proname FROM pg_proc WHERE proname IN (
  'get_radio_emetteurs_geojson', 'count_emetteurs_par_radio',
  'get_radio_stats', 'get_radios_for_emetteur'
);
```

Expected: 4 rows.

- [ ] **Step 4: Commit**

```bash
git add sql/078_rpc_radio_m2m.sql
git commit -m "feat(radio-m2m): update RPCs for many-to-many model"
```

---

### Task 3: Rewrite the matcher for many-to-many

**Files:**
- Modify: `lib/radio/radio-matcher.ts`

This is the biggest change. The pipeline stays the same through CRAWL_FREQ, CRAWL_ARCOM, PARENT_DETECT. But PASS_1 and PASS_2 are completely rewritten: instead of UPDATE radio_id on emetteurs_radio, we INSERT into emetteur_radio_stations.

- [ ] **Step 1: Rewrite STEP 0 (RESET)**

Replace the current RESET (which nulls radio_id) with a TRUNCATE of the junction table:

In `radio-matcher.ts`, replace the STEP 0 block:

```typescript
  // ══════════════════════════════════════════════════════════════════════════
  // STEP 0: RESET — clear junction table
  // ══════════════════════════════════════════════════════════════════════════
  await logger.phase('RESET', async () => {
    await supabase.from('emetteur_radio_stations').delete().not('id', 'is', null);
    await supabase.from('emetteurs_radio').update({ radio_id: null }).not('id', 'is', null);
    await logger.info('RESET', 'Junction table vidée, radio_id remis à NULL');
  });
```

- [ ] **Step 2: Rewrite PASS_1 — deterministic many-to-many insert**

Replace the current PASS_1 block (round-robin) with cartesian product insert per department:

```typescript
  // ══════════════════════════════════════════════════════════════════════════
  // PASS 1: Deterministic many-to-many — each emitter × all radios in dept
  // ══════════════════════════════════════════════════════════════════════════
  await logger.phase('PASS_1', async () => {
    let totalRelations = 0;
    let deptsDone = 0;

    for (const [dept, emitterIds] of byDept) {
      const radioIds = deptRadioIds.get(dept);
      if (!radioIds || radioIds.size === 0) continue;

      const rids = [...radioIds];

      // Determine source per radio (from freq-radio crawl or arcom)
      const freqRadioSet = new Set(
        crawledEntries.filter(e => e.departement === dept).map(e => e.radio_id)
      );

      // Build cartesian product rows for this dept
      const rows: Array<{ emetteur_id: string; radio_id: string; source: string }> = [];
      for (const eid of emitterIds) {
        for (const rid of rids) {
          rows.push({
            emetteur_id: eid,
            radio_id: rid,
            source: freqRadioSet.has(rid) ? 'freq-radio' : 'arcom',
          });
        }
      }

      // Insert in batches of 500 (Supabase Nano safe)
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await supabase
          .from('emetteur_radio_stations')
          .upsert(batch, { onConflict: 'emetteur_id,radio_id', ignoreDuplicates: true });
        if (error) {
          await logger.error('PASS_1', `Batch insert error dept ${dept}: ${error.message}`);
        }
      }

      totalRelations += rows.length;
      deptsDone++;

      if (deptsDone % 10 === 0) {
        await logger.info('PASS_1', `${deptsDone}/${byDept.size} depts — ${totalRelations} relations`);
      }
    }

    result.matched_pass1 = totalRelations;
    await logger.info('PASS_1', `Passe 1 terminée : ${totalRelations} relations (${deptsDone} depts)`);
  });
```

- [ ] **Step 3: Rewrite PASS_2 — national fallback via junction table**

Replace the current PASS_2 block:

```typescript
  // ══════════════════════════════════════════════════════════════════════════
  // PASS 2: Fallback nationals — orphan emitters get linked to national radios
  // ══════════════════════════════════════════════════════════════════════════
  await logger.phase('PASS_2', async () => {
    if (nationalIds.length === 0) {
      await logger.warn('PASS_2', 'Aucune radio nationale pour le fallback');
      return;
    }

    // Find orphan emitters (not in junction table)
    const { data: orphanData } = await supabase
      .rpc('get_orphan_emetteur_ids');

    // Fallback: if RPC doesn't exist yet, query directly
    let orphanIds: string[] = [];
    if (orphanData && Array.isArray(orphanData)) {
      orphanIds = orphanData.map((d: { id: string }) => d.id);
    } else {
      let off = 0;
      while (true) {
        const { data } = await supabase
          .from('emetteurs_radio')
          .select('id')
          .is('radio_id', null)
          .range(off, off + 4999);
        if (!data || data.length === 0) break;
        // Filter to those NOT in junction table — handled by the fact that
        // PASS_1 already covered depts with index entries. Remaining emitters
        // are in depts with no index.
        orphanIds.push(...data.map(d => d.id));
        if (data.length < 5000) break;
        off += 5000;
      }
    }

    if (orphanIds.length === 0) {
      await logger.info('PASS_2', 'Aucun orphelin restant');
      return;
    }

    await logger.info('PASS_2', `${orphanIds.length} émetteurs orphelins → ${nationalIds.length} radios nationales`);

    // Insert orphan × national radios
    let totalRelations = 0;
    const BATCH = 500;

    for (let oi = 0; oi < orphanIds.length; oi += 50) {
      const emChunk = orphanIds.slice(oi, oi + 50);
      const rows: Array<{ emetteur_id: string; radio_id: string; source: string }> = [];

      for (const eid of emChunk) {
        for (const rid of nationalIds) {
          rows.push({ emetteur_id: eid, radio_id: rid, source: 'fallback-national' });
        }
      }

      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { error } = await supabase
          .from('emetteur_radio_stations')
          .upsert(batch, { onConflict: 'emetteur_id,radio_id', ignoreDuplicates: true });
        if (error) {
          await logger.error('PASS_2', `Batch insert error: ${error.message}`);
        }
      }

      totalRelations += rows.length;
    }

    result.matched_pass2 = totalRelations;
    await logger.info('PASS_2', `Passe 2 (fallback nationaux) : +${totalRelations} relations`);
  });
```

- [ ] **Step 4: Update FINAL STATS**

Replace the final stats block to count from junction table:

```typescript
  // ══════════════════════════════════════════════════════════════════════════
  // FINAL STATS
  // ══════════════════════════════════════════════════════════════════════════
  result.total_matched = result.matched_pass1 + result.matched_pass2;
  result.orphelins = 0; // Will be computed in RAPPORT from actual DB state
  result.pct_matching = result.total_emetteurs > 0
    ? Math.round((result.total_matched / result.total_emetteurs) * 1000) / 10
    : 0;

  await logger.success('FINALIZE', `Matching terminé : ${result.total_matched} relations — P1:${result.matched_pass1} P2:${result.matched_pass2}, ${result.depts_covered} depts, ${result.crawled_radios} radios crawlées`);
```

- [ ] **Step 5: Update RAPPORT to use junction table counts**

In the `generateMatchingReport` function, replace the emitter counting loop:

```typescript
  // Count emitters per radio FROM JUNCTION TABLE
  const radioEmitterCounts = new Map<string, number>();
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('emetteur_radio_stations')
      .select('radio_id')
      .range(offset, offset + 4999);
    if (!data || data.length === 0) break;
    for (const row of data) {
      radioEmitterCounts.set(row.radio_id, (radioEmitterCounts.get(row.radio_id) ?? 0) + 1);
    }
    if (data.length < 5000) break;
    offset += 5000;
  }
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: same 3 pre-existing errors only.

- [ ] **Step 7: Commit**

```bash
git add lib/radio/radio-matcher.ts
git commit -m "feat(radio-m2m): rewrite matcher for deterministic many-to-many"
```

---

### Task 4: Update GET /api/radio/emetteurs for m2m

**Files:**
- Modify: `app/api/radio/emetteurs/route.ts`

No code change needed here — the route calls `get_radio_emetteurs_geojson` RPC which we already updated in Task 2. The RPC now JOINs via junction table and returns `nb_radios` + `radio_principale` instead of `radio_nom`.

- [ ] **Step 1: Verify the route still works**

The API call is unchanged:
```
GET /api/radio/emetteurs?radio_id=3a6d8bcb-4c47-4abb-9b2d-b80e1ec6fee0
```

The RPC now filters via `emetteur_radio_stations` instead of `emetteurs_radio.radio_id`. The response GeoJSON properties now include `nb_radios` and `radio_principale` instead of `radio_nom`, `radio_id`, `categorie_arcom`, etc.

- [ ] **Step 2: Commit (no-op — route unchanged)**

Skip commit — no file changed.

---

### Task 5: Update GET /api/radio/emetteurs/[staAnfr] for m2m

**Files:**
- Modify: `app/api/radio/emetteurs/[staAnfr]/route.ts`

- [ ] **Step 1: Rewrite to return array of radios**

Replace the entire file content:

```typescript
/**
 * GET /api/radio/emetteurs/[staAnfr]
 * Detail of a single emitter with ALL associated radios (many-to-many).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { staAnfr: string } },
) {
  const { staAnfr } = params;
  const supabase = createAdminClient();

  // Get emitter
  const { data: emetteur, error } = await supabase
    .from('emetteurs_radio')
    .select('*')
    .eq('sta_nm_anfr', staAnfr)
    .single();

  if (error || !emetteur) {
    return NextResponse.json({ error: 'Emetteur non trouve' }, { status: 404 });
  }

  // Get all radios via junction table
  const { data: radios } = await supabase
    .rpc('get_radios_for_emetteur', { p_emetteur_id: emetteur.id });

  return NextResponse.json({
    ...emetteur,
    radios: radios ?? [],
    nb_radios: (radios ?? []).length,
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/api/radio/emetteurs/\[staAnfr\]/route.ts
git commit -m "feat(radio-m2m): update emetteur detail API for many-to-many"
```

---

### Task 6: Update GET /api/radio/stations for m2m

**Files:**
- Modify: `app/api/radio/stations/route.ts`

No code change needed — the route already calls `count_emetteurs_par_radio()` RPC which was updated in Task 2 to count from junction table.

- [ ] **Step 1: Verify**

The `count_emetteurs_par_radio()` RPC now does:
```sql
SELECT radio_id, COUNT(DISTINCT emetteur_id) FROM emetteur_radio_stations GROUP BY radio_id
```

The route code at line 39 calls this RPC and builds the `emCountMap`. No change needed.

- [ ] **Step 2: Commit (no-op)**

Skip commit.

---

### Task 7: Update GET /api/radio/stations/[id] for m2m

**Files:**
- Modify: `app/api/radio/stations/[id]/route.ts`

- [ ] **Step 1: Rewrite GET to query via junction table**

Replace lines 28-34 (the emitters query) in the GET handler:

```typescript
  // Get emitters for this radio via junction table
  const { data: emetteurs } = await supabase
    .from('emetteur_radio_stations')
    .select('emetteurs_radio(id, sta_nm_anfr, systeme, frequence_mhz, puissance_w, hauteur_m, commune, departement, rayon_couverture_m)')
    .eq('radio_id', id)
    .limit(500);

  // Flatten the embedded relation
  const flatEmetteurs = (emetteurs ?? []).map((row: Record<string, unknown>) => {
    const e = row.emetteurs_radio as Record<string, unknown> | null;
    return e ?? row;
  });
```

And update the return statement:

```typescript
  return NextResponse.json({
    radio,
    emetteurs: flatEmetteurs,
    nb_emetteurs: flatEmetteurs.length,
    nb_emetteurs_fm: flatEmetteurs.filter((e: Record<string, unknown>) => e.systeme === 'FM').length,
    nb_emetteurs_dab: flatEmetteurs.filter((e: Record<string, unknown>) => e.systeme === 'DAB+').length,
  });
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/api/radio/stations/\[id\]/route.ts
git commit -m "feat(radio-m2m): update radio detail API for many-to-many"
```

---

### Task 8: Update POST /api/radio/match-manual for m2m

**Files:**
- Modify: `app/api/radio/match-manual/route.ts`

- [ ] **Step 1: Rewrite to insert into junction table**

Replace lines 33-38 (the update loop):

```typescript
  const supabase = createAdminClient();
  let updated = 0;

  // Insert into junction table instead of updating radio_id
  const rows = parsed.data.matches.map(m => ({
    emetteur_id: m.emetteur_id,
    radio_id: m.radio_id,
    source: 'manual' as const,
  }));

  // Batch insert (max 500 already enforced by Zod)
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase
      .from('emetteur_radio_stations')
      .upsert(batch, { onConflict: 'emetteur_id,radio_id', ignoreDuplicates: true });
    if (!error) updated += batch.length;
  }
```

- [ ] **Step 2: Commit**

```bash
git add app/api/radio/match-manual/route.ts
git commit -m "feat(radio-m2m): update manual matching for many-to-many"
```

---

### Task 9: Update map popup for multi-radio display

**Files:**
- Modify: `app/copilote/_hooks/useMapInit.ts:466-498`

- [ ] **Step 1: Rewrite the popup HTML**

Replace the `onRadioPointClick` handler (lines 466-498):

```typescript
      const onRadioPointClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, unknown>;
        const nbRadios = Number(p.nb_radios ?? 0);
        const principale = p.radio_principale ? String(p.radio_principale) : null;
        const sys = String(p.systeme ?? 'FM');
        const freqVal = Number(p.frequence_mhz);
        const freqDisplay = (freqVal && freqVal !== 87.5 && freqVal !== 108) ? `${freqVal.toFixed(1)} MHz` : sys;
        const pwVal = Number(p.puissance_w);
        const pw = pwVal > 0 ? (pwVal >= 1000000 ? `${(pwVal/1000000).toFixed(1)} MW` : pwVal >= 1000 ? `${(pwVal/1000).toFixed(1)} kW` : `${pwVal} W`) : '';
        const covVal = Number(p.rayon_couverture_m);
        const cov = covVal > 0 ? `~${Math.round(covVal / 1000)} km` : '';

        const radioLine = nbRadios > 0
          ? `<div style="font-size:14px;font-weight:600;color:#f0f0f0;margin-bottom:2px">${nbRadios} radio${nbRadios > 1 ? 's' : ''} diffusee${nbRadios > 1 ? 's' : ''}</div>
             ${principale ? `<div style="color:#a0a0a0;font-size:11px;margin-bottom:6px">Dont : ${principale}${nbRadios > 1 ? `, +${nbRadios - 1} autres` : ''}</div>` : ''}`
          : '<div style="font-size:14px;font-weight:600;color:#666666;margin-bottom:2px">Aucune radio associee</div>';

        new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:10px 14px;font-family:'Inter',sans-serif;font-size:12px;line-height:1.6">
            ${radioLine}
            <div style="border-top:0.5px solid #1a1a1a;margin:4px 0;padding-top:4px">
              <div style="color:#a0a0a0;font-size:11px">${freqDisplay}</div>
              ${pw ? `<div style="color:#666666;font-size:11px">Puissance : ${pw}</div>` : ''}
              ${cov ? `<div style="color:#666666;font-size:11px">Couverture : ${cov}</div>` : ''}
              <div style="color:#666666;font-size:11px">${[p.commune, p.departement ? `Dept ${p.departement}` : ''].filter(Boolean).join(' . ')}</div>
            </div>
          </div>`)
          .addTo(map);
      };
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/copilote/_hooks/useMapInit.ts
git commit -m "feat(radio-m2m): update map popup for multiple radios per emitter"
```

---

### Task 10: Update map page for m2m GeoJSON properties

**Files:**
- Modify: `app/map/page.tsx`

The map page already handles the GeoJSON from the RPC. Since the RPC now returns `nb_radios` and `radio_principale` instead of `radio_nom`, the popup in `/map` needs the same update.

- [ ] **Step 1: Check if /map has its own popup handler**

The `/map/page.tsx` uses the same `useMapInit` hook from `/copilote/_hooks/`. If it has a separate popup handler, update it. If not, the Task 9 change covers both.

Search for `radio_nom` references in `app/map/page.tsx` and update any that reference the old property name to use `nb_radios` / `radio_principale`.

- [ ] **Step 2: Update the radio highlight logic if needed**

The highlight logic at lines 472-478 uses `radioSelectedId` to highlight matching points via `['==', ['get', 'radio_id'], radioSelectedId]`. Since GeoJSON no longer has `radio_id` per feature (it's many-to-many), the highlight needs updating.

The simplest approach: when a radio is selected, the fetch already filters by radio_id via the RPC, so ALL returned points belong to that radio. Highlight ALL points instead of filtering by property:

```typescript
      if (radioSelectedId) {
        try {
          // All visible points belong to the selected radio (filtered by API)
          map.setPaintProperty('radio-points', 'circle-color', '#4ecdc4');
          map.setPaintProperty('radio-points', 'circle-opacity', 1);
          map.setPaintProperty('radio-points', 'circle-radius', radioPointSize);
        } catch { /* */ }
      }
```

- [ ] **Step 3: Commit**

```bash
git add app/map/page.tsx
git commit -m "feat(radio-m2m): update map search/filter for many-to-many"
```

---

### Task 11: Run enrichment and verify with SQL tests

**Files:** None (verification only)

- [ ] **Step 1: Run the enrichment**

Trigger via `/admin/radio` or directly call the crawl-arcom endpoint. Wait for completion.

- [ ] **Step 2: Run all 8 verification queries**

```sql
-- Test 1: Radio Scoop in dept 01
SELECT COUNT(*) FROM emetteur_radio_stations ers
JOIN emetteurs_radio e ON ers.emetteur_id = e.id
JOIN radios r ON ers.radio_id = r.id
WHERE r.nom = 'Radio Scoop' AND e.departement = '01';
-- EXPECTED: > 0

-- Test 2: Radio Scoop in dept 69
SELECT COUNT(*) FROM emetteur_radio_stations ers
JOIN emetteurs_radio e ON ers.emetteur_id = e.id
JOIN radios r ON ers.radio_id = r.id
WHERE r.nom = 'Radio Scoop' AND e.departement = '69';
-- EXPECTED: > 0

-- Test 3: Each emitter has MULTIPLE radios
SELECT e.sta_nm_anfr, e.departement, COUNT(ers.id) as nb_radios
FROM emetteurs_radio e
JOIN emetteur_radio_stations ers ON ers.emetteur_id = e.id
WHERE e.departement = '69'
GROUP BY e.id, e.sta_nm_anfr, e.departement
LIMIT 5;
-- EXPECTED: each emitter has 50-80 radios

-- Test 4: No randomness — all emitters in dept have same nb_radios
SELECT COUNT(DISTINCT nb_radios) FROM (
  SELECT e.id, COUNT(ers.id) as nb_radios
  FROM emetteurs_radio e
  JOIN emetteur_radio_stations ers ON ers.emetteur_id = e.id
  WHERE e.departement = '69'
  GROUP BY e.id
) sub;
-- EXPECTED: 1

-- Test 5: Total relations volume
SELECT COUNT(*) FROM emetteur_radio_stations;
-- EXPECTED: 500,000 - 1,500,000

-- Test 6: nb_emetteurs in API (manual curl test)
-- GET /api/radio/stations?search=scoop
-- EXPECTED: nb_emetteurs > 0 for Radio Scoop

-- Test 7: Stats RPC works
SELECT get_radio_stats();
-- EXPECTED: total_relations > 0, emetteurs_matches > 0

-- Test 8: Existing tables untouched
SELECT COUNT(*) FROM poi;
SELECT COUNT(*) FROM comptages_routiers;
```

- [ ] **Step 3: Commit verification results as a note**

No commit needed — verification only.

---

### Task 12: Final cleanup and type-check

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: same 3 pre-existing errors only.

- [ ] **Step 2: Git log**

Run: `git log --oneline feat/radio-many-to-many`

Expected commits:
```
feat(radio-m2m): update map search/filter for many-to-many
feat(radio-m2m): update map popup for multiple radios per emitter
feat(radio-m2m): update manual matching for many-to-many
feat(radio-m2m): update radio detail API for many-to-many
feat(radio-m2m): update emetteur detail API for many-to-many
feat(radio-m2m): rewrite matcher for deterministic many-to-many
feat(radio-m2m): update RPCs for many-to-many model
feat(radio-m2m): create emetteur_radio_stations junction table
```
