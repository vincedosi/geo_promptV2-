/**
 * L'aperçu d'un espace rend EXACTEMENT ce que voit un vrai compte de cet espace.
 *
 * Deux règles écrites deux fois : en TypeScript (`getOrgSourceIds`, que
 * l'aperçu appelle) et en SQL (`source_visible` / `ds_select`, sql/234, que
 * PostgREST applique à un compte connecté avec la clé publique). Ce test les
 * confronte : si elles divergeaient, l'aperçu montrerait un droit qui n'existe
 * pas (ou en cacherait un). Même mécanique de comptes que
 * cloisonnement-rls.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { creerClientTest } from './_client';
import { apercuEspace } from '@/lib/espaces/apercu-espace';

const admin = creerClientTest();
const MOT_DE_PASSE = 'Apercu-espaces-2026!';
let compte: { id: string; orgId: string; client: SupabaseClient };

beforeAll(async () => {
  const { data: org } = await admin.from('organizations').select('id').eq('slug', 'marine').single();
  const orgId = org!.id as string;
  const email = 'test-apercu-marine@exemple.test';
  const { data: existants } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const ancien = existants?.users.find((u) => u.email === email);
  if (ancien) await admin.auth.admin.deleteUser(ancien.id);
  const { data: cree, error } = await admin.auth.admin.createUser({ email, password: MOT_DE_PASSE, email_confirm: true });
  if (error || !cree.user) throw new Error(error?.message);
  // sql/236 : l'appartenance AVANT l'espace actif.
  await admin.from('organization_members').insert({ user_id: cree.user.id, organization_id: orgId });
  const { error: e2 } = await admin.from('profiles').upsert({ id: cree.user.id, email, role: 'client', organization_id: orgId });
  if (e2) throw new Error(e2.message);
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { error: e3 } = await client.auth.signInWithPassword({ email, password: MOT_DE_PASSE });
  if (e3) throw new Error(e3.message);
  compte = { id: cree.user.id, orgId, client };
}, 60_000);

afterAll(async () => {
  if (compte?.id) {
    const { error } = await admin.auth.admin.deleteUser(compte.id);
    if (error) console.error(`nettoyage : ${error.message}`);
  }
});

describe('aperçu de la MARINE = ce que voit un vrai compte MARINE', () => {
  it('mêmes jeux de données que la RLS (règle SQL)', async () => {
    const apercu = await apercuEspace(admin as never, compte.orgId);
    const ecran = [...apercu.jeux.socle, ...apercu.jeux.proprietaire, ...apercu.jeux.partage].map((j) => j.id).sort();
    const { data, error } = await compte.client.from('data_sources').select('id');
    expect(error).toBeNull();
    expect(ecran).toEqual((data ?? []).map((d) => d.id as string).sort());
  });

  it('chaque catégorie annoncée est lisible par le compte, et « bmw » n\'est pas annoncée', async () => {
    const apercu = await apercuEspace(admin as never, compte.orgId);
    expect(apercu.categories.map((c) => c.toLowerCase())).not.toContain('bmw');
    for (const cat of apercu.categories) {
      const { data, error } = await compte.client.from('poi_france').select('id').eq('categorie', cat).limit(1);
      expect(error, cat).toBeNull();
      expect(data?.length, cat).toBe(1);
    }
  });
});
