/**
 * Cloisonnement entre organisations — attaqué par la VRAIE porte d'entrée.
 *
 * ── POURQUOI CE FICHIER PARLE À POSTGREST AVEC LA CLÉ PUBLIQUE ─────────────
 *
 * L'application passe par `createAdminClient()` (clé `service_role`), qui
 * contourne la RLS. On en a longtemps conclu que les politiques étaient
 * « dormantes », donc sans importance. C'est faux dans un sens précis : la clé
 * PUBLIQUE est dans le bundle du navigateur, et n'importe quel client connecté
 * peut appeler `/rest/v1/<table>` lui-même, avec son propre jeton. Pour cet
 * appelant-là, la RLS est la SEULE barrière.
 *
 * Mesuré le 2026-10-08 sur la base locale, avant correctif : un compte client
 * DRHAT faisait `update profiles set role='super_admin', organization_id=<BMW>`
 * sur sa propre ligne, et lisait ensuite les 177 concessions BMW. La politique
 * `profiles_update` autorisait `id = auth.uid()` sans restreindre les colonnes.
 *
 * Ces tests créent donc de VRAIS comptes, se connectent comme un navigateur,
 * et tentent chaque attaque. Les comptes sont supprimés à la fin.
 *
 * ⚠ Ils lisent la base locale. Aucune valeur absolue n'est figée : on vérifie
 * des RELATIONS (« zéro ligne d'une autre organisation »), pas des effectifs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const CLE_PUBLIQUE = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const MOT_DE_PASSE = 'Cloisonnement-test-2026!';

interface Compte { id: string; orgId: string; client: SupabaseClient }

const comptes: Record<'marine' | 'bmw' | 'drhat', Compte> = {} as never;
const anonyme = createClient(URL_SB, CLE_PUBLIQUE, { auth: { persistSession: false } });

async function orgParSlug(slug: string): Promise<string> {
  const { data, error } = await admin.from('organizations').select('id').eq('slug', slug).single();
  if (error || !data) throw new Error(`organisation ${slug} introuvable : ${error?.message}`);
  return data.id as string;
}

async function creerCompte(cle: keyof typeof comptes, slug: string): Promise<void> {
  const orgId = await orgParSlug(slug);
  const email = `test-cloisonnement-${cle}@magelian.test`;

  // Un passage précédent interrompu a pu laisser le compte : on repart de zéro.
  const { data: existants } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const ancien = existants?.users.find((u) => u.email === email);
  if (ancien) await admin.auth.admin.deleteUser(ancien.id);

  const { data: cree, error } = await admin.auth.admin.createUser({
    email, password: MOT_DE_PASSE, email_confirm: true,
  });
  if (error || !cree.user) throw new Error(`création ${email} : ${error?.message}`);

  const { error: errProfil } = await admin.from('profiles').upsert({
    id: cree.user.id, email, role: 'client', organization_id: orgId,
  });
  if (errProfil) throw new Error(`profil ${email} : ${errProfil.message}`);

  const client = createClient(URL_SB, CLE_PUBLIQUE, { auth: { persistSession: false } });
  const { error: errConnexion } = await client.auth.signInWithPassword({ email, password: MOT_DE_PASSE });
  if (errConnexion) throw new Error(`connexion ${email} : ${errConnexion.message}`);

  comptes[cle] = { id: cree.user.id, orgId, client };
}

beforeAll(async () => {
  await creerCompte('marine', 'marine');
  await creerCompte('bmw', 'bmw-group');
  await creerCompte('drhat', 'drhat');
}, 60_000);

afterAll(async () => {
  for (const c of Object.values(comptes)) {
    if (!c?.id) continue;
    const { error } = await admin.from('profiles').delete().eq('id', c.id);
    if (error) throw new Error(`suppression profil : ${error.message}`);
    await admin.auth.admin.deleteUser(c.id);
  }
});

describe('profils — un client ne change ni son rôle ni son organisation', () => {
  it('refuse l auto-promotion en super_admin', async () => {
    const { drhat } = comptes;
    await drhat.client.from('profiles').update({ role: 'super_admin' }).eq('id', drhat.id);
    const { data } = await admin.from('profiles').select('role').eq('id', drhat.id).single();
    expect(data?.role).toBe('client');
  });

  it('refuse le changement d organisation', async () => {
    const { drhat, bmw } = comptes;
    await drhat.client.from('profiles').update({ organization_id: bmw.orgId }).eq('id', drhat.id);
    const { data } = await admin.from('profiles').select('organization_id').eq('id', drhat.id).single();
    expect(data?.organization_id).toBe(drhat.orgId);
  });

  it('laisse lire son propre profil (le navigateur en a besoin)', async () => {
    const { marine } = comptes;
    const { data, error } = await marine.client.from('profiles').select('role, organization_id').eq('id', marine.id).single();
    expect(error).toBeNull();
    expect(data?.organization_id).toBe(marine.orgId);
  });
});

describe('POI — chacun ses sources privées, tout le monde le socle', () => {
  it('la Marine voit les CIRFA et pas une concession BMW', async () => {
    const { marine } = comptes;
    const { data: bmw } = await marine.client.from('poi_france').select('id').eq('categorie', 'bmw').limit(5);
    const { data: cirfa } = await marine.client.from('poi_france').select('id').eq('categorie', 'cirfa').limit(5);
    expect(bmw).toEqual([]);
    expect(cirfa?.length ?? 0).toBeGreaterThan(0);
  });

  it('BMW voit ses concessions et pas un CIRFA', async () => {
    const { bmw } = comptes;
    const { data: cirfa } = await bmw.client.from('poi_france').select('id').eq('categorie', 'cirfa').limit(5);
    const { data: concessions } = await bmw.client.from('poi_france').select('id').eq('categorie', 'bmw').limit(5);
    expect(cirfa).toEqual([]);
    expect(concessions?.length ?? 0).toBeGreaterThan(0);
  });

  it('une organisation sans donnée privée voit le socle et rien d autre', async () => {
    const { drhat } = comptes;
    const { data: lycees } = await drhat.client.from('poi_france').select('id').eq('categorie', 'lycee').limit(5);
    const { data: prives } = await drhat.client.from('poi_france').select('id').in('categorie', ['bmw', 'cirfa']).limit(5);
    expect(lycees?.length ?? 0).toBeGreaterThan(0);
    expect(prives).toEqual([]);
  });

  it('les sources : la Marine ne voit pas celle de BMW', async () => {
    const { marine, bmw } = comptes;
    const { data } = await marine.client.from('data_sources').select('id, organization_id');
    expect((data ?? []).some((s) => s.organization_id === bmw.orgId)).toBe(false);
  });
});

describe('tables qui ne doivent RIEN rendre à un client par PostgREST', () => {
  // Chacune est lue côté serveur par la clé service_role, jamais par le
  // navigateur. Une politique `USING (true)` y ouvrait tout à tout le monde.
  const tables = [
    'isochrones_cache', 'geography_zones', 'bidding_strategies', 'bidding_zone_configs',
    'bidding_daily_state', 'bidding_drift_events', 'bidding_simulations',
    'bidding_strategy_subzones', 'strategy_changes', 'adaptive_model_state',
  ];
  for (const table of tables) {
    it(`${table} : zéro ligne`, async () => {
      const { data } = await comptes.marine.client.from(table).select('*').limit(1);
      expect(data ?? []).toEqual([]);
    });
  }

  it('organizations : un client ne voit que la sienne', async () => {
    const { marine } = comptes;
    const { data } = await marine.client.from('organizations').select('id');
    expect((data ?? []).map((o) => o.id)).toEqual([marine.orgId]);
  });
});

describe('fonctions SECURITY DEFINER — fermées aux clients', () => {
  // Elles contournent la RLS ET reconstruisent des tables entières : un
  // appel anonyme suffisait à lancer un calcul lourd sur la base.
  for (const [nom, args] of [
    ['construire_iris_bornes', {}],
    ['construire_iris_agg', { p_niveau: 'commune' }],
    ['construire_zones_risque', { p_profil: {}, p_code: 'x', p_natures: null, p_lissage_pct: 0 }],
    ['compute_filosofi_profiles_batch_2km', { p_entries: [], p_secret_stat: 0 }],
  ] as const) {
    it(`${nom} : refusée sans connexion`, async () => {
      const { error } = await anonyme.rpc(nom, args);
      expect(error?.code).toBe('42501');
    });
    it(`${nom} : refusée à un client connecté`, async () => {
      const { error } = await comptes.marine.client.rpc(nom, args);
      expect(error?.code).toBe('42501');
    });
  }
});
