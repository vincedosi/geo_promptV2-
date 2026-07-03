# Campaign Status & Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à chaque campagne digitale un statut de pilotage (5 états) calculé depuis le calendrier + corrigeable à la main, avec un signal d'attention « données périmées », visible en badge/filtre sur les listes de campagnes.

**Architecture:** Le statut effectif n'est jamais stocké pour sa partie dérivée : une fonction pure `effectiveCampaignStatus(dates, override, today)` le calcule à la lecture (override manuel sinon calendrier). Seules les corrections manuelles (`paused`/`ended`/`archived`) sont persistées comme override sur `dsp_campaigns`. Une petite RPC fournit la date de dernière donnée par campagne pour le signal d'attention. Zéro cron, jamais de statut périmé.

**Tech Stack:** Next.js 14 App Router · TypeScript strict · Supabase (PostgreSQL + PostGIS) via MCP · Zod · Vitest · MapLibre (inchangé ici).

## Global Constraints

- Supabase compute **Nano** (250 IOPS) : jamais de full scan non indexé ; `get_campaign_last_data_dates` s'appuie sur l'index UNIQUE `(campaign_id, date, postal_code, city)` existant de `dsp_campaign_data`.
- Migrations SQL via **MCP Supabase** (`apply_migration`), **jamais** de SQL manuel ; définition versionnée dans `sql/` (règle anti-dérive DB↔repo).
- **Aucune couleur hex en dur** — toujours `var(--token)` du design system.
- Routes API : `export const dynamic = 'force-dynamic'`, validation **Zod**, `createAdminClient()` depuis `@/lib/auth`, scope org via `profile.organization_id`.
- Tests : **Vitest**, `npm test` ; type-check `npx tsc --noEmit`.
- TypeScript strict, imports absolus `@/`.
- Commits atomiques, format `type: description`, terminés par `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## File Structure

- **Create** `sql/093_campaign_status_override.sql` — migration : 3 colonnes override sur `dsp_campaigns` + RPC `get_campaign_last_data_dates`.
- **Create** `lib/campaigns/status.ts` — logique pure : type `CampaignStatus`, `effectiveCampaignStatus`, `campaignNeedsAttention`, `STATUS_META`, `FRESHNESS_DAYS`.
- **Create** `tests/unit/campaigns/status.test.ts` — tests unitaires de la logique pure.
- **Create** `components/campaigns/CampaignStatusBadge.tsx` — badge visuel partagé (label + couleur + point d'attention).
- **Modify** `app/api/admin/campaigns/[id]/route.ts` — le `PATCH` accepte `status_override`.
- **Modify** `app/api/admin/campaigns/route.ts` — la liste renvoie `last_data_date` par campagne.
- **Modify** `app/admin/campaigns/page.tsx` — badge + onglets de filtre + tri (En cours en tête) + contrôles d'override.
- **Modify** `app/map/analyse/digital/_components/CampaignCard.tsx` — badge + point d'attention.

---

## Task 1 — Migration : colonnes override + RPC date de dernière donnée

**Files:**
- Create: `sql/093_campaign_status_override.sql`
- Apply: via MCP Supabase `apply_migration` (name `campaign_status_override`)

**Interfaces:**
- Produces: colonnes `dsp_campaigns.status_override` (`text NULL`, CHECK `IN ('paused','ended','archived')`), `status_override_at timestamptz NULL`, `status_override_by uuid NULL`. RPC `get_campaign_last_data_dates() RETURNS TABLE(campaign_id uuid, last_data_date date)`.

- [ ] **Step 1: Écrire la migration versionnée**

Create `sql/093_campaign_status_override.sql` :

```sql
-- ============================================================
-- 093 — Statut de campagne : override manuel + date de dernière donnée
-- ============================================================
-- Appliquée le 2026-07-03 via MCP Supabase (migration campaign_status_override).
--
-- Le statut effectif est CALCULÉ (lib/campaigns/status.ts) : override manuel
-- sinon dérivé du calendrier. Seules les corrections manuelles sont persistées.
-- get_campaign_last_data_dates alimente le signal d'attention (campagne en cours
-- sans donnée récente) — s'appuie sur l'index UNIQUE (campaign_id, date, …).

