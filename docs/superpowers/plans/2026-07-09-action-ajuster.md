# Action « Ajuster » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajuster une campagne lancée (budgets PAR CANAL, CPM, dates, mode, intensité, cible, canaux) dans un panneau unique, avec re-push bidding via connecteurs API (DV360 réel / simulé), historisation dans le journal existant, et propositions par l'agent IA.

**Architecture:** Le modèle budget passe à « une ligne par DSP/réseau social, global = somme » (wizard ET panneau), stocké dans `geo_strategy.channels.budgets`. Une route orchestratrice `POST /api/bidding/strategies/[id]/adjust` fait : patch partiel `bidding_strategies` + audit `log_strategy_change('adjusted')` + snapshot v+1 (RPC SQL `duplicate_plan_snapshot`) + push par canal via `lib/dsp/push/` (statuts pushed/simulated/failed/skipped) + événement consolidé `bidding_agent_actions` (`intent='manual_adjust'`). L'UI est une modale `AdjustPanel` ouverte depuis le header de `CampaignOverview` ; le chat campagne peut émettre une ligne `[PROPOSITION_AJUSTEMENT]{json}` rendue en carte qui pré-remplit le panneau.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (MCP pour la migration), Zod, Vitest, Vercel AI SDK (Gemini), API DV360 v3.

## Global Constraints

- Supabase Nano : jamais plus de 3 requêtes Supabase en parallèle ; requêtes bornées ; insert par lots de 50.
- SQL : TOUJOURS via MCP Supabase (`apply_migration` / `execute_sql`), projet `vkkdbygwbrxyogqosten`. Copie du fichier dans `sql/` pour le repo.
- Design : tokens `var(--…)` uniquement (JAMAIS de hex nu), sentence case, flat, Inter + JetBrains Mono. Réutiliser les atomes de `app/campaigns/[id]/_components/steps/ui.tsx`.
- Ne PAS modifier : `app/api/isochrone-battle/route.ts`, `middleware.ts`, la route `PATCH /api/bidding/strategies/[id]` (elle reste telle quelle ; `adjust` est une route séparée).
- Pas d'exemples de marque dans les placeholders (génériques descriptifs).
- Statut connexion DSP = `'connected'` (PAS `'active'`).
- Le mode démo = `dsp_campaigns.is_demo === true` OU `profiles.demo_mode === true` (même règle que la route channels).
- Commits atomiques `type: description`.

---

### Task 1: Budgets & links par canal (lib + route channels)

**Files:**
- Modify: `lib/campaigns/channels.ts`
- Modify: `app/api/campaigns/[campaignId]/channels/route.ts`
- Test: `tests/unit/campaigns/channels.test.ts` (ajouts)

**Interfaces:**
- Produces: `ChannelBudgets = Record<string, number>`, `DspLinks { dv360?: { advertiser_id?, insertion_order_id?, algorithm_id? } }`, `StoredChannels extends CampaignChannels { budgets?, links? }`, `ChannelBudgetsSchema`, `DspLinksSchema`, `sumBudgets(budgets): number`, `pruneBudgets(budgets, sel): ChannelBudgets`. La route PUT accepte `{dsps, socials, ad_server, budgets?, links?}` et merge sans écraser les sous-clés non fournies ; GET renvoie `selected` avec `budgets`/`links`.

- [ ] **Step 1: Tests qui échouent (sumBudgets / pruneBudgets)**

Ajouter à `tests/unit/campaigns/channels.test.ts` :

