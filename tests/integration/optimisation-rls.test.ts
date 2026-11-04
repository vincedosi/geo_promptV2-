/**
 * `optimisation_reglages` (sql/345) — RLS ACTIVE AVEC POLICY ÉCRITE, attaquée par la vraie porte d'entrée.
 *
 * Sur le modèle de `cloisonnement-rls.test.ts` : de VRAIS comptes, la clé PUBLIQUE, PostgREST — l'appelant pour qui la
 * RLS est la seule barrière (plan 2026-11-04-optimisation-python-architecture.md § 9.3). Le service Python, lui, est
 * BYPASSRLS : son cloisonnement est applicatif et testé côté pytest (`tests/lecture/test_reglages.py`).
 *
 * Ce qui est vérifié :
 *  - l'espace propriétaire lit la ligne ; un autre espace lit 0 ligne ; un espace avec qui la campagne est PARTAGÉE
 *    (`campaign_organizations`) la lit ; super_admin la lit ; l'anonyme ne lit rien ;
 *  - insert / update / delete refusés à tous les comptes connectés, propriétaire compris (aucune policy d'écriture,
 *    REVOKE explicite) : la ligne relue par l'administrateur est inchangée.
 *
 * Les comptes, la campagne d'essai et sa ligne de réglages sont supprimés à la fin.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const CLE_PUBLIQUE = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const MOT_DE_PASSE = 'Optimisation-rls-2026!';

type Cle = 'proprietaire' | 'etranger' | 'partage' | 'superAdmin';
interface Compte { id: string; orgId: string; client: SupabaseClient }

const comptes = {} as Record<Cle, Compte>;
const anonyme = createClient(URL_SB, CLE_PUBLIQUE, { auth: { persistSession: false } });
let campagne = '';

const PARAMETRES = { seuils: { cp_sous_plan_pct: 60 } };

async function orgParSlug(slug: string): Promise<string> {
  const { data, error } = await admin.from('organizations').select('id').eq('slug', slug).single();
  if (error || !data) throw new Error(`organisation ${slug} introuvable : ${error?.message}`);
  return data.id as string;
}

async function creerCompte(cle: Cle, slug: string, role: 'client' | 'super_admin' = 'client'): Promise<void> {
  const orgId = await orgParSlug(slug);
  const email = `test-optimisation-rls-${cle.toLowerCase()}@magelian.test`;
  const { data: existants } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const ancien = existants?.users.find((u) => u.email === email);
  if (ancien) {
    const { error } = await admin.from('profiles').delete().eq('id', ancien.id);
    if (error) throw new Error(`ancien profil ${email} : ${error.message}`);
    await admin.auth.admin.deleteUser(ancien.id);
  }
  const { data: cree, error } = await admin.auth.admin.createUser({ email, password: MOT_DE_PASSE, email_confirm: true });
  if (error || !cree.user) throw new Error(`création ${email} : ${error?.message}`);
  const { error: errMembre } = await admin.from('organization_members').insert({ user_id: cree.user.id, organization_id: orgId });
  if (errMembre) throw new Error(`appartenance ${email} : ${errMembre.message}`);
  const { error: errProfil } = await admin.from('profiles').upsert({ id: cree.user.id, email, role, organization_id: orgId });
  if (errProfil) throw new Error(`profil ${email} : ${errProfil.message}`);
  const client = createClient(URL_SB, CLE_PUBLIQUE, { auth: { persistSession: false } });
  const { error: errConnexion } = await client.auth.signInWithPassword({ email, password: MOT_DE_PASSE });
  if (errConnexion) throw new Error(`connexion ${email} : ${errConnexion.message}`);
  comptes[cle] = { id: cree.user.id, orgId, client };
}

async function lireParAdmin() {
  const { data, error } = await admin.from('optimisation_reglages').select('campagne_id, algo_id, parametres')
    .eq('campagne_id', campagne);
  if (error) throw new Error(`relecture admin : ${error.message}`);
  return data;
}

beforeAll(async () => {
  await creerCompte('proprietaire', 'marine');
  await creerCompte('etranger', 'bmw-group');
  await creerCompte('partage', 'drhat');
  await creerCompte('superAdmin', 'genesis-global', 'super_admin');

  const { data, error } = await admin.from('dsp_campaigns')
    .insert({ name: `[ESSAI] optimisation RLS ${Date.now()}`, organization_id: comptes.proprietaire.orgId })
    .select('id').single();
  if (error || !data) throw new Error(`campagne d essai : ${error?.message}`);
  campagne = data.id as string;

  const { error: errPartage } = await admin.from('campaign_organizations').insert([
    { campaign_id: campagne, organization_id: comptes.proprietaire.orgId },
    { campaign_id: campagne, organization_id: comptes.partage.orgId },
  ]);
  if (errPartage) throw new Error(`partage : ${errPartage.message}`);

  const { error: errReglage } = await admin.from('optimisation_reglages')
    .insert({ campagne_id: campagne, workspace_id: comptes.proprietaire.orgId, parametres: PARAMETRES });
  if (errReglage) throw new Error(`réglage d essai : ${errReglage.message}`);
}, 60_000);

afterAll(async () => {
  const erreurs: string[] = [];
  if (campagne) {
    // La cascade depuis dsp_campaigns emporte réglage et partages.
    const { error } = await admin.from('dsp_campaigns').delete().eq('id', campagne);
    if (error) erreurs.push(`campagne : ${error.message}`);
  }
  for (const c of Object.values(comptes)) {
    if (!c?.id) continue;
    const { error } = await admin.from('profiles').delete().eq('id', c.id);
    if (error) erreurs.push(`profil : ${error.message}`);
    await admin.auth.admin.deleteUser(c.id);
  }
  if (erreurs.length > 0) throw new Error(`nettoyage incomplet — ${erreurs.join(' ; ')}`);
});

describe('optimisation_reglages — lecture cloisonnée par espace', () => {
  it('l espace propriétaire lit sa ligne', async () => {
    const { data, error } = await comptes.proprietaire.client.from('optimisation_reglages')
      .select('campagne_id, workspace_id, algo_id, parametres').eq('campagne_id', campagne);
    expect(error).toBeNull();
    expect(data).toEqual([{
      campagne_id: campagne, workspace_id: comptes.proprietaire.orgId, algo_id: 'uniformiser_global', parametres: PARAMETRES,
    }]);
  });

  it('un autre espace lit zéro ligne', async () => {
    const { data, error } = await comptes.etranger.client.from('optimisation_reglages').select('campagne_id')
      .eq('campagne_id', campagne);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('un espace avec qui la campagne est partagée la lit', async () => {
    const { data, error } = await comptes.partage.client.from('optimisation_reglages').select('campagne_id')
      .eq('campagne_id', campagne);
    expect(error).toBeNull();
    expect(data).toEqual([{ campagne_id: campagne }]);
  });

  it('super_admin la lit', async () => {
    const { data, error } = await comptes.superAdmin.client.from('optimisation_reglages').select('campagne_id')
      .eq('campagne_id', campagne);
    expect(error).toBeNull();
    expect(data).toEqual([{ campagne_id: campagne }]);
  });

  it('l anonyme ne lit rien', async () => {
    const { data, error } = await anonyme.from('optimisation_reglages').select('campagne_id').eq('campagne_id', campagne);
    expect(error?.code === '42501' || (data ?? []).length === 0).toBe(true);
  });
});

describe('optimisation_reglages — aucune écriture par la clé publique', () => {
  it('insert refusé à tous, propriétaire et super_admin compris', async () => {
    for (const c of Object.values(comptes)) {
      const { error } = await c.client.from('optimisation_reglages')
        .insert({ campagne_id: campagne, workspace_id: c.orgId, parametres: {} });
      expect(error?.code).toBe('42501');
    }
  });

  it('update refusé : la ligne est inchangée', async () => {
    for (const c of Object.values(comptes)) {
      const { error } = await c.client.from('optimisation_reglages')
        .update({ algo_id: 'pirate', parametres: { seuils: { fuite_pct: 99 } } }).eq('campagne_id', campagne);
      expect(error?.code).toBe('42501');
    }
    expect(await lireParAdmin()).toEqual([{ campagne_id: campagne, algo_id: 'uniformiser_global', parametres: PARAMETRES }]);
  });

  it('delete refusé : la ligne est toujours là', async () => {
    for (const c of Object.values(comptes)) {
      const { error } = await c.client.from('optimisation_reglages').delete().eq('campagne_id', campagne);
      expect(error?.code).toBe('42501');
    }
    expect(await lireParAdmin()).toHaveLength(1);
  });
});
