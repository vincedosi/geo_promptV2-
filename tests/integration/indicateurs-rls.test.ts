/**
 * Un indicateur privé ne se lit plus par PostgREST DIRECT (sql/290, relecture T1-T3 n° 2).
 *
 * La clé publique est dans le bundle : un compte connecté peut appeler `/rest/v1/<table>` avec son propre jeton, et
 * pour lui la RLS est la seule barrière (même raisonnement que cloisonnement-rls.test.ts). On crée deux VRAIS comptes
 * (BMW, Bercy), on passe l'abstention à Bercy le temps du bloc — état d'origine exigé au socle, restauré dans
 * `afterAll` —, et on lit comme un navigateur. Comptes supprimés à la fin.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const CLE_PUBLIQUE = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const MOT_DE_PASSE = 'Indicateurs-rls-2026!';
const CODE = 'abstention_pres_2022';

interface Compte { id: string; client: SupabaseClient }
const comptes: Partial<Record<'bmw' | 'bercy', Compte>> = {};
let idAbstention = '';
let origine: { visibilite: string; organization_id: string | null } | null = null;

async function creerCompte(cle: 'bmw' | 'bercy', slug: string): Promise<void> {
  const { data: org, error: eo } = await admin.from('organizations').select('id').eq('slug', slug).single();
  if (eo || !org) throw new Error(`organisation ${slug} : ${eo?.message}`);
  const email = `test-indicateurs-rls-${cle}@magelian.test`;
  // Un passage précédent interrompu a pu laisser le compte : on repart de zéro.
  const { data: existants } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const ancien = existants?.users.find((u) => u.email === email);
  if (ancien) await admin.auth.admin.deleteUser(ancien.id);

  const { data: cree, error } = await admin.auth.admin.createUser({ email, password: MOT_DE_PASSE, email_confirm: true });
  if (error || !cree.user) throw new Error(`création ${email} : ${error?.message}`);
  const { error: em } = await admin.from('organization_members').insert({ user_id: cree.user.id, organization_id: org.id });
  if (em) throw new Error(`appartenance ${email} : ${em.message}`);
  const { error: ep } = await admin.from('profiles').upsert({ id: cree.user.id, email, role: 'client', organization_id: org.id });
  if (ep) throw new Error(`profil ${email} : ${ep.message}`);

  const client = createClient(URL_SB, CLE_PUBLIQUE, { auth: { persistSession: false } });
  const { error: ec } = await client.auth.signInWithPassword({ email, password: MOT_DE_PASSE });
  if (ec) throw new Error(`connexion ${email} : ${ec.message}`);
  comptes[cle] = { id: cree.user.id, client };
}

beforeAll(async () => {
  const { data: src, error } = await admin.from('data_sources')
    .select('id, visibilite, organization_id').eq('type', 'indicateur').eq('category', CODE).single();
  if (error || !src) throw new Error(`source de l abstention (sql/288) : ${error?.message}`);
  if (src.visibilite !== 'socle') throw new Error('l abstention n est pas au socle : remettez-la au socle avant ce test');
  idAbstention = src.id as string;
  origine = { visibilite: src.visibilite as string, organization_id: src.organization_id as string | null };

  await creerCompte('bmw', 'bmw-group');
  await creerCompte('bercy', 'bercy');
  const { data: bercy } = await admin.from('organizations').select('id').eq('slug', 'bercy').single();
  const { error: eu } = await admin.from('data_sources')
    .update({ visibilite: 'privee', organization_id: bercy?.id }).eq('id', idAbstention);
  if (eu) throw new Error(`passage à Bercy : ${eu.message}`);
}, 60_000);

afterAll(async () => {
  if (origine) {
    const { error } = await admin.from('data_sources').update(origine).eq('id', idAbstention);
    if (error) throw new Error(`remise au socle : ${error.message}`);
  }
  for (const c of Object.values(comptes)) {
    if (!c?.id) continue;
    const { error } = await admin.from('profiles').delete().eq('id', c.id);
    if (error) throw new Error(`suppression profil : ${error.message}`);
    await admin.auth.admin.deleteUser(c.id);
  }
});

async function lectures(c: SupabaseClient) {
  const [reg, icv, brut] = [
    await c.from('cible_indicator_registry').select('indicator_code').eq('indicator_code', CODE),
    await c.from('indicator_cp_values').select('postal_code').eq('indicator_code', CODE).limit(5),
    await c.from('dataset_abstention_2022').select('code_postal').limit(5),
  ];
  for (const r of [reg, icv, brut]) expect(r.error).toBeNull();
  return { registre: reg.data?.length ?? 0, valeurs: icv.data?.length ?? 0, table: brut.data?.length ?? 0 };
}

describe('abstention privée à Bercy — PostgREST direct, jeton du compte', () => {
  it('un compte BMW ne lit ni la ligne du registre, ni les valeurs par CP, ni la table brute', async () => {
    expect(await lectures(comptes.bmw!.client)).toEqual({ registre: 0, valeurs: 0, table: 0 });
  });

  it('il lit toujours les indicateurs du socle (référentiels sans source)', async () => {
    const { data, error } = await comptes.bmw!.client.from('cible_indicator_registry').select('indicator_code').eq('indicator_code', 'taux_pauvrete');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('un compte Bercy lit les trois (contrôle positif)', async () => {
    expect(await lectures(comptes.bercy!.client)).toEqual({ registre: 1, valeurs: 5, table: 5 });
  });

  it('une seule ligne du registre lit la table brute (prémisse de la policy de sql/290, revue finale n° 7)', async () => {
    // La policy de `dataset_abstention_2022` s'ouvre dès qu'UNE ligne `data_source = 'abstention'` est visible : une
    // seconde ligne sans source ouvrirait la table à tous. Si ce test échoue, revoir la policy avant de l'adapter.
    const { data, error } = await admin.from('cible_indicator_registry').select('indicator_code, data_source_id').eq('data_source', 'abstention');
    expect(error).toBeNull();
    expect(data).toEqual([{ indicator_code: CODE, data_source_id: idAbstention }]);
  });
});
