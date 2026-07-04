# Pacing plan-vs-réel géographique + rebid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Figer l'intention poussée au DSP (snapshot versionné), la comparer à la délivrance réelle de l'ad server par item de zone, et produire un rebid correctif — pour campagnes digitales.

**Architecture:** La campagne est le pivot. Au push (génération de l'export DSP), un endpoint fige un snapshot CP-level du plan (`campaign_plan_snapshot`, réutilise la RPC d'expansion item→CP `get_zone_items_export`). Deux RPC bornées joignent le snapshot à `dsp_campaign_data` au code postal et agrègent le réel par item ; la logique pure `lib/pacing/compute.ts` calcule parts/écart/statut, `lib/pacing/rebid.ts` les poids corrigés. Un onglet « Plan vs réel » dans le panneau d'analyse digitale affiche le diagnostic et déclenche l'export corrigé.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, Supabase (PostgreSQL 15 + PostGIS, compute Nano), Zod, Vitest.

**Spec source :** `docs/superpowers/specs/2026-07-04-pacing-plan-vs-reel-design.md`.

## Global Constraints

- **Supabase Nano** : RPC bornées à la campagne + version, jamais de full scan ; `EXPLAIN ANALYZE` obligatoire sur toute nouvelle RPC (viser index scan) ; max 3 appels Supabase parallèles ; batch insert par 50 (`lib/import/inserter.ts`).
- **Migrations** : appliquées via MCP Supabase (`apply_migration`), définition versionnée dans `sql/` (règle anti-dérive DB↔repo). Prochain numéro : `sql/096`.
- **Pas de couleur hex en dur** dans le code UI — tokens `var(--…)`. Statuts via une constante `PACING_STATUS_META` (patron `STATUS_META` de `lib/campaigns/status.ts`).
- **TypeScript strict**, imports absolus `@/`, types dans `types/` ou colocalisés dans le fichier de logique pure.
- **Routes API** : `export const dynamic = 'force-dynamic'`, validation Zod sur les bodies, `createAdminClient()` de `@/lib/auth`, auth via `requireAuth`/`authUnauthorized` de `@/lib/api/middleware`.
- **Normalisation des parts = intra-zone** (fidèle à l'export, une requête par zone). `expected_share` et `actual_share` ∈ [0,1] au sein de la zone.
- **Métrique du réel** : `p_metric_field` dérivé du `dsp_source` de la campagne (`adform` → `tracked_ads`, sinon `impressions`), pour se réconcilier avec le panneau d'analyse.
- **Identité item** : `item_id = \`${zone_id}:${poi_id}\`` (aligné sur les clés `weights` du panneau et le filtre `r.id.startsWith(\`${zone_id}:\`)` de l'export).
- **Constantes tunables** : `PACING_TOLERANCE_PTS = 5`, `REBID_CAP = 0.5`, `REBID_EPSILON = 0.001`.
- Commits atomiques `type: description`, terminés par `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Migration — table `campaign_plan_snapshot` + RPC pacing

**Files:**
- Create: `sql/096_campaign_plan_snapshot.sql`
- Appliquée via MCP Supabase (`apply_migration`, name `campaign_plan_snapshot`).

**Interfaces:**
- Consumes: tables existantes `dsp_campaigns`, `dsp_campaign_data` (colonnes `campaign_id`, `postal_code`, `impressions`, `unique_impressions`, `tracked_ads`, `spend`).
- Produces:
  - Table `public.campaign_plan_snapshot` (colonnes ci-dessous).
  - RPC `get_campaign_pacing(p_campaign_id uuid, p_metric_field text, p_version int DEFAULT NULL) RETURNS jsonb` → `{ version, items:[{zone_id, zone_name, item_id, item_name, item_weight, expected_share, actual_imp, actual_spend, cp_count}], in_plan_imp, total_imp, spillover:{imp, spend} }`.

> **Hors scope de ce plan** : le drill-down au code postal (spec §UI « drill CP ») est un raffinement différé — non requis par la boucle diagnostic+rebid. On ne crée donc pas de RPC `get_campaign_pacing_cp` tant qu'aucune UI ne la consomme (YAGNI).

- [ ] **Step 1: Écrire le fichier de migration**

Créer `sql/096_campaign_plan_snapshot.sql` avec ce contenu exact :

```sql
-- ============================================================
-- 096 — Pacing plan-vs-réel : snapshot du plan poussé + RPC pacing
-- ============================================================
-- Appliquée le 2026-07-04 via MCP Supabase.
--
-- campaign_plan_snapshot fige, au moment du push (génération export DSP),
-- l'intention par item de zone, expansée en codes postaux. expected_share est
-- normalisé INTRA-ZONE (fidèle à l'export, une requête par zone). Une ligne par
-- (snapshot, item, code postal). Versionné : un push = une version.
--
-- get_campaign_pacing joint le snapshot à dsp_campaign_data au code postal,
-- borné à la campagne + version → index scan (jamais de full scan, contrainte Nano).

CREATE TABLE IF NOT EXISTS public.campaign_plan_snapshot (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid NOT NULL,
  version        int  NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  dsp            text,
  budget         numeric,
  cpm            numeric,
  cible          text,
  zone_id        text NOT NULL,
  zone_name      text,
  item_id        text NOT NULL,
  item_name      text,
  item_weight    numeric NOT NULL,
  expected_share numeric NOT NULL,
  postal_code    text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_snapshot_campaign_version
  ON public.campaign_plan_snapshot (campaign_id, version);
CREATE INDEX IF NOT EXISTS idx_plan_snapshot_join
  ON public.campaign_plan_snapshot (campaign_id, version, postal_code);

ALTER TABLE public.campaign_plan_snapshot ENABLE ROW LEVEL SECURITY;

-- Lecture scopée org (miroir de dsp_campaign_data via la campagne), écriture service-role.
DROP POLICY IF EXISTS plan_snapshot_read ON public.campaign_plan_snapshot;
CREATE POLICY plan_snapshot_read ON public.campaign_plan_snapshot
  FOR SELECT USING (
    campaign_id IN (
      SELECT id FROM public.dsp_campaigns
      WHERE organization_id = public.get_user_org(auth.uid())
    )
    OR public.get_user_org(auth.uid()) IS NULL  -- super_admin sans org
  );

-- get_campaign_pacing : agrégation par item + spillover, bornée campagne+version.
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
    RETURN NULL;  -- aucun snapshot
  END IF;

  -- Réel par code postal de la campagne (métrique dynamique bornée à des colonnes connues)
  WITH real_cp AS (
    SELECT d.postal_code,
           SUM(CASE p_metric_field
                 WHEN 'tracked_ads' THEN d.tracked_ads
                 WHEN 'unique_impressions' THEN d.unique_impressions
                 ELSE d.impressions END)::numeric AS imp,
           SUM(COALESCE(d.spend, 0))::numeric AS spend
    FROM public.dsp_campaign_data d
    WHERE d.campaign_id = p_campaign_id
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

  -- Totaux campagne (pour le spillover hors-plan)
  SELECT
    COALESCE(SUM(CASE p_metric_field
                   WHEN 'tracked_ads' THEN d.tracked_ads
                   WHEN 'unique_impressions' THEN d.unique_impressions
                   ELSE d.impressions END), 0)::numeric,
    COALESCE(SUM(COALESCE(d.spend, 0)), 0)::numeric
  INTO v_total_imp, v_total_spend
  FROM public.dsp_campaign_data d
  WHERE d.campaign_id = p_campaign_id;

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

- [ ] **Step 2: Appliquer la migration via MCP**

Appeler `mcp__..._Supabase__apply_migration` (project `vkkdbygwbrxyogqosten`, name `campaign_plan_snapshot`) avec le corps SQL du Step 1 (sans les commentaires d'en-tête si besoin). Vérifier `{"success":true}`.

- [ ] **Step 3: Vérifier la structure + un EXPLAIN borné**

Via `execute_sql` :
```sql
-- structure
SELECT column_name FROM information_schema.columns WHERE table_name = 'campaign_plan_snapshot';
-- la RPC ne plante pas sur une campagne sans snapshot (retourne NULL)
SELECT public.get_campaign_pacing(
  (SELECT id FROM dsp_campaigns LIMIT 1), 'impressions', NULL);
```
Attendu : 15 colonnes ; second appel → `null` (aucun snapshot encore). Pas d'erreur.

- [ ] **Step 4: Commit**

```bash
git add sql/096_campaign_plan_snapshot.sql
git commit -m "feat(sql): pacing — table campaign_plan_snapshot + RPC get_campaign_pacing(_cp)"
```

---

### Task 2: Logique pure `lib/pacing/compute.ts` (parts, écart, statut)

**Files:**
- Create: `lib/pacing/compute.ts`
- Test: `tests/unit/pacing/compute.test.ts`

**Interfaces:**
- Consumes: rien (pur).
- Produces:
  - `type PacingStatus = 'sur_servi' | 'conforme' | 'sous_servi' | 'en_attente'`
  - `const PACING_TOLERANCE_PTS = 5`
  - `interface PacingItemInput { zone_id; zone_name; item_id; item_name; item_weight; expected_share; actual_imp; actual_spend; cp_count }`
  - `interface PacingItem extends PacingItemInput { actual_share; delta_pts; status }`
  - `function computePacing(items: PacingItemInput[]): PacingItem[]`
  - `const PACING_STATUS_META: Record<PacingStatus, { label: string; colorVar: string }>`

- [ ] **Step 1: Écrire les tests**

Créer `tests/unit/pacing/compute.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { computePacing, PACING_TOLERANCE_PTS, type PacingItemInput } from '@/lib/pacing/compute';

const base = (over: Partial<PacingItemInput>): PacingItemInput => ({
  zone_id: 'z1', zone_name: 'Zone 1', item_id: 'z1:a', item_name: 'A',
  item_weight: 50, expected_share: 0.5, actual_imp: 0, actual_spend: 0, cp_count: 3, ...over,
});

describe('computePacing', () => {
  it('calcule actual_share intra-zone et delta_pts', () => {
    const out = computePacing([
      base({ item_id: 'z1:a', expected_share: 0.5, actual_imp: 700 }),
      base({ item_id: 'z1:b', expected_share: 0.5, actual_imp: 300 }),
    ]);
    const a = out.find(i => i.item_id === 'z1:a')!;
    expect(a.actual_share).toBeCloseTo(0.7, 5);
    expect(a.delta_pts).toBeCloseTo(20, 5); // 70% - 50%
    expect(a.status).toBe('sur_servi');
    const b = out.find(i => i.item_id === 'z1:b')!;
    expect(b.status).toBe('sous_servi');
  });

  it('classe conforme dans la tolérance', () => {
    const out = computePacing([
      base({ item_id: 'z1:a', expected_share: 0.5, actual_imp: 520 }),
      base({ item_id: 'z1:b', expected_share: 0.5, actual_imp: 480 }),
    ]);
    expect(out.find(i => i.item_id === 'z1:a')!.status).toBe('conforme'); // +2 pts < 5
  });

  it('normalise par zone, pas globalement', () => {
    const out = computePacing([
      base({ zone_id: 'z1', item_id: 'z1:a', expected_share: 1, actual_imp: 100 }),
      base({ zone_id: 'z2', zone_name: 'Zone 2', item_id: 'z2:a', expected_share: 1, actual_imp: 900 }),
    ]);
    // chaque zone a un seul item → actual_share = 1 dans sa zone, delta 0
    expect(out.every(i => i.actual_share === 1 && i.delta_pts === 0 && i.status === 'conforme')).toBe(true);
  });

  it('zone sans délivrance → en_attente, pas sous_servi', () => {
    const out = computePacing([
      base({ item_id: 'z1:a', expected_share: 0.5, actual_imp: 0 }),
      base({ item_id: 'z1:b', expected_share: 0.5, actual_imp: 0 }),
    ]);
    expect(out.every(i => i.status === 'en_attente' && i.actual_share === 0)).toBe(true);
  });

  it('expose la tolérance = 5 pts', () => {
    expect(PACING_TOLERANCE_PTS).toBe(5);
  });
});
```

- [ ] **Step 2: Lancer les tests (échec attendu)**

Run: `npx vitest run tests/unit/pacing/compute.test.ts`
Expected: FAIL (`Cannot find module '@/lib/pacing/compute'`).

- [ ] **Step 3: Écrire l'implémentation**

Créer `lib/pacing/compute.ts` :

```ts
/**
 * Pacing plan-vs-réel — logique pure (zéro I/O, testable).
 * Compare la part planifiée (figée au push) à la part réelle délivrée, PAR ITEM,
 * normalisée INTRA-ZONE. delta_pts = (part réelle − part planifiée) × 100.
 */

export type PacingStatus = 'sur_servi' | 'conforme' | 'sous_servi' | 'en_attente';

/** Seuil (points) au-delà duquel un item est sur/sous-servi vs son plan. */
export const PACING_TOLERANCE_PTS = 5;

export interface PacingItemInput {
  zone_id: string;
  zone_name: string;
  item_id: string;
  item_name: string;
  item_weight: number;
  expected_share: number; // [0,1], intra-zone (figé)
  actual_imp: number;
  actual_spend: number;
  cp_count: number;
}

export interface PacingItem extends PacingItemInput {
  actual_share: number; // [0,1], intra-zone
  delta_pts: number;
  status: PacingStatus;
}

function classify(deltaPts: number, tol: number): PacingStatus {
  if (deltaPts > tol) return 'sur_servi';
  if (deltaPts < -tol) return 'sous_servi';
  return 'conforme';
}

export function computePacing(
  items: PacingItemInput[],
  tol: number = PACING_TOLERANCE_PTS,
): PacingItem[] {
  // Total réel par zone (dénominateur des parts intra-zone)
  const zoneTotal = new Map<string, number>();
  for (const it of items) {
    zoneTotal.set(it.zone_id, (zoneTotal.get(it.zone_id) ?? 0) + it.actual_imp);
  }
  return items.map((it) => {
    const total = zoneTotal.get(it.zone_id) ?? 0;
    if (total <= 0) {
      return { ...it, actual_share: 0, delta_pts: -it.expected_share * 100, status: 'en_attente' };
    }
    const actual_share = it.actual_imp / total;
    const delta_pts = (actual_share - it.expected_share) * 100;
    return { ...it, actual_share, delta_pts, status: classify(delta_pts, tol) };
  });
}

/** Libellé + couleur (token design system) par statut. */
export const PACING_STATUS_META: Record<PacingStatus, { label: string; colorVar: string }> = {
  sur_servi:  { label: 'Sur-servi',      colorVar: 'var(--warning)' },
  conforme:   { label: 'Conforme',       colorVar: 'var(--brand-teal)' },
  sous_servi: { label: 'Sous-servi',     colorVar: 'var(--danger)' },
  en_attente: { label: 'En attente',     colorVar: 'var(--text-tertiary)' },
};
```

- [ ] **Step 4: Lancer les tests (succès attendu)**

Run: `npx vitest run tests/unit/pacing/compute.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pacing/compute.ts tests/unit/pacing/compute.test.ts
git commit -m "feat(pacing): logique pure parts/écart/statut intra-zone (TDD)"
```

---

### Task 3: Endpoint snapshot `POST /api/custom-geo/media-plan/snapshot`

**Files:**
- Create: `app/api/custom-geo/media-plan/snapshot/route.ts`

**Interfaces:**
- Consumes: RPC `get_zone_items_export(p_zone_id uuid, p_caller_user_id uuid)` → `{ items:[{poi_id, poi_name, lat, lng, radius_km, cps: string[]}] } | null` ; table `campaign_plan_snapshot` (Task 1).
- Produces: `POST` body `{ campaign_id: uuid, dsp: 'dv360'|'tiktok', budget:number|null, cpm:number|null, cible:string, zones:[{ zone_id, zone_name, items:[{ item_id, item_name, weight }] }] }` → `{ ok:true, version:number, rows_inserted:number }`.

- [ ] **Step 1: Écrire la route**

Créer `app/api/custom-geo/media-plan/snapshot/route.ts` :

```ts
/**
 * POST /api/custom-geo/media-plan/snapshot
 * Fige un snapshot versionné du plan poussé au DSP : par item (zone_id:poi_id),
 * expansé en codes postaux via get_zone_items_export, expected_share normalisé
 * INTRA-ZONE. Appelé par ZoneMediaPlanPanel au moment de la génération de l'export.
 * Scope org : membre de l'org de la campagne, ou super_admin sans org.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { CIBLE_KEYS } from '@/lib/custom-geo/cibles';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  campaign_id: z.string().uuid(),
  dsp: z.enum(['dv360', 'tiktok']),
  budget: z.number().nonnegative().nullable(),
  cpm: z.number().nonnegative().nullable(),
  cible: z.enum(CIBLE_KEYS as [string, ...string[]]),
  zones: z.array(z.object({
    zone_id: z.string(),
    zone_name: z.string(),
    items: z.array(z.object({
      item_id: z.string(),
      item_name: z.string(),
      weight: z.number().min(0).max(100),
    })).min(1),
  })).min(1).max(50),
});

interface ZoneExportItem { poi_id: string; poi_name: string; lat: number; lng: number; radius_km: number; cps: string[]; }

function scopeGuard(profile: { role: string; organization_id: string | null }, campaignOrgId: string | null): boolean {
  if (profile.role === 'super_admin' && !profile.organization_id) return true;
  return !!profile.organization_id && campaignOrgId === profile.organization_id;
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const { campaign_id, dsp, budget, cpm, cible, zones } = parsed.data;

  const supabase = createAdminClient();

  // Scope org
  const { data: campaign, error: fetchErr } = await supabase
    .from('dsp_campaigns').select('id, organization_id').eq('id', campaign_id).single();
  if (fetchErr || !campaign) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!scopeGuard(profile, campaign.organization_id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Version suivante (max+1). Rare concurrence → contrainte d'unicité logique côté lecture.
  const { data: versRows } = await supabase
    .from('campaign_plan_snapshot').select('version')
    .eq('campaign_id', campaign_id).order('version', { ascending: false }).limit(1);
  const version = ((versRows?.[0]?.version as number | undefined) ?? 0) + 1;

  // Expansion item→CP par zone (≤3 en parallèle : contrainte Nano). On traite les zones par lots de 3.
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < zones.length; i += 3) {
    const batch = zones.slice(i, i + 3);
    const expanded = await Promise.all(batch.map(async (z) => {
      const { data } = await supabase.rpc('get_zone_items_export', {
        p_zone_id: z.zone_id, p_caller_user_id: profile.id,
      }) as { data: { items: ZoneExportItem[] } | null };
      return { z, items: data?.items ?? [] };
    }));

    for (const { z, items } of expanded) {
      const totalWeight = z.items.reduce((s, it) => s + it.weight, 0) || 1;
      const cpsByPoi = new Map(items.map((it) => [it.poi_id, it.cps]));
      for (const planItem of z.items) {
        const poiId = planItem.item_id.slice(z.zone_id.length + 1); // "zone:poi" → "poi"
        const cps = cpsByPoi.get(poiId) ?? [];
        if (cps.length === 0) continue; // item non poussable → non figé
        const expected_share = planItem.weight / totalWeight; // normalisation INTRA-ZONE
        for (const cp of cps) {
          rows.push({
            campaign_id, version, created_by: profile.id, dsp, budget, cpm, cible,
            zone_id: z.zone_id, zone_name: z.zone_name,
            item_id: planItem.item_id, item_name: planItem.item_name,
            item_weight: planItem.weight, expected_share, postal_code: cp,
          });
        }
      }
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'no_expandable_items' }, { status: 422 });
  }

  // Insert par lots de 50 (pattern lib/import/inserter.ts)
  for (let i = 0; i < rows.length; i += 50) {
    const { error: insErr } = await supabase.from('campaign_plan_snapshot').insert(rows.slice(i, i + 50));
    if (insErr) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, version, rows_inserted: rows.length });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add "app/api/custom-geo/media-plan/snapshot/route.ts"
git commit -m "feat(pacing): endpoint snapshot du plan poussé (expansion item→CP, versionné)"
```

---

### Task 4: Accroche client — snapshot au moment de l'export

**Files:**
- Modify: `app/map/_components/ZoneMediaPlanPanel.tsx` (fonction `exportWeighted`, lignes ~257-282)

**Interfaces:**
- Consumes: `POST /api/custom-geo/media-plan/snapshot` (Task 3), état `campaignId`, `zones`, `rows`, `activeRepartition`, `budgetNum`, `cpmNum`, `cible`.
- Produces: rien (effet de bord : fige un snapshot en plus des téléchargements).

- [ ] **Step 1: Modifier `exportWeighted`**

Dans `app/map/_components/ZoneMediaPlanPanel.tsx`, remplacer le corps de `exportWeighted` (lignes ~257-282) par la version ci-dessous — **la boucle de téléchargement existante est inchangée**, on ajoute l'appel snapshot après, gardé par `campaignId` :

```ts
  const exportWeighted = useCallback(async (format: 'bidding_script' | 'tiktok_geo') => {
    setExportState({ running: true, error: null });
    try {
      // Un fichier par zone affichée ; les items de la zone portent les poids
      // du tableau (bruts, non renormalisés — les scores DSP sont relatifs)
      for (const z of zones) {
        const itemRows = rows.filter(r => r.id.startsWith(`${z.id}:`));
        if (itemRows.length) {
          const weights: Record<string, number> = {};
          for (const r of itemRows) {
            weights[r.id.slice(z.id.length + 1)] = Math.round((activeRepartition[r.id] ?? 0) * 10) / 10;
          }
          const params: Record<string, string> = { weights: JSON.stringify(weights) };
          if (format === 'tiktok_geo' && budgetNum > 0) params.budget = String(budgetNum);
          await downloadZoneExport(z.id, format, params);
        } else {
          // Zone non décomposable : export classique non pondéré
          await downloadZoneExport(z.id, format);
        }
      }

      // Fige le snapshot du plan poussé (pacing plan-vs-réel), une fois pour tout le plan.
      if (campaignId) {
        const snapZones = zones.map(z => ({
          zone_id: z.id,
          zone_name: z.name,
          items: rows
            .filter(r => r.id.startsWith(`${z.id}:`))
            .map(r => ({
              item_id: r.id,
              item_name: r.name,
              weight: Math.round((activeRepartition[r.id] ?? 0) * 10) / 10,
            })),
        })).filter(z => z.items.length > 0);
        if (snapZones.length) {
          await adminFetch('/api/custom-geo/media-plan/snapshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              campaign_id: campaignId,
              dsp: format === 'tiktok_geo' ? 'tiktok' : 'dv360',
              budget: Number.isFinite(budgetNum) && budgetNum > 0 ? budgetNum : null,
              cpm: Number.isFinite(cpmNum) && cpmNum > 0 ? cpmNum : null,
              cible,
              zones: snapZones,
            }),
          }).catch(() => { /* le téléchargement a réussi ; le snapshot est best-effort */ });
        }
      }

      setExportState({ running: false, error: null });
    } catch (err) {
      setExportState({ running: false, error: err instanceof Error ? err.message : 'Erreur export' });
    }
  }, [zones, rows, activeRepartition, budgetNum, cpmNum, cible, campaignId]);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add "app/map/_components/ZoneMediaPlanPanel.tsx"
git commit -m "feat(pacing): fige le snapshot du plan à la génération de l'export DSP"
```

---

### Task 5: Route pacing `GET /api/digital/[campaignId]/pacing`

**Files:**
- Create: `app/api/digital/[campaignId]/pacing/route.ts`

**Interfaces:**
- Consumes: RPC `get_campaign_pacing` (Task 1), `computePacing` + types (Task 2).
- Produces: `GET ?version=<int>` → `{ version, items: PacingItem[], in_plan_imp, total_imp, spillover:{imp,spend} } | { empty: true }`.

- [ ] **Step 1: Écrire la route**

Créer `app/api/digital/[campaignId]/pacing/route.ts` :

```ts
/**
 * GET /api/digital/[campaignId]/pacing?version=<int>
 * Diagnostic plan-vs-réel par item (parts intra-zone, écart, statut) + spillover.
 * Métrique du réel = tracked_ads pour Adform, sinon impressions (réconciliation panneau).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { computePacing, type PacingItemInput } from '@/lib/pacing/compute';

export const dynamic = 'force-dynamic';

interface PacingRpc {
  version: number;
  items: PacingItemInput[];
  in_plan_imp: number;
  total_imp: number;
  spillover: { imp: number; spend: number };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;
  const { searchParams } = new URL(request.url);
  const versionParam = searchParams.get('version');
  const version = versionParam ? parseInt(versionParam, 10) : null;

  const supabase = createAdminClient();

  // Métrique alignée sur le panneau d'analyse
  const { data: camp } = await supabase
    .from('dsp_campaigns').select('dsp_source').eq('id', campaignId).single();
  const metricField = camp?.dsp_source === 'adform' ? 'tracked_ads' : 'impressions';

  const { data, error } = await supabase.rpc('get_campaign_pacing', {
    p_campaign_id: campaignId,
    p_metric_field: metricField,
    p_version: version,
  });
  if (error) {
    console.error('[digital/pacing]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rpc = (typeof data === 'string' ? JSON.parse(data) : data) as PacingRpc | null;
  if (!rpc) {
    return NextResponse.json({ empty: true }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const items = computePacing(rpc.items ?? []);
  return NextResponse.json(
    { version: rpc.version, items, in_plan_imp: rpc.in_plan_imp, total_imp: rpc.total_imp, spillover: rpc.spillover },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
```

- [ ] **Step 2: Type-check + EXPLAIN ANALYZE de la RPC (Nano)**

Run: `npx tsc --noEmit` (attendu : 0 erreur).

Puis, via `execute_sql`, vérifier que la RPC est bornée (pas de seq scan sur `campaign_plan_snapshot`) — sur une campagne ayant un snapshot, sinon accepter l'absence de données :
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.get_campaign_pacing(
  (SELECT campaign_id FROM campaign_plan_snapshot LIMIT 1), 'impressions', NULL);
```
Attendu : les accès à `campaign_plan_snapshot` passent par `idx_plan_snapshot_join` / `idx_plan_snapshot_campaign_version` (Index Scan), pas de Seq Scan sur cette table. (Si aucun snapshot n'existe encore, noter que l'EXPLAIN est à refaire après la première utilisation réelle — ne pas bloquer la tâche là-dessus.)

- [ ] **Step 3: Commit**

```bash
git add "app/api/digital/[campaignId]/pacing/route.ts"
git commit -m "feat(pacing): route GET pacing (RPC + calcul parts/statut, métrique réconciliée)"
```

---

### Task 6: Logique pure `lib/pacing/rebid.ts` (poids corrigés)

**Files:**
- Create: `lib/pacing/rebid.ts`
- Test: `tests/unit/pacing/rebid.test.ts`

**Interfaces:**
- Consumes: rien (pur).
- Produces:
  - `const REBID_CAP = 0.5`, `const REBID_EPSILON = 0.001`
  - `interface RebidItemInput { zone_id; item_id; item_weight; expected_share; actual_share }`
  - `interface RebidItem { zone_id; item_id; old_weight; new_weight }`
  - `function computeRebidWeights(items: RebidItemInput[]): RebidItem[]`

- [ ] **Step 1: Écrire les tests**

Créer `tests/unit/pacing/rebid.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { computeRebidWeights, REBID_CAP, type RebidItemInput } from '@/lib/pacing/rebid';

const it_ = (over: Partial<RebidItemInput>): RebidItemInput => ({
  zone_id: 'z1', item_id: 'z1:a', item_weight: 50, expected_share: 0.5, actual_share: 0.5, ...over,
});

describe('computeRebidWeights', () => {
  it('renforce le sous-servi, réduit le sur-servi, renormalise à 100 par zone', () => {
    const out = computeRebidWeights([
      it_({ item_id: 'z1:a', item_weight: 50, expected_share: 0.5, actual_share: 0.7 }), // sur-servi
      it_({ item_id: 'z1:b', item_weight: 50, expected_share: 0.5, actual_share: 0.3 }), // sous-servi
    ]);
    const a = out.find(i => i.item_id === 'z1:a')!;
    const b = out.find(i => i.item_id === 'z1:b')!;
    expect(b.new_weight).toBeGreaterThan(a.new_weight);
    expect(a.new_weight + b.new_weight).toBeCloseTo(100, 3);
  });

  it('plafonne la correction à REBID_CAP', () => {
    const [only] = computeRebidWeights([
      it_({ item_id: 'z1:a', item_weight: 100, expected_share: 0.5, actual_share: 0.001 }),
    ]);
    // un seul item → renormalisé à 100 quoi qu'il arrive
    expect(only.new_weight).toBeCloseTo(100, 3);
    expect(REBID_CAP).toBe(0.5);
  });

  it('plan déjà conforme → poids ~inchangés', () => {
    const out = computeRebidWeights([
      it_({ item_id: 'z1:a', item_weight: 60, expected_share: 0.6, actual_share: 0.6 }),
      it_({ item_id: 'z1:b', item_weight: 40, expected_share: 0.4, actual_share: 0.4 }),
    ]);
    expect(out.find(i => i.item_id === 'z1:a')!.new_weight).toBeCloseTo(60, 1);
    expect(out.find(i => i.item_id === 'z1:b')!.new_weight).toBeCloseTo(40, 1);
  });

  it('item sans délivrance (actual_share 0) → poussé au max plafonné', () => {
    const out = computeRebidWeights([
      it_({ item_id: 'z1:a', item_weight: 50, expected_share: 0.5, actual_share: 0 }),
      it_({ item_id: 'z1:b', item_weight: 50, expected_share: 0.5, actual_share: 1 }),
    ]);
    expect(out.find(i => i.item_id === 'z1:a')!.new_weight).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Lancer les tests (échec attendu)**

Run: `npx vitest run tests/unit/pacing/rebid.test.ts`
Expected: FAIL (`Cannot find module '@/lib/pacing/rebid'`).

- [ ] **Step 3: Écrire l'implémentation**

Créer `lib/pacing/rebid.ts` :

```ts
/**
 * Rebid correctif — logique pure. À partir du diagnostic (part attendue vs réelle),
 * calcule des poids corrigés qui repoussent la répartition vers le plan :
 * facteur = clamp(expected/actual, 1−CAP, 1+CAP), plafonné pour ne pas sur-corriger,
 * puis renormalisé à 100 PAR ZONE (les scores DSP sont relatifs intra-zone).
 */

export const REBID_CAP = 0.5;
export const REBID_EPSILON = 0.001;

export interface RebidItemInput {
  zone_id: string;
  item_id: string;
  item_weight: number;
  expected_share: number;
  actual_share: number;
}

export interface RebidItem {
  zone_id: string;
  item_id: string;
  old_weight: number;
  new_weight: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function computeRebidWeights(items: RebidItemInput[]): RebidItem[] {
  // Poids bruts corrigés
  const raw = items.map((it) => {
    const factor = clamp(it.expected_share / Math.max(it.actual_share, REBID_EPSILON), 1 - REBID_CAP, 1 + REBID_CAP);
    return { it, rawWeight: it.item_weight * factor };
  });
  // Renormalisation à 100 par zone
  const zoneSum = new Map<string, number>();
  for (const r of raw) zoneSum.set(r.it.zone_id, (zoneSum.get(r.it.zone_id) ?? 0) + r.rawWeight);
  return raw.map((r) => {
    const sum = zoneSum.get(r.it.zone_id) ?? 0;
    const new_weight = sum > 0 ? (r.rawWeight / sum) * 100 : r.it.item_weight;
    return { zone_id: r.it.zone_id, item_id: r.it.item_id, old_weight: r.it.item_weight, new_weight };
  });
}
```

- [ ] **Step 4: Lancer les tests (succès attendu)**

Run: `npx vitest run tests/unit/pacing/rebid.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pacing/rebid.ts tests/unit/pacing/rebid.test.ts
git commit -m "feat(pacing): logique pure du rebid correctif plafonné (TDD)"
```

---

### Task 7: UI — onglet « Plan vs réel » (diagnostic + bouton rebid)

**Files:**
- Create: `app/map/analyse/digital/_components/PacingPanel.tsx`
- Modify: `app/map/analyse/digital/_components/AnalysisPanel.tsx` (ajout d'un mode + rendu conditionnel)

**Interfaces:**
- Consumes: `GET /api/digital/[campaignId]/pacing` (Task 5), `PACING_STATUS_META` + type `PacingItem` (Task 2), `computeRebidWeights` (Task 6), `downloadZoneExport` (`@/lib/custom-geo/download-export`), `adminFetch`.
- Produces: composant `PacingPanel`.

- [ ] **Step 1: Écrire le composant `PacingPanel`**

Créer `app/map/analyse/digital/_components/PacingPanel.tsx` :

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { downloadZoneExport } from '@/lib/custom-geo/download-export';
import { PACING_STATUS_META, type PacingItem } from '@/lib/pacing/compute';
import { computeRebidWeights, type RebidItemInput } from '@/lib/pacing/rebid';

const fInter = 'Inter, sans-serif';

interface PacingResponse {
  version: number;
  items: PacingItem[];
  in_plan_imp: number;
  total_imp: number;
  spillover: { imp: number; spend: number };
}

export function PacingPanel({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<{ loading: boolean; data: PacingResponse | null; empty: boolean; error: string | null }>(
    { loading: true, data: null, empty: false, error: null },
  );

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, data: null, empty: false, error: null });
    adminFetch(`/api/digital/${campaignId}/pacing`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (cancelled) return;
        if (j.empty) setState({ loading: false, data: null, empty: true, error: null });
        else setState({ loading: false, data: j, empty: false, error: null });
      })
      .catch((err) => { if (!cancelled) setState({ loading: false, data: null, empty: false, error: err.message }); });
    return () => { cancelled = true; };
  }, [campaignId]);

  const onRebid = useCallback((format: 'bidding_script' | 'tiktok_geo') => {
    const items = state.data?.items ?? [];
    if (!items.length) return;
    const rebidInput: RebidItemInput[] = items.map(i => ({
      zone_id: i.zone_id, item_id: i.item_id, item_weight: i.item_weight,
      expected_share: i.expected_share, actual_share: i.actual_share,
    }));
    const corrected = computeRebidWeights(rebidInput);
    // Un export par zone, avec les poids corrigés (poi_id → new_weight)
    const byZone = new Map<string, Record<string, number>>();
    for (const r of corrected) {
      const poiId = r.item_id.slice(r.zone_id.length + 1);
      const w = byZone.get(r.zone_id) ?? {};
      w[poiId] = Math.round(r.new_weight * 10) / 10;
      byZone.set(r.zone_id, w);
    }
    for (const [zoneId, weights] of byZone) {
      void downloadZoneExport(zoneId, format, { weights: JSON.stringify(weights) });
    }
  }, [state.data]);

  if (state.loading) return <div style={{ padding: 16, fontFamily: fInter, fontSize: 13, color: 'var(--text-secondary)' }}>Chargement…</div>;
  if (state.error) return <div style={{ padding: 16, fontFamily: fInter, fontSize: 13, color: 'var(--danger)' }}>Erreur : {state.error}</div>;
  if (state.empty) return (
    <div style={{ padding: 24, fontFamily: fInter, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
      Aucun plan figé — pousse un export DSP depuis le plan média pour démarrer la boucle.
    </div>
  );

  const d = state.data!;
  const nbSous = d.items.filter(i => i.status === 'sous_servi').length;
  const nbSur = d.items.filter(i => i.status === 'sur_servi').length;

  return (
    <div style={{ padding: 12, fontFamily: fInter }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
        <span>Version <strong style={{ color: 'var(--text-primary)' }}>v{d.version}</strong></span>
        <span>Sous-servis <strong style={{ color: 'var(--danger)' }}>{nbSous}</strong></span>
        <span>Sur-servis <strong style={{ color: 'var(--warning)' }}>{nbSur}</strong></span>
        <span>Hors-plan <strong style={{ color: 'var(--text-primary)' }}>{Math.round(d.spillover.imp).toLocaleString('fr-FR')}</strong> imp.</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ color: 'var(--text-tertiary)', textAlign: 'left' }}>
            <th style={{ padding: '6px 8px' }}>Zone / item</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Planifié</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Réel</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Δ (pts)</th>
            <th style={{ padding: '6px 8px' }}>Statut</th>
          </tr>
        </thead>
        <tbody>
          {[...d.items].sort((a, b) => a.delta_pts - b.delta_pts).map((i) => {
            const meta = PACING_STATUS_META[i.status];
            return (
              <tr key={i.item_id} style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                <td style={{ padding: '6px 8px' }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>{i.zone_name}</span> · <span style={{ color: 'var(--text-primary)' }}>{i.item_name}</span>
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{(i.expected_share * 100).toFixed(1)}%</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{(i.actual_share * 100).toFixed(1)}%</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: meta.colorVar }}>{i.delta_pts >= 0 ? '+' : ''}{i.delta_pts.toFixed(1)}</td>
                <td style={{ padding: '6px 8px', color: meta.colorVar }}>{meta.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={() => onRebid('bidding_script')} style={rebidBtn}>Générer le rebid corrigé DV360</button>
        <button onClick={() => onRebid('tiktok_geo')} style={rebidBtn}>Rebid TikTok</button>
      </div>
    </div>
  );
}

const rebidBtn: React.CSSProperties = {
  background: 'transparent', border: '0.5px solid var(--brand-teal)', color: 'var(--brand-teal)',
  borderRadius: 6, padding: '8px 16px', fontFamily: fInter, fontSize: 12, cursor: 'pointer',
};
```

- [ ] **Step 2: Câbler un mode « Plan vs réel » dans `AnalysisPanel`**

Dans `app/map/analyse/digital/_components/AnalysisPanel.tsx` :

1. Importer le composant (avec les autres imports en tête) :
```ts
import { PacingPanel } from './PacingPanel';
```

2. Ajouter un state de mode près du state `tab` (ligne ~42) :
```ts
const [mode, setMode] = useState<'analyse' | 'pacing'>('analyse');
```

3. Ajouter le toggle de mode juste au-dessus de la barre d'onglets existante (avant le bloc `([['region', 'Regions'], …])`) :
```tsx
<div style={{ display: 'flex', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
  {(['analyse', 'pacing'] as const).map((m) => (
    <button key={m} onClick={() => setMode(m)} style={{
      padding: '6px 12px', fontFamily: 'Inter, sans-serif', fontSize: 12, cursor: 'pointer',
      background: 'transparent', border: 'none',
      borderBottom: mode === m ? '2px solid var(--brand-teal)' : '2px solid transparent',
      color: mode === m ? 'var(--brand-teal)' : 'var(--text-tertiary)',
    }}>{m === 'analyse' ? 'Analyse démographique' : 'Plan vs réel'}</button>
  ))}
</div>
```

4. Envelopper le rendu existant (la barre d'onglets region/dept/cp + la grille de contenu) dans `{mode === 'analyse' && ( … )}`, et ajouter après :
```tsx
{mode === 'pacing' && <PacingPanel campaignId={campaignId} />}
```
(`campaignId` : réutiliser la prop/variable de campagne déjà présente dans `AnalysisPanel` — vérifier son nom exact dans le fichier ; si elle s'appelle autrement, adapter.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 4: Vérification navigateur (manuelle, au contrôle)**

`npm run dev`, ouvrir une campagne dans `/map/analyse/digital`, onglet « Plan vs réel » : état vide si aucun snapshot ; après un export depuis le plan média, la version apparaît, le tableau zone→item s'affiche avec Δ et statuts colorés ; « Générer le rebid corrigé » télécharge un fichier par zone. Console sans erreur. (Nécessite dev server + session ; non exécuté par l'implémenteur — noté pour le contrôle final.)

- [ ] **Step 5: Commit**

```bash
git add "app/map/analyse/digital/_components/PacingPanel.tsx" "app/map/analyse/digital/_components/AnalysisPanel.tsx"
git commit -m "feat(pacing): onglet Plan vs réel (diagnostic zone→item + rebid corrigé)"
```

---

## Notes d'implémentation transverses

- **Métrique du réel** : `p_metric_field` est dérivé du `dsp_source` de la campagne dans la route pacing (`adform` → `tracked_ads`, sinon `impressions`). La RPC mappe ce champ via un `CASE` sur des colonnes connues (pas de SQL dynamique injectable).
- **Snapshot best-effort** : l'appel snapshot dans `exportWeighted` est en `.catch()` silencieux — un échec de snapshot ne doit jamais casser le téléchargement de l'export, qui est l'action primaire de l'utilisateur.
- **Nano** : la seule RPC à surveiller est `get_campaign_pacing` (jointure snapshot↔dsp_campaign_data) — `EXPLAIN ANALYZE` au Task 5, viser l'index scan borné à la campagne (leçon de l'incident I/O R1 sur `get_campaign_last_data_dates`).
- **Cas mono-zone** (démo CIRFA à 4 items) : `expected_share` intra-zone = plan-global, le diagnostic compare directement les 4 items entre eux.
```
