# Carte de dérive (sous-onglet Suivi) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un sous-onglet « Carte de dérive » au Suivi campagne : une vraie carte composée (métropole + Corse + DROM-COM repositionnés) où l'on choisit la maille (National/Région/Département/CP), on lit la dérive (relative/absolue), on règle le seuil de décrochage, on voit le top des zones qui dérivent et on exporte en PNG.

**Architecture :** 2 RPC PostGIS agrègent `campaign_cp_rollup` (grain CP) jusqu'à la maille choisie via les tables `ref_*` (codes DROM corrects 971-976), reprojettent les DROM en insets, et renvoient un score brut + géométrie. Le front (composant `SuiviDeriveMap`) rend une carte MapLibre embarquée + un tableau ; le seuil de décrochage recolore/recompte **côté client** (zéro refetch). Le filtre acteurs du suivi est hérité.

**Tech Stack :** Next.js 14 App Router, TypeScript strict, Supabase PostGIS (RPC SECURITY DEFINER), MapLibre GL JS 5.x, Vitest. MCP Supabase pour appliquer/valider les migrations.

## Global Constraints

- Supabase **Nano** : jamais de full-scan ; agrégations bornées ; CP = bbox + `geom_simplified` ; max 3 requêtes Supabase parallèles ; `EXPLAIN ANALYZE` sur toute nouvelle requête PostGIS.
- RPC : `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO service_role`. **Toute migration via MCP Supabase** (`execute_sql`), jamais de SQL manuel demandé à l'utilisateur ; trace dans `sql/NNN_*.sql`.
- Routes API : `export const dynamic = 'force-dynamic'`, `requireAuth` + `checkCampaignAccess`, réponses `Cache-Control: no-store`, `createAdminClient()` depuis `@/lib/auth`.
- Design system : `var(--token)` uniquement (aucun hex nu), sentence case, flat (pas de glow/gradient/blur/violet), accent teal `--brand-teal`, Inter + JetBrains Mono.
- `?actors=` parsé par `parseActorsParam` (existant, `lib/campaigns/actor-metrics.ts`) : vide ⇒ `null` (tous), jamais `[]`.
- Projet Supabase : `vkkdbygwbrxyogqosten`. Campagne démo de vérif : `dccc0000-0000-4000-8000-000000000002`.
- Gzip obligatoire sur MVT (non concerné ici — on renvoie du GeoJSON JSON standard).

## Rappels de données (vérifiés en base le 2026-07-24)

