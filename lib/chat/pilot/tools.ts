/**
 * Handlers des outils de pilotage — importent le moteur A directement (server-side).
 * Chaque handler retourne un objet structuré (PilotResult/PilotPacing) ou { error }.
 */
import { createAdminClient } from '@/lib/auth';
import { seedDemo, applyRebid, readDemoPacing, purgeDemo, assertDemo } from '@/lib/demo/controller';
import { DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';

function wrap<T>(p: Promise<T>): Promise<T | { error: string }> {
  return p.catch((e) => ({ error: e instanceof Error ? e.message : 'pilot_tool_failed' }));
}

export async function demarrerPilotage(userId: string) {
  const supabase = createAdminClient();
  return wrap(seedDemo(supabase, userId));
}

export async function mesurer(userId: string, version?: number) {
  const supabase = createAdminClient();
  return wrap((async () => {
    const p = await readDemoPacing(supabase, version ?? null);
    if (!p) return { error: 'aucun_plan_figé' };
    return p;
  })());
}

export async function corrigerEnchere(userId: string) {
  const supabase = createAdminClient();
  return wrap(applyRebid(supabase, userId));
}

export async function reinitialiser(userId: string) {
  const supabase = createAdminClient();
  return wrap((async () => {
    await assertDemo(supabase, DEMO_CAMPAIGN_ID);
    await purgeDemo(supabase);
    return { ok: true };
  })());
}
