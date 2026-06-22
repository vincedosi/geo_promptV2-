# Onglet API — Connexions DSP (DV360) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un onglet « API » multi-DSP dans l'admin MAGELIAN, avec connexion réelle DV360 (Service Account + OAuth), stockage chiffré par organisation, onglet Logs, et placeholders Meta/TikTok/TTD.

**Architecture:** Pages Next.js App Router sous `app/admin/api/` (layout + sous-onglets en routes imbriquées). Backend : routes `app/api/admin/dsp/**` protégées par `requireAdmin`, secrets chiffrés AES-256-GCM (`lib/crypto/secrets.ts`), auth Google via `google-auth-library` (`lib/dsp/dv360/`), persistance dans 2 tables Supabase RLS (`dsp_connections`, `dsp_api_logs`). Tous les écritures DB passent par `createAdminClient()` (service role) avec `organization_id` dérivé du profil authentifié.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (PostgreSQL), Zod, Vitest, `google-auth-library`, Node `crypto` (AES-256-GCM).

## Global Constraints

- TypeScript strict ; imports absolus `@/` ; types partagés dans `types/`.
- Routes API : `export const dynamic = 'force-dynamic'`, validation Zod, `createAdminClient()` depuis `@/lib/auth`, guard `requireAdmin(request)` → `adminUnauthorized()` si null.
- Auth : sur `/api/*` ne JAMAIS appeler `getUser()` côté page ; les routes utilisent le Bearer token via `requireAdmin`/`getUserFromRequest`.
- Supabase Nano (250 IOPS) : tables petites, accès indexé par `organization_id`, jamais de full scan, `Promise.all` ≤ 3 appels Supabase.
- Migrations : appliquées via MCP Supabase `apply_migration` ET sauvegardées en fichier `supabase/migrations/*.sql` (versionnage). JAMAIS de SQL manuel hors MCP.
- Design system (dark minimal) : tokens `var(--…)` UNIQUEMENT, jamais de hex en dur ; sentence case ; section header = bandeau `var(--bg-level-2)` + dot teal ; focus teal ; CTA blanc ou teal ; pas de violet ; fonts Inter + JetBrains Mono.
- Secrets : jamais loggés, jamais renvoyés au client, chiffrés au repos. `detail` des logs sanitisé.
- Fichiers protégés (NE PAS TOUCHER) : `app/api/isochrone-battle/*`, `middleware.ts`, fonctions PostGIS battle.
- Commits atomiques, format `type: description`.

---

## File Structure

**Créés :**
- `supabase/migrations/20260622_dsp_api_connections.sql` — tables + RLS + index + trigger
- `lib/crypto/secrets.ts` — encrypt/decrypt AES-256-GCM
- `tests/unit/crypto/secrets.test.ts` — round-trip + tampering
- `types/dsp.ts` — types partagés DSP
- `lib/dsp/logger.ts` — `logDspEvent()`
- `lib/dsp/dv360/auth.ts` — JWT service account + helpers OAuth
- `lib/dsp/dv360/client.ts` — access token + `listAdvertisers`
- `tests/unit/dsp/dv360-auth.test.ts` — buildAuthUrl + parsing SA
- `lib/dsp/validation.ts` — schémas Zod partagés
- `app/api/admin/dsp/connections/route.ts` — GET statut
- `app/api/admin/dsp/dv360/connect/route.ts` — POST/DELETE
- `app/api/admin/dsp/dv360/test/route.ts` — POST appel réel
- `app/api/admin/dsp/dv360/oauth/start/route.ts` — GET redirect Google
- `app/api/admin/dsp/dv360/oauth/callback/route.ts` — GET échange code
- `app/api/admin/dsp/logs/route.ts` — GET logs paginés
- `app/admin/api/_lib/constants.ts` — tokens design + meta providers
- `app/admin/api/layout.tsx` — barre sous-onglets
- `app/admin/api/page.tsx` — redirect → dv360
- `app/admin/api/dv360/page.tsx` — écran DV360
- `app/admin/api/meta/page.tsx`, `tiktok/page.tsx`, `ttd/page.tsx` — placeholders
- `app/admin/api/logs/page.tsx` — table logs
- `public/logos/dv360.svg`, `meta.svg`, `tiktok.svg`, `ttd.svg`

**Modifiés :**
- `components/AppSidebar.tsx` — ajout section « API »
- `package.json` — dépendance `google-auth-library`
- `ARCHITECTURE.md` — tables, routes, env

---

## Task 1: Dépendance + clé d'environnement

**Files:**
- Modify: `package.json`
- Modify: `.env.local` (local, non commité)

**Interfaces:**
- Produces: dépendance `google-auth-library` disponible ; env `DSP_ENC_KEY`, `DV360_OAUTH_CLIENT_ID`, `DV360_OAUTH_CLIENT_SECRET`, `DV360_OAUTH_REDIRECT_URI`.

- [ ] **Step 1: Installer la dépendance**

Run: `npm install google-auth-library`
Expected: ajout dans `package.json` `dependencies`, install sans erreur.

- [ ] **Step 2: Générer la clé de chiffrement et l'ajouter à `.env.local`**

Run: `node -e "console.log('DSP_ENC_KEY=' + require('crypto').randomBytes(32).toString('base64'))"`
Copier la ligne affichée dans `.env.local`, puis ajouter les 3 variables OAuth (valeurs réelles fournies par la console Google Cloud, placeholders si pas encore disponibles) :

```
DSP_ENC_KEY=<sortie de la commande>
DV360_OAUTH_CLIENT_ID=
DV360_OAUTH_CLIENT_SECRET=
DV360_OAUTH_REDIRECT_URI=http://localhost:3000/api/admin/dsp/dv360/oauth/callback
```