```ts
import { sumBudgets, pruneBudgets } from '@/lib/campaigns/channels';

describe('budgets par canal', () => {
  it('sumBudgets additionne les lignes et ignore les valeurs non finies', () => {
    expect(sumBudgets({ dv360: 30000, tiktok: 15000 })).toBe(45000);
    expect(sumBudgets({})).toBe(0);
    expect(sumBudgets(undefined)).toBe(0);
    expect(sumBudgets({ dv360: 100, bad: Number.NaN })).toBe(100);
  });

  it('pruneBudgets purge les lignes des canaux retirés', () => {
    const sel = { dsps: ['dv360'], socials: [], ad_server: 'adform' as string | null };
    expect(pruneBudgets({ dv360: 30000, tiktok: 15000 }, sel)).toEqual({ dv360: 30000 });
  });

  it("pruneBudgets garde les lignes des socials et tolère l'absence de budgets", () => {
    const sel = { dsps: ['dv360'], socials: ['tiktok'], ad_server: null };
    expect(pruneBudgets({ dv360: 1, tiktok: 2 }, sel)).toEqual({ dv360: 1, tiktok: 2 });
    expect(pruneBudgets(undefined, sel)).toEqual({});
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npm test -- --run tests/unit/campaigns/channels.test.ts`
Expected: FAIL (`sumBudgets` n'existe pas).

- [ ] **Step 3: Implémenter dans `lib/campaigns/channels.ts`**

Ajouter à la fin du fichier (les exports existants ne bougent pas) :

```ts
// ── Budgets par canal & liens DSP (geo_strategy.channels.budgets / .links) ─────
/** Une ligne de budget (€) par canal DSP/social sélectionné. Global = somme. */
export type ChannelBudgets = Record<string, number>;

export interface Dv360Links {
  advertiser_id?: string;
  insertion_order_id?: string;
  algorithm_id?: string;
}
export interface DspLinks { dv360?: Dv360Links }

/** Forme complète stockée dans geo_strategy.channels. */
export interface StoredChannels extends CampaignChannels {
  budgets?: ChannelBudgets;
  links?: DspLinks;
}

export const ChannelBudgetsSchema = z.record(
  z.string().min(1).max(50),
  z.number().min(0).finite(),
);

export const DspLinksSchema = z.object({
  dv360: z.object({
    advertiser_id: z.string().max(50).optional(),
    insertion_order_id: z.string().max(50).optional(),
    algorithm_id: z.string().max(50).optional(),
  }).optional(),
});

/** Somme des lignes budget (0 si vide/absent). */
export function sumBudgets(budgets: ChannelBudgets | null | undefined): number {
  return Object.values(budgets ?? {}).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
}

/** Garde uniquement les lignes des canaux encore sélectionnés (purge au retrait). */
export function pruneBudgets(
  budgets: ChannelBudgets | null | undefined, sel: CampaignChannels,
): ChannelBudgets {
  const allowed = new Set([...sel.dsps, ...sel.socials]);
  return Object.fromEntries(Object.entries(budgets ?? {}).filter(([code]) => allowed.has(code)));
}
```

- [ ] **Step 4: Vérifier le pass**

Run: `npm test -- --run tests/unit/campaigns/channels.test.ts`
Expected: PASS (12 anciens + 3 nouveaux).

- [ ] **Step 5: Étendre la route channels (PUT merge + GET passthrough)**

Dans `app/api/campaigns/[campaignId]/channels/route.ts` :

1. Imports : ajouter `ChannelBudgetsSchema, DspLinksSchema, pruneBudgets, type StoredChannels, type ChannelBudgets, type DspLinks` à l'import depuis `@/lib/campaigns/channels`.
2. Dans `loadContext`, typer `selected` en `StoredChannels` (le GET renvoie déjà l'objet entier, budgets/links passeront tout seuls) :

```ts
const selected = (gs.channels as StoredChannels | undefined) ?? EMPTY_CHANNELS;
```

3. Dans `PUT`, remplacer le parse + le merge par :

```ts
const PutBodySchema = CampaignChannelsSchema.extend({
  budgets: ChannelBudgetsSchema.optional(),
  links: DspLinksSchema.optional(),
});
```

(déclaré au niveau module, sous `CampaignChannelsSchema` importé), puis dans le corps :

```ts
const parsed = PutBodySchema.safeParse(raw);
if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
const sel = { dsps: parsed.data.dsps, socials: parsed.data.socials, ad_server: parsed.data.ad_server };
```

`validateSelection(sel, …)` (au lieu de `parsed.data`), et le merge devient :

```ts
// Merge non destructif : préserve media_plan etc., ET les sous-clés budgets/links
// quand le client ne les renvoie pas (ex. StepCanaux qui ne gère que la sélection).
const gs = (ctx.camp.geo_strategy ?? {}) as Record<string, unknown>;
const prev = (gs.channels ?? {}) as StoredChannels;
const budgets = pruneBudgets(parsed.data.budgets ?? prev.budgets, sel);
const links: DspLinks | undefined = parsed.data.links ?? prev.links;
const nextChannels: StoredChannels = { ...sel, budgets, ...(links ? { links } : {}) };
const nextGeoStrategy = { ...gs, channels: nextChannels };
```

- [ ] **Step 6: Suite + type-check**

Run: `npx tsc --noEmit && npm test -- --run tests/unit/campaigns/channels.test.ts`
Expected: 0 erreur tsc, tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/campaigns/channels.ts "app/api/campaigns/[campaignId]/channels/route.ts" tests/unit/campaigns/channels.test.ts
git commit -m "feat: budgets par canal + liens DSP dans geo_strategy.channels (lib + route)"
```

---

### Task 2: Wizard — budget par ligne de canal

**Files:**
- Modify: `app/campaigns/[id]/_components/steps/types.ts`
- Create: `lib/campaigns/resolve-zone.ts`
- Modify: `app/campaigns/[id]/_components/steps/StepBudget.tsx`
- Modify: `app/campaigns/[id]/_components/steps/StepLancement.tsx`
- Modify: `components/campaign/CampaignCockpit.tsx`

**Interfaces:**
- Consumes: `sumBudgets`, `StoredChannels` (Task 1) ; `GET /api/campaigns/[id]/channels` → `{catalog, selected}`.
- Produces: `ProgDraft.channelBudgets: Record<string, number>` (remplace `totalBudget`), `draftTotalBudget(d: ProgDraft): number | null`, `resolveFinalZone(cibles: {id,name}[], orgId: string | null): Promise<{scope_type, zone_id}>` dans `lib/campaigns/resolve-zone.ts` (client, réutilisé par AdjustPanel en Task 5). `StepBudget` reçoit une nouvelle prop `campaignId: string`.

- [ ] **Step 1: types.ts — channelBudgets à la place de totalBudget**

Dans `app/campaigns/[id]/_components/steps/types.ts` :
- Dans `ProgDraft`, remplacer `totalBudget: number | null;` par :

```ts
  /** Une ligne de budget (€) par canal DSP/social sélectionné. Global = somme. */
  channelBudgets: Record<string, number>;
```

- Dans `DEFAULT_PROG_DRAFT`, remplacer `totalBudget: null,` par `channelBudgets: {},`.
- Ajouter après `DEFAULT_PROG_DRAFT` :

```ts
/** Budget global du brouillon = somme des lignes par canal (null si 0 — rien saisi). */
export function draftTotalBudget(d: ProgDraft): number | null {
  const sum = Object.values(d.channelBudgets).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  return sum > 0 ? Math.round(sum * 100) / 100 : null;
}
```

- [ ] **Step 2: Extraire resolveFinalZone (verbatim) vers `lib/campaigns/resolve-zone.ts`**

Créer `lib/campaigns/resolve-zone.ts` (helper CLIENT — utilise adminFetch, comme l'original) :

```ts
/**
 * Résolution de la zone finale d'une stratégie depuis un panier de cibles.
 * n=0 → national ; n=1 → zone directe ; n>1 → crée la composite (union + save).
 * Extrait verbatim de StepLancement — partagé wizard / AdjustPanel.
 * CLIENT uniquement (adminFetch).
 */
import { adminFetch } from '@/lib/admin-fetch';

export async function resolveFinalZone(
  cibles: { id: string; name: string }[],
  orgId: string | null,
): Promise<{ scope_type: 'national' | 'custom_zone'; zone_id: string | null }> {
  if (cibles.length === 0) return { scope_type: 'national', zone_id: null };
  if (cibles.length === 1) return { scope_type: 'custom_zone', zone_id: cibles[0].id };
  if (!orgId) throw new Error('Organisation introuvable pour fusionner les zones cibles');
  const geoRes = await adminFetch('/api/custom-geo/source/composite', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone_ids: cibles.map((c) => c.id) }),
  });
  if (!geoRes.ok) throw new Error('Fusion des zones cibles échouée');
  const geo = await geoRes.json();
  const saveRes = await adminFetch('/api/custom-geo/save', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Cible composite (${cibles.length} zones) — ${new Date().toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}`,
      source_type: 'composite',
      source_metadata: { kind: 'composite', member_zone_ids: cibles.map((c) => c.id) },
      geometry: geo.geometry,
      org_id: orgId,
    }),
  });
  if (!saveRes.ok) throw new Error('Sauvegarde de la zone composite échouée');
  if (saveRes.status === 207) {
    throw new Error('Zone composite créée mais résolution des codes échouée — relance le lancement.');
  }
  const saved = await saveRes.json();
  return { scope_type: 'custom_zone', zone_id: saved.zone_id };
}
```

Dans `StepLancement.tsx` : supprimer la fonction locale `resolveFinalZone` (lignes 26-58) et importer `import { resolveFinalZone } from '@/lib/campaigns/resolve-zone';`.

- [ ] **Step 3: StepBudget — une ligne par canal**

Remplacer intégralement `app/campaigns/[id]/_components/steps/StepBudget.tsx` par :

```tsx
'use client';

/**
 * Étape 3/5 — Budget : UNE ligne de budget par canal (DSP + réseaux sociaux
 * sélectionnés à l'étape Canaux), budget global = somme en lecture seule,
 * CPM cible et période. Écrit `channelBudgets`, `forecastCpm`, `startDate`,
 * `endDate` dans le brouillon. Labels des canaux : GET /channels (catalog),
 * qui pré-remplit aussi les lignes depuis geo_strategy.channels.budgets
 * (reprogrammation) quand le brouillon est vide.
 */
import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { ChannelRow, StoredChannels } from '@/lib/campaigns/channels';
import type { StepProps } from './types';
import { draftTotalBudget, fmtEUR } from './types';
import { B, C, DateField, FieldBlock, Lead, NumberField, Row2, StandardFooter, StepShell, fInter, fMono } from './ui';

export function StepBudget({
  draft, setDraft, campaignId, onPrev, onNext,
}: StepProps & { campaignId: string; onPrev: () => void; onNext: () => void }) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const prefilledRef = useRef(false);

  // Labels du catalogue + pré-remplissage des lignes depuis le stockage (une fois).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await adminFetch(`/api/campaigns/${campaignId}/channels`, { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const d = await r.json() as { catalog: ChannelRow[]; selected: StoredChannels };
        setLabels(Object.fromEntries((d.catalog ?? []).map((c) => [c.code, c.label])));
        if (!prefilledRef.current) {
          prefilledRef.current = true;
          const stored = d.selected?.budgets ?? {};
          setDraft((prev) => Object.keys(prev.channelBudgets).length > 0 ? prev
            : { ...prev, channelBudgets: stored });
        }
      } catch { /* best-effort : labels = codes */ }
    })();
    return () => { cancelled = true; };
  }, [campaignId, setDraft]);

  const lines = [...draft.channels.dsps, ...draft.channels.socials];
  const total = draftTotalBudget(draft);
  const nextDisabled = !total || !draft.startDate || !draft.endDate;

  return (
    <StepShell
      title="Budget"
      stepNumber={3}
      totalSteps={5}
      memo={{
        paragraphs: [
          <>Le budget se fixe <B>par canal</B> : une ligne par DSP et par réseau. Le global n&apos;est que la somme.</>,
          <>Le pacing répartit la dépense de chaque canal sur la période pour éviter les à-coups.</>,
        ],
        tip: 'CPM cible = point de départ ; l’algo l’ajuste ensuite par zone.',
        mini: [3, 2, 4],
      }}
      footer={<StandardFooter onPrev={onPrev} nextLabel="Continuer →" onNext={onNext} nextDisabled={nextDisabled} />}
    >
      <Lead>
        Combien sur chaque canal, à quel prix, sur quelle période. MAGELIAN pace la dépense pour ne jamais dépasser.
      </Lead>

      <FieldBlock label="Budget par canal">
        {lines.length === 0 ? (
          <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>
            Sélectionne d&apos;abord tes canaux à l&apos;étape Canaux — chaque canal aura sa ligne de budget.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {lines.map((code) => (
              <NumberField
                key={code}
                label={labels[code] ?? code}
                value={draft.channelBudgets[code] ?? null}
                onChange={(v) => setDraft((prev) => {
                  const next = { ...prev.channelBudgets };
                  if (v == null) delete next[code]; else next[code] = v;
                  return { ...prev, channelBudgets: next };
                })}
                suffix="€"
                placeholder="ex. 30000"
                step={100}
                min={0}
              />
            ))}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderTop: `0.5px solid ${C.border}`, paddingTop: 10,
            }}>
              <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>Budget global (somme)</span>
              <span style={{ fontFamily: fMono, fontSize: 15, color: C.text }}>{fmtEUR(total)}</span>
            </div>
          </div>
        )}
      </FieldBlock>

      <FieldBlock label="Enveloppe">
        <Row2>
          <NumberField
            label="CPM cible"
            value={draft.forecastCpm}
            onChange={(v) => setDraft((prev) => ({ ...prev, forecastCpm: v }))}
            suffix="€"
            placeholder="ex. 6.20"
            step={0.1}
            min={0}
          />
          <div />
        </Row2>
      </FieldBlock>

      <FieldBlock label="Période">
        <Row2>
          <DateField label="Début" value={draft.startDate} onChange={(v) => setDraft((prev) => ({ ...prev, startDate: v }))} />
          <DateField label="Fin" value={draft.endDate} onChange={(v) => setDraft((prev) => ({ ...prev, endDate: v }))} />
        </Row2>
      </FieldBlock>
    </StepShell>
  );
}
```

- [ ] **Step 4: StepLancement — somme + budgets persistés + récap réparti**

Dans `app/campaigns/[id]/_components/steps/StepLancement.tsx` :
- Import : ajouter `draftTotalBudget` à l'import depuis `./types`, et `import { resolveFinalZone } from '@/lib/campaigns/resolve-zone';` (Step 2).
- Au début du composant (après `const noChannel = …`) :

```ts
  const totalBudget = draftTotalBudget(draft);
```

- `invalid` : remplacer `|| !draft.totalBudget` par `|| !totalBudget`.
- Dans `commonFields` : remplacer `total_budget: draft.totalBudget,` par `total_budget: totalBudget,`.
- La persistance canaux (PUT, lignes ~181-184) passe les budgets :

```ts
      await adminFetch(`/api/campaigns/${campaignId}/channels`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft.channels, budgets: draft.channelBudgets }),
      }).catch(() => { /* non bloquant : la stratégie est déjà créée */ });
```

- Récap budget (RecapRow, lignes ~245-248) : remplacer par

```tsx
        <RecapRow
          title={`${fmtEUR(totalBudget)} · CPM ${draft.forecastCpm != null ? draft.forecastCpm.toLocaleString('fr-FR') + ' €' : '—'}`}
          sub={`${fmtDateShort(draft.startDate)} → ${fmtDateShort(draft.endDate)} · ${
            Object.entries(draft.channelBudgets).map(([c, v]) => `${c} ${v.toLocaleString('fr-FR')} €`).join(' · ') || 'répartition non saisie'
          }`}
        />
```

- [ ] **Step 5: CampaignCockpit — prop campaignId à StepBudget + prefill sans totalBudget**

Dans `components/campaign/CampaignCockpit.tsx` :
- Rendu StepBudget (ligne ~189) :

```tsx
          {progStep === 'budget' && (
            <StepBudget draft={draft} setDraft={setDraft} campaignId={id} onPrev={goProgPrev} onNext={goProgNext} />
          )}
```

- Dans le prefill stratégie (lignes ~92-101), supprimer la ligne `totalBudget: s.total_budget ?? prev.totalBudget,` (les lignes budget se pré-remplissent depuis `geo_strategy.channels.budgets` via StepBudget).

- [ ] **Step 6: Chasser les usages restants de totalBudget**

Run: `grep -rn "totalBudget" app components lib --include="*.ts" --include="*.tsx" | grep -v channelBudgets | grep -v draftTotalBudget`
Expected: plus AUCUNE occurrence de `draft.totalBudget` (seules les mentions locales `const totalBudget` de StepLancement restent). Corriger tout résiduel.

- [ ] **Step 7: Type-check + tests + commit**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: 0 erreur, tests verts.

```bash
git add "app/campaigns/[id]/_components/steps/types.ts" "app/campaigns/[id]/_components/steps/StepBudget.tsx" "app/campaigns/[id]/_components/steps/StepLancement.tsx" components/campaign/CampaignCockpit.tsx lib/campaigns/resolve-zone.ts
git commit -m "feat: budget par ligne de canal dans le wizard (global = somme) + resolveFinalZone partagé"
```

---

### Task 3: Connecteurs push bidding (`lib/dsp/push/`)

**Files:**
- Create: `lib/dsp/push/types.ts`
- Create: `lib/dsp/push/simulated.ts`
- Create: `lib/dsp/push/dv360.ts`
- Create: `lib/dsp/push/index.ts`
- Modify: `lib/dsp/dv360/client.ts` (2 fonctions ajoutées)
- Test: `tests/unit/dsp/push.test.ts`

**Interfaces:**
- Consumes: `buildWeightedZoneBiddingScript(zoneName, tiers)` et `WeightedBiddingTier {name, cps, score}` de `lib/digital/dv360-bidding-script.ts` ; `resolveAccessToken(conn)` et `Dv360ConnectionRow` de `lib/dsp/dv360/client.ts` ; `DspLinks` (Task 1).
- Produces:
  - `type PushStatus = 'pushed' | 'simulated' | 'failed' | 'skipped'`
  - `interface BiddingPushContext { channel; campaign: {id; name; is_demo}; channelBudget: number | null; budgetChanged: boolean; zoneName: string; tiers: WeightedBiddingTier[]; connection: Dv360ConnectionRow | null; links: DspLinks | null; isDemo: boolean }`
  - `interface BiddingPushResult { channel: string; status: PushStatus; detail: string; payload_summary: Record<string, unknown> }`
  - `interface BiddingPusher { channel: string; push(ctx): Promise<BiddingPushResult> }`
  - `selectPusher(channel: string, isDemo: boolean, hasConnection: boolean): BiddingPusher` (décision pure, exportée pour les tests)
  - `runPush(ctx: BiddingPushContext): Promise<BiddingPushResult>` (sélection + exécution + catch → `failed`)
  - Client DV360 : `uploadCustomBiddingScript(accessToken, advertiserId, algorithmId, script): Promise<{ scriptName: string }>` et `patchInsertionOrderBudget(accessToken, advertiserId, insertionOrderId, budgetAmountMicros): Promise<void>`.

- [ ] **Step 1: Tests qui échouent (décision + payload simulé)**

Créer `tests/unit/dsp/push.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { selectPusher, runPush } from '@/lib/dsp/push';
import type { BiddingPushContext } from '@/lib/dsp/push/types';

function ctx(over: Partial<BiddingPushContext> = {}): BiddingPushContext {
  return {
    channel: 'ttd',
    campaign: { id: 'c1', name: 'Campagne test', is_demo: true },
    channelBudget: 30000,
    budgetChanged: true,
    zoneName: 'Zone test',
    tiers: [{ name: 'Item A', cps: ['35000', '35200'], score: 0.6 }],
    connection: null,
    links: null,
    isDemo: true,
    ...over,
  };
}

describe('selectPusher', () => {
  it('démo → simulé, même avec connexion', () => {
    expect(selectPusher('dv360', true, true).channel).toBe('dv360');
    // le simulé se reconnaît à son résultat, pas à son channel — testé via runPush
  });
  it('pas de connexion → simulé ; connexion réelle sans connecteur → skipped', async () => {
    const noConn = await runPush(ctx({ channel: 'dv360', isDemo: false, connection: null }));
    expect(noConn.status).toBe('simulated');
    const noPusher = await runPush(ctx({ channel: 'ttd', isDemo: false, connection: {} as never }));
    expect(noPusher.status).toBe('skipped');
  });
});

describe('push simulé', () => {
  it('construit le vrai payload (script pondéré + delta budget) sans réseau', async () => {
    const r = await runPush(ctx({ channel: 'dv360' }));
    expect(r.status).toBe('simulated');
    expect(r.payload_summary.script).toContain('max_aggregate');
    expect(r.payload_summary.script).toContain('"35000"');
    expect(r.payload_summary.budget).toBe(30000);
  });
  it('sans tiers ni delta budget → payload minimal, toujours simulé', async () => {
    const r = await runPush(ctx({ tiers: [], budgetChanged: false, channelBudget: null }));
    expect(r.status).toBe('simulated');
    expect(r.payload_summary.script).toBeUndefined();
  });
});

describe('push dv360 réel', () => {
  it('links absents → skipped avec détail explicite', async () => {
    const r = await runPush(ctx({ channel: 'dv360', isDemo: false, connection: {} as never, links: null }));
    expect(r.status).toBe('skipped');
    expect(r.detail).toContain('IDs DV360');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npm test -- --run tests/unit/dsp/push.test.ts`
Expected: FAIL (module `@/lib/dsp/push` introuvable).

- [ ] **Step 3: `lib/dsp/push/types.ts`**

```ts
/**
 * Connecteurs de push bidding — un connecteur par canal, même signature.
 * simulated = payload réel construit, aucune API appelée (démo / non connecté).
 * skipped   = volontairement non poussé (connecteur absent, links manquants).
 */
import type { WeightedBiddingTier } from '@/lib/digital/dv360-bidding-script';
import type { DspLinks } from '@/lib/campaigns/channels';
import type { Dv360ConnectionRow } from '@/lib/dsp/dv360/client';

export type PushStatus = 'pushed' | 'simulated' | 'failed' | 'skipped';

export interface BiddingPushContext {
  channel: string; // code dsp_channel_registry (dv360, ttd, meta, tiktok…)
  campaign: { id: string; name: string; is_demo: boolean };
  /** Budget (€) de la ligne de CE canal — jamais le global. */
  channelBudget: number | null;
  budgetChanged: boolean;
  zoneName: string;
  /** Items + CP + score (poids/100) du snapshot v+1 ; vide si pas de snapshot. */
  tiers: WeightedBiddingTier[];
  connection: Dv360ConnectionRow | null;
  links: DspLinks | null;
  isDemo: boolean;
}

export interface BiddingPushResult {
  channel: string;
  status: PushStatus;
  detail: string;
  payload_summary: Record<string, unknown>;
}

export interface BiddingPusher {
  channel: string;
  push(ctx: BiddingPushContext): Promise<BiddingPushResult>;
}
```

- [ ] **Step 4: `lib/dsp/push/simulated.ts`**

```ts
/**
 * Connecteur simulé : construit EXACTEMENT ce qui serait envoyé (script custom
 * bidding pondéré, delta budget) mais n'appelle aucune API. C'est ce payload
 * qui est journalisé — le mode démo montre le vrai contenu.
 */
import { buildWeightedZoneBiddingScript } from '@/lib/digital/dv360-bidding-script';
import type { BiddingPushContext, BiddingPushResult, BiddingPusher } from './types';

export function buildPayloadSummary(ctx: BiddingPushContext): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  if (ctx.tiers.length > 0) {
    summary.script = buildWeightedZoneBiddingScript(ctx.zoneName, ctx.tiers);
    summary.tiers_count = ctx.tiers.length;
  }
  if (ctx.budgetChanged && ctx.channelBudget != null) summary.budget = ctx.channelBudget;
  return summary;
}

export function simulatedPusher(channel: string): BiddingPusher {
  return {
    channel,
    async push(ctx: BiddingPushContext): Promise<BiddingPushResult> {
      const payload = buildPayloadSummary(ctx);
      const parts = [
        payload.script ? 'script custom bidding' : null,
        payload.budget != null ? `budget ${ctx.channelBudget} €` : null,
      ].filter(Boolean);
      return {
        channel,
        status: 'simulated',
        detail: parts.length
          ? `Simulé (${ctx.isDemo ? 'mode démo' : 'canal non connecté'}) : ${parts.join(' + ')}`
          : `Simulé (${ctx.isDemo ? 'mode démo' : 'canal non connecté'}) : rien à pousser`,
        payload_summary: payload,
      };
    },
  };
}

export function skippedPusher(channel: string, detail: string): BiddingPusher {
  return {
    channel,
    async push(): Promise<BiddingPushResult> {
      return { channel, status: 'skipped', detail, payload_summary: {} };
    },
  };
}
```

- [ ] **Step 5: Client DV360 — upload script + patch budget IO**

Ajouter à la fin de `lib/dsp/dv360/client.ts` :

```ts
/**
 * Upload d'un script custom bidding (3 appels : uploadScript → media upload →
 * scripts.create). L'algorithme (links.algorithm_id) doit exister côté DV360.
 */
export async function uploadCustomBiddingScript(
  accessToken: string,
  advertiserId: string,
  algorithmId: string,
  script: string,
): Promise<{ scriptName: string }> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const refRes = await fetch(
    `${DV360_BASE}/customBiddingAlgorithms/${encodeURIComponent(algorithmId)}:uploadScript?advertiserId=${encodeURIComponent(advertiserId)}`,
    { headers: auth, cache: 'no-store' },
  );
  if (!refRes.ok) throw new Error(`DV360 uploadScript ref ${refRes.status} : ${(await refRes.text()).slice(0, 300)}`);
  const ref = (await refRes.json()) as { resourceName?: string };
  if (!ref.resourceName) throw new Error('DV360 uploadScript : resourceName absent.');

  const upRes = await fetch(
    `https://displayvideo.googleapis.com/upload/media/${ref.resourceName}?uploadType=media`,
    { method: 'POST', headers: { ...auth, 'Content-Type': 'text/plain' }, cache: 'no-store', body: script },
  );
  if (!upRes.ok) throw new Error(`DV360 media upload ${upRes.status} : ${(await upRes.text()).slice(0, 300)}`);

  const createRes = await fetch(
    `${DV360_BASE}/customBiddingAlgorithms/${encodeURIComponent(algorithmId)}/scripts?advertiserId=${encodeURIComponent(advertiserId)}`,
    {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ script: { resource: { resourceName: ref.resourceName } } }),
    },
  );
  if (!createRes.ok) throw new Error(`DV360 scripts.create ${createRes.status} : ${(await createRes.text()).slice(0, 300)}`);
  const created = (await createRes.json()) as { name?: string };
  return { scriptName: created.name ?? '' };
}

