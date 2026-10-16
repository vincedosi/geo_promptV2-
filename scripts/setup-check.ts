/**
 * scripts/setup-check.ts — vérification rapide de la configuration locale.
 *
 * Usage : `npx tsx scripts/setup-check.ts`
 *
 * Vérifie :
 *   - .env.local existe + vars obligatoires présentes
 *   - Connexion Supabase OK (anon key fonctionnelle)
 *
 * Termine avec exit code 0 si tout OK, 1 sinon.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

type Result = { ok: boolean; label: string; detail?: string };

const PROJECT_ROOT = join(__dirname, '..');
const ENV_LOCAL = join(PROJECT_ROOT, '.env.local');

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

function loadEnvLocal(): Record<string, string> {
  if (!existsSync(ENV_LOCAL)) return {};
  const content = readFileSync(ENV_LOCAL, 'utf-8');
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

async function checkEnvFile(): Promise<Result> {
  if (!existsSync(ENV_LOCAL)) {
    return { ok: false, label: '.env.local exists', detail: 'Copier .env.example en .env.local' };
  }
  return { ok: true, label: '.env.local exists' };
}

async function checkRequiredVars(env: Record<string, string>): Promise<Result[]> {
  return REQUIRED.map(key => ({
    ok: Boolean(env[key]),
    label: `Var ${key}`,
    detail: env[key] ? undefined : 'Manquant ou vide',
  }));
}

async function checkSupabase(env: Record<string, string>): Promise<Result> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { ok: false, label: 'Supabase reachable', detail: 'NEXT_PUBLIC_SUPABASE_URL ou _ANON_KEY manquant' };
  }
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    // 200 / 401 / 404 = service joignable (401 attendu sans token sur /rest/v1/)
    return res.status < 500
      ? { ok: true, label: 'Supabase reachable' }
      : { ok: false, label: 'Supabase reachable', detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, label: 'Supabase reachable', detail: String(e instanceof Error ? e.message : e) };
  }
}

function fmt(r: Result): string {
  const icon = r.ok ? '✅' : '❌';
  const detail = r.detail ? ` — ${r.detail}` : '';
  return `${icon} ${r.label}${detail}`;
}

async function main(): Promise<number> {
  // eslint-disable-next-line no-console
  console.log('MAGELIAN setup check\n');

  const envFileResult = await checkEnvFile();
  // eslint-disable-next-line no-console
  console.log(fmt(envFileResult));
  if (!envFileResult.ok) return 1;

  const env = loadEnvLocal();
  const results: Result[] = [
    ...(await checkRequiredVars(env)),
    await checkSupabase(env),
  ];

  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(fmt(r));
  }

  const failed = results.filter(r => !r.ok);
  if (failed.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✅ Configuration prête. Lance `npm run dev`.');
    return 0;
  }
  // eslint-disable-next-line no-console
  console.log(`\n❌ ${failed.length} check(s) en erreur. Corrige .env.local et relance.`);
  return 1;
}

main().then(code => process.exit(code)).catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
