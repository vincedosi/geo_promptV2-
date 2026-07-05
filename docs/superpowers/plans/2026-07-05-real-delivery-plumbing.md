# Source de délivrance réelle — plomberie (point 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à une vraie campagne d'entrer dans la machinerie pacing/bilan : importer la délivrance datée sur une campagne existante (`campaign_id`) et lire son bilan via une route générique.

**Architecture:** Deux changements de plomberie. (1) La route d'import SSE gagne un `campaign_id` optionnel : quand il est fourni, on append la délivrance à cette campagne (scope org vérifié, upsert idempotent) au lieu d'en créer une. (2) Une nouvelle route `GET /api/digital/[campaignId]/report` expose `buildCampaignReport` (déjà générique) avec scope org.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (upsert onConflict), Zod, Vitest.

## Global Constraints

- **Supabase Nano** : import batch 50 séquentiel (existant), aucun fan-out parallèle. Lecture bilan bornée par campagne.
- **Routes** : `export const dynamic = 'force-dynamic'`. Import = `requireAdmin`. Report = `requireAuth` + scope org explicite (super_admin, ou `campaign.organization_id === profile.organization_id`). `createAdminClient()` depuis `@/lib/auth`.
- **Rétrocompat** : sans `campaign_id`, l'import garde son comportement actuel (crée une campagne). L'upsert vaut pour les deux chemins.
- **TypeScript strict**, imports absolus `@/`. Pas de nouvelle table SQL. Pas de modif du parser/mappings (le fichier daté passe déjà : `date` requis présent).
- Fixture de dev pour la vérif : `docs/Adform/Custom GEO_dated_synthetic.xlsx` (dsp_source `adform`, 2 périodes 2026-04-01..04-30 et 05-01..05-30).
- Spec : `docs/superpowers/specs/2026-07-05-real-delivery-plumbing-design.md`.

---

### Task 1: Import vers une campagne existante

**Files:**
- Create: `lib/campaigns/import-scope.ts`
- Test: `tests/unit/campaigns/import-scope.test.ts`
- Modify: `app/api/admin/campaigns/import/route.ts`

**Interfaces:**
- Consumes : `requireAdmin`, `createAdminClient` (déjà importés dans la route).
- Produces : `resolveImportScope(role: string, profileOrgId: string | null, campaignOrgId: string | null): { allowed: boolean; reason?: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/campaigns/import-scope.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { resolveImportScope } from '@/lib/campaigns/import-scope';

describe('resolveImportScope', () => {
  it('super_admin : autorisé quelle que soit l’org', () => {
    expect(resolveImportScope('super_admin', null, 'org-a')).toEqual({ allowed: true });
    expect(resolveImportScope('super_admin', 'org-b', 'org-a')).toEqual({ allowed: true });
  });
  it('même org : autorisé', () => {
    expect(resolveImportScope('admin', 'org-a', 'org-a')).toEqual({ allowed: true });
  });
  it('org différente : refusé', () => {
    expect(resolveImportScope('admin', 'org-b', 'org-a')).toEqual({ allowed: false, reason: 'org_mismatch' });
  });
  it('campagne sans org (non super_admin) : refusé', () => {
    expect(resolveImportScope('admin', 'org-a', null)).toEqual({ allowed: false, reason: 'campaign_no_org' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/campaigns/import-scope.test.ts`
Expected: FAIL — `Cannot find module '@/lib/campaigns/import-scope'`.

- [ ] **Step 3: Implement the pure function**

Create `lib/campaigns/import-scope.ts` :

```ts
/**
 * Décide si un profil peut importer de la délivrance sur une campagne EXISTANTE.
 * Pur (aucune I/O). super_admin passe partout ; sinon même org obligatoire.
 */
export function resolveImportScope(
  role: string,
  profileOrgId: string | null,
  campaignOrgId: string | null,
): { allowed: boolean; reason?: string } {
  if (role === 'super_admin') return { allowed: true };
  if (!campaignOrgId) return { allowed: false, reason: 'campaign_no_org' };
  if (campaignOrgId === profileOrgId) return { allowed: true };
  return { allowed: false, reason: 'org_mismatch' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/campaigns/import-scope.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into the import route — add import**

In `app/api/admin/campaigns/import/route.ts`, add the import. Replace:

```ts
import type { CampaignImportEvent } from '@/types/campaign';
```

with:

```ts
import type { CampaignImportEvent } from '@/types/campaign';
import { resolveImportScope } from '@/lib/campaigns/import-scope';
```

- [ ] **Step 6: Add `campaign_id` to the fields schema**

Replace:

```ts
  organization_id: z.string().uuid().optional().nullable(),
});
```

with:

```ts
  organization_id: z.string().uuid().optional().nullable(),
  campaign_id: z.string().uuid().optional().nullable(),
});
```

- [ ] **Step 7: Extract the requested campaign_id**

Replace:

```ts
  const dspSource = parsedFields.data.dsp_source.toLowerCase();
  const campaignNameOverride = parsedFields.data.campaign_name ?? null;
  const requestedOrgId = parsedFields.data.organization_id ?? null;