/**
 * Met à jour le budget d'un insertion order : lit l'IO, remplace le montant du
 * DERNIER segment de budget, PATCH avec updateMask ciblé.
 */
export async function patchInsertionOrderBudget(
  accessToken: string,
  advertiserId: string,
  insertionOrderId: string,
  budgetAmountMicros: number,
): Promise<void> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const base = `${DV360_BASE}/advertisers/${encodeURIComponent(advertiserId)}/insertionOrders/${encodeURIComponent(insertionOrderId)}`;
  const getRes = await fetch(base, { headers: auth, cache: 'no-store' });
  if (!getRes.ok) throw new Error(`DV360 insertionOrders.get ${getRes.status} : ${(await getRes.text()).slice(0, 300)}`);
  const io = (await getRes.json()) as { budget?: { budgetUnit?: string; budgetSegments?: Array<Record<string, unknown>> } };
  const segments = io.budget?.budgetSegments ?? [];
  if (segments.length === 0) throw new Error('DV360 : insertion order sans segment de budget.');
  segments[segments.length - 1] = { ...segments[segments.length - 1], budgetAmountMicros: String(budgetAmountMicros) };
  const patchRes = await fetch(`${base}?updateMask=budget.budgetSegments`, {
    method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ budget: { ...io.budget, budgetSegments: segments } }),
  });
  if (!patchRes.ok) throw new Error(`DV360 insertionOrders.patch ${patchRes.status} : ${(await patchRes.text()).slice(0, 300)}`);
}
```

- [ ] **Step 6: `lib/dsp/push/dv360.ts`**

```ts
/** Connecteur DV360 réel : script custom bidding + budget IO, best-effort. */
import { buildWeightedZoneBiddingScript } from '@/lib/digital/dv360-bidding-script';
import { resolveAccessToken, uploadCustomBiddingScript, patchInsertionOrderBudget } from '@/lib/dsp/dv360/client';
import type { BiddingPushContext, BiddingPushResult, BiddingPusher } from './types';

export const dv360Pusher: BiddingPusher = {
  channel: 'dv360',
  async push(ctx: BiddingPushContext): Promise<BiddingPushResult> {
    const links = ctx.links?.dv360;
    if (!links?.advertiser_id || (!links.algorithm_id && !links.insertion_order_id)) {
      return {
        channel: 'dv360', status: 'skipped',
        detail: 'IDs DV360 non renseignés (advertiser + algorithme ou insertion order) — à saisir dans la section Canaux',
        payload_summary: {},
      };
    }
    if (!ctx.connection) {
      return { channel: 'dv360', status: 'skipped', detail: 'Connexion DV360 absente', payload_summary: {} };
    }
    const token = await resolveAccessToken(ctx.connection);
    const done: string[] = [];
    const payload: Record<string, unknown> = {};
    if (links.algorithm_id && ctx.tiers.length > 0) {
      const script = buildWeightedZoneBiddingScript(ctx.zoneName, ctx.tiers);
      const { scriptName } = await uploadCustomBiddingScript(token, links.advertiser_id, links.algorithm_id, script);
      done.push('script custom bidding');
      payload.script_name = scriptName;
      payload.tiers_count = ctx.tiers.length;
    }
    if (links.insertion_order_id && ctx.budgetChanged && ctx.channelBudget != null) {
      await patchInsertionOrderBudget(token, links.advertiser_id, links.insertion_order_id, Math.round(ctx.channelBudget * 1_000_000));
      done.push(`budget IO ${ctx.channelBudget} €`);
      payload.budget = ctx.channelBudget;
    }
    if (done.length === 0) {
      return { channel: 'dv360', status: 'skipped', detail: 'Rien à pousser (ni script ni delta budget)', payload_summary: {} };
    }
    return { channel: 'dv360', status: 'pushed', detail: `Poussé : ${done.join(' + ')}`, payload_summary: payload };
  },
};
```

- [ ] **Step 7: `lib/dsp/push/index.ts` (sélection + exécution)**

```ts
/**
 * Sélection du connecteur par canal + exécution avec catch → failed.
 * Règles (spec §5) :
 *   démo OU pas de connexion  → simulé (payload réel, zéro appel API)
 *   connexion + connecteur    → réel (pushed/failed)
 *   connexion sans connecteur → skipped
 */