- [ ] **Step 3: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS (aucune erreur introduite).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add google-auth-library for DV360 API"
```

---

## Task 2: Migration DB — tables dsp_connections + dsp_api_logs

**Files:**
- Create: `supabase/migrations/20260622_dsp_api_connections.sql`

**Interfaces:**
- Produces: tables `public.dsp_connections`, `public.dsp_api_logs` avec RLS par org et index. Colonnes exactes consommées par les tâches suivantes (voir SQL).

- [ ] **Step 1: Écrire le fichier de migration**

Create `supabase/migrations/20260622_dsp_api_connections.sql` :

```sql
-- =====================================================================
-- Onglet API — connexions DSP (DV360 d'abord)
-- Tables : dsp_connections (credentials chiffrés par org) + dsp_api_logs
-- =====================================================================

-- ── dsp_connections ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dsp_connections (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider                      text NOT NULL CHECK (provider IN ('dv360','meta','tiktok','ttd')),
  auth_method                   text CHECK (auth_method IN ('service_account','oauth')),
  status                        text NOT NULL DEFAULT 'disconnected'
                                  CHECK (status IN ('disconnected','connected','error')),
  partner_id                    text,
  advertiser_ids                jsonb NOT NULL DEFAULT '[]'::jsonb,
  credentials_encrypted         text,
  oauth_refresh_token_encrypted text,
  token_expires_at              timestamptz,
  last_error                    text,
  meta                          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  created_by                    uuid REFERENCES public.profiles(id),
  UNIQUE (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_dsp_connections_org
  ON public.dsp_connections (organization_id);

-- trigger updated_at
CREATE OR REPLACE FUNCTION public.set_dsp_connections_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_dsp_connections_updated_at ON public.dsp_connections;
CREATE TRIGGER trg_dsp_connections_updated_at
  BEFORE UPDATE ON public.dsp_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_dsp_connections_updated_at();

-- ── dsp_api_logs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dsp_api_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('dv360','meta','tiktok','ttd')),
  category        text NOT NULL CHECK (category IN ('api_call','connection','job')),
  level           text NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
  action          text NOT NULL,
  status_code     int,
  duration_ms     int,
  message         text,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dsp_api_logs_org_created
  ON public.dsp_api_logs (organization_id, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────
-- Lecture réservée aux membres de l'org ; écritures via service role (routes).
ALTER TABLE public.dsp_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dsp_connections_select ON public.dsp_connections;
CREATE POLICY dsp_connections_select ON public.dsp_connections
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

ALTER TABLE public.dsp_api_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dsp_api_logs_select ON public.dsp_api_logs;
CREATE POLICY dsp_api_logs_select ON public.dsp_api_logs
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org(auth.uid()));
```

- [ ] **Step 2: Appliquer via MCP Supabase**

Appeler l'outil MCP `apply_migration` avec `name: "20260622_dsp_api_connections"` et le contenu SQL ci-dessus.
Expected: succès, pas d'erreur.

- [ ] **Step 3: Vérifier la création des tables**

Appeler MCP `execute_sql` :
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name IN ('dsp_connections','dsp_api_logs');
```
Expected: 2 lignes retournées.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260622_dsp_api_connections.sql
git commit -m "feat: dsp_connections + dsp_api_logs tables (RLS par org)"
```

---

## Task 3: Helper de chiffrement AES-256-GCM

**Files:**
- Create: `lib/crypto/secrets.ts`
- Test: `tests/unit/crypto/secrets.test.ts`

**Interfaces:**
- Produces: `encryptSecret(plain: string): string` et `decryptSecret(payload: string): string`. Format : `iv_b64:tag_b64:ciphertext_b64`. Lèvent si `DSP_ENC_KEY` absente/mauvaise taille ou payload corrompu.

- [ ] **Step 1: Écrire le test (échec attendu)**

Create `tests/unit/crypto/secrets.test.ts` :

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  // Clé 32 bytes en base64, injectée avant import du module
  process.env.DSP_ENC_KEY = randomBytes(32).toString('base64');
});

describe('secrets', () => {
  it('round-trip : decrypt(encrypt(x)) === x', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/crypto/secrets');
    const plain = '{"client_email":"sa@x.iam.gserviceaccount.com","private_key":"-----BEGIN..."}';
    const enc = encryptSecret(plain);
    expect(enc).not.toContain('client_email'); // chiffré
    expect(enc.split(':')).toHaveLength(3);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('deux chiffrements du même clair diffèrent (IV aléatoire)', async () => {
    const { encryptSecret } = await import('@/lib/crypto/secrets');
    expect(encryptSecret('abc')).not.toBe(encryptSecret('abc'));
  });

  it('payload altéré → throw', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/crypto/secrets');
    const enc = encryptSecret('secret');
    const [iv, tag, ct] = enc.split(':');
    const tampered = [iv, tag, Buffer.from('zzzz').toString('base64')].join(':');
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: Lancer le test (échec)**

Run: `npx vitest run tests/unit/crypto/secrets.test.ts`
Expected: FAIL — module `@/lib/crypto/secrets` introuvable.

- [ ] **Step 3: Implémenter le helper**

Create `lib/crypto/secrets.ts` :

```ts
/**
 * MAGELIAN — chiffrement symétrique des secrets DSP (AES-256-GCM).
 * Clé : DSP_ENC_KEY (base64, 32 bytes) en variable d'environnement serveur.
 * Format stocké : iv_b64:tag_b64:ciphertext_b64.
 * À importer côté serveur uniquement (jamais bundlé client).
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function getKey(): Buffer {
  const b64 = process.env.DSP_ENC_KEY;
  if (!b64) throw new Error('[secrets] DSP_ENC_KEY manquante dans l\'environnement.');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error('[secrets] DSP_ENC_KEY doit faire 32 bytes (base64). Générer : node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))".');
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('[secrets] payload chiffré invalide.');
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
```

- [ ] **Step 4: Lancer le test (succès)**

Run: `npx vitest run tests/unit/crypto/secrets.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/crypto/secrets.ts tests/unit/crypto/secrets.test.ts
git commit -m "feat: AES-256-GCM secret encryption helper"
```

---

## Task 4: Types partagés DSP

**Files:**
- Create: `types/dsp.ts`

**Interfaces:**
- Produces: `DspProvider`, `DspAuthMethod`, `DspStatus`, `DspConnectionPublic`, `DspApiLogRow`, `DspLogCategory`, `DspLogLevel`. Consommés par routes + pages.

- [ ] **Step 1: Écrire les types**

Create `types/dsp.ts` :

```ts
/** MAGELIAN — types partagés pour l'onglet API (connexions DSP). */

export type DspProvider = 'dv360' | 'meta' | 'tiktok' | 'ttd';
export type DspAuthMethod = 'service_account' | 'oauth';
export type DspStatus = 'disconnected' | 'connected' | 'error';
export type DspLogCategory = 'api_call' | 'connection' | 'job';
export type DspLogLevel = 'info' | 'warn' | 'error';

/** Vue publique d'une connexion — JAMAIS de secret renvoyé au client. */
export interface DspConnectionPublic {
  provider: DspProvider;
  auth_method: DspAuthMethod | null;
  status: DspStatus;
  partner_id: string | null;
  advertiser_ids: { id: string; name: string }[];
  token_expires_at: string | null;
  last_error: string | null;
  updated_at: string | null;
}

export interface DspApiLogRow {
  id: string;
  provider: DspProvider;
  category: DspLogCategory;
  level: DspLogLevel;
  action: string;
  status_code: number | null;
  duration_ms: number | null;
  message: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add types/dsp.ts
git commit -m "feat: shared DSP types"
```

---

## Task 5: Helper de logging dsp_api_logs

**Files:**
- Create: `lib/dsp/logger.ts`

**Interfaces:**
- Consumes: `createAdminClient` (`@/lib/auth`), types de `@/types/dsp`.
- Produces: `logDspEvent(params: LogDspEventParams): Promise<void>` — best-effort, ne throw jamais.

```ts
interface LogDspEventParams {
  orgId: string;
  provider: DspProvider;
  category: DspLogCategory;
  level?: DspLogLevel;        // défaut 'info'
  action: string;
  statusCode?: number | null;
  durationMs?: number | null;
  message?: string;
  detail?: Record<string, unknown>;  // sanitisé par l'appelant — JAMAIS de secret
}
```

- [ ] **Step 1: Implémenter le helper**

Create `lib/dsp/logger.ts` :

```ts
/**
 * MAGELIAN — logging des événements DSP dans dsp_api_logs.
 * Best-effort : n'interrompt JAMAIS la requête principale (try/catch silencieux).
 * L'appelant DOIT sanitiser `detail` — aucun secret ne doit y figurer.
 */
import { createAdminClient } from '@/lib/auth';
import type { DspProvider, DspLogCategory, DspLogLevel } from '@/types/dsp';

interface LogDspEventParams {
  orgId: string;
  provider: DspProvider;
  category: DspLogCategory;
  level?: DspLogLevel;
  action: string;
  statusCode?: number | null;
  durationMs?: number | null;
  message?: string;
  detail?: Record<string, unknown>;
}

export async function logDspEvent(params: LogDspEventParams): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from('dsp_api_logs').insert({
      organization_id: params.orgId,
      provider: params.provider,
      category: params.category,
      level: params.level ?? 'info',
      action: params.action,
      status_code: params.statusCode ?? null,
      duration_ms: params.durationMs ?? null,
      message: params.message ?? null,
      detail: params.detail ?? {},
    });
  } catch (e) {
    console.error('[logDspEvent] échec insertion log (ignoré):', e);
  }
}
```

- [ ] **Step 2: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/dsp/logger.ts
git commit -m "feat: logDspEvent helper (best-effort dsp_api_logs)"
```

---

## Task 6: Lib auth DV360 (Service Account + OAuth)

**Files:**
- Create: `lib/dsp/dv360/auth.ts`
- Test: `tests/unit/dsp/dv360-auth.test.ts`

**Interfaces:**
- Consumes: `google-auth-library` (`JWT`, `OAuth2Client`).
- Produces:
  - `DV360_SCOPES: string[]`
  - `parseServiceAccount(json: string): { client_email: string; private_key: string }` (throw si invalide)
  - `getServiceAccountToken(saJson: string): Promise<string>` (access token)
  - `buildOAuthClient(): OAuth2Client`
  - `buildAuthUrl(state: string): string`
  - `exchangeCode(code: string): Promise<{ refreshToken: string | null; accessToken: string; expiryDate: number | null }>`
  - `refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiryDate: number | null }>`

- [ ] **Step 1: Écrire le test (échec attendu)**

Create `tests/unit/dsp/dv360-auth.test.ts` :

```ts
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.DV360_OAUTH_CLIENT_ID = 'test-client-id';
  process.env.DV360_OAUTH_CLIENT_SECRET = 'test-secret';
  process.env.DV360_OAUTH_REDIRECT_URI = 'http://localhost:3000/api/admin/dsp/dv360/oauth/callback';
});

describe('dv360 auth', () => {
  it('parseServiceAccount accepte un JSON SA valide', async () => {
    const { parseServiceAccount } = await import('@/lib/dsp/dv360/auth');
    const sa = parseServiceAccount(JSON.stringify({
      client_email: 'sa@x.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    }));
    expect(sa.client_email).toContain('gserviceaccount.com');
  });

  it('parseServiceAccount rejette un JSON sans private_key', async () => {
    const { parseServiceAccount } = await import('@/lib/dsp/dv360/auth');
    expect(() => parseServiceAccount('{"client_email":"a@b.com"}')).toThrow();
  });

  it('buildAuthUrl contient scope display-video, state et access_type=offline', async () => {
    const { buildAuthUrl } = await import('@/lib/dsp/dv360/auth');
    const url = buildAuthUrl('org-123');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('display-video');
    expect(url).toContain('state=org-123');
    expect(url).toContain('access_type=offline');
  });
});
```

- [ ] **Step 2: Lancer le test (échec)**

Run: `npx vitest run tests/unit/dsp/dv360-auth.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter la lib**

Create `lib/dsp/dv360/auth.ts` :

```ts
/**
 * MAGELIAN — authentification Google DV360.
 * Deux méthodes : Service Account (JWT) et OAuth2 utilisateur (3-legged).
 * Scopes centralisés ici (no hardcode ailleurs). Serveur uniquement.
 */
import { JWT, OAuth2Client } from 'google-auth-library';

export const DV360_SCOPES = [
  'https://www.googleapis.com/auth/display-video',
  // 'https://www.googleapis.com/auth/doubleclickbidmanager' — reporting, itération 2
];

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export function parseServiceAccount(json: string): ServiceAccountKey {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error('Clé Service Account : JSON invalide.');
  }
  const sa = obj as Partial<ServiceAccountKey>;
  if (!sa.client_email || !sa.private_key) {
    throw new Error('Clé Service Account : champs client_email / private_key manquants.');
  }
  return { client_email: sa.client_email, private_key: sa.private_key };
}