- `campaign_cp_rollup(campaign_id, postal_code, dept, impressions, clicks, spend, imps_7d, imps_prev7d, in_target, planned_share, actor)` — grain (CP × acteur). `dept` y est le `LEFT(cp,2)` hérité (⚠ collapse DROM en « 97 » — on ne l'utilise PAS pour la maille dépt).
- `ref_codes_postaux(code_postal, nom_principal, code_dept, geom, geom_simplified, centroid, …)`.
- `ref_departements(code_dept, code_region, geom, nom_dept, centroid_lat, centroid_lon)`.
- `ref_regions(code_region, nom_region, geom, centroid_lat, centroid_lon)`.
- Mailles : **Département** = grouper par `ref_codes_postaux.code_dept` (→ vrais 971-976), géométrie `ref_departements.geom`. **Région** = via `ref_departements.code_region`, géométrie `ref_regions.geom`. **CP** = `ref_codes_postaux.geom_simplified`.
- DROM centroïdes réels (lon,lat, SRID 4326) : 971 (-61.5,16.2), 972 (-61.0,14.7), 973 (-53.2,3.9), 974 (55.5,-21.1), 976 (45.1,-12.8). Corse 2A/2B ≈ (9,42) — aucune reprojection.
- Score (mêmes définitions que `get_campaign_suivi_map`) : **relatif (hold)** = `(imps_maille/total_imps)/part_planifiée_maille × 100` ; **absolu (objectif)** = `imps_maille/(part_planifiée_maille × expected_global) × 100`, avec `expected_global = public.get_campaign_expected(campaign)`.

---

## Task 1 : RPC `get_campaign_derive_map` (maille + score + géométrie + insets DROM)

**Files:**
- Create/trace: `sql/117_campaign_derive_map.sql`
- Applied via: MCP `execute_sql` (projet `vkkdbygwbrxyogqosten`)

**Interfaces:**
- Consumes: `campaign_cp_rollup`, `ref_codes_postaux`, `ref_departements`, `ref_regions`, `public.get_campaign_expected(uuid)`.
- Produces: `public.get_campaign_derive_map(p_campaign_id uuid, p_mesh text DEFAULT 'departement', p_metric text DEFAULT 'hold', p_actors text[] DEFAULT NULL, p_bbox_xmin float8 DEFAULT -12, p_bbox_ymin float8 DEFAULT 40, p_bbox_xmax float8 DEFAULT 10, p_bbox_ymax float8 DEFAULT 52) RETURNS json` — FeatureCollection-like `json_agg` de `{code, nom, in_target, value, geometry}`. `value` = score brut (numeric, arrondi 0), `null` si non calculable. DROM (code_dept `^97`) reprojetés en insets.

- [ ] **Step 1 : Écrire la fonction et l'appliquer via MCP.** `execute_sql` avec ce corps (trace identique dans `sql/117`):

```sql
CREATE OR REPLACE FUNCTION public.get_campaign_derive_map(
  p_campaign_id uuid, p_mesh text DEFAULT 'departement', p_metric text DEFAULT 'hold',
  p_actors text[] DEFAULT NULL,
  p_bbox_xmin float8 DEFAULT -12, p_bbox_ymin float8 DEFAULT 40,
  p_bbox_xmax float8 DEFAULT 10, p_bbox_ymax float8 DEFAULT 52)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_expected numeric := public.get_campaign_expected(p_campaign_id);
  v_total    numeric;
  v_result   json;
BEGIN
  -- Total livré (filtré acteur) — dénominateur du score relatif.
  SELECT COALESCE(SUM(impressions), 0) INTO v_total
  FROM campaign_cp_rollup
  WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors));

  -- 1) Agrégat par CP (filtré acteur) + rattachement dépt/région via ref.
  WITH cp AS (
    SELECT r.postal_code, rcp.code_dept, d.code_region,
           BOOL_OR(r.in_target) AS in_target,
           MAX(r.planned_share) AS planned_share,
           COALESCE(SUM(r.impressions) FILTER (WHERE p_actors IS NULL OR r.actor = ANY(p_actors)), 0) AS imps
    FROM campaign_cp_rollup r
    JOIN ref_codes_postaux rcp ON rcp.code_postal = r.postal_code
    LEFT JOIN ref_departements d ON d.code_dept = rcp.code_dept
    WHERE r.campaign_id = p_campaign_id
    GROUP BY r.postal_code, rcp.code_dept, d.code_region
  ),
  -- 2) Regroupement à la maille : (code, nom, in_target, planned_share sommé, imps sommées).
  mesh AS (
    SELECT code, nom, BOOL_OR(in_target) AS in_target,
           SUM(planned_share) AS planned_share, SUM(imps) AS imps
    FROM (
      SELECT CASE p_mesh
               WHEN 'cp' THEN cp.postal_code
               WHEN 'region' THEN cp.code_region
               ELSE cp.code_dept END AS code,
             cp.postal_code, cp.in_target, cp.planned_share, cp.imps
      FROM cp
    ) x
    JOIN LATERAL (SELECT x.code) k(code) ON true
    LEFT JOIN LATERAL (
      SELECT CASE p_mesh
        WHEN 'cp' THEN (SELECT nom_principal FROM ref_codes_postaux WHERE code_postal = x.code)
        WHEN 'region' THEN (SELECT nom_region FROM ref_regions WHERE code_region = x.code)
        ELSE (SELECT nom_dept FROM ref_departements WHERE code_dept = x.code) END AS nom
    ) n ON true
    GROUP BY code, nom
  ),
  -- 3) Géométrie de la maille + reprojection DROM en insets.
  geo AS (
    SELECT m.code, m.nom, m.in_target,
           CASE
             WHEN p_metric = 'objectif' THEN
               CASE WHEN m.in_target AND m.planned_share > 0 AND v_expected > 0
                    THEN ROUND(m.imps / (m.planned_share * v_expected) * 100) END
             ELSE
               CASE WHEN m.planned_share > 0 AND v_total > 0
                    THEN ROUND((m.imps / v_total) / m.planned_share * 100) END
           END AS value,
           CASE p_mesh
             WHEN 'cp' THEN (SELECT geom_simplified FROM ref_codes_postaux WHERE code_postal = m.code)
             WHEN 'region' THEN (SELECT geom FROM ref_regions WHERE code_region = m.code)
             ELSE (SELECT geom FROM ref_departements WHERE code_dept = m.code)
           END AS g,
           (p_mesh <> 'region' AND left(m.code, 2) = '97') AS is_drom_dept,
           (p_mesh = 'region' AND m.code IN ('01','02','03','04','06')) AS is_drom_region
    FROM mesh m
  ),
  -- 4) Insets DROM : ST_Translate(ST_Scale(geom, s, s), tx, ty). Métropole/Corse = identité.
  --    Slots (tx,ty,s) précalculés depuis les centroïdes réels (dépt ; région = même famille).
  reproj AS (
    SELECT g.code, g.nom, g.in_target, g.value,
      CASE
        WHEN g.is_drom_dept OR g.is_drom_region THEN
          (SELECT ST_Translate(ST_Scale(g.g, s, s), tx, ty)
           FROM (VALUES
             ('971','01', 1.2, 64.8, 30.56),
             ('972','02', 1.3, 70.3, 29.19),
             ('973','03', 0.35, 9.62, 44.94),
             ('974','04', 1.3, -81.15, 71.73),
             ('976','06', 2.5, -121.75, 74.6)
           ) v(dept, region, s, tx, ty)
           WHERE (p_mesh = 'region' AND v.region = g.code) OR (p_mesh <> 'region' AND v.dept = g.code)
           LIMIT 1)
        ELSE g.g
      END AS g
    FROM geo g
  )
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_result
  FROM (
    SELECT code, nom, in_target, value, ST_AsGeoJSON(g)::json AS geometry
    FROM reproj
    WHERE g IS NOT NULL
      AND g && ST_MakeEnvelope(p_bbox_xmin, p_bbox_ymin, p_bbox_xmax, p_bbox_ymax, 4326)
  ) t;

  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.get_campaign_derive_map(uuid, text, text, text[], float8, float8, float8, float8) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_derive_map(uuid, text, text, text[], float8, float8, float8, float8) TO service_role;
```

- [ ] **Step 2 : Vérifier en base (EXPLAIN + valeurs) — la maille, le fix DROM, le score.** Run via MCP :

```sql
-- Département : DROM éclatés (971-976, pas de « 97 »), ~100 zones, scores plausibles
SELECT count(*) AS n, count(*) FILTER (WHERE (f->>'code') ~ '^97') AS drom,
       min((f->>'value')::numeric) AS vmin, max((f->>'value')::numeric) AS vmax
FROM json_array_elements(public.get_campaign_derive_map(
  'dccc0000-0000-4000-8000-000000000002'::uuid, 'departement', 'hold', NULL)) f;
```
Expected : `n` ≈ 100, `drom` = 4, `vmin` bas (Marseille/Lille ~52), `vmax` ~1xx, **aucun code « 97 »** (seulement 971-976).

- [ ] **Step 3 : Vérifier région + CP + non-régression acteur.** Run :

```sql
SELECT 'region' lvl, count(*) FROM json_array_elements(public.get_campaign_derive_map('dccc0000-0000-4000-8000-000000000002'::uuid,'region','hold',NULL)) f
UNION ALL SELECT 'cp', count(*) FROM json_array_elements(public.get_campaign_derive_map('dccc0000-0000-4000-8000-000000000002'::uuid,'cp','hold',NULL)) f
UNION ALL SELECT 'cp_tiktok', count(*) FROM json_array_elements(public.get_campaign_derive_map('dccc0000-0000-4000-8000-000000000002'::uuid,'cp','hold',ARRAY['tiktok'])) f;
```
Expected : `region` ≈ 17, `cp` ≈ 2000, `cp_tiktok` ≈ 2000 (mêmes CP, valeurs recalculées). Confirmer via `EXPLAIN ANALYZE` que la requête dépt reste < 300 ms.

- [ ] **Step 4 : Sauvegarder la trace `sql/117_campaign_derive_map.sql`** (en-tête daté + corps identique + note « appliquée le 2026-07-24 via MCP »).

- [ ] **Step 5 : Commit.**

```bash
git add sql/117_campaign_derive_map.sql
git commit -m "feat(derive): RPC get_campaign_derive_map (maille + score + insets DROM)"
```

---

## Task 2 : RPC `get_campaign_derive_ranked` + headline national

**Files:**
- Create/trace: `sql/118_campaign_derive_ranked.sql`
- Applied via: MCP `execute_sql`

**Interfaces:**
- Consumes: mêmes tables/logique que Task 1.
- Produces:
  - `public.get_campaign_derive_ranked(p_campaign_id uuid, p_mesh text DEFAULT 'departement', p_metric text DEFAULT 'hold', p_actors text[] DEFAULT NULL, p_limit int DEFAULT 50) RETURNS jsonb` — `jsonb_agg` trié `value` croissant NULLS LAST (pire d'abord) de `{code, nom, in_target, value, impressions}`. CP borné à `p_limit`.
  - `public.get_campaign_derive_headline(p_campaign_id uuid, p_metric text DEFAULT 'hold', p_actors text[] DEFAULT NULL) RETURNS numeric` — score national global (relatif ⇒ 100 par construction si tout est livré ; absolu ⇒ `total_imps/expected*100`).

- [ ] **Step 1 : Écrire + appliquer via MCP** (corps ci-dessous, réutilise la logique CP→maille de Task 1 ; `sql/118` trace identique) :

```sql
CREATE OR REPLACE FUNCTION public.get_campaign_derive_ranked(
  p_campaign_id uuid, p_mesh text DEFAULT 'departement', p_metric text DEFAULT 'hold',
  p_actors text[] DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_expected numeric := public.get_campaign_expected(p_campaign_id);
  v_total numeric; v_out jsonb;
BEGIN
  SELECT COALESCE(SUM(impressions),0) INTO v_total FROM campaign_cp_rollup
  WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors));

  WITH cp AS (
    SELECT r.postal_code, rcp.code_dept, d.code_region,
           BOOL_OR(r.in_target) AS in_target, MAX(r.planned_share) AS planned_share,
           COALESCE(SUM(r.impressions) FILTER (WHERE p_actors IS NULL OR r.actor = ANY(p_actors)),0) AS imps
    FROM campaign_cp_rollup r
    JOIN ref_codes_postaux rcp ON rcp.code_postal = r.postal_code
    LEFT JOIN ref_departements d ON d.code_dept = rcp.code_dept
    WHERE r.campaign_id = p_campaign_id
    GROUP BY r.postal_code, rcp.code_dept, d.code_region
  ),
  mesh AS (
    SELECT CASE p_mesh WHEN 'cp' THEN postal_code WHEN 'region' THEN code_region ELSE code_dept END AS code,
           BOOL_OR(in_target) AS in_target, SUM(planned_share) AS planned_share, SUM(imps) AS imps
    FROM cp GROUP BY 1
  ),
  scored AS (
    SELECT code, in_target, imps,
      CASE WHEN p_metric='objectif'
           THEN CASE WHEN in_target AND planned_share>0 AND v_expected>0 THEN ROUND(imps/(planned_share*v_expected)*100) END
           ELSE CASE WHEN planned_share>0 AND v_total>0 THEN ROUND((imps/v_total)/planned_share*100) END END AS value
    FROM mesh
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.value ASC NULLS LAST), '[]'::jsonb) INTO v_out
  FROM (
    SELECT s.code,
           CASE p_mesh WHEN 'cp' THEN (SELECT nom_principal FROM ref_codes_postaux WHERE code_postal=s.code)
                       WHEN 'region' THEN (SELECT nom_region FROM ref_regions WHERE code_region=s.code)
                       ELSE (SELECT nom_dept FROM ref_departements WHERE code_dept=s.code) END AS nom,
           s.in_target, s.value, s.imps AS impressions
    FROM scored s
    ORDER BY s.value ASC NULLS LAST
    LIMIT CASE WHEN p_mesh='cp' THEN p_limit ELSE 200 END
  ) t;
  RETURN v_out;
END; $$;
REVOKE ALL ON FUNCTION public.get_campaign_derive_ranked(uuid,text,text,text[],int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_derive_ranked(uuid,text,text,text[],int) TO service_role;

CREATE OR REPLACE FUNCTION public.get_campaign_derive_headline(
  p_campaign_id uuid, p_metric text DEFAULT 'hold', p_actors text[] DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_expected numeric := public.get_campaign_expected(p_campaign_id); v_total numeric;
BEGIN
  SELECT COALESCE(SUM(impressions),0) INTO v_total FROM campaign_cp_rollup
  WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors));
  IF p_metric='objectif' THEN
    RETURN CASE WHEN v_expected>0 THEN ROUND(v_total/v_expected*100) END;
  ELSE
    RETURN 100;  -- relatif : le national tient sa part par définition
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.get_campaign_derive_headline(uuid,text,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_derive_headline(uuid,text,text[]) TO service_role;
```

- [ ] **Step 2 : Vérifier en base.** Run :

```sql
SELECT jsonb_array_length(public.get_campaign_derive_ranked('dccc0000-0000-4000-8000-000000000002'::uuid,'cp','hold',NULL,50)) AS cp_top,
       (public.get_campaign_derive_ranked('dccc0000-0000-4000-8000-000000000002'::uuid,'departement','hold',NULL) -> 0 ->> 'nom') AS pire_dept,
       public.get_campaign_derive_headline('dccc0000-0000-4000-8000-000000000002'::uuid,'objectif',NULL) AS head_abs,
       public.get_campaign_derive_headline('dccc0000-0000-4000-8000-000000000002'::uuid,'hold',NULL) AS head_rel;
```
Expected : `cp_top` = 50 ; `pire_dept` = un dépt sous-livré (Marseille/Lille) ; `head_abs` ≈ 80 ; `head_rel` = 100.

- [ ] **Step 3 : Trace `sql/118_campaign_derive_ranked.sql` + Step 4 : Commit.**

```bash
git add sql/118_campaign_derive_ranked.sql
git commit -m "feat(derive): RPC get_campaign_derive_ranked + headline national"
```

---

## Task 3 : Helpers TS `lib/campaigns/derive-metrics.ts` (types + seuil + palette) — TDD

**Files:**
- Create: `lib/campaigns/derive-metrics.ts`
- Test: `tests/unit/campaigns/derive-metrics.test.ts`

**Interfaces:**
- Produces:
  - `type DeriveMesh = 'national' | 'region' | 'departement' | 'cp'`
  - `type DeriveMetric = 'hold' | 'objectif'`
  - `interface DeriveFeature { code: string; nom: string | null; in_target: boolean; value: number | null; geometry: GeoJSON.Geometry }`
  - `interface DeriveRow { code: string; nom: string | null; in_target: boolean; value: number | null; impressions: number }`
  - `function decrocheTone(value: number | null, threshold: number): 'bad' | 'warn' | 'ok' | 'over'` — `null`→`'warn'` ; `< threshold`→`'bad'` ; `threshold..100`→`'warn'` ; `100..110`→`'ok'` ; `>110`→`'over'`.
  - `function countDecroche(rows: { value: number | null }[], threshold: number): number` — nombre de `value != null && value < threshold`.
  - `function meshLabel(m: DeriveMesh): string` et `function nextMesh/prevMesh` (ordre national→cp).
  - Ré-export `parseActorsParam, actorsKey` depuis `actor-metrics` (DRY, pas de duplication).

- [ ] **Step 1 : Écrire le test (RED).** `tests/unit/campaigns/derive-metrics.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { decrocheTone, countDecroche, meshLabel } from '@/lib/campaigns/derive-metrics';

describe('derive-metrics', () => {
  it('decrocheTone : seuil pilote la frontière rouge', () => {
    expect(decrocheTone(52, 80)).toBe('bad');   // sous le seuil
    expect(decrocheTone(85, 80)).toBe('warn');  // entre seuil et 100
    expect(decrocheTone(100, 80)).toBe('ok');
    expect(decrocheTone(130, 80)).toBe('over');
    expect(decrocheTone(85, 90)).toBe('bad');   // même valeur, seuil plus haut => décroche
    expect(decrocheTone(null, 80)).toBe('warn');
  });
  it('countDecroche : compte les zones sous le seuil (null ignoré)', () => {
    expect(countDecroche([{ value: 52 }, { value: 85 }, { value: null }, { value: 40 }], 80)).toBe(2);
  });
  it('meshLabel : sentence case', () => {
    expect(meshLabel('cp')).toBe('CP');
    expect(meshLabel('departement')).toBe('Département');
  });
});
```

- [ ] **Step 2 : Run (FAIL).** `npx vitest run tests/unit/campaigns/derive-metrics.test.ts` → FAIL (module introuvable).

- [ ] **Step 3 : Écrire l'implémentation.** `lib/campaigns/derive-metrics.ts` :

```ts
/**
 * Carte de dérive — types du payload des RPC get_campaign_derive_* (sql/117-118)
 * et helpers purs (ton par seuil de décrochage, décompte, libellés de maille).
 * Aucune dépendance React (testable Vitest).
 */
export { parseActorsParam, actorsKey } from './actor-metrics';

export type DeriveMesh = 'national' | 'region' | 'departement' | 'cp';
export type DeriveMetric = 'hold' | 'objectif';
export type DeriveTone = 'bad' | 'warn' | 'ok' | 'over';

export interface DeriveFeature {
  code: string; nom: string | null; in_target: boolean;
  value: number | null; geometry: GeoJSON.Geometry;
}
export interface DeriveRow {
  code: string; nom: string | null; in_target: boolean;
  value: number | null; impressions: number;
}

const MESHES: DeriveMesh[] = ['national', 'region', 'departement', 'cp'];

/** Ton divergent : le seuil déplace la frontière « décroche » (rouge). */
export function decrocheTone(value: number | null, threshold: number): DeriveTone {
  if (value == null) return 'warn';
  if (value < threshold) return 'bad';
  if (value <= 100) return 'warn';
  if (value <= 110) return 'ok';
  return 'over';
}

export function countDecroche(rows: { value: number | null }[], threshold: number): number {
  return rows.filter((r) => r.value != null && r.value < threshold).length;
}

export function meshLabel(m: DeriveMesh): string {
  return m === 'national' ? 'National' : m === 'region' ? 'Région'
    : m === 'departement' ? 'Département' : 'CP';
}
export function nextMesh(m: DeriveMesh): DeriveMesh { return MESHES[Math.min(MESHES.length - 1, MESHES.indexOf(m) + 1)]; }
export function prevMesh(m: DeriveMesh): DeriveMesh { return MESHES[Math.max(0, MESHES.indexOf(m) - 1)]; }
export const MESH_ORDER = MESHES;
```

- [ ] **Step 4 : Run (GREEN).** `npx vitest run tests/unit/campaigns/derive-metrics.test.ts` → PASS. Puis `npx tsc --noEmit` → 0.

- [ ] **Step 5 : Commit.**

```bash
git add lib/campaigns/derive-metrics.ts tests/unit/campaigns/derive-metrics.test.ts
git commit -m "feat(derive): helpers TS (types, ton par seuil, mailles) + tests"
```

---

## Task 4 : Routes API `derive/map` et `derive/ranked`

**Files:**
- Create: `app/api/digital/[campaignId]/derive/map/route.ts`
- Create: `app/api/digital/[campaignId]/derive/ranked/route.ts`

**Interfaces:**
- Consumes: RPC Task 1/2, `parseActorsParam` (Task 3 ré-export), `requireAuth`, `checkCampaignAccess`.
- Produces: `GET …/derive/map?mesh=&metric=&bbox=&actors=` → `{ mesh, metric, headline, features }` ; `GET …/derive/ranked?mesh=&metric=&actors=&limit=` → `{ rows }`.

- [ ] **Step 1 : Écrire `derive/map/route.ts`** (modèle : `suivi/map/route.ts`) :

```ts
/**
 * GET /api/digital/[campaignId]/derive/map?mesh=departement|region|cp&metric=hold|objectif&bbox=…&actors=…
 * — features de la carte de dérive à la maille choisie (RPC get_campaign_derive_map)
 * + score national de tête (get_campaign_derive_headline). Lecture rollups uniquement.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { parseActorsParam } from '@/lib/campaigns/derive-metrics';

export const dynamic = 'force-dynamic';

const FRANCE_BBOX = [-12, 40, 10, 52] as const;
const QuerySchema = z.object({
  mesh: z.enum(['region', 'departement', 'cp']).default('departement'),
  metric: z.enum(['hold', 'objectif']).default('hold'),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  const sp = request.nextUrl.searchParams;
  const bboxRaw = (sp.get('bbox') ?? FRANCE_BBOX.join(',')).split(',').map(Number);
  const parsed = QuerySchema.safeParse({ mesh: sp.get('mesh') ?? 'departement', metric: sp.get('metric') ?? 'hold', bbox: bboxRaw });
  if (!parsed.success || parsed.data.bbox.some((v) => !Number.isFinite(v))) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }
  const { mesh, metric, bbox } = parsed.data;
  const pActors = parseActorsParam(sp);

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const [mapRes, headRes] = await Promise.all([
    supabase.rpc('get_campaign_derive_map', {
      p_campaign_id: campaignId, p_mesh: mesh, p_metric: metric, p_actors: pActors,
      p_bbox_xmin: bbox[0], p_bbox_ymin: bbox[1], p_bbox_xmax: bbox[2], p_bbox_ymax: bbox[3],
    }),
    supabase.rpc('get_campaign_derive_headline', { p_campaign_id: campaignId, p_metric: metric, p_actors: pActors }),
  ]);
  if (mapRes.error) return NextResponse.json({ error: mapRes.error.message }, { status: 500 });

  return NextResponse.json(
    { mesh, metric, headline: headRes.data ?? null, features: mapRes.data ?? [] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
```

- [ ] **Step 2 : Écrire `derive/ranked/route.ts`** :

```ts
/**
 * GET /api/digital/[campaignId]/derive/ranked?mesh=&metric=&actors=&limit=
 * — zones qui dérivent à la maille, pire d'abord (RPC get_campaign_derive_ranked).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { parseActorsParam } from '@/lib/campaigns/derive-metrics';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  const sp = request.nextUrl.searchParams;
  const mesh = (['region', 'departement', 'cp'].includes(sp.get('mesh') ?? '') ? sp.get('mesh') : 'departement') as string;
  const metric = (sp.get('metric') === 'objectif' ? 'objectif' : 'hold');
  const limit = Math.min(200, Math.max(1, Number(sp.get('limit')) || 50));
  const pActors = parseActorsParam(sp);

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const { data, error } = await supabase.rpc('get_campaign_derive_ranked', {
    p_campaign_id: campaignId, p_mesh: mesh, p_metric: metric, p_actors: pActors, p_limit: limit,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}
```

- [ ] **Step 3 : `npx tsc --noEmit` → 0.** Puis vérif runtime rapide (dev server) :
`curl -s "http://localhost:3000/api/digital/dccc0000-0000-4000-8000-000000000002/derive/map?mesh=departement" -H "cookie:<session>"` → 200 avec `features` non vide. (Ou vérif navigateur en Task 9.)

- [ ] **Step 4 : Commit.**

```bash
git add "app/api/digital/[campaignId]/derive"
git commit -m "feat(derive): routes API map + ranked (requireAuth, no-store, actors)"
```

---

## Task 5 : Composant `MeshSelector` (le sélecteur « Grain »)

**Files:**
- Create: `components/campaign/suivi/MeshSelector.tsx`

**Interfaces:**
- Consumes: `DeriveMesh`, `meshLabel` (Task 3).
- Produces: `export function MeshSelector({ mesh, onChange }: { mesh: DeriveMesh; onChange: (m: DeriveMesh) => void })` — piste segmentée National/Région/Département/CP, indicateur teal glissant, sentence case, tokens du design system.

- [ ] **Step 1 : Écrire le composant** (reprend l'interaction validée en brainstorm `.superpowers/brainstorm/606-*/content/grain-france-v3.html`, adaptée en React + tokens `var(--…)`) :

```tsx
'use client';
/**
 * MeshSelector — le sélecteur signature « Grain » de la carte de dérive.
 * Piste segmentée National → Région → Département → CP ; curseur teal glissant.
 * Flat + teal (design system), sentence case, aucune couleur en dur.
 */
import { MESH_ORDER, meshLabel, type DeriveMesh } from '@/lib/campaigns/derive-metrics';

const fInter = "'Inter', system-ui, sans-serif";

export function MeshSelector({ mesh, onChange }: { mesh: DeriveMesh; onChange: (m: DeriveMesh) => void }) {
  const idx = MESH_ORDER.indexOf(mesh);
  return (
    <div style={{
      display: 'flex', position: 'relative', background: 'var(--bg-level-2)',
      border: '0.5px solid var(--border-subtle)', borderRadius: 10, padding: 4, gap: 2, width: '100%',
    }}>
      <div aria-hidden style={{
        position: 'absolute', top: 4, bottom: 4, left: 4, width: `calc(${100 / MESH_ORDER.length}% - 4px)`,
        background: 'var(--brand-teal)', borderRadius: 7, zIndex: 1,
        transform: `translateX(${idx * 100}%)`, transition: 'transform 0.38s cubic-bezier(0.34,1.35,0.5,1)',
      }} />
      {MESH_ORDER.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          style={{
            flex: 1, position: 'relative', zIndex: 2, background: 'transparent', border: 'none',
            padding: '9px 4px', borderRadius: 7, cursor: 'pointer', fontFamily: fInter, fontSize: 12.5,
            fontWeight: m === mesh ? 600 : 400,
            color: m === mesh ? 'var(--bg-primary)' : 'var(--text-tertiary)', transition: 'color 0.25s',
          }}
        >
          {meshLabel(m)}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2 : `npx tsc --noEmit` → 0. Commit.**

```bash
git add components/campaign/suivi/MeshSelector.tsx
git commit -m "feat(derive): MeshSelector (selecteur de maille Grain)"
```

---

## Task 6 : Composant `SuiviDeriveMap` (carte MapLibre embarquée + seuil + score)

**Files:**
- Create: `components/campaign/suivi/SuiviDeriveMap.tsx`
- Test: vérif navigateur (Task 9)

**Interfaces:**
- Consumes: routes Task 4, `MeshSelector` (Task 5), helpers Task 3, filtre acteurs (props `actors: string[]`).
- Produces: `export function SuiviDeriveMap({ campaignId, actors }: { campaignId: string; actors: string[] })` — carte de dérive complète (carte + sélecteurs + seuil + compteur). Expose la ref carte pour le tableau (Task 7) via un state levé ou un contexte simple.

- [ ] **Step 1 : Écrire le composant.** Points OBLIGATOIRES (le reste suit le modèle `app/map/_components/SuiviMapLayer.tsx` — le lire d'abord) :
  - `new maplibregl.Map({ container, style: { version: 8, sources: {}, layers: [{ id:'bg', type:'background', paint:{ 'background-color': readCss('--bg-primary') } }] }, center:[2,47], zoom:4.4, attributionControl:false, preserveDrawingBuffer: true })` — **`preserveDrawingBuffer: true`** (export PNG), fond plein sombre (pas de tuiles externes → export net, zéro I/O tuiles).
  - State : `mesh` (`'departement'` par défaut), `metric` (`'hold'`), `threshold` (80), `features`, `headline`.
  - Fetch débouncé (300 ms) `GET /derive/map?mesh=&metric=&actors=` **caché par** `campaignId|mesh|metric|actorsKey(actors)` dans un `useRef(Map)` (pattern `suiviCacheRef`) ; `AbortController` sur changement.
  - Source GeoJSON `derive-src` + layer `fill` dont `fill-color` = expression divergente **paramétrée par le seuil** (recalculée quand `threshold` change, **sans refetch**) :

```ts
function fillExpr(threshold: number): maplibregl.ExpressionSpecification {
  const c = readTones(); // { bad, warn, ok, teal } depuis les tokens (cf. SuiviMapLayer.readToneColors)
  const V: maplibregl.ExpressionSpecification = ['coalesce', ['get', 'value'], -1];
  return ['case',
    ['<', V, 0], 'rgba(0,0,0,0)',            // pas de valeur
    ['<', V, threshold], c.bad,               // décroche
    ['<=', V, 100], c.warn,
    ['<=', V, 110], c.ok,
    c.teal];
}
// setPaintProperty('derive-fill','fill-color', fillExpr(threshold)) à chaque changement de seuil
```
  - Sous **filtre acteur partiel** (`actors.length > 0`) : désactiver l'option « Atteinte absolue » (réutiliser la logique `hiddenUnderPartialActors` — ici simple : si `actors.length>0 && metric==='objectif'` forcer `metric='hold'`).
  - Compteur « N zones décrochent » = `countDecroche(features, threshold)` (recalcul client au seuil).
  - Contrôles rendus : `<MeshSelector>`, toggle `[Dérive relative | Atteinte absolue]`, curseur seuil (`<input type=range min=50 max=100>` stylé tokens), compteur, légende (réutiliser le rendu légende de SuiviMapLayer).
  - `fitBounds` sur l'enveloppe des features au premier chargement d'une maille.

- [ ] **Step 2 : `npx tsc --noEmit` → 0. Commit.**

```bash
git add components/campaign/suivi/SuiviDeriveMap.tsx
git commit -m "feat(derive): SuiviDeriveMap (carte MapLibre + maille + score + seuil client)"
```

---

## Task 7 : Tableau `DeriveTable` (zones qui dérivent) + export PNG

**Files:**
- Create: `components/campaign/suivi/DeriveTable.tsx`
- Modify: `components/campaign/suivi/SuiviDeriveMap.tsx` (intégrer le tableau + bouton export)

**Interfaces:**
- Consumes: `GET /derive/ranked`, helpers Task 3, la ref carte de Task 6.
- Produces: `export function DeriveTable({ campaignId, mesh, metric, actors, threshold, onRowClick }: { … onRowClick: (code: string) => void })` — liste triée pire d'abord (badge ton par seuil, mini-barre), clic ligne → `onRowClick(code)`.

- [ ] **Step 1 : Écrire `DeriveTable`.** Fetch `GET /derive/ranked?mesh=&metric=&actors=` (caché par `campaignId|mesh|metric|actorsKey`), colonnes `Zone · Livré · Score` avec `<Badge>` coloré par `decrocheTone(value, threshold)` (recolore au seuil sans refetch), mini-barre proportionnelle à `value`. `onClick` ligne → `onRowClick(row.code)`. Tokens du design system, sentence case.

- [ ] **Step 2 : Intégrer dans `SuiviDeriveMap`** : rendre `<DeriveTable … onRowClick={flyToCode}>` à droite/dessous la carte ; `flyToCode(code)` = `map.fitBounds` sur la feature `code` + surbrillance (setFeatureState ou un layer de contour teal).

- [ ] **Step 3 : Bouton « Exporter en PNG ».** Dans `SuiviDeriveMap` :

```ts
function exportPng() {
  const map = mapRef.current; if (!map) return;
  map.once('render', () => {
    const url = map.getCanvas().toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = `derive-${mesh}-${new Date().toISOString().slice(0,10)}.png`;
    a.click();
  });
  map.triggerRepaint();
}
```
Bouton outline teal « Exporter en PNG » (tokens). Note : `preserveDrawingBuffer:true` est requis (posé en Task 6).

- [ ] **Step 4 : `npx tsc --noEmit` → 0. Commit.**

```bash
git add components/campaign/suivi/DeriveTable.tsx components/campaign/suivi/SuiviDeriveMap.tsx
git commit -m "feat(derive): DeriveTable (top zones) + sync clic + export PNG"
```

---

## Task 8 : Sous-onglets dans `CampaignSuivi`

**Files:**
- Modify: `components/campaign/CampaignSuivi.tsx`

**Interfaces:**
- Consumes: `SuiviDeriveMap` (Task 6), l'état `selectedActors` existant.
- Produces: barre de sous-onglets « Vue d'ensemble » / « Carte de dérive » dans la colonne bilan du Suivi.

- [ ] **Step 1 : Ajouter l'état + la barre.** Dans `CampaignSuivi`, ajouter `const [subTab, setSubTab] = useState<'overview'|'derive'>('overview');`. Dans le bloc `strategyId && suivi ? (…)`, insérer AVANT `ActorFilter` une barre d'onglets (2 boutons, style Tabs du design system : actif = `color var(--text-primary)` + `border-bottom 2px solid var(--brand-teal)`, inactif = `var(--text-tertiary)`), puis :
  - `subTab === 'overview'` → le contenu actuel (ActorFilter, SuiviCockpit, ActorPanel, ReconciliationPanel, SuiviCharts, SuiviTable) **inchangé**.
  - `subTab === 'derive'` → `<SuiviDeriveMap campaignId={campaignId} actors={selectedActors} />` (le `ActorFilter` reste au-dessus des deux, partagé, pour que le filtre acteurs s'applique aussi à la carte de dérive).

- [ ] **Step 2 : `npx tsc --noEmit` → 0.** `npx vitest run tests/unit/campaigns/` → tous verts (non-régression).

- [ ] **Step 3 : Commit.**

```bash
git add components/campaign/CampaignSuivi.tsx
git commit -m "feat(derive): sous-onglet Carte de derive dans le Suivi"
```

---

## Task 9 : Vérification navigateur bout-en-bout

**Files:** aucune (vérif). Serveur dev unique (`npm run dev`, jamais `build` en //).

- [ ] **Step 1 : Login** `admin@geoprompt.com` / `G3oPrompt_Admin#2026`, aller sur `http://localhost:3000/map?campaign=dccc0000-0000-4000-8000-000000000002&tab=suivi`.
- [ ] **Step 2 : Sous-onglet** « Carte de dérive » présent ; clic → carte composée visible (France + Corse + **insets DROM** à gauche, colorés).
- [ ] **Step 3 : Sélecteur Grain** — Département par défaut ; cliquer Région / CP change la choroplèthe (le grain se densifie) ; National affiche le chiffre de tête. Marseille/Lille en rouge au niveau dépt.
- [ ] **Step 4 : Seuil** — bouger le curseur recolore la carte + le tableau + le compteur « N zones décrochent » **instantanément, sans requête réseau** (vérifier l'onglet Réseau : aucun appel au drag).
- [ ] **Step 5 : Score** — bascule Dérive relative / Atteinte absolue change les couleurs ; en filtre acteur partiel (TikTok), « Atteinte absolue » désactivée.
- [ ] **Step 6 : Tableau** — pire d'abord ; clic sur une ligne → la carte vole/surbrille la zone.
- [ ] **Step 7 : Export PNG** — le bouton télécharge une image de la carte.
- [ ] **Step 8 : Console** — 0 erreur (warns Recharts bénins ignorés). Screenshot baseline + DROM + export.
- [ ] **Step 9 : Rapport** de vérif + `npx tsc --noEmit` (0) + suite `tests/unit/campaigns/` (verte).

---

## Self-review (auteur)

- **Couverture spec** : sous-onglet (T8) · carte composée + DROM insets (T1 reproj, T6 rendu) · sélecteur Grain (T5) · score relatif/absolu (T1/T2 metric, T6 toggle) · seuil client (T3 helpers, T6 recolor, T9 vérif réseau) · tableau top zones (T2/T7) · export PNG (T7) · fix 97x→971-976 (T1/T2 via `ref_codes_postaux.code_dept`) · filtre acteurs hérité (routes T4, T6/T7). National = KPI de tête (T2 headline, T6). V1.1 (palettes/filtres) explicitement hors périmètre.
- **Placeholders** : aucun — code SQL/TS/routes complet ; UI T6 renvoie au modèle `SuiviMapLayer` avec les snippets critiques (init `preserveDrawingBuffer`, `fillExpr(threshold)`, export PNG) fournis en entier.
- **Cohérence des types** : `DeriveMesh/DeriveMetric/DeriveFeature/DeriveRow` définis T3, consommés T4/T6/T7 ; noms RPC (`get_campaign_derive_map/_ranked/_headline`) et params identiques entre T1/T2 et les routes T4 ; `parseActorsParam/actorsKey` ré-exportés T3 et utilisés T4/T6/T7 ; `decrocheTone/countDecroche` T3 utilisés T6/T7.
```