import { dv360Pusher } from './dv360';
import { simulatedPusher, skippedPusher } from './simulated';
import type { BiddingPushContext, BiddingPushResult, BiddingPusher } from './types';

const REAL_PUSHERS: Record<string, BiddingPusher> = { dv360: dv360Pusher };

export function selectPusher(channel: string, isDemo: boolean, hasConnection: boolean): BiddingPusher {
  if (isDemo || !hasConnection) return simulatedPusher(channel);
  return REAL_PUSHERS[channel] ?? skippedPusher(channel, `Connecteur ${channel} non implémenté — push manuel via export`);
}

export async function runPush(ctx: BiddingPushContext): Promise<BiddingPushResult> {
  const pusher = selectPusher(ctx.channel, ctx.isDemo, ctx.connection !== null);
  try {
    return await pusher.push(ctx);
  } catch (e) {
    return {
      channel: ctx.channel, status: 'failed',
      detail: e instanceof Error ? e.message.slice(0, 300) : 'Erreur inconnue',
      payload_summary: {},
    };
  }
}
```

- [ ] **Step 8: Vérifier le pass + commit**

Run: `npx tsc --noEmit && npm test -- --run tests/unit/dsp/push.test.ts`
Expected: 0 erreur tsc, 5 tests PASS.

```bash
git add lib/dsp/push lib/dsp/dv360/client.ts tests/unit/dsp/push.test.ts
git commit -m "feat: connecteurs push bidding (DV360 réel + simulé + skipped) et client DV360 script/budget"
```

---

### Task 4: Migration RPC + route `POST /api/bidding/strategies/[id]/adjust`

**Files:**
- Create: `sql/103_adjust_helpers.sql` (+ apply via MCP Supabase)
- Create: `app/api/bidding/strategies/[id]/adjust/route.ts`
- Modify: `app/api/bidding/strategies/[id]/journal/route.ts` (1 case dans `titleForAction`)

**Interfaces:**
- Consumes: `sumBudgets, pruneBudgets, validateSelection, CampaignChannelsSchema, ChannelBudgetsSchema, DspLinksSchema, StoredChannels` (Task 1) ; `runPush, BiddingPushContext` (Task 3) ; `INTENSITY_CURVES, TARGET_VARIABLE_CODE` de `app/campaigns/[id]/_components/steps/types` (import type-safe côté serveur : ce fichier n'a pas de `'use client'` bloquant les imports de constantes — vérifier au build ; sinon dupliquer les courbes dans `lib/campaigns/intensity.ts` et faire importer les deux) ; RPC existantes `log_strategy_change`, `apply_zone_weights_to_strategy` ; `checkStrategyAccess, checkCampaignAccess, checkZoneAccess` de `lib/campaigns/access` ; `effectiveCampaignStatus` de `lib/campaigns/status` ; `logDspEvent` de `lib/dsp/logger`.
- Produces: `POST /api/bidding/strategies/[id]/adjust` → `{ changes: [{field, old, new}], snapshot_version: number | null, pushes: BiddingPushResult[] }` ; RPC `duplicate_plan_snapshot(p_campaign_id, p_created_by, p_budgets, p_cpm, p_period_start, p_period_end) → {new_version, rows_inserted}` ; le journal affiche « Ajustement manuel » pour `intent='manual_adjust'`.

- [ ] **Step 1: Vérifier les colonnes de `bidding_agent_actions`**

Via MCP Supabase `execute_sql` :

```sql
select column_name, is_nullable, data_type from information_schema.columns
where table_name = 'bidding_agent_actions' order by ordinal_position;
```

Expected: colonnes `strategy_id, intent, trigger_source, agent_response, recommendations, action_taken, applied_at, llm_model, autonomy_level_at_time, created_at` (+ id). Si une colonne NOT NULL sans défaut n'est pas dans l'insert du Step 5, l'ajouter à l'insert avec une valeur neutre documentée.

- [ ] **Step 2: Migration `duplicate_plan_snapshot`**

Écrire `sql/103_adjust_helpers.sql` ET l'appliquer via MCP `apply_migration` (nom `adjust_helpers`) :

```sql
-- 103 — Ajuster : duplication serveur du dernier snapshot de plan en v+1
-- (évite un aller-retour de milliers de lignes CP sur Nano).
-- p_budgets : jsonb {"dv360": 30000, "tiktok": 15000} — budget par dsp du snapshot ;
-- clé absente = budget inchangé. p_cpm/p_period_* : null = inchangé.
create or replace function public.duplicate_plan_snapshot(
  p_campaign_id uuid,
  p_created_by uuid,
  p_budgets jsonb default '{}'::jsonb,
  p_cpm numeric default null,
  p_period_start date default null,
  p_period_end date default null
) returns table (new_version int, rows_inserted int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last int;
  v_new int;
  v_count int;
begin
  select max(version) into v_last from campaign_plan_snapshot where campaign_id = p_campaign_id;
  if v_last is null then
    return query select null::int, 0;
    return;
  end if;
  v_new := v_last + 1;
  insert into campaign_plan_snapshot (
    campaign_id, version, created_by, dsp, budget, cpm, cible,
    zone_id, zone_name, item_id, item_name, item_weight, expected_share,
    postal_code, period_start, period_end
  )
  select
    campaign_id, v_new, p_created_by, dsp,
    coalesce((p_budgets ->> dsp)::numeric, budget),
    coalesce(p_cpm, cpm), cible,
    zone_id, zone_name, item_id, item_name, item_weight, expected_share,
    postal_code,
    coalesce(p_period_start, period_start),
    coalesce(p_period_end, period_end)
  from campaign_plan_snapshot
  where campaign_id = p_campaign_id and version = v_last;
  get diagnostics v_count = row_count;
  return query select v_new, v_count;
end;
$$;

-- Durcissement (pattern projet : SECURITY DEFINER verrouillé service_role)
revoke all on function public.duplicate_plan_snapshot(uuid, uuid, jsonb, numeric, date, date) from public, anon, authenticated;
grant execute on function public.duplicate_plan_snapshot(uuid, uuid, jsonb, numeric, date, date) to service_role;
```

NOTE exécuteur : si `campaign_plan_snapshot` a des colonnes en plus/en moins (vérifier via `information_schema.columns`), ajuster la liste — la duplication doit copier TOUTES les colonnes métier hors `id`/`created_at`.

Vérifier : `select * from duplicate_plan_snapshot('00000000-0000-4000-8000-000000000000'::uuid, '00000000-0000-4000-8000-000000000000'::uuid);` → `(null, 0)` sans erreur.

- [ ] **Step 3: Cas `manual_adjust` dans le journal**

Dans `app/api/bidding/strategies/[id]/journal/route.ts`, fonction `titleForAction`, ajouter avant `default:` :

```ts
    case 'manual_adjust': return 'Ajustement manuel';
```

- [ ] **Step 4: Route adjust — création complète**

Créer `app/api/bidding/strategies/[id]/adjust/route.ts` :

```ts
/**
 * POST /api/bidding/strategies/[id]/adjust
 * Action « Ajuster » : patch partiel de la stratégie active SANS re-wizard,
 * budgets PAR CANAL (global = somme serveur), puis re-push bidding via
 * connecteurs (lib/dsp/push) et historisation :
 *   - strategy_changes (audit fin, change_type='adjusted', via log_strategy_change)
 *   - bidding_agent_actions (événement consolidé intent='manual_adjust' → journal + chat)
 *   - dsp_api_logs (une ligne par tentative de push, provider connu uniquement)
 * Un échec de push N'ANNULE PAS l'ajustement (succès partiel, statut failed).
 * Nano : orchestration séquentielle, jamais >3 requêtes en parallèle.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkStrategyAccess, checkZoneAccess } from '@/lib/campaigns/access';
import { effectiveCampaignStatus } from '@/lib/campaigns/status';
import {
  CampaignChannelsSchema, ChannelBudgetsSchema, DspLinksSchema,
  validateSelection, pruneBudgets, sumBudgets,
  type ChannelRow, type StoredChannels, type CampaignChannels, type DspLinks,
} from '@/lib/campaigns/channels';
import { runPush } from '@/lib/dsp/push';
import type { BiddingPushResult } from '@/lib/dsp/push/types';
import type { WeightedBiddingTier } from '@/lib/digital/dv360-bidding-script';
import type { Dv360ConnectionRow } from '@/lib/dsp/dv360/client';
import { logDspEvent } from '@/lib/dsp/logger';
import type { DspProvider } from '@/types/dsp';
import { INTENSITY_CURVES, TARGET_VARIABLE_CODE, type Intensity } from '@/app/campaigns/[id]/_components/steps/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AdjustSchema = z.object({
  reason: z.string().min(3).max(2000),
  changes: z.object({
    channel_budgets: ChannelBudgetsSchema.optional(),
    forecast_cpm: z.number().positive().optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    execution_mode: z.enum(['monitor_only', 'suggest', 'auto']).optional(),
    intensity: z.enum(['doux', 'marque', 'fort']).optional(),
    zone: z.object({
      scope_type: z.enum(['national', 'custom_zone']),
      zone_id: z.string().uuid().nullable(),
    }).optional(),
    channels: CampaignChannelsSchema.optional(),
  }).refine((o) => Object.keys(o).length > 0, { message: 'aucun_changement' }),
  links: DspLinksSchema.optional(),
});

const KNOWN_PROVIDERS: ReadonlySet<string> = new Set(['dv360', 'meta', 'tiktok', 'ttd']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { id } = await params;

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = AdjustSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const { reason, changes } = parsed.data;
  if (changes.start_date && changes.end_date && changes.start_date > changes.end_date) {
    return NextResponse.json({ error: 'dates_incoherentes' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const access = await checkStrategyAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  // ── Gardes : stratégie active + campagne ni en pause ni clôturée ─────────────
  const { data: strategy } = await supabase
    .from('bidding_strategies')
    .select('id, campaign_id, status, total_budget, forecast_cpm, start_date, end_date, execution_mode, in_zone_weights, out_zone_weights, scope_type, zone_id')
    .eq('id', id).single();
  if (!strategy) return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });
  if (strategy.status !== 'active') {
    return NextResponse.json({ error: 'strategy_not_active', status: strategy.status }, { status: 409 });
  }

  const { data: campaign } = await supabase
    .from('dsp_campaigns')
    .select('id, name, organization_id, is_demo, geo_strategy, date_start, date_end, status_override')
    .eq('id', strategy.campaign_id).single();
  if (!campaign) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  const today = new Date().toISOString().slice(0, 10);
  const campStatus = effectiveCampaignStatus(campaign as never, today);
  if (campStatus === 'en_pause' || campaign.status_override === 'ended' || campStatus === 'archivee') {
    return NextResponse.json({ error: 'campaign_not_adjustable', status: campStatus }, { status: 409 });
  }

  const { data: profRow } = await supabase.from('profiles').select('demo_mode').eq('id', profile.id).maybeSingle();
  const isDemo = !!campaign.is_demo || !!(profRow as { demo_mode?: boolean } | null)?.demo_mode;

  if (changes.zone?.zone_id) {
    const zoneAccess = await checkZoneAccess(supabase, profile, changes.zone.zone_id);
    if (zoneAccess !== 'ok') return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });
  }

  // ── Canaux / budgets : état stocké + nouvel état ─────────────────────────────
  const gs = (campaign.geo_strategy ?? {}) as Record<string, unknown>;
  const prevChannels = (gs.channels ?? { dsps: [], socials: [], ad_server: null }) as StoredChannels;
  const sel: CampaignChannels = changes.channels ?? {
    dsps: prevChannels.dsps ?? [], socials: prevChannels.socials ?? [], ad_server: prevChannels.ad_server ?? null,
  };

  const { data: regRows } = await supabase
    .from('dsp_channel_registry')
    .select('code, label, category, connection_provider, active')
    .eq('active', true);
  const catalog = (regRows ?? []) as ChannelRow[];

  const { data: connProvRows } = await supabase
    .from('dsp_connections').select('provider')
    .eq('organization_id', campaign.organization_id).eq('status', 'connected');
  const connectedProviders = ((connProvRows ?? []) as Array<{ provider: string }>).map((c) => c.provider);

  if (changes.channels) {
    const check = validateSelection(sel, catalog, connectedProviders, isDemo);
    if (!check.ok) return NextResponse.json({ error: 'channel_not_available', code: check.badCode }, { status: 400 });
  }

  const prevBudgets = prevChannels.budgets ?? {};
  const nextBudgets = pruneBudgets(changes.channel_budgets ?? prevBudgets, sel);
  const budgetsChanged = JSON.stringify(prevBudgets) !== JSON.stringify(nextBudgets);
  const newTotal = sumBudgets(nextBudgets);
  if ((changes.channel_budgets || changes.channels) && newTotal <= 0) {
    return NextResponse.json({ error: 'budget_total_nul' }, { status: 400 });
  }

  // ── Patch partiel bidding_strategies (même mécanique que la route PATCH) ─────
  const updates: Record<string, unknown> = {};
  const changesLog: Array<{ field: string; old: unknown; new: unknown }> = [];
  const push = (field: string, oldV: unknown, newV: unknown) => {
    if (JSON.stringify(oldV) !== JSON.stringify(newV)) { updates[field] = newV; changesLog.push({ field, old: oldV, new: newV }); }
  };
  if (budgetsChanged) push('total_budget', strategy.total_budget, newTotal);
  if (changes.forecast_cpm !== undefined) push('forecast_cpm', strategy.forecast_cpm, changes.forecast_cpm);
  if (changes.start_date !== undefined) push('start_date', strategy.start_date ? String(strategy.start_date).slice(0, 10) : null, changes.start_date);
  if (changes.end_date !== undefined) push('end_date', strategy.end_date ? String(strategy.end_date).slice(0, 10) : null, changes.end_date);
  if (changes.execution_mode !== undefined) push('execution_mode', strategy.execution_mode, changes.execution_mode);
  if (changes.intensity !== undefined) {
    push('in_zone_weights', strategy.in_zone_weights, {
      mode: 'by_insee_variable', variable_code: TARGET_VARIABLE_CODE,
      curve: INTENSITY_CURVES[changes.intensity as Intensity],
    });
  }
  if (changes.zone !== undefined) {
    push('scope_type', strategy.scope_type, changes.zone.scope_type);
    push('zone_id', strategy.zone_id, changes.zone.zone_id);
  }

  if (Object.keys(updates).length > 0) {
    const { error: uErr } = await supabase.from('bidding_strategies').update(updates).eq('id', id);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
    const weightChanged = 'in_zone_weights' in updates || 'zone_id' in updates || 'scope_type' in updates;
    if (weightChanged) {
      const { error: rpcErr } = await supabase.rpc('apply_zone_weights_to_strategy', {
        p_strategy_id: id,
        p_in_weights: (updates.in_zone_weights as Record<string, unknown>) ?? strategy.in_zone_weights ?? {},
        p_out_weights: strategy.out_zone_weights ?? {},
      });
      if (rpcErr) return NextResponse.json({ error: `apply_zone_weights: ${rpcErr.message}` }, { status: 500 });
    }
    for (const ch of changesLog) {
      await supabase.rpc('log_strategy_change', {
        p_strategy_id: id, p_change_type: 'adjusted', p_field_path: ch.field,
        p_old_value: ch.old as never, p_new_value: ch.new as never,
        p_reason: reason, p_triggered_by: 'user',
      });
    }
  }

  // ── Canaux + budgets + links → geo_strategy.channels (merge non destructif) ──
  const prevLinks = prevChannels.links;
  const nextLinks: DspLinks | undefined = parsed.data.links
    ? { ...prevLinks, ...parsed.data.links }
    : prevLinks;
  const channelsPayloadChanged = changes.channels !== undefined || budgetsChanged || parsed.data.links !== undefined;
  if (channelsPayloadChanged) {
    const nextChannels: StoredChannels = { ...sel, budgets: nextBudgets, ...(nextLinks ? { links: nextLinks } : {}) };
    const { error: gErr } = await supabase.from('dsp_campaigns')
      .update({ geo_strategy: { ...gs, channels: nextChannels } }).eq('id', campaign.id);
    if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 });
    if (changes.channels) changesLog.push({ field: 'channels', old: { dsps: prevChannels.dsps, socials: prevChannels.socials, ad_server: prevChannels.ad_server }, new: sel });
    if (budgetsChanged) changesLog.push({ field: 'channel_budgets', old: prevBudgets, new: nextBudgets });
  }

  // ── Snapshot v+1 (RPC serveur — copie du dernier plan avec budgets/cpm/période à jour)
  let snapshotVersion: number | null = null;
  const { data: dupRows, error: dupErr } = await supabase.rpc('duplicate_plan_snapshot', {
    p_campaign_id: campaign.id,
    p_created_by: profile.id,
    p_budgets: nextBudgets,
    p_cpm: changes.forecast_cpm ?? null,
    p_period_start: changes.start_date ?? null,
    p_period_end: changes.end_date ?? null,
  });
  if (dupErr) console.error('[adjust] duplicate_plan_snapshot:', dupErr.message);
  const dup = Array.isArray(dupRows) ? dupRows[0] as { new_version: number | null } | undefined : undefined;
  snapshotVersion = dup?.new_version ?? null;

  // ── Tiers pour le script pondéré (depuis le snapshot v+1, borné) ─────────────
  const tiersByDsp = new Map<string, WeightedBiddingTier[]>();
  let zoneName = 'Zone de la stratégie';
  if (snapshotVersion != null) {
    const { data: snapRows } = await supabase
      .from('campaign_plan_snapshot')
      .select('dsp, zone_name, item_id, item_name, item_weight, postal_code')
      .eq('campaign_id', campaign.id).eq('version', snapshotVersion).limit(5000);
    const byKey = new Map<string, { dsp: string; name: string; score: number; cps: string[] }>();
    for (const r of (snapRows ?? []) as Array<{ dsp: string; zone_name: string; item_id: string; item_name: string; item_weight: number; postal_code: string }>) {
      zoneName = r.zone_name || zoneName;
      const k = `${r.dsp}:${r.item_id}`;
      const cur = byKey.get(k) ?? { dsp: r.dsp, name: r.item_name, score: (r.item_weight ?? 0) / 100, cps: [] };
      cur.cps.push(r.postal_code);
      byKey.set(k, cur);
    }
    for (const t of byKey.values()) {
      const list = tiersByDsp.get(t.dsp) ?? [];
      list.push({ name: t.name, cps: t.cps, score: t.score });
      tiersByDsp.set(t.dsp, list);
    }
  }

  // ── Push par canal (séquentiel) ──────────────────────────────────────────────
  const providerByCode = new Map(catalog.map((c) => [c.code, c.connection_provider]));
  const neededProviders = [...new Set([...sel.dsps, ...sel.socials]
    .map((code) => providerByCode.get(code)).filter((p): p is string => !!p))];
  let connByProvider = new Map<string, Dv360ConnectionRow>();
  if (neededProviders.length > 0) {
    const { data: connRows } = await supabase
      .from('dsp_connections')
      .select('provider, auth_method, credentials_encrypted, oauth_refresh_token_encrypted, oauth_client_id, oauth_client_secret_encrypted')
      .eq('organization_id', campaign.organization_id).eq('status', 'connected')
      .in('provider', neededProviders);
    connByProvider = new Map(((connRows ?? []) as Array<Dv360ConnectionRow & { provider: string }>)
      .map((c) => [c.provider, c]));
  }

  const pushes: BiddingPushResult[] = [];
  for (const code of [...sel.dsps, ...sel.socials]) {
    const provider = providerByCode.get(code) ?? null;
    const connection = provider ? (connByProvider.get(provider) ?? null) : null;
    const started = Date.now();
    const result = await runPush({
      channel: code,
      campaign: { id: campaign.id, name: campaign.name, is_demo: !!campaign.is_demo },
      channelBudget: nextBudgets[code] ?? null,
      budgetChanged: budgetsChanged && prevBudgets[code] !== nextBudgets[code],
      zoneName,
      tiers: tiersByDsp.get(code) ?? tiersByDsp.get('dv360') ?? [],
      connection,
      links: nextLinks ?? null,
      isDemo,
    });
    pushes.push(result);
    if (provider && KNOWN_PROVIDERS.has(provider) && campaign.organization_id) {
      await logDspEvent({
        orgId: campaign.organization_id, provider: provider as DspProvider,
        category: 'api_call', level: result.status === 'failed' ? 'error' : 'info',
        action: 'bidding_push', durationMs: Date.now() - started,
        message: `${result.status} — ${result.detail}`.slice(0, 500),
        detail: { channel: code, snapshot_version: snapshotVersion, ...('budget' in result.payload_summary ? { budget: result.payload_summary.budget } : {}) },
      });
    }
  }

  // ── Événement consolidé → journal + chat (bidding_agent_actions) ─────────────
  const summary = changesLog.map((c) => c.field).join(', ') || 'canaux/links';
  const { error: actErr } = await supabase.from('bidding_agent_actions').insert({
    strategy_id: id,
    intent: 'manual_adjust',
    trigger_source: 'user',
    agent_response: reason,
    recommendations: {
      changes: changesLog,
      pushes: pushes.map((p) => ({ channel: p.channel, status: p.status, detail: p.detail })),
      snapshot_version: snapshotVersion,
    },
    action_taken: `Ajustement : ${summary}`,
    applied_at: new Date().toISOString(),
  });
  if (actErr) console.error('[adjust] bidding_agent_actions:', actErr.message);

  return NextResponse.json({ changes: changesLog, snapshot_version: snapshotVersion, pushes });
}
```

NOTE exécuteur : si l'import de `INTENSITY_CURVES` depuis `app/campaigns/[id]/_components/steps/types` casse le build serveur (fichier importé par des composants client mais sans directive `'use client'` propre — vérifier), créer `lib/campaigns/intensity.ts` avec `Intensity`, `INTENSITY_CURVES`, `TARGET_VARIABLE_CODE` déplacés, et ré-exporter depuis `types.ts` pour ne pas casser le wizard.

- [ ] **Step 5: Type-check + tests + commit**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: 0 erreur, tests verts.

```bash
git add sql/103_adjust_helpers.sql "app/api/bidding/strategies/[id]/adjust/route.ts" "app/api/bidding/strategies/[id]/journal/route.ts"
git commit -m "feat: route adjust (patch partiel + snapshot v+1 + push par canal + journal consolidé)"
```

---

### Task 5: AdjustPanel + bouton « Ajuster » dans CampaignOverview

**Files:**
- Create: `components/campaign/AdjustPanel.tsx`
- Modify: `components/campaign/CampaignOverview.tsx`

**Interfaces:**
- Consumes: `POST /api/bidding/strategies/[id]/adjust` (Task 4) ; `GET /api/bidding/strategies/[id]` (existant, → `{strategy}`) ; `GET /api/campaigns/[id]/channels` (Task 1, → `{catalog, connectedProviders, is_demo, selected}`) ; `GET /api/custom-geo/list?org_id=` (existant, → `{zones: [{id, name}]}` — vérifier la clé exacte de la réponse dans `app/api/custom-geo/list/route.ts` au moment de coder) ; `GET /api/admin/campaigns/[id]/organizations` → `{owner_organization_id}` ; `resolveFinalZone` (Task 2) ; `inferIntensity, INTENSITY_META, EXECUTION_MODE_META, INTENSITY_CURVES, fmtEUR, type Intensity, type ExecutionMode` de `steps/types` ; atomes `ui.tsx`.
- Produces: `AdjustPanel` — props `{ campaignId: string; strategyId: string; open: boolean; onClose: () => void; onApplied: () => void; initialChanges?: Record<string, unknown>; initialReason?: string }`. Exportée pour CampaignOverview (bouton) et CampaignSuivi (Task 6, proposition du chat).

- [ ] **Step 1: Créer `components/campaign/AdjustPanel.tsx`**

```tsx
'use client';

/**
 * AdjustPanel — action « Ajuster » : modale compacte pour modifier une campagne
 * LANCÉE (stratégie active) sans repasser le wizard. Sections pré-remplies :
 * budgets PAR CANAL (global = somme), CPM, dates, mode, intensité, cible, canaux
 * (+ liens DV360). Diff, pas re-saisie : seul le modifié part au serveur
 * (POST /api/bidding/strategies/[id]/adjust) — raison obligatoire, récap des
 * pushes par canal (poussé / simulé / échec / ignoré) au retour.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { resolveFinalZone } from '@/lib/campaigns/resolve-zone';
import type { ChannelRow, StoredChannels, CampaignChannels, DspLinks } from '@/lib/campaigns/channels';
import {
  INTENSITY_META, EXECUTION_MODE_META, inferIntensity, fmtEUR,
  type Intensity, type ExecutionMode,
} from '@/app/campaigns/[id]/_components/steps/types';
import {
  C, fInter, fMono, FieldBlock, NumberField, DateField, OptionRow, OptsList,
  GhostButton, PrimaryButton, Row2,
} from '@/app/campaigns/[id]/_components/steps/ui';

interface PushLine { channel: string; status: 'pushed' | 'simulated' | 'failed' | 'skipped'; detail: string }

interface PanelState {
  channelBudgets: Record<string, number>;
  forecastCpm: number | null;
  startDate: string;
  endDate: string;
  executionMode: ExecutionMode;
  intensity: Intensity;
  cibles: { id: string; name: string }[];
  channels: CampaignChannels;
  links: DspLinks;
}

const PUSH_LABEL: Record<PushLine['status'], string> = {
  pushed: 'poussé', simulated: 'simulé', failed: 'échec', skipped: 'ignoré',
};

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div style={{ border: `0.5px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', background: C.elevated, border: 'none', cursor: 'pointer',
          padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
        }}
      >
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal, flexShrink: 0 }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: C.text }}>{title}</span>
        <span style={{ marginLeft: 'auto', fontFamily: fMono, fontSize: 11, color: C.textDim }}>{open ? '−' : '+'}</span>
      </button>
      {open && <div style={{ padding: '14px' }}>{children}</div>}
    </div>
  );
}

export function AdjustPanel({
  campaignId, strategyId, open, onClose, onApplied, initialChanges, initialReason,
}: {
  campaignId: string; strategyId: string; open: boolean;
  onClose: () => void; onApplied: () => void;
  initialChanges?: Record<string, unknown>; initialReason?: string;
}) {
  const { toast: toastApi } = useToast();
  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState<PanelState | null>(null);
  const [state, setState] = useState<PanelState | null>(null);
  const [catalog, setCatalog] = useState<ChannelRow[]>([]);
  const [reason, setReason] = useState(initialReason ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [pushResults, setPushResults] = useState<PushLine[] | null>(null);
  const [ownerOrgId, setOwnerOrgId] = useState<string | null>(null);
  const [zonesList, setZonesList] = useState<{ id: string; name: string }[]>([]);

  // Chargement initial : stratégie + canaux (2 appels), org + zones en lazy.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setPushResults(null);
    (async () => {
      try {
        const [sRes, chRes] = await Promise.all([
          adminFetch(`/api/bidding/strategies/${strategyId}`, { cache: 'no-store' }),
          adminFetch(`/api/campaigns/${campaignId}/channels`, { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        const s = sRes.ok ? (await sRes.json()).strategy ?? {} : {};
        const ch = chRes.ok ? await chRes.json() : { catalog: [], selected: { dsps: [], socials: [], ad_server: null } };
        const stored = (ch.selected ?? {}) as StoredChannels;
        const base: PanelState = {
          channelBudgets: { ...(stored.budgets ?? {}) },
          forecastCpm: s.forecast_cpm ?? null,
          startDate: s.start_date ? String(s.start_date).slice(0, 10) : '',
          endDate: s.end_date ? String(s.end_date).slice(0, 10) : '',
          executionMode: (s.execution_mode ?? 'auto') as ExecutionMode,
          intensity: inferIntensity(s.in_zone_weights) ?? 'marque',
          cibles: s.zone_id ? [{ id: s.zone_id, name: 'Zone de la stratégie' }] : [],
          channels: { dsps: stored.dsps ?? [], socials: stored.socials ?? [], ad_server: stored.ad_server ?? null },
          links: stored.links ?? {},
        };
        setCatalog((ch.catalog ?? []) as ChannelRow[]);
        setInitial(base);
        // Pré-remplissage externe (proposition de l'agent) : merge sur l'état courant.
        const ic = initialChanges ?? {};
        setState({
          ...base,
          channelBudgets: { ...base.channelBudgets, ...((ic.channel_budgets as Record<string, number>) ?? {}) },
          forecastCpm: (ic.forecast_cpm as number | undefined) ?? base.forecastCpm,
          startDate: (ic.start_date as string | undefined) ?? base.startDate,
          endDate: (ic.end_date as string | undefined) ?? base.endDate,
          executionMode: (ic.execution_mode as ExecutionMode | undefined) ?? base.executionMode,
          intensity: (ic.intensity as Intensity | undefined) ?? base.intensity,
        });
      } catch { /* best-effort */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, campaignId, strategyId, initialChanges]);

  // Org + zones custom (pour la section Cible) — lazy, une fois le panneau ouvert.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const orgRes = await adminFetch(`/api/admin/campaigns/${campaignId}/organizations`, { cache: 'no-store' });
        const orgData = orgRes.ok ? await orgRes.json() : {};
        const org = (orgData.owner_organization_id as string | undefined) ?? null;
        if (cancelled) return;
        setOwnerOrgId(org);
        if (org) {
          const zRes = await adminFetch(`/api/custom-geo/list?org_id=${org}`, { cache: 'no-store' });
          const zData = zRes.ok ? await zRes.json() : {};
          if (!cancelled) {
            setZonesList(((zData.zones ?? []) as Array<{ id: string; name: string }>).map((z) => ({ id: z.id, name: z.name })));
          }
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [open, campaignId]);

  const labels = useMemo(() => Object.fromEntries(catalog.map((c) => [c.code, c.label])), [catalog]);
  const total = useMemo(
    () => state ? Object.values(state.channelBudgets).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0) : 0,
    [state],
  );

  // ── Diff : ne soumettre QUE le modifié ──────────────────────────────────────
  const diff = useMemo(() => {
    if (!initial || !state) return { changes: {} as Record<string, unknown>, labels: [] as string[] };
    const changes: Record<string, unknown> = {};
    const out: string[] = [];
    if (JSON.stringify(initial.channelBudgets) !== JSON.stringify(state.channelBudgets)) {
      changes.channel_budgets = state.channelBudgets;
      out.push(`budgets → global ${fmtEUR(total || null)}`);
    }
    if (initial.forecastCpm !== state.forecastCpm && state.forecastCpm != null) {
      changes.forecast_cpm = state.forecastCpm; out.push(`CPM ${initial.forecastCpm ?? '—'} → ${state.forecastCpm}`);
    }
    if (initial.startDate !== state.startDate && state.startDate) { changes.start_date = state.startDate; out.push(`début ${state.startDate}`); }
    if (initial.endDate !== state.endDate && state.endDate) { changes.end_date = state.endDate; out.push(`fin ${state.endDate}`); }
    if (initial.executionMode !== state.executionMode) { changes.execution_mode = state.executionMode; out.push(`mode ${EXECUTION_MODE_META[state.executionMode].title}`); }
    if (initial.intensity !== state.intensity) { changes.intensity = state.intensity; out.push(`intensité ${INTENSITY_META[state.intensity].title}`); }
    if (JSON.stringify(initial.cibles.map((c) => c.id)) !== JSON.stringify(state.cibles.map((c) => c.id))) {
      changes.__cibles = state.cibles; out.push(`cible (${state.cibles.length || 'national'})`);
    }
    if (JSON.stringify(initial.channels) !== JSON.stringify(state.channels)) { changes.channels = state.channels; out.push('canaux'); }
    return { changes, labels: out };
  }, [initial, state, total]);
  const linksChanged = !!initial && !!state && JSON.stringify(initial.links) !== JSON.stringify(state.links);
  const hasDiff = diff.labels.length > 0 || linksChanged;

  const apply = useCallback(async () => {
    if (!state || !hasDiff || reason.trim().length < 3 || submitting) return;
    setSubmitting(true);
    try {
      const { __cibles, ...changes } = diff.changes as { __cibles?: { id: string; name: string }[] } & Record<string, unknown>;
      if (__cibles) {
        const zone = await resolveFinalZone(__cibles, ownerOrgId);
        (changes as Record<string, unknown>).zone = zone;
      }
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/adjust`, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: reason.trim(),
          changes,
          ...(linksChanged ? { links: state.links } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastApi.error('Ajustement impossible', data.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      setPushResults((data.pushes ?? []) as PushLine[]);
      toastApi.success('Campagne ajustée', 'Modifications enregistrées et journalisées.');
      onApplied();
    } catch (err) {
      toastApi.error('Erreur réseau', err instanceof Error ? err.message : undefined);
    } finally {
      setSubmitting(false);
    }
  }, [state, hasDiff, reason, submitting, diff, linksChanged, ownerOrgId, strategyId, toastApi, onApplied]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Ajuster la campagne"
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div style={{
        width: 'min(680px, 100%)', background: C.card, border: `0.5px solid ${C.border}`,
        borderRadius: 12, overflow: 'hidden',
      }}>
        <div style={{ background: C.elevated, borderBottom: `0.5px solid ${C.border}`, padding: '13px 20px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal }} />
          <h2 style={{ fontFamily: fInter, fontSize: 14, fontWeight: 500, color: C.text, margin: 0 }}>Ajuster la campagne</h2>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Fermer"
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: C.textDim, fontFamily: fMono, fontSize: 16, cursor: 'pointer' }}>
            ×
          </button>
        </div>

        {loading || !state ? (
          <div style={{ padding: 24, fontFamily: fInter, fontSize: 13, color: C.textDim }}>Chargement…</div>
        ) : pushResults ? (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontFamily: fInter, fontSize: 13, color: C.text, fontWeight: 500 }}>Récapitulatif du push</div>
            {pushResults.length === 0 && (
              <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Aucun canal à pousser.</div>
            )}
            {pushResults.map((p) => (
              <div key={p.channel} style={{ display: 'flex', gap: 10, alignItems: 'baseline', border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
                <span style={{ fontFamily: fMono, fontSize: 12, color: C.text }}>{labels[p.channel] ?? p.channel}</span>
                <span style={{
                  fontFamily: fInter, fontSize: 11, borderRadius: 4, padding: '1px 8px',
                  background: C.elevated, border: `0.5px solid ${C.borderDefault}`,
                  color: p.status === 'failed' ? 'var(--danger)' : p.status === 'pushed' ? 'var(--success)' : C.textSec,
                }}>{PUSH_LABEL[p.status]}</span>
                <span style={{ fontFamily: fInter, fontSize: 11.5, color: C.textDim, flex: 1 }}>{p.detail}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <PrimaryButton label="Fermer" onClick={onClose} />
            </div>
          </div>
        ) : (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Section title="Budget & période" defaultOpen>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[...state.channels.dsps, ...state.channels.socials].map((code) => (
                  <NumberField
                    key={code}
                    label={labels[code] ?? code}
                    value={state.channelBudgets[code] ?? null}
                    onChange={(v) => setState((prev) => {
                      if (!prev) return prev;
                      const next = { ...prev.channelBudgets };
                      if (v == null) delete next[code]; else next[code] = v;
                      return { ...prev, channelBudgets: next };
                    })}
                    suffix="€" placeholder="ex. 30000" step={100} min={0}
                  />
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `0.5px solid ${C.border}`, paddingTop: 10 }}>
                  <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>Budget global (somme)</span>
                  <span style={{ fontFamily: fMono, fontSize: 15, color: C.text }}>{fmtEUR(total || null)}</span>
                </div>
                <Row2>
                  <NumberField label="CPM cible" value={state.forecastCpm}
                    onChange={(v) => setState((p) => p ? { ...p, forecastCpm: v } : p)} suffix="€" step={0.1} min={0} />
                  <div />
                </Row2>
                <Row2>
                  <DateField label="Début" value={state.startDate} onChange={(v) => setState((p) => p ? { ...p, startDate: v } : p)} />
                  <DateField label="Fin" value={state.endDate} onChange={(v) => setState((p) => p ? { ...p, endDate: v } : p)} />
                </Row2>
              </div>
            </Section>

            <Section title="Mode d'exécution">
              <OptsList>
                {(Object.keys(EXECUTION_MODE_META) as ExecutionMode[]).map((m) => (
                  <OptionRow key={m} selected={state.executionMode === m}
                    title={EXECUTION_MODE_META[m].title} sub={EXECUTION_MODE_META[m].sub}
                    onClick={() => setState((p) => p ? { ...p, executionMode: m } : p)} />
                ))}
              </OptsList>
            </Section>

            <Section title="Intensité du ciblage">
              <OptsList>
                {(Object.keys(INTENSITY_META) as Intensity[]).map((i) => (
                  <OptionRow key={i} selected={state.intensity === i}
                    title={INTENSITY_META[i].title} sub={INTENSITY_META[i].sub}
                    onClick={() => setState((p) => p ? { ...p, intensity: i } : p)} />
                ))}
              </OptsList>
            </Section>

            <Section title="Cible">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {state.cibles.length === 0 && (
                    <span style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>National (aucune zone ciblée)</span>
                  )}
                  {state.cibles.map((c) => (
                    <span key={c.id} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, background: C.elevated,
                      border: `0.5px solid ${C.borderDefault}`, borderRadius: 4, padding: '3px 8px',
                      fontFamily: fInter, fontSize: 11, color: C.textSec,
                    }}>
                      {c.name}
                      <button type="button" aria-label={`Retirer ${c.name}`}
                        onClick={() => setState((p) => p ? { ...p, cibles: p.cibles.filter((x) => x.id !== c.id) } : p)}
                        style={{ background: 'transparent', border: 'none', color: C.textDim, cursor: 'pointer', padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
                <select
                  value=""
                  onChange={(e) => {
                    const z = zonesList.find((x) => x.id === e.target.value);
                    if (z) setState((p) => p && !p.cibles.some((c) => c.id === z.id) ? { ...p, cibles: [...p.cibles, z] } : p);
                  }}
                  style={{
                    background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6,
                    padding: '8px 12px', fontFamily: fInter, fontSize: 13, color: C.text, outline: 'none',
                  }}
                >
                  <option value="">Ajouter une zone existante…</option>
                  {zonesList.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
                <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>
                  Pour construire une nouvelle cible par seuil, passe par l&apos;étape Cible du wizard.
                </span>
              </div>
            </Section>

            <Section title="Canaux & liens DSP">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(['dsp', 'social', 'adserver'] as const).map((cat) => (
                  <div key={cat}>
                    <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginBottom: 6 }}>
                      {cat === 'dsp' ? 'DSP' : cat === 'social' ? 'Réseaux sociaux' : 'Ad server (mesure)'}
                    </div>
                    <OptsList>
                      {catalog.filter((r) => r.category === cat).map((r) => {
                        const list = cat === 'dsp' ? state.channels.dsps : cat === 'social' ? state.channels.socials : null;
                        const selected = list ? list.includes(r.code) : state.channels.ad_server === r.code;
                        return (
                          <OptionRow key={r.code} selected={selected} title={r.label} sub={r.category === 'adserver' ? 'Ad server' : r.category === 'dsp' ? 'DSP' : 'Social'}
                            onClick={() => setState((p) => {
                              if (!p) return p;
                              if (cat === 'adserver') return { ...p, channels: { ...p.channels, ad_server: selected ? null : r.code } };
                              const key = cat === 'dsp' ? 'dsps' : 'socials';
                              const cur = p.channels[key];
                              const next = selected ? cur.filter((c) => c !== r.code) : [...cur, r.code];
                              return { ...p, channels: { ...p.channels, [key]: next } };
                            })} />
                        );
                      })}
                    </OptsList>
                  </div>
                ))}
                {state.channels.dsps.includes('dv360') && (
                  <FieldBlock label="Liens DV360 (pour le push API — optionnels)">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {([['advertiser_id', 'Advertiser ID'], ['insertion_order_id', 'Insertion order ID'], ['algorithm_id', 'Custom bidding algorithm ID']] as const).map(([k, lab]) => (
                        <input
                          key={k}
                          type="text"
                          placeholder={lab}
                          value={state.links.dv360?.[k] ?? ''}
                          onChange={(e) => setState((p) => p ? {
                            ...p,
                            links: { ...p.links, dv360: { ...p.links.dv360, [k]: e.target.value || undefined } },
                          } : p)}
                          style={{
                            background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6,
                            padding: '8px 12px', fontFamily: fMono, fontSize: 12, color: C.text, outline: 'none',
                          }}
                        />
                      ))}
                    </div>
                  </FieldBlock>
                )}
              </div>
            </Section>

            {/* Pied : diff + raison + appliquer */}
            <div style={{ borderTop: `0.5px solid ${C.border}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontFamily: fInter, fontSize: 11.5, color: hasDiff ? C.textSec : C.textDim }}>
                {hasDiff ? `Modifications : ${[...diff.labels, ...(linksChanged ? ['liens DSP'] : [])].join(' · ')}` : 'Aucune modification pour l’instant.'}
              </div>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Raison de l'ajustement (obligatoire — alimente le journal)"
                style={{
                  background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6,
                  padding: '10px 12px', fontFamily: fInter, fontSize: 13, color: C.text, outline: 'none',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = C.teal50; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = C.border; }}
              />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <GhostButton label="Annuler" onClick={onClose} disabled={submitting} />
                <PrimaryButton
                  label={submitting ? 'Application…' : 'Appliquer & pousser'}
                  onClick={apply}
                  disabled={submitting || !hasDiff || reason.trim().length < 3}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

NOTE exécuteur (spec §5b) : si toutes les lignes budget sont vides alors que la
stratégie a un `total_budget > 0` (campagne créée avant le modèle par canal),
afficher sous la ligne « Budget global (somme) » un hint
`Répartis le budget actuel (<total_budget formaté> €) entre les canaux` —
`s.total_budget` est déjà chargé dans le premier useEffect, le stocker dans un
`useState<number | null>` dédié.

- [ ] **Step 2: Bouton « Ajuster » dans CampaignOverview**

Dans `components/campaign/CampaignOverview.tsx` :

1. Imports : `import { AdjustPanel } from './AdjustPanel';` et `useCallback` déjà présent.
2. États + fetch stratégie autonome (même pattern borné que CampaignSuivi) — après les `useState` existants :

```ts
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [strategyStatus, setStrategyStatus] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await adminFetch('/api/bidding/strategies', { cache: 'no-store' });
        const d = r.ok ? await r.json() : { strategies: [] };
        const match = (d.strategies ?? []).find(
          (s: { campaign_id: string; status?: string }) => s.campaign_id === id,
        );
        if (!cancelled) { setStrategyId(match?.id ?? null); setStrategyStatus(match?.status ?? null); }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [id]);
```

3. Dans le header actions (`<div style={{ display: 'flex', gap: 8 }}>`, avant « Mettre en pause ») :

```tsx
          {strategyId && strategyStatus === 'active' && status === 'en_cours' && (
            <ActionButton label="Ajuster" variant="teal" onClick={() => setAdjustOpen(true)} disabled={overridePending} />
          )}
```

4. Avant le `<ConfirmModal …>` final :

```tsx
      {strategyId && (
        <AdjustPanel
          campaignId={id}
          strategyId={strategyId}
          open={adjustOpen}
          onClose={() => setAdjustOpen(false)}
          onApplied={() => { fetchDetail(page); }}
        />
      )}
```

- [ ] **Step 3: Type-check + hex + commit**

Run: `npx tsc --noEmit && grep -rn "#[0-9a-fA-F]\{3,6\}" components/campaign/AdjustPanel.tsx ; npm test -- --run`
Expected: tsc 0 ; grep exit 1 (aucun hex — les rgba(0,0,0,0.6) d'overlay sont tolérés, PAS de hex) ; tests verts.

```bash
git add components/campaign/AdjustPanel.tsx components/campaign/CampaignOverview.tsx
git commit -m "feat: AdjustPanel (diff + raison + push par canal) + bouton Ajuster dans l'aperçu"
```

---

### Task 6: Agent — proposition d'ajustement dans le chat campagne

**Files:**
- Modify: `lib/campaigns/suivi-chat.ts` (system prompt)
- Modify: `components/campaign/CampaignSuivi.tsx` (parse marker + carte + AdjustPanel)
- Test: `tests/unit/campaigns/suivi-chat.test.ts` (ajout parse — si le fichier expose déjà des tests du prompt, ajouter au même fichier)

**Interfaces:**
- Consumes: `AdjustPanel` (Task 5, props `initialChanges`/`initialReason`).
- Produces: convention de flux — le modèle termine sa réponse par UNE ligne `[PROPOSITION_AJUSTEMENT]{"reason":"…","changes":{…}}` ; helper exporté `parseAdjustProposal(text: string): { clean: string; proposal: { reason: string; changes: Record<string, unknown> } | null }` dans `lib/campaigns/suivi-chat.ts`.

- [ ] **Step 1: Test qui échoue (parseAdjustProposal)**

Dans `tests/unit/campaigns/suivi-chat.test.ts`, ajouter :

```ts
import { parseAdjustProposal } from '@/lib/campaigns/suivi-chat';

describe('parseAdjustProposal', () => {
  it('extrait la proposition et nettoie le texte', () => {
    const raw = 'Le CPM est trop haut sur dv360.\n[PROPOSITION_AJUSTEMENT]{"reason":"CPM trop haut","changes":{"forecast_cpm":5.5}}';
    const { clean, proposal } = parseAdjustProposal(raw);
    expect(clean).toBe('Le CPM est trop haut sur dv360.');
    expect(proposal?.reason).toBe('CPM trop haut');
    expect(proposal?.changes.forecast_cpm).toBe(5.5);
  });
  it('texte sans marker → proposal null, texte inchangé', () => {
    const { clean, proposal } = parseAdjustProposal('Réponse simple.');
    expect(clean).toBe('Réponse simple.');
    expect(proposal).toBeNull();
  });
  it('JSON invalide après le marker → proposal null, marker retiré', () => {
    const { proposal } = parseAdjustProposal('Texte\n[PROPOSITION_AJUSTEMENT]{pas du json');
    expect(proposal).toBeNull();
  });
});
```

Run: `npm test -- --run tests/unit/campaigns/suivi-chat.test.ts` → FAIL.

- [ ] **Step 2: Implémenter dans `lib/campaigns/suivi-chat.ts`**

1. Ajouter le helper (exporté, en fin de fichier) :

```ts
// ── Proposition d'ajustement (protocole marker dans le flux texte) ──────────────
export const ADJUST_MARKER = '[PROPOSITION_AJUSTEMENT]';

export interface AdjustProposal { reason: string; changes: Record<string, unknown> }

/** Extrait la ligne [PROPOSITION_AJUSTEMENT]{json} d'une réponse du chat. */
export function parseAdjustProposal(text: string): { clean: string; proposal: AdjustProposal | null } {
  const idx = text.lastIndexOf(ADJUST_MARKER);
  if (idx === -1) return { clean: text, proposal: null };
  const clean = text.slice(0, idx).replace(/\n+$/, '');
  try {
    const parsed = JSON.parse(text.slice(idx + ADJUST_MARKER.length).trim()) as AdjustProposal;
    if (typeof parsed.reason !== 'string' || typeof parsed.changes !== 'object' || parsed.changes === null) {
      return { clean, proposal: null };
    }
    return { clean, proposal: parsed };
  } catch {
    return { clean, proposal: null };
  }
}
```

2. Dans `buildSuiviChatSystemPrompt`, ajouter à la fin du bloc `Règles :` (après « Aucune action destructive proposée. ») :

```
- Si l'utilisateur demande une recommandation d'action ET que tu identifies un ajustement concret et chiffré, termine ta réponse par UNE seule ligne, exactement au format :
[PROPOSITION_AJUSTEMENT]{"reason":"<pourquoi en une phrase>","changes":{...}}
  Clés autorisées dans changes : channel_budgets (objet code canal → € ), forecast_cpm, start_date, end_date, execution_mode (monitor_only|suggest|auto), intensity (doux|marque|fort). JSON compact sur une seule ligne, aucune autre clé. N'émets JAMAIS cette ligne pour une simple question d'analyse.
```

Run: `npm test -- --run tests/unit/campaigns/suivi-chat.test.ts` → PASS.

- [ ] **Step 3: CampaignSuivi — carte proposition + AdjustPanel**

Dans `components/campaign/CampaignSuivi.tsx` :

1. Imports :

```ts
import { parseAdjustProposal, type AdjustProposal } from '@/lib/campaigns/suivi-chat';
import { AdjustPanel } from './AdjustPanel';
```

2. Étendre `Msg` : `interface Msg { role: 'user' | 'assistant'; content: string; pending?: boolean; proposal?: AdjustProposal | null }`.
3. À la FIN du stream dans `send` (après la boucle de lecture + le `tail`), parser une seule fois :

```ts
      const { clean, proposal } = parseAdjustProposal(acc);
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'assistant', content: clean, pending: false, proposal };
        return copy;
      });
```

4. États du panneau (à côté des états existants) :

```ts
  const [adjustProposal, setAdjustProposal] = useState<AdjustProposal | null>(null);
```

5. Dans le rendu des messages, sous la bulle assistant, si `m.proposal` ET `strategyId` ET `strategyStatus === 'active'` :

```tsx
                {m.role === 'assistant' && m.proposal && strategyId && strategyStatus === 'active' && (
                  <div style={{
                    marginTop: 6, border: '0.5px solid var(--brand-teal-30)', borderRadius: 8,
                    padding: '10px 12px', background: 'var(--bg-surface)',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
                      Proposition : {m.proposal.reason}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAdjustProposal(m.proposal ?? null)}
                      style={{
                        background: 'transparent', border: '0.5px solid var(--brand-teal)', borderRadius: 6,
                        padding: '6px 12px', fontFamily: fInter, fontSize: 12, color: 'var(--brand-teal)', cursor: 'pointer',
                      }}
                    >
                      Ouvrir dans Ajuster
                    </button>
                  </div>
                )}
```

(le wrapper de message passe de `justifyContent` seul à une colonne : adapter le conteneur du message assistant en `flexDirection: 'column', alignItems: 'flex-start'` pour empiler bulle + carte).

6. Avant la fermeture du composant :

```tsx
      {strategyId && adjustProposal && (
        <AdjustPanel
          campaignId={campaignId}
          strategyId={strategyId}
          open
          onClose={() => setAdjustProposal(null)}
          onApplied={() => setAdjustProposal(null)}
          initialChanges={adjustProposal.changes}
          initialReason={adjustProposal.reason}
        />
      )}
```

- [ ] **Step 4: Suite + commit**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: 0 erreur, tests verts.

```bash
git add lib/campaigns/suivi-chat.ts components/campaign/CampaignSuivi.tsx tests/unit/campaigns/suivi-chat.test.ts
git commit -m "feat: proposition d'ajustement par l'agent (marker chat + carte + panneau pré-rempli)"
```

---

### Task 7: Vérification bout en bout

**Files:** aucun nouveau (fixes éventuels) + `ARCHITECTURE.md` (doc).

- [ ] **Step 1: Suite complète**

Run: `npx tsc --noEmit && npm test -- --run && npm run lint`
Expected: tsc 0 ; tous les tests PASS (dont `channels.test.ts`, `push.test.ts`, `suivi-chat.test.ts`) ; lint sans nouvelle warning.

- [ ] **Step 2: Zéro hex nu**

Run: `grep -rn "#[0-9a-fA-F]\{3,6\}" components/campaign/AdjustPanel.tsx "app/campaigns/[id]/_components/steps/StepBudget.tsx" lib/dsp/push "app/api/bidding/strategies/[id]/adjust/route.ts"`
Expected: aucune occurrence.

- [ ] **Step 3: Navigateur (dev server + login admin@geoprompt.com / G3oPrompt_Admin#2026)**

Via Playwright MCP, sur la campagne démo (stratégie active — la ré-armer via le wizard si besoin) :
0. Wizard : étape Budget affiche UNE ligne par canal sélectionné (labels du catalogue), le « Budget global (somme) » se met à jour en lecture seule ; Lancement affiche la répartition dans le récap et arme la campagne.
1. Aperçu : bouton « Ajuster » visible (stratégie active + campagne en cours).
2. AdjustPanel : sections pré-remplies (budgets par ligne, CPM, dates, mode, intensité, cible « Zone de la stratégie », canaux cochés). Diff vide → « Appliquer & pousser » désactivé.
3. Modifier le budget d'un canal + la raison → appliquer → récap des pushes : chaque canal en `simulé` (campagne démo), détail explicite. `POST …/adjust` → 200.
4. Rouvrir le panneau → les nouvelles valeurs sont l'état initial (persisté). Le total stratégie (somme) a bougé.
5. Journal : `GET /api/bidding/strategies/{id}/journal` contient l'événement « Ajustement manuel » avec la raison et les pushes.
6. Chat campagne : demander « Recommande-moi un ajustement concret sur cette campagne » → si la réponse contient une proposition, la carte « Proposition : … » apparaît avec « Ouvrir dans Ajuster » → le panneau s'ouvre pré-rempli avec la raison. (Le modèle peut ne pas émettre le marker à tous les coups — retenter une formulation explicite ; vérifier au minimum que le texte normal ne casse pas.)
7. Garde : campagne mise en pause → POST adjust renvoie 409 ; bouton absent.
8. Zéro erreur console.

- [ ] **Step 4: Doc ARCHITECTURE.md**

Ajouter dans la table des routes (section Digital/campagnes ou une sous-section dédiée) :

```
| `/api/bidding/strategies/[id]/adjust` | POST | Action « Ajuster » : patch partiel stratégie (budgets PAR CANAL — global = somme serveur), snapshot v+1 (RPC duplicate_plan_snapshot), push bidding par connecteur (lib/dsp/push : DV360 réel / simulé / skipped), journal consolidé bidding_agent_actions intent=manual_adjust + dsp_api_logs |
```

et dans la section RPC :

```
| `duplicate_plan_snapshot` | Copie serveur du dernier snapshot de plan en v+1 (budgets par dsp, cpm, période) | `api/bidding/strategies/[id]/adjust/` |
```

- [ ] **Step 5: Build prod + commit final**

Run: `npm run build`
Expected: build OK (tuer les process `next` + `rm -rf .next` si EPERM).

```bash
git add -A && git commit -m "docs: routes adjust + RPC duplicate_plan_snapshot dans ARCHITECTURE"
```

(fixes éventuels : `fix: ajustements vérification action Ajuster`.)