export async function getServiceAccountToken(saJson: string): Promise<string> {
  const sa = parseServiceAccount(saJson);
  const client = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: DV360_SCOPES,
  });
  const { access_token } = await client.authorize();
  if (!access_token) throw new Error('DV360 : échec obtention access token (Service Account).');
  return access_token;
}

export function buildOAuthClient(): OAuth2Client {
  const id = process.env.DV360_OAUTH_CLIENT_ID;
  const secret = process.env.DV360_OAUTH_CLIENT_SECRET;
  const redirect = process.env.DV360_OAUTH_REDIRECT_URI;
  if (!id || !secret || !redirect) {
    throw new Error('Variables OAuth DV360 manquantes (DV360_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI).');
  }
  return new OAuth2Client(id, secret, redirect);
}

export function buildAuthUrl(state: string): string {
  return buildOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: DV360_SCOPES,
    state,
  });
}

export async function exchangeCode(code: string): Promise<{
  refreshToken: string | null;
  accessToken: string;
  expiryDate: number | null;
}> {
  const { tokens } = await buildOAuthClient().getToken(code);
  if (!tokens.access_token) throw new Error('DV360 OAuth : access token absent de la réponse.');
  return {
    refreshToken: tokens.refresh_token ?? null,
    accessToken: tokens.access_token,
    expiryDate: tokens.expiry_date ?? null,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiryDate: number | null;
}> {
  const client = buildOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('DV360 OAuth : échec refresh access token.');
  const expiry = client.credentials.expiry_date ?? null;
  return { accessToken: token, expiryDate: expiry };
}
```

- [ ] **Step 4: Lancer le test (succès)**

Run: `npx vitest run tests/unit/dsp/dv360-auth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dsp/dv360/auth.ts tests/unit/dsp/dv360-auth.test.ts
git commit -m "feat: DV360 auth (service account JWT + OAuth helpers)"
```

---

## Task 7: Client DV360 (access token résolu + listAdvertisers)

**Files:**
- Create: `lib/dsp/dv360/client.ts`

**Interfaces:**
- Consumes: `getServiceAccountToken`, `refreshAccessToken` (`./auth`), `decryptSecret` (`@/lib/crypto/secrets`).
- Produces:
  - type `Dv360ConnectionRow` (sous-ensemble de dsp_connections nécessaire)
  - `resolveAccessToken(conn: Dv360ConnectionRow): Promise<string>` — choisit SA vs OAuth, déchiffre, renvoie token
  - `listAdvertisers(accessToken: string, partnerId: string): Promise<{ id: string; name: string }[]>`

- [ ] **Step 1: Implémenter le client**

Create `lib/dsp/dv360/client.ts` :

```ts
/**
 * MAGELIAN — client REST DV360 (Display & Video 360 API v3).
 * Résout un access token depuis une connexion stockée (chiffrée) puis
 * effectue des appels REST. Serveur uniquement.
 */
import { getServiceAccountToken, refreshAccessToken } from './auth';
import { decryptSecret } from '@/lib/crypto/secrets';

const DV360_BASE = 'https://displayvideo.googleapis.com/v3';

export interface Dv360ConnectionRow {
  auth_method: 'service_account' | 'oauth' | null;
  credentials_encrypted: string | null;
  oauth_refresh_token_encrypted: string | null;
}

export async function resolveAccessToken(conn: Dv360ConnectionRow): Promise<string> {
  if (conn.auth_method === 'service_account') {
    if (!conn.credentials_encrypted) throw new Error('Aucune clé Service Account enregistrée.');
    return getServiceAccountToken(decryptSecret(conn.credentials_encrypted));
  }
  if (conn.auth_method === 'oauth') {
    if (!conn.oauth_refresh_token_encrypted) throw new Error('Aucun refresh token OAuth enregistré.');
    const { accessToken } = await refreshAccessToken(decryptSecret(conn.oauth_refresh_token_encrypted));
    return accessToken;
  }
  throw new Error('Méthode d\'authentification DV360 non configurée.');
}

export async function listAdvertisers(
  accessToken: string,
  partnerId: string,
): Promise<{ id: string; name: string }[]> {
  const url = `${DV360_BASE}/advertisers?partnerId=${encodeURIComponent(partnerId)}&pageSize=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DV360 advertisers.list ${res.status} : ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    advertisers?: { advertiserId: string; displayName: string }[];
  };
  return (data.advertisers ?? []).map((a) => ({ id: a.advertiserId, name: a.displayName }));
}
```

- [ ] **Step 2: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/dsp/dv360/client.ts
git commit -m "feat: DV360 REST client (token resolve + listAdvertisers)"
```

---

## Task 8: Schémas de validation Zod

**Files:**
- Create: `lib/dsp/validation.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces: `dv360ConnectSchema` (body POST connect), `logsQuerySchema` (query GET logs).

- [ ] **Step 1: Implémenter les schémas**

Create `lib/dsp/validation.ts` :

```ts
/** MAGELIAN — schémas Zod des routes DSP. */
import { z } from 'zod';

export const dv360ConnectSchema = z.object({
  auth_method: z.literal('service_account'), // OAuth passe par /oauth/start, pas ce body
  partner_id: z.string().trim().min(1, 'partner_id requis'),
  service_account_json: z.string().trim().min(1, 'clé Service Account requise'),
});
export type Dv360ConnectInput = z.infer<typeof dv360ConnectSchema>;

export const logsQuerySchema = z.object({
  provider: z.enum(['dv360', 'meta', 'tiktok', 'ttd']).optional(),
  level: z.enum(['info', 'warn', 'error']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
```

- [ ] **Step 2: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/dsp/validation.ts
git commit -m "feat: Zod schemas for DSP routes"
```

---

## Task 9: Route GET /api/admin/dsp/connections

**Files:**
- Create: `app/api/admin/dsp/connections/route.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `adminUnauthorized` (`@/lib/api/middleware`), `createAdminClient`, types `DspConnectionPublic`.
- Produces: `GET` → `{ connections: DspConnectionPublic[] }` pour l'org du profil (sans secrets).

- [ ] **Step 1: Implémenter la route**

Create `app/api/admin/dsp/connections/route.ts` :

```ts
/** MAGELIAN — GET /api/admin/dsp/connections : statut des connexions DSP de l'org. */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import type { DspConnectionPublic } from '@/types/dsp';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation associée au profil.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('dsp_connections')
    .select('provider, auth_method, status, partner_id, advertiser_ids, token_expires_at, last_error, updated_at')
    .eq('organization_id', profile.organization_id);

  if (error) {
    console.error('[GET dsp/connections]', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  const connections = (data ?? []) as DspConnectionPublic[];
  return NextResponse.json({ connections }, { headers: { 'Cache-Control': 'no-store' } });
}
```

- [ ] **Step 2: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/dsp/connections/route.ts
git commit -m "feat: GET dsp/connections route"
```

---

## Task 10: Route POST + DELETE /api/admin/dsp/dv360/connect

**Files:**
- Create: `app/api/admin/dsp/dv360/connect/route.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `createAdminClient`, `dv360ConnectSchema`, `parseServiceAccount` (`@/lib/dsp/dv360/auth`), `encryptSecret`, `logDspEvent`.
- Produces: `POST` (enregistre SA, status `disconnected`) ; `DELETE` (déconnecte, nullify secrets).

- [ ] **Step 1: Implémenter la route**

Create `app/api/admin/dsp/dv360/connect/route.ts` :

```ts
/** MAGELIAN — POST/DELETE /api/admin/dsp/dv360/connect : enregistre/supprime la connexion Service Account. */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { dv360ConnectSchema } from '@/lib/dsp/validation';
import { parseServiceAccount } from '@/lib/dsp/dv360/auth';
import { encryptSecret } from '@/lib/crypto/secrets';
import { logDspEvent } from '@/lib/dsp/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const parsed = dv360ConnectSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Body invalide.' }, { status: 400 });
  }
  const { partner_id, service_account_json } = parsed.data;

  // Valide la structure de la clé AVANT chiffrement (échoue vite si mauvais JSON)
  try {
    parseServiceAccount(service_account_json);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('dsp_connections').upsert({
    organization_id: orgId,
    provider: 'dv360',
    auth_method: 'service_account',
    status: 'disconnected',
    partner_id,
    credentials_encrypted: encryptSecret(service_account_json),
    oauth_refresh_token_encrypted: null,
    last_error: null,
    created_by: profile.id,
  }, { onConflict: 'organization_id,provider' });

  if (error) {
    console.error('[POST dv360/connect]', error.message);
    return NextResponse.json({ error: 'Erreur enregistrement.' }, { status: 500 });
  }

  await logDspEvent({
    orgId, provider: 'dv360', category: 'connection', action: 'connect_service_account',
    message: `Service Account enregistré (partner ${partner_id})`,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from('dsp_connections').update({
    status: 'disconnected',
    auth_method: null,
    credentials_encrypted: null,
    oauth_refresh_token_encrypted: null,
    token_expires_at: null,
    advertiser_ids: [],
    last_error: null,
  }).eq('organization_id', orgId).eq('provider', 'dv360');

  if (error) {
    console.error('[DELETE dv360/connect]', error.message);
    return NextResponse.json({ error: 'Erreur déconnexion.' }, { status: 500 });
  }

  await logDspEvent({ orgId, provider: 'dv360', category: 'connection', action: 'disconnect', message: 'Connexion DV360 supprimée' });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/dsp/dv360/connect/route.ts
git commit -m "feat: DV360 connect/disconnect route (service account)"
```

---

## Task 11: Route POST /api/admin/dsp/dv360/test (appel réel)

**Files:**
- Create: `app/api/admin/dsp/dv360/test/route.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `createAdminClient`, `resolveAccessToken`, `listAdvertisers` (`@/lib/dsp/dv360/client`), `logDspEvent`.
- Produces: `POST` → exécute `listAdvertisers`, met à jour `advertiser_ids` + `status`, log. Retourne `{ ok, advertisers }` ou `{ error }`.

- [ ] **Step 1: Implémenter la route**

Create `app/api/admin/dsp/dv360/test/route.ts` :

```ts
/** MAGELIAN — POST /api/admin/dsp/dv360/test : appel réel DV360 (list advertisers) prouvant l'auth. */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { resolveAccessToken, listAdvertisers, type Dv360ConnectionRow } from '@/lib/dsp/dv360/client';
import { logDspEvent } from '@/lib/dsp/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: conn, error: readErr } = await supabase
    .from('dsp_connections')
    .select('auth_method, credentials_encrypted, oauth_refresh_token_encrypted, partner_id')
    .eq('organization_id', orgId).eq('provider', 'dv360').single();

  if (readErr || !conn) {
    return NextResponse.json({ error: 'Aucune connexion DV360 enregistrée.' }, { status: 404 });
  }
  if (!conn.partner_id) {
    return NextResponse.json({ error: 'Partner ID manquant.' }, { status: 400 });
  }

  const started = Date.now();
  try {
    const token = await resolveAccessToken(conn as Dv360ConnectionRow);
    const advertisers = await listAdvertisers(token, conn.partner_id);
    const durationMs = Date.now() - started;

    await supabase.from('dsp_connections').update({
      status: 'connected', advertiser_ids: advertisers, last_error: null,
    }).eq('organization_id', orgId).eq('provider', 'dv360');

    await logDspEvent({
      orgId, provider: 'dv360', category: 'api_call', action: 'list_advertisers',
      statusCode: 200, durationMs,
      message: `${advertisers.length} advertisers récupérés`,
      detail: { count: advertisers.length, partner_id: conn.partner_id },
    });

    return NextResponse.json({ ok: true, advertisers });
  } catch (e) {
    const durationMs = Date.now() - started;
    const msg = (e as Error).message;
    await supabase.from('dsp_connections').update({ status: 'error', last_error: msg })
      .eq('organization_id', orgId).eq('provider', 'dv360');
    await logDspEvent({
      orgId, provider: 'dv360', category: 'api_call', action: 'list_advertisers',
      level: 'error', durationMs, message: msg,
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
```

- [ ] **Step 2: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/dsp/dv360/test/route.ts
git commit -m "feat: DV360 connection test route (real list advertisers)"
```

---

## Task 12: Routes OAuth DV360 (start + callback)

**Files:**
- Create: `app/api/admin/dsp/dv360/oauth/start/route.ts`
- Create: `app/api/admin/dsp/dv360/oauth/callback/route.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `buildAuthUrl`, `exchangeCode` (`@/lib/dsp/dv360/auth`), `encryptSecret`, `createAdminClient`, `logDspEvent`.
- Produces: `start` → 302 vers Google (state = orgId) ; `callback` → échange code, upsert connexion OAuth, redirige vers `/admin/api/dv360`.

> Note state : pour l'itération 1, le `state` porte l'orgId directement. Le callback étant ouvert (pas de Bearer), il relit l'org depuis le state. C'est acceptable car l'orgId n'est pas un secret et l'écriture ne fait qu'attacher des tokens à cette org. Durcissement (state signé HMAC) à prévoir itération 2 — noté dans la spec.

- [ ] **Step 1: Implémenter `start`**

Create `app/api/admin/dsp/dv360/oauth/start/route.ts` :

```ts
/** MAGELIAN — GET /api/admin/dsp/dv360/oauth/start : redirige vers le consentement Google. */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { buildAuthUrl } from '@/lib/dsp/dv360/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });
  }
  try {
    return NextResponse.redirect(buildAuthUrl(profile.organization_id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Implémenter `callback`**

Create `app/api/admin/dsp/dv360/oauth/callback/route.ts` :

```ts
/** MAGELIAN — GET /api/admin/dsp/dv360/oauth/callback : échange le code OAuth et enregistre la connexion. */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { exchangeCode } from '@/lib/dsp/dv360/auth';
import { encryptSecret } from '@/lib/crypto/secrets';
import { logDspEvent } from '@/lib/dsp/logger';

export const dynamic = 'force-dynamic';

function redirectToUi(request: NextRequest, query: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  return NextResponse.redirect(`${base}/admin/api/dv360?${query}`);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const orgId = url.searchParams.get('state'); // orgId porté par le state
  const oauthError = url.searchParams.get('error');

  if (oauthError) return redirectToUi(request, `oauth=error&reason=${encodeURIComponent(oauthError)}`);
  if (!code || !orgId) return redirectToUi(request, 'oauth=error&reason=missing_code_or_state');

  try {
    const { refreshToken, expiryDate } = await exchangeCode(code);
    if (!refreshToken) {
      // Google n'a pas renvoyé de refresh token (consent déjà accordé sans prompt)
      return redirectToUi(request, 'oauth=error&reason=no_refresh_token');
    }
    const supabase = createAdminClient();
    await supabase.from('dsp_connections').upsert({
      organization_id: orgId,
      provider: 'dv360',
      auth_method: 'oauth',
      status: 'disconnected',
      oauth_refresh_token_encrypted: encryptSecret(refreshToken),
      credentials_encrypted: null,
      token_expires_at: expiryDate ? new Date(expiryDate).toISOString() : null,
      last_error: null,
    }, { onConflict: 'organization_id,provider' });

    await logDspEvent({ orgId, provider: 'dv360', category: 'connection', action: 'oauth_callback', message: 'OAuth Google connecté' });
    return redirectToUi(request, 'oauth=success');
  } catch (e) {
    return redirectToUi(request, `oauth=error&reason=${encodeURIComponent((e as Error).message)}`);
  }
}
```

- [ ] **Step 3: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/dsp/dv360/oauth/start/route.ts app/api/admin/dsp/dv360/oauth/callback/route.ts
git commit -m "feat: DV360 OAuth start + callback routes"
```

---

## Task 13: Route GET /api/admin/dsp/logs

**Files:**
- Create: `app/api/admin/dsp/logs/route.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `createAdminClient`, `logsQuerySchema` (`@/lib/dsp/validation`), type `DspApiLogRow`.
- Produces: `GET` → `{ logs: DspApiLogRow[] }` filtré + paginé pour l'org.

- [ ] **Step 1: Implémenter la route**

Create `app/api/admin/dsp/logs/route.ts` :

```ts
/** MAGELIAN — GET /api/admin/dsp/logs : logs DSP de l'org (filtres provider/level, pagination). */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { logsQuerySchema } from '@/lib/dsp/validation';
import type { DspApiLogRow } from '@/types/dsp';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const url = new URL(request.url);
  const parsed = logsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
  }
  const { provider, level, limit, offset } = parsed.data;

  const supabase = createAdminClient();
  let query = supabase
    .from('dsp_api_logs')
    .select('id, provider, category, level, action, status_code, duration_ms, message, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (provider) query = query.eq('provider', provider);
  if (level) query = query.eq('level', level);

  const { data, error } = await query;
  if (error) {
    console.error('[GET dsp/logs]', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  return NextResponse.json({ logs: (data ?? []) as DspApiLogRow[] }, { headers: { 'Cache-Control': 'no-store' } });
}
```

- [ ] **Step 2: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/dsp/logs/route.ts
git commit -m "feat: GET dsp/logs route (filters + pagination)"
```

---

## Task 14: Logos providers + constants UI

**Files:**
- Create: `public/logos/dv360.svg`, `public/logos/meta.svg`, `public/logos/tiktok.svg`, `public/logos/ttd.svg`
- Create: `app/admin/api/_lib/constants.ts`

**Interfaces:**
- Produces: `PROVIDERS` (liste ordonnée { key, label, logo, available }) et `C` (tokens design). Consommés par layout + pages.

- [ ] **Step 1: Créer 4 logos SVG placeholder (wordmarks neutres)**

Create `public/logos/dv360.svg` :

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="28" viewBox="0 0 120 28"><rect width="120" height="28" rx="4" fill="#111111"/><text x="12" y="19" font-family="Inter, sans-serif" font-size="13" font-weight="600" fill="#f0f0f0">DV360</text></svg>
```

Create `public/logos/meta.svg` :

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="28" viewBox="0 0 120 28"><rect width="120" height="28" rx="4" fill="#111111"/><text x="12" y="19" font-family="Inter, sans-serif" font-size="13" font-weight="600" fill="#f0f0f0">Meta</text></svg>
```

Create `public/logos/tiktok.svg` :

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="28" viewBox="0 0 120 28"><rect width="120" height="28" rx="4" fill="#111111"/><text x="12" y="19" font-family="Inter, sans-serif" font-size="13" font-weight="600" fill="#f0f0f0">TikTok</text></svg>
```

Create `public/logos/ttd.svg` :

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="28" viewBox="0 0 160 28"><rect width="160" height="28" rx="4" fill="#111111"/><text x="12" y="19" font-family="Inter, sans-serif" font-size="13" font-weight="600" fill="#f0f0f0">The Trade Desk</text></svg>
```

- [ ] **Step 2: Créer les constantes UI**

Create `app/admin/api/_lib/constants.ts` :

```ts
/** MAGELIAN — constantes de l'onglet API (providers + tokens design). */
import type { DspProvider } from '@/types/dsp';

export interface ProviderMeta {
  key: DspProvider;
  label: string;
  logo: string;
  available: boolean; // false = placeholder « bientôt disponible »
}

export const PROVIDERS: ProviderMeta[] = [
  { key: 'dv360',  label: 'DV360',          logo: '/logos/dv360.svg',  available: true },
  { key: 'meta',   label: 'Meta',           logo: '/logos/meta.svg',   available: false },
  { key: 'tiktok', label: 'TikTok',         logo: '/logos/tiktok.svg', available: false },
  { key: 'ttd',    label: 'The Trade Desk', logo: '/logos/ttd.svg',    available: false },
];

/** Tokens design réutilisés (var(--…) du design system, jamais de hex en dur). */
export const C = {
  bg: 'var(--bg-primary)',
  card: 'var(--bg-surface)',
  elevated: 'var(--bg-level-2)',
  border: 'var(--border-subtle)',
  borderDefault: 'var(--border-default)',
  teal: 'var(--brand-teal)',
  green: 'var(--success)',
  red: 'var(--danger)',
  warn: 'var(--warning)',
  text: 'var(--text-primary)',
  textSec: 'var(--text-secondary)',
  textDim: 'var(--text-tertiary)',
};
export const fInter = "'Inter', system-ui, sans-serif";
export const fMono = "'JetBrains Mono', monospace";
```

- [ ] **Step 3: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add public/logos app/admin/api/_lib/constants.ts
git commit -m "feat: DSP provider logos + API tab UI constants"
```

---

## Task 15: Layout sous-onglets + page redirect

**Files:**
- Create: `app/admin/api/layout.tsx`
- Create: `app/admin/api/page.tsx`

**Interfaces:**
- Consumes: `PROVIDERS`, `C`, `fInter` (`./_lib/constants`).
- Produces: barre de sous-onglets (DV360/Meta/TikTok/TTD + Logs) avec onglet actif teal ; `/admin/api` redirige vers `/admin/api/dv360`.

- [ ] **Step 1: Implémenter le layout**

Create `app/admin/api/layout.tsx` :

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PROVIDERS, C, fInter } from './_lib/constants';

const TABS = [
  ...PROVIDERS.map((p) => ({ href: `/admin/api/${p.key}`, label: p.label })),
  { href: '/admin/api/logs', label: 'Logs' },
];

export default function ApiLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text }}>
      <div style={{ padding: '20px 24px 0' }}>
        <h1 style={{ fontFamily: fInter, fontWeight: 500, fontSize: 18, margin: 0 }}>
          Connexions API
        </h1>
        <p style={{ fontFamily: fInter, fontSize: 13, color: C.textSec, marginTop: 4 }}>
          Connecter les plateformes DSP pour le reporting et le custom bidding.
        </p>
      </div>

      <nav style={{ display: 'flex', gap: 4, padding: '16px 24px 0', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                fontFamily: fInter, fontSize: 13, fontWeight: 500,
                padding: '8px 12px', textDecoration: 'none',
                color: active ? C.text : C.textDim,
                borderBottom: active ? `2px solid ${C.teal}` : '2px solid transparent',
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div style={{ padding: 24 }}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Implémenter la page redirect**

Create `app/admin/api/page.tsx` :

```tsx
import { redirect } from 'next/navigation';

export default function ApiIndexPage() {
  redirect('/admin/api/dv360');
}
```

- [ ] **Step 3: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/admin/api/layout.tsx app/admin/api/page.tsx
git commit -m "feat: API tab layout (sub-tabs) + index redirect"
```

---

## Task 16: Pages placeholder Meta / TikTok / TTD

**Files:**
- Create: `app/admin/api/meta/page.tsx`
- Create: `app/admin/api/tiktok/page.tsx`
- Create: `app/admin/api/ttd/page.tsx`

**Interfaces:**
- Consumes: `PROVIDERS`, `C`, `fInter` (`../_lib/constants`).
- Produces: écran « bientôt disponible » par provider (logo + texte + formulaire désactivé).

> Les 3 fichiers ont la même structure ; seule la clé provider change. Code complet pour chacun ci-dessous.

- [ ] **Step 1: Créer `meta/page.tsx`**

Create `app/admin/api/meta/page.tsx` :

```tsx
'use client';
import { PROVIDERS, C, fInter } from '../_lib/constants';

export default function MetaPage() {
  const p = PROVIDERS.find((x) => x.key === 'meta')!;
  return (
    <div style={{ maxWidth: 560 }}>
      <img src={p.logo} alt={p.label} style={{ height: 28, marginBottom: 16 }} />
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24 }}>
        <p style={{ fontFamily: fInter, fontSize: 14, color: C.text, margin: 0 }}>Intégration {p.label} bientôt disponible</p>
        <p style={{ fontFamily: fInter, fontSize: 13, color: C.textSec, marginTop: 8 }}>
          La connexion {p.label} sera ajoutée après la mise en production de DV360.
        </p>
        <input
          disabled
          placeholder="Identifiant de compte"
          style={{ marginTop: 16, width: '100%', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.textDim, fontFamily: fInter, fontSize: 13 }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Créer `tiktok/page.tsx`**

Create `app/admin/api/tiktok/page.tsx` — identique à Step 1 mais avec `find((x) => x.key === 'tiktok')` et `export default function TiktokPage()`.

```tsx
'use client';
import { PROVIDERS, C, fInter } from '../_lib/constants';

export default function TiktokPage() {
  const p = PROVIDERS.find((x) => x.key === 'tiktok')!;
  return (
    <div style={{ maxWidth: 560 }}>
      <img src={p.logo} alt={p.label} style={{ height: 28, marginBottom: 16 }} />
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24 }}>
        <p style={{ fontFamily: fInter, fontSize: 14, color: C.text, margin: 0 }}>Intégration {p.label} bientôt disponible</p>
        <p style={{ fontFamily: fInter, fontSize: 13, color: C.textSec, marginTop: 8 }}>
          La connexion {p.label} sera ajoutée après la mise en production de DV360.
        </p>
        <input
          disabled
          placeholder="Identifiant de compte"
          style={{ marginTop: 16, width: '100%', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.textDim, fontFamily: fInter, fontSize: 13 }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Créer `ttd/page.tsx`**

Create `app/admin/api/ttd/page.tsx` :

```tsx
'use client';
import { PROVIDERS, C, fInter } from '../_lib/constants';

export default function TtdPage() {
  const p = PROVIDERS.find((x) => x.key === 'ttd')!;
  return (
    <div style={{ maxWidth: 560 }}>
      <img src={p.logo} alt={p.label} style={{ height: 28, marginBottom: 16 }} />
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24 }}>
        <p style={{ fontFamily: fInter, fontSize: 14, color: C.text, margin: 0 }}>Intégration {p.label} bientôt disponible</p>
        <p style={{ fontFamily: fInter, fontSize: 13, color: C.textSec, marginTop: 8 }}>
          La connexion {p.label} sera ajoutée après la mise en production de DV360.
        </p>
        <input
          disabled
          placeholder="Identifiant de compte"
          style={{ marginTop: 16, width: '100%', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.textDim, fontFamily: fInter, fontSize: 13 }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/admin/api/meta/page.tsx app/admin/api/tiktok/page.tsx app/admin/api/ttd/page.tsx
git commit -m "feat: placeholder pages Meta/TikTok/TTD"
```

---

## Task 17: Page DV360 (écran complet)

**Files:**
- Create: `app/admin/api/dv360/page.tsx`

**Interfaces:**
- Consumes: `adminFetch` (`@/lib/admin-fetch`), `useToast` (`@/components/ui/geo-toast`), `PROVIDERS`, `C`, `fInter`, `fMono` (`../_lib/constants`), type `DspConnectionPublic`.
- Endpoints : `GET /api/admin/dsp/connections`, `POST/DELETE /api/admin/dsp/dv360/connect`, `POST /api/admin/dsp/dv360/test`, `GET /api/admin/dsp/dv360/oauth/start`.

- [ ] **Step 1: Implémenter la page**

Create `app/admin/api/dv360/page.tsx` :

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { PROVIDERS, C, fInter, fMono } from '../_lib/constants';
import type { DspConnectionPublic } from '@/types/dsp';

type Method = 'service_account' | 'oauth';

export default function Dv360Page() {
  const toast = useToast();
  const provider = PROVIDERS.find((p) => p.key === 'dv360')!;

  const [conn, setConn] = useState<DspConnectionPublic | null>(null);
  const [method, setMethod] = useState<Method>('service_account');
  const [partnerId, setPartnerId] = useState('');
  const [saJson, setSaJson] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/dsp/connections');
      const json = await res.json();
      const dv = (json.connections ?? []).find((c: DspConnectionPublic) => c.provider === 'dv360') ?? null;
      setConn(dv);
      if (dv?.partner_id) setPartnerId(dv.partner_id);
      if (dv?.auth_method) setMethod(dv.auth_method);
    } catch {
      toast.error('Impossible de charger la connexion DV360.');
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // Retour OAuth (query ?oauth=success|error) — lu côté client pour éviter
  // la contrainte Suspense de useSearchParams() au build Next 14.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const o = params.get('oauth');
    if (o === 'success') toast.success('DV360 connecté via Google.');
    else if (o === 'error') toast.error(`Échec OAuth : ${params.get('reason') ?? 'inconnu'}`);
  }, [toast]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/dv360/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_method: 'service_account', partner_id: partnerId, service_account_json: saJson }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erreur');
      toast.success('Connexion enregistrée.');
      setSaJson('');
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/dv360/test', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erreur');
      toast.success(`Connexion OK — ${json.advertisers?.length ?? 0} advertisers.`);
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/dv360/connect', { method: 'DELETE' });
      if (!res.ok) throw new Error('Erreur déconnexion');
      toast.success('Déconnecté.');
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const status = conn?.status ?? 'disconnected';
  const statusColor = status === 'connected' ? C.green : status === 'error' ? C.red : C.textDim;

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <img src={provider.logo} alt="DV360" style={{ height: 28 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: fMono, fontSize: 12, color: statusColor }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />
          {status === 'connected' ? 'Connecté' : status === 'error' ? 'Erreur' : 'Déconnecté'}
        </span>
      </div>

      {conn?.last_error && (
        <div style={{ background: 'rgba(255,87,87,0.1)', border: `0.5px solid ${C.red}`, borderRadius: 6, padding: '8px 12px', marginBottom: 16, fontFamily: fMono, fontSize: 11, color: C.red }}>
          {conn.last_error}
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24 }}>
        {/* Méthode */}
        <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Méthode d'authentification</label>
        <div style={{ display: 'flex', gap: 16, margin: '8px 0 16px' }}>
          {(['service_account', 'oauth'] as Method[]).map((m) => (
            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: fInter, fontSize: 13, color: C.textSec, cursor: 'pointer' }}>
              <input type="radio" checked={method === m} onChange={() => setMethod(m)} />
              {m === 'service_account' ? 'Service Account' : 'OAuth Google'}
            </label>
          ))}
        </div>

        {/* Partner ID */}
        <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Partner ID</label>
        <input
          value={partnerId}
          onChange={(e) => setPartnerId(e.target.value)}
          placeholder="ex : 123456"
          style={{ width: '100%', margin: '6px 0 16px', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontFamily: fInter, fontSize: 13 }}
        />

        {method === 'service_account' ? (
          <>
            <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Clé Service Account (JSON)</label>
            <textarea
              value={saJson}
              onChange={(e) => setSaJson(e.target.value)}
              placeholder='{ "client_email": "...", "private_key": "..." }'
              rows={6}
              style={{ width: '100%', margin: '6px 0 16px', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontFamily: fMono, fontSize: 11, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={save} disabled={busy || !partnerId || !saJson} style={btnTeal(busy || !partnerId || !saJson)}>Enregistrer</button>
              <button onClick={test} disabled={busy || !conn} style={btnOutline(busy || !conn)}>Tester la connexion</button>
              {conn && <button onClick={disconnect} disabled={busy} style={btnDanger(busy)}>Déconnecter</button>}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <a href="/api/admin/dsp/dv360/oauth/start" style={{ ...btnTeal(false), textDecoration: 'none', display: 'inline-block' }}>Se connecter avec Google</a>
            <button onClick={test} disabled={busy || !conn} style={btnOutline(busy || !conn)}>Tester la connexion</button>
            {conn && <button onClick={disconnect} disabled={busy} style={btnDanger(busy)}>Déconnecter</button>}
          </div>
        )}
      </div>

      {conn && conn.advertiser_ids.length > 0 && (
        <p style={{ fontFamily: fMono, fontSize: 12, color: C.textSec, marginTop: 16 }}>
          Advertisers détectés : {conn.advertiser_ids.length}
        </p>
      )}
    </div>
  );
}

function btnTeal(disabled: boolean): React.CSSProperties {
  return { background: 'transparent', border: `0.5px solid ${C.teal}`, color: C.teal, borderRadius: 6, padding: '8px 16px', fontFamily: fInter, fontSize: 12, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 };
}
function btnOutline(disabled: boolean): React.CSSProperties {
  return { background: 'transparent', border: `0.5px solid ${C.borderDefault}`, color: C.textSec, borderRadius: 6, padding: '8px 16px', fontFamily: fInter, fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 };
}
function btnDanger(disabled: boolean): React.CSSProperties {
  return { background: 'transparent', border: `0.5px solid ${C.red}`, color: C.red, borderRadius: 6, padding: '8px 16px', fontFamily: fInter, fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 };
}
```

- [ ] **Step 2: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/admin/api/dv360/page.tsx
git commit -m "feat: DV360 connection screen (SA + OAuth)"
```

---

## Task 18: Page Logs

**Files:**
- Create: `app/admin/api/logs/page.tsx`

**Interfaces:**
- Consumes: `adminFetch`, `useToast`, `C`, `fInter`, `fMono` (`../_lib/constants`), type `DspApiLogRow`.
- Endpoint : `GET /api/admin/dsp/logs?provider=&level=`.

- [ ] **Step 1: Implémenter la page**

Create `app/admin/api/logs/page.tsx` :

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { C, fInter, fMono } from '../_lib/constants';
import type { DspApiLogRow } from '@/types/dsp';

export default function LogsPage() {
  const toast = useToast();
  const [logs, setLogs] = useState<DspApiLogRow[]>([]);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = errorsOnly ? '?level=error' : '';
      const res = await adminFetch(`/api/admin/dsp/logs${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erreur');
      setLogs(json.logs ?? []);
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }, [errorsOnly, toast]);

  useEffect(() => { load(); }, [load]);

  const levelColor = (l: string) => (l === 'error' ? C.red : l === 'warn' ? C.warn : C.textSec);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: fInter, fontSize: 13, color: C.textSec, cursor: 'pointer' }}>
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
          Erreurs uniquement
        </label>
        <button onClick={load} style={{ background: 'transparent', border: `0.5px solid ${C.borderDefault}`, color: C.textSec, borderRadius: 6, padding: '6px 12px', fontFamily: fInter, fontSize: 12, cursor: 'pointer' }}>
          Rafraîchir
        </button>
      </div>

      {loading ? (
        <p style={{ fontFamily: fInter, fontSize: 13, color: C.textDim }}>Chargement…</p>
      ) : logs.length === 0 ? (
        <p style={{ fontFamily: fInter, fontSize: 13, color: C.textDim }}>Aucun log pour le moment.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fMono, fontSize: 11 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.textDim, borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '8px 10px' }}>Date</th>
              <th style={{ padding: '8px 10px' }}>Provider</th>
              <th style={{ padding: '8px 10px' }}>Catégorie</th>
              <th style={{ padding: '8px 10px' }}>Action</th>
              <th style={{ padding: '8px 10px' }}>Statut</th>
              <th style={{ padding: '8px 10px' }}>Durée</th>
              <th style={{ padding: '8px 10px' }}>Message</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} style={{ borderBottom: `1px solid ${C.border}`, color: C.textSec }}>
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{new Date(l.created_at).toLocaleString('fr-FR')}</td>
                <td style={{ padding: '8px 10px' }}>{l.provider}</td>
                <td style={{ padding: '8px 10px' }}>{l.category}</td>
                <td style={{ padding: '8px 10px' }}>{l.action}</td>
                <td style={{ padding: '8px 10px', color: levelColor(l.level) }}>{l.status_code ?? l.level}</td>
                <td style={{ padding: '8px 10px' }}>{l.duration_ms != null ? `${l.duration_ms} ms` : '—'}</td>
                <td style={{ padding: '8px 10px', color: C.text }}>{l.message ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/admin/api/logs/page.tsx
git commit -m "feat: DSP API logs page (filter errors only)"
```

---

## Task 19: Entrée sidebar « API »

**Files:**
- Modify: `components/AppSidebar.tsx`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: nouvelle section « API » dans la nav avec entrée « Connexions API » → `/admin/api`.

- [ ] **Step 1: Importer une icône**

Dans `components/AppSidebar.tsx`, ajouter `Plug` à l'import lucide existant (ligne ~6-21) :

```tsx
import {
  Activity,
  BarChart3,
  Database,
  FileUp,
  Layers,
  LayoutGrid,
  Lock,
  MapPin,
  Monitor,
  Plug,
  Radio,
  Share2,
  Target,
  Upload,
  Users,
} from 'lucide-react'
```

- [ ] **Step 2: Ajouter la section « API » dans `navItems`**

Dans `components/AppSidebar.tsx`, insérer un nouvel objet de section entre `Administration` et `Systeme` (après la fermeture `]}` de la section Administration, ligne ~64) :

```tsx
  {
    section: 'API',
    items: [
      { href: '/admin/api', label: 'Connexions API', icon: Plug, badge: 'Admin' },
    ],
  },
```

- [ ] **Step 3: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Vérifier que le build passe**

Run: `npm run build`
Expected: build réussit, route `/admin/api` et sous-routes listées.

- [ ] **Step 5: Commit**

```bash
git add components/AppSidebar.tsx
git commit -m "feat: sidebar API section (Connexions API)"
```

---

## Task 20: Vérification manuelle end-to-end + docs

**Files:**
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: doc à jour ; validation manuelle du flux réel.

- [ ] **Step 1: Lancer le dev et vérifier l'UI**

Run: `npm run dev`
Dans le navigateur (connecté en admin, cf. mémoire credentials GEOMATIK) :
1. La sidebar montre la section « API » → « Connexions API ».
2. `/admin/api` redirige vers `/admin/api/dv360`.
3. Les 5 sous-onglets s'affichent (DV360 actif teal).
4. Meta/TikTok/TTD montrent « bientôt disponible ».
5. Logs montre « Aucun log pour le moment ».
Expected: tous les écrans s'affichent sans erreur console.

- [ ] **Step 2: Tester le flux Service Account réel**

Avec une vraie clé SA ayant accès à un partner DV360 :
1. Onglet DV360 → méthode Service Account → saisir Partner ID + coller la clé JSON → « Enregistrer » → toast succès.
2. « Tester la connexion » → toast « Connexion OK — N advertisers ».
3. Onglet Logs → une ligne `list_advertisers` statut 200 apparaît.
Expected: appel réel réussi, advertisers comptés, log présent.
> Si pas de clé SA réelle disponible : vérifier au minimum qu'une clé invalide retourne une erreur propre (toast + log niveau error), prouvant que la chaîne déchiffrement→appel→log fonctionne.

- [ ] **Step 3: Mettre à jour ARCHITECTURE.md**

Dans `ARCHITECTURE.md`, ajouter :
- Section « Routes API » : un bloc DSP API listant `/api/admin/dsp/connections`, `/api/admin/dsp/dv360/connect`, `/api/admin/dsp/dv360/test`, `/api/admin/dsp/dv360/oauth/start`, `/api/admin/dsp/dv360/oauth/callback`, `/api/admin/dsp/logs`.
- Section « Tables Supabase » : `dsp_connections` et `dsp_api_logs` (RLS par org, secrets chiffrés AES-256-GCM).
- Section « Variables d'environnement » : `DSP_ENC_KEY` (obligatoire), `DV360_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` (OAuth).

- [ ] **Step 4: Lancer toute la suite de tests**

Run: `npx vitest run`
Expected: PASS (incluant `crypto/secrets` et `dsp/dv360-auth`).

- [ ] **Step 5: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: document DSP API routes, tables, env vars"
```

---

## Notes d'implémentation transverses

- **OAuth callback non authentifié** : le callback Google n'a pas le Bearer token MAGELIAN ; il s'appuie sur le `state` (orgId). C'est acceptable en itération 1 (orgId non secret, écriture = simple attachement de tokens). Durcissement HMAC du state = itération 2.
- **`requireAdmin` = super_admin** : les routes utilisent `profile.organization_id`. Si le super_admin n'a pas d'org, les routes renvoient 400 explicite. Le test E2E doit se faire avec un compte ayant une org.
- **Aucune nouvelle charge I/O Nano** : toutes les requêtes DSP sont mono-ligne indexées par `organization_id` ; aucun appel parallèle Supabase.
- **Itération 2 (hors scope)** : pull reporting (Bid Manager API → `dsp_campaign_data`), push custom bidding (`customBiddingAlgorithms`), state OAuth signé, providers Meta/TikTok/TTD.