ALTER TABLE public.dsp_campaigns
  ADD COLUMN IF NOT EXISTS status_override    text,
  ADD COLUMN IF NOT EXISTS status_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_override_by uuid;

ALTER TABLE public.dsp_campaigns
  DROP CONSTRAINT IF EXISTS dsp_campaigns_status_override_check;
ALTER TABLE public.dsp_campaigns
  ADD CONSTRAINT dsp_campaigns_status_override_check
  CHECK (status_override IS NULL OR status_override IN ('paused','ended','archived'));

CREATE OR REPLACE FUNCTION public.get_campaign_last_data_dates()
RETURNS TABLE(campaign_id uuid, last_data_date date)
LANGUAGE sql
STABLE
AS $$
  SELECT campaign_id, max(date) AS last_data_date
  FROM public.dsp_campaign_data
  GROUP BY campaign_id;
$$;
```

- [ ] **Step 2: Appliquer via MCP Supabase**

Appeler `apply_migration` (projet `vkkdbygwbrxyogqosten`, name `campaign_status_override`) avec le contenu SQL ci-dessus (hors commentaires d'en-tête si besoin).

- [ ] **Step 3: Vérifier colonnes + RPC via execute_sql**

Run (MCP `execute_sql`) :
```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
   WHERE table_name='dsp_campaigns' AND column_name IN ('status_override','status_override_at','status_override_by')) AS cols,
  (SELECT count(*) FROM get_campaign_last_data_dates()) AS nb_campaigns_with_data;
```
Expected: `cols = 3`, `nb_campaigns_with_data` ≥ 1 (au moins une campagne a des données).

- [ ] **Step 4: Commit**

```bash
git add sql/093_campaign_status_override.sql
git commit -m "feat(sql): statut campagne — colonnes override + RPC last_data_date"
```

---

## Task 2 — Logique pure du statut (TDD)

**Files:**
- Create: `lib/campaigns/status.ts`
- Test: `tests/unit/campaigns/status.test.ts`

**Interfaces:**
- Produces:
  - `type CampaignStatus = 'a_venir' | 'en_cours' | 'en_pause' | 'terminee' | 'archivee'`
  - `type StatusOverride = 'paused' | 'ended' | 'archived'`
  - `effectiveCampaignStatus(input: { date_start: string | null; date_end: string | null; status_override: StatusOverride | null }, today: string): CampaignStatus` — dates/`today` au format `'YYYY-MM-DD'`.
  - `campaignNeedsAttention(input: { status: CampaignStatus; last_data_date: string | null }, today: string, freshnessDays?: number): boolean`
  - `const FRESHNESS_DAYS = 3`
  - `const STATUS_META: Record<CampaignStatus, { label: string; colorVar: string }>`

- [ ] **Step 1: Écrire les tests qui échouent**

Create `tests/unit/campaigns/status.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { effectiveCampaignStatus, campaignNeedsAttention, FRESHNESS_DAYS } from '@/lib/campaigns/status';

const base = { date_start: '2026-07-01', date_end: '2026-07-31', status_override: null };

describe('effectiveCampaignStatus', () => {
  it('à venir quand today < date_start', () => {
    expect(effectiveCampaignStatus(base, '2026-06-30')).toBe('a_venir');
  });
  it('en cours dans la fenêtre', () => {
    expect(effectiveCampaignStatus(base, '2026-07-15')).toBe('en_cours');
    expect(effectiveCampaignStatus(base, '2026-07-01')).toBe('en_cours'); // borne incluse
    expect(effectiveCampaignStatus(base, '2026-07-31')).toBe('en_cours'); // borne incluse
  });
  it('terminée quand today > date_end', () => {
    expect(effectiveCampaignStatus(base, '2026-08-01')).toBe('terminee');
  });
  it('override prime sur le calendrier', () => {
    expect(effectiveCampaignStatus({ ...base, status_override: 'paused' }, '2026-07-15')).toBe('en_pause');
    expect(effectiveCampaignStatus({ ...base, status_override: 'ended' }, '2026-07-15')).toBe('terminee');
    expect(effectiveCampaignStatus({ ...base, status_override: 'archived' }, '2026-07-15')).toBe('archivee');
  });
  it('dates nulles : jamais à venir sans date_start, jamais terminée sans date_end', () => {
    expect(effectiveCampaignStatus({ date_start: null, date_end: '2026-07-31', status_override: null }, '2026-06-01')).toBe('en_cours');
    expect(effectiveCampaignStatus({ date_start: '2026-07-01', date_end: null, status_override: null }, '2026-09-01')).toBe('en_cours');
    expect(effectiveCampaignStatus({ date_start: null, date_end: null, status_override: null }, '2026-07-15')).toBe('en_cours');
  });
});