```

with:

```ts
  const dspSource = parsedFields.data.dsp_source.toLowerCase();
  const campaignNameOverride = parsedFields.data.campaign_name ?? null;
  const requestedOrgId = parsedFields.data.organization_id ?? null;
  const requestedCampaignId = parsedFields.data.campaign_id ?? null;
```

- [ ] **Step 8: Pre-check the target campaign before the stream**

The mappings are loaded just before `const buffer = Buffer.from(...)`. Replace:

```ts
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name;
```

with:

```ts
  // ── Cible : campagne existante (optionnel) — créer le client tôt pour la pré-vérif ──
  const supabase = createAdminClient();
  let existingCampaign: { id: string; organization_id: string | null; dsp_source: string | null } | null = null;
  if (requestedCampaignId) {
    const { data: camp } = await supabase
      .from('dsp_campaigns')
      .select('id, organization_id, dsp_source')
      .eq('id', requestedCampaignId)
      .single();
    if (!camp) {
      return new Response(JSON.stringify({ error: 'campaign_not_found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    const scope = resolveImportScope(profile.role, profile.organization_id, camp.organization_id);
    if (!scope.allowed) {
      return new Response(JSON.stringify({ error: 'Forbidden', reason: scope.reason }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }
    existingCampaign = camp;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name;
```

- [ ] **Step 9: Use the outer client + conditionalize campaign creation**

Inside the stream, replace the whole creation block:

```ts
        // ── Create campaign record ──────────────────────────────────────
        const supabase = createAdminClient();

        const { data: campaign, error: campErr } = await supabase
          .from('dsp_campaigns')
          .insert({
            name: campaignName,
            dsp_source: dspSource,
            advertiser: null,
            date_start: parsed.dateStart,
            date_end: parsed.dateEnd,
            total_tracked_ads: parsed.totalTrackedAds,
            total_unique_impressions: parsed.totalUniqueImpressions,
            countries: parsed.countries,
            created_by: profile.id,
            organization_id: organizationId,
          })
          .select('id')
          .single();

        if (campErr || !campaign) {
          send({ type: 'error', message: `Erreur création campagne : ${campErr?.message ?? 'inconnue'}` });
          controller.close();
          return;
        }

        const campaignId = campaign.id;

        // Lier l'org propriétaire dans la table pivot multi-org
        await supabase
          .from('campaign_organizations')
          .upsert(
            { campaign_id: campaignId, organization_id: organizationId, added_by: profile.id },
            { onConflict: 'campaign_id,organization_id', ignoreDuplicates: true },
          );
```

with:

```ts
        // ── Cibler la campagne : existante (append) ou nouvelle ─────────
        // supabase est déjà créé avant le stream (pré-vérif campaign_id).
        let campaignId: string;
        let effectiveOrgId = organizationId;
        if (existingCampaign) {
          campaignId = existingCampaign.id;
          effectiveOrgId = existingCampaign.organization_id ?? organizationId;
          if (existingCampaign.dsp_source && existingCampaign.dsp_source !== dspSource) {
            send({
              type: 'progress',
              processed: 0,
              total: totalRows,
              message: `Attention : campagne cible '${existingCampaign.dsp_source}', fichier '${dspSource}'. La métrique de pacing suit le dsp_source de la campagne.`,
            });
          }
        } else {
          const { data: campaign, error: campErr } = await supabase
            .from('dsp_campaigns')
            .insert({
              name: campaignName,
              dsp_source: dspSource,
              advertiser: null,
              date_start: parsed.dateStart,
              date_end: parsed.dateEnd,
              total_tracked_ads: parsed.totalTrackedAds,
              total_unique_impressions: parsed.totalUniqueImpressions,
              countries: parsed.countries,
              created_by: profile.id,
              organization_id: organizationId,
            })
            .select('id')
            .single();
          if (campErr || !campaign) {
            send({ type: 'error', message: `Erreur création campagne : ${campErr?.message ?? 'inconnue'}` });
            controller.close();
            return;
          }
          campaignId = campaign.id;
        }

        // Lier l'org propriétaire dans la table pivot multi-org
        await supabase
          .from('campaign_organizations')
          .upsert(
            { campaign_id: campaignId, organization_id: effectiveOrgId, added_by: profile.id },
            { onConflict: 'campaign_id,organization_id', ignoreDuplicates: true },
          );
```

- [ ] **Step 10: Make delivery insert idempotent (upsert)**

Replace:

```ts
          const { error: insertErr } = await supabase
            .from('dsp_campaign_data')
            .insert(batch);
```

with:

```ts
          const { error: insertErr } = await supabase
            .from('dsp_campaign_data')
            .upsert(batch, { onConflict: 'campaign_id,date,postal_code,city' });
```

- [ ] **Step 11: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur. (Vérifier notamment qu'il ne reste PAS un second `const supabase = createAdminClient();` dans le stream — sinon erreur de redéclaration.)

- [ ] **Step 12: Commit**

```bash
git add lib/campaigns/import-scope.ts tests/unit/campaigns/import-scope.test.ts app/api/admin/campaigns/import/route.ts
git commit -m "feat(import): import vers campagne existante (campaign_id + scope org + upsert idempotent)"
```

---

### Task 2: Route bilan générique `GET /api/digital/[campaignId]/report`

**Files:**
- Create: `app/api/digital/[campaignId]/report/route.ts`

**Interfaces:**
- Consumes : `buildCampaignReport` de `@/lib/report/aggregate` ; `requireAuth`/`authUnauthorized` de `@/lib/api/middleware` ; `createAdminClient` de `@/lib/auth`.
- Produces : `GET /api/digital/[campaignId]/report` → `{ report: CampaignReport | null }` ou `{ error }`.

> Calque la forme de `app/api/digital/[campaignId]/pacing/route.ts` (params Promise, requireAuth, métrique adform→tracked_ads). **Ajoute** un scope org explicite que la route pacing n'a pas.

- [ ] **Step 1: Write the route**

Create `app/api/digital/[campaignId]/report/route.ts` :

```ts
/**
 * GET /api/digital/[campaignId]/report
 * Bilan de campagne générique (courbe conformité, avant/après, budget, KPI).
 * Réutilise buildCampaignReport (brique C). requireAuth + scope org explicite.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { buildCampaignReport } from '@/lib/report/aggregate';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  const supabase = createAdminClient();
  const { data: camp } = await supabase
    .from('dsp_campaigns')
    .select('organization_id, dsp_source')
    .eq('id', campaignId)
    .single();

  // 404 si absente OU hors org (ne pas divulguer l'existence à une autre org)
  if (!camp) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  if (profile.role !== 'super_admin' && camp.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  }

  const metric = camp.dsp_source === 'adform' ? 'tracked_ads' : 'impressions';
  try {
    const report = await buildCampaignReport(supabase, campaignId, metric);
    return NextResponse.json({ report: report ?? null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'report_failed' },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add app/api/digital/[campaignId]/report/route.ts
git commit -m "feat(digital): route GET /api/digital/[id]/report (bilan générique + scope org)"
```

---

## Vérification finale (contrôleur, après Tasks 1-2)

Vérif E2E authentifiée (Playwright/curl, dev server) sur la fixture datée — prouve la plomberie de bout en bout :

1. **Créer une campagne de test** non démo (`dsp_source='adform'`, org GENESIS `00000000-0000-0000-0000-000000000001`) via MCP Supabase `execute_sql` (INSERT dsp_campaigns) — noter son `id`.
2. **Créer un plan/snapshot** sur 2 périodes couvrant la délivrance : `POST /api/custom-geo/media-plan/snapshot` (ou INSERT direct `campaign_plan_snapshot` via MCP) avec `period_start/period_end` = `2026-04-01/2026-05-01` (v1) et `2026-05-01/2026-05-31` (v2), des `postal_code` recoupant des communes de la fixture (ex. 64460, 55130, 60220…), `expected_share`/`item_weight` répartis.
3. **Importer la fixture en ciblant la campagne** : `POST /api/admin/campaigns/import` en multipart avec `file=docs/Adform/Custom GEO_dated_synthetic.xlsx`, `dsp_source=adform`, `campaign_id=<id test>`. Confirmer via SSE `complete` que les lignes atterrissent, puis vérifier en base : `SELECT count(*), min(date), max(date) FROM dsp_campaign_data WHERE campaign_id='<id>'` → ~6493 lignes, dates 2026-04-01..05-30, sur la bonne campagne (pas de nouvelle campagne créée).
4. **Lire le bilan** : `GET /api/digital/<id>/report` → `{ report }` non nul, 2 versions segmentées par période, budget/écarts calculés sur `tracked_ads`. Vérifier aussi `GET /api/digital/<id>/pacing` (cohérence).
5. **Idempotence** : relancer le même import (même campaign_id) → pas d'erreur UNIQUE (upsert), compte de lignes stable.
6. **Nettoyer** : `DELETE FROM dsp_campaigns WHERE id='<id>'` (cascade sur dsp_campaign_data + snapshots) via MCP.

## Hors scope (rappel)

Surface UI (onglet bilan vraie campagne), mapping DV360, capture `Unique Reach`, rebid réel, correction du caveat multi-média UNIQUE (pré-existant).