describe('campaignNeedsAttention', () => {
  const today = '2026-07-15';
  it('faux si pas en cours', () => {
    expect(campaignNeedsAttention({ status: 'terminee', last_data_date: null }, today)).toBe(false);
    expect(campaignNeedsAttention({ status: 'a_venir', last_data_date: null }, today)).toBe(false);
  });
  it('vrai si en cours sans aucune donnée', () => {
    expect(campaignNeedsAttention({ status: 'en_cours', last_data_date: null }, today)).toBe(true);
  });
  it('vrai si en cours et dernière donnée > FRESHNESS_DAYS', () => {
    expect(campaignNeedsAttention({ status: 'en_cours', last_data_date: '2026-07-10' }, today)).toBe(true); // 5 jours
  });
  it('faux si en cours et donnée fraîche (<= FRESHNESS_DAYS)', () => {
    expect(campaignNeedsAttention({ status: 'en_cours', last_data_date: '2026-07-13' }, today)).toBe(false); // 2 jours
    expect(campaignNeedsAttention({ status: 'en_cours', last_data_date: '2026-07-12' }, today)).toBe(false); // 3 jours = seuil
  });
  it('FRESHNESS_DAYS vaut 3', () => {
    expect(FRESHNESS_DAYS).toBe(3);
  });
});
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `npx vitest run tests/unit/campaigns/status.test.ts`
Expected: FAIL — module `@/lib/campaigns/status` introuvable.

- [ ] **Step 3: Implémenter la logique pure**

Create `lib/campaigns/status.ts` :

```ts
/**
 * Statut de campagne — logique pure (zéro I/O, testable).
 * Statut effectif = override manuel sinon dérivé du calendrier.
 * Dates au format ISO 'YYYY-MM-DD' (comparaison lexicographique correcte).
 */

export type CampaignStatus = 'a_venir' | 'en_cours' | 'en_pause' | 'terminee' | 'archivee';
export type StatusOverride = 'paused' | 'ended' | 'archived';

/** Seuil (jours) au-delà duquel une campagne « en cours » sans donnée est signalée. */
export const FRESHNESS_DAYS = 3;

const OVERRIDE_TO_STATUS: Record<StatusOverride, CampaignStatus> = {
  paused: 'en_pause',
  ended: 'terminee',
  archived: 'archivee',
};

export function effectiveCampaignStatus(
  input: { date_start: string | null; date_end: string | null; status_override: StatusOverride | null },
  today: string,
): CampaignStatus {
  if (input.status_override) return OVERRIDE_TO_STATUS[input.status_override];
  if (input.date_start && today < input.date_start) return 'a_venir';
  if (input.date_end && today > input.date_end) return 'terminee';
  return 'en_cours';
}

/** Nombre de jours entiers entre deux dates ISO (b - a). */
function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function campaignNeedsAttention(
  input: { status: CampaignStatus; last_data_date: string | null },
  today: string,
  freshnessDays: number = FRESHNESS_DAYS,
): boolean {
  if (input.status !== 'en_cours') return false;
  if (!input.last_data_date) return true;
  return daysBetween(input.last_data_date, today) > freshnessDays;
}

/** Libellé + couleur (token design system) par statut. */
export const STATUS_META: Record<CampaignStatus, { label: string; colorVar: string }> = {
  a_venir:  { label: 'À venir',   colorVar: 'var(--text-secondary)' },
  en_cours: { label: 'En cours',  colorVar: 'var(--brand-teal)' },
  en_pause: { label: 'En pause',  colorVar: 'var(--warning)' },
  terminee: { label: 'Terminée',  colorVar: 'var(--text-tertiary)' },
  archivee: { label: 'Archivée',  colorVar: 'var(--text-tertiary)' },
};
```

- [ ] **Step 4: Lancer les tests → succès**

Run: `npx vitest run tests/unit/campaigns/status.test.ts`
Expected: PASS (tous les tests verts).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add lib/campaigns/status.ts tests/unit/campaigns/status.test.ts
git commit -m "feat(campaigns): logique pure statut effectif + attention (TDD)"
```

---

## Task 3 — Le PATCH campagne accepte l'override

**Files:**
- Modify: `app/api/admin/campaigns/[id]/route.ts`
- Test: `tests/unit/campaigns/override-schema.test.ts` (Create)

**Interfaces:**
- Consumes: `StatusOverride` de `lib/campaigns/status.ts`.
- Produces: le `PATCH /api/admin/campaigns/[id]` accepte `{ status_override?: 'paused'|'ended'|'archived'|null }` ; écrit `status_override`, `status_override_at = now()`, `status_override_by = profile.id`.

- [ ] **Step 1: Écrire le test du schéma Zod (échec attendu)**

Create `tests/unit/campaigns/override-schema.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { StatusOverrideSchema } from '@/app/api/admin/campaigns/[id]/route';

describe('StatusOverrideSchema', () => {
  it('accepte les valeurs autorisées et null', () => {
    for (const v of ['paused', 'ended', 'archived', null]) {
      expect(StatusOverrideSchema.safeParse(v).success).toBe(true);
    }
  });
  it('rejette une valeur inconnue', () => {
    expect(StatusOverrideSchema.safeParse('live').success).toBe(false);
    expect(StatusOverrideSchema.safeParse('en_pause').success).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `npx vitest run tests/unit/campaigns/override-schema.test.ts`
Expected: FAIL — `StatusOverrideSchema` non exporté.

- [ ] **Step 3: Lire le fichier route puis ajouter le schéma + l'écriture**

Lire `app/api/admin/campaigns/[id]/route.ts` (repérer le handler `PATCH` et son objet de mise à jour). Ajouter en haut du fichier, après les imports :

```ts
import { z } from 'zod';
export const StatusOverrideSchema = z.enum(['paused', 'ended', 'archived']).nullable();
```

Dans le handler `PATCH`, après la validation du body et le contrôle d'org existant, si le body contient la clé `status_override`, valider et l'intégrer à l'objet de mise à jour Supabase :

```ts
if ('status_override' in body) {
  const parsed = StatusOverrideSchema.safeParse(body.status_override);
  if (!parsed.success) {
    return NextResponse.json({ error: 'status_override invalide' }, { status: 400 });
  }
  updateFields.status_override = parsed.data;                         // 'paused'|'ended'|'archived'|null
  updateFields.status_override_at = parsed.data ? new Date().toISOString() : null;
  updateFields.status_override_by = parsed.data ? profile.id : null;
}
```
(`updateFields` = l'objet passé à `.update(...)` du handler ; `profile` = le résultat de `requireAdmin`/`getUserFromRequest` déjà présent. Adapter les noms à ceux du fichier.)

- [ ] **Step 4: Lancer le test schéma → succès**

Run: `npx vitest run tests/unit/campaigns/override-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Vérifier l'écriture DB (manuel, base réelle)**

Depuis un client authentifié admin (ou via un test manuel), `PATCH /api/admin/campaigns/<id>` avec `{ "status_override": "paused" }`, puis vérifier via MCP `execute_sql` :
```sql
SELECT status_override, status_override_at IS NOT NULL AS horodate, status_override_by IS NOT NULL AS auteur
FROM dsp_campaigns WHERE id = '<id>';
```
Expected: `paused`, `true`, `true`. Puis `PATCH` avec `{ "status_override": null }` → la ligne repasse à NULL/NULL/NULL. Nettoyer après test.

- [ ] **Step 6: Type-check + commit**

Run: `npx tsc --noEmit` (attendu : OK).
```bash
git add "app/api/admin/campaigns/[id]/route.ts" tests/unit/campaigns/override-schema.test.ts
git commit -m "feat(campaigns): PATCH accepte status_override (paused/ended/archived)"
```

---

## Task 4 — Badge + `last_data_date` en liste + filtre/tri (lecture)

**Files:**
- Create: `components/campaigns/CampaignStatusBadge.tsx`
- Modify: `app/api/admin/campaigns/route.ts`
- Modify: `app/admin/campaigns/page.tsx`
- Modify: `app/map/analyse/digital/_components/CampaignCard.tsx`

**Interfaces:**
- Consumes: `effectiveCampaignStatus`, `campaignNeedsAttention`, `STATUS_META`, `CampaignStatus` de `@/lib/campaigns/status` ; RPC `get_campaign_last_data_dates`.
- Produces: composant `<CampaignStatusBadge status={CampaignStatus} attention={boolean} />`.

- [ ] **Step 1: Créer le composant badge**

Create `components/campaigns/CampaignStatusBadge.tsx` :

```tsx
import { STATUS_META, type CampaignStatus } from '@/lib/campaigns/status';

interface Props { status: CampaignStatus; attention?: boolean; }

export function CampaignStatusBadge({ status, attention = false }: Props) {
  const meta = STATUS_META[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: "'Inter', system-ui, sans-serif", fontSize: 11, fontWeight: 500,
      color: meta.colorVar,
      border: `0.5px solid ${meta.colorVar}`, borderRadius: 4, padding: '2px 8px',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.colorVar }} />
      {meta.label}
      {attention && (
        <span title="En cours mais aucune donnée récente" style={{
          width: 6, height: 6, borderRadius: '50%', background: 'var(--warning)', marginLeft: 2,
        }} />
      )}
    </span>
  );
}
```

- [ ] **Step 2: Exposer `last_data_date` dans la liste admin**

Lire `app/api/admin/campaigns/route.ts`. Après la récupération des campagnes et des stats, appeler la RPC et fusionner :

```ts
const { data: lastDates } = await supabase.rpc('get_campaign_last_data_dates');
const lastByCampaign = new Map<string, string>((lastDates ?? []).map((r: { campaign_id: string; last_data_date: string }) => [r.campaign_id, r.last_data_date]));
// dans le map de sortie de chaque campagne :
//   last_data_date: lastByCampaign.get(c.id) ?? null,
```
Le champ `status_override` remonte déjà (le SELECT est `*`). S'assurer que la réponse par campagne contient `date_start`, `date_end`, `status_override`, `last_data_date`.

- [ ] **Step 3: Badge + filtre + tri dans la liste admin**

Lire `app/admin/campaigns/page.tsx`. Pour chaque campagne, calculer le statut effectif et l'attention (aujourd'hui = `new Date().toISOString().slice(0,10)`), afficher `<CampaignStatusBadge>`, ajouter des onglets de filtre (*Toutes · En cours · À venir · En pause · Terminées*, Archivées masquées par défaut) et trier avec les `en_cours` en tête :

```tsx
import { CampaignStatusBadge } from '@/components/campaigns/CampaignStatusBadge';
import { effectiveCampaignStatus, campaignNeedsAttention, type CampaignStatus } from '@/lib/campaigns/status';

const today = new Date().toISOString().slice(0, 10);
const withStatus = campaigns.map(c => {
  const status = effectiveCampaignStatus(c, today);
  return { ...c, status, attention: campaignNeedsAttention({ status, last_data_date: c.last_data_date }, today) };
});
const ORDER: CampaignStatus[] = ['en_cours', 'a_venir', 'en_pause', 'terminee', 'archivee'];
const visible = withStatus
  .filter(c => (filter === 'all' ? c.status !== 'archivee' : c.status === filter))
  .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
```
(Ajouter un `useState<'all' | CampaignStatus>('all')` pour `filter` et un rang d'onglets branché dessus. Rendre `<CampaignStatusBadge status={c.status} attention={c.attention} />` sur chaque ligne/carte.)

- [ ] **Step 4: Badge dans la CampaignCard digitale**

Lire `app/map/analyse/digital/_components/CampaignCard.tsx`. Si la campagne y porte `date_start`/`date_end`/`status_override`/`last_data_date`, calculer statut + attention comme ci-dessus et afficher `<CampaignStatusBadge>`. Sinon (champs absents de la source digitale), les ajouter à la RPC/route qui alimente la carte de la même façon qu'au Step 2 pour `/api/digital/campaigns`.

- [ ] **Step 5: Vérification navigateur**

Lancer `npm run dev`, se connecter (admin@geoprompt.com), ouvrir `/admin/campaigns` : chaque campagne porte un badge cohérent avec ses dates ; le filtre « En cours » ne montre que les live ; les archivées sont masquées par défaut ; les « En cours » sont en tête. Vérifier une CampaignCard sur `/map?layer=digital`. Console sans erreur.

- [ ] **Step 6: Type-check + commit**

Run: `npx tsc --noEmit` (attendu : OK).
```bash
git add components/campaigns/CampaignStatusBadge.tsx app/api/admin/campaigns/route.ts app/admin/campaigns/page.tsx app/map/analyse/digital/_components/CampaignCard.tsx
git commit -m "feat(campaigns): badge de statut + filtre/tri + last_data_date en liste"
```

---

## Task 5 — Contrôles d'override dans le header de campagne (écriture)

**Files:**
- Modify: `app/admin/campaigns/[id]/page.tsx` (header de détail campagne)

**Interfaces:**
- Consumes: le `PATCH /api/admin/campaigns/[id]` (Task 3), `effectiveCampaignStatus` + `<CampaignStatusBadge>`.

- [ ] **Step 1: Ajouter les actions d'override**

Lire `app/admin/campaigns/[id]/page.tsx`. Dans le header, afficher le badge de statut effectif et des boutons selon l'état courant :
- **En cours** → « Mettre en pause » (`PATCH { status_override: 'paused' }`) et « Clôturer » (`{ status_override: 'ended' }`).
- **En pause** → « Reprendre » (`{ status_override: null }`).
- **Terminée** (par override `ended`) → « Rouvrir » (`{ status_override: null }`).
- Toujours : « Archiver » (`{ status_override: 'archived' }`) / si archivée « Désarchiver » (`{ status_override: null }`).

Handler générique :

```tsx
async function setOverride(value: 'paused' | 'ended' | 'archived' | null) {
  const res = await adminFetch(`/api/admin/campaigns/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status_override: value }),
  });
  if (res.ok) refetchCampaign(); // recharge la campagne → badge recalculé
}
```
(`adminFetch` depuis `@/lib/admin-fetch` ; `refetchCampaign` = le rechargement existant du détail. Adapter aux noms du fichier.)

- [ ] **Step 2: Vérification navigateur**

`npm run dev`, ouvrir une campagne « En cours » sur `/admin/campaigns/<id>` : « Mettre en pause » → badge passe « En pause » ; « Reprendre » → revient à « En cours » ; « Archiver » → « Archivée ». Vérifier en base que `status_override` suit, puis nettoyer (remettre `null`). Console sans erreur.

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit` (attendu : OK).
```bash
git add "app/admin/campaigns/[id]/page.tsx"
git commit -m "feat(campaigns): contrôles pause/reprendre/clôturer/archiver dans le header"
```

---

## Self-Review (couverture du spec)

- **Modèle de données** (3 colonnes + CHECK) → Task 1. ✅
- **RPC last_data_date** → Task 1 (via `get_campaign_last_data_dates`, raffinement vs spec : petite RPC dédiée au lieu d'éditer les grosses RPC liste — noté). ✅
- **Statut calculé + override / 5 états / transitions** → Task 2 (logique) + Task 3 (écriture) + Task 5 (actions). ✅
- **Point d'attention (fraîcheur, seuil 3 j)** → Task 2 (`campaignNeedsAttention`) + Task 4 (affichage). ✅
- **Badge + filtre + tri sur les 2 surfaces** → Task 4 (admin + CampaignCard digitale). ✅
- **PATCH réutilisé, scope org, Zod, audit qui/quand** → Task 3. ✅
- **Tests logique pure** → Task 2 ; **schéma** → Task 3. ✅
- **Rétrocompat sans backfill** (colonnes NULL → statut calendaire immédiat) → garanti par la conception ; aucune tâche de backfill. ✅
- **Hors scope** (synchro DSP live, dashboard pacing, brouillon) → aucune tâche, respecté. ✅

Cohérence des types : `CampaignStatus` / `StatusOverride` / `effectiveCampaignStatus` / `campaignNeedsAttention` / `STATUS_META` / `FRESHNESS_DAYS` utilisés à l'identique de la Task 2 dans les Tasks 3-5. `get_campaign_last_data_dates` renvoie `(campaign_id, last_data_date)` consommé tel quel en Task 4.
