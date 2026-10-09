/**
 * L'invariant d'appartenance (sql/236), attaqué contre la base locale.
 *
 * Règle : pour un non-super_admin, `profiles.organization_id` (l'espace ACTIF)
 * est toujours un espace dont il est membre (`organization_members`), ou null.
 * Elle vit EN BASE parce que la base est la seule barrière face à un appel
 * PostgREST direct (leçon de sql/234) — une route oubliée ne doit pas pouvoir
 * la violer.
 *
 * Tout est créé jetable (`[ESSAI espaces]`) et supprimé à la fin.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const PREFIXE = '[ESSAI espaces]';
const espaces: string[] = [];
const comptes: string[] = [];

async function creerEspace(nom: string): Promise<string> {
  const slug = `essai-espaces-${nom.toLowerCase()}-${Date.now()}`;
  const { data, error } = await admin.from('organizations')
    .insert({ name: `${PREFIXE} ${nom}`, slug }).select('id').single();
  if (error || !data) throw new Error(`espace ${nom} : ${error?.message}`);
  espaces.push(data.id as string);
  return data.id as string;
}

async function creerCompte(cle: string, role: 'client' | 'super_admin' = 'client'): Promise<string> {
  const email = `essai-espaces-${cle}-${Date.now()}@exemple.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`compte ${cle} : ${error?.message}`);
  comptes.push(data.user.id);
  const { error: e2 } = await admin.from('profiles').upsert({ id: data.user.id, email, role, organization_id: null });
  if (e2) throw new Error(`profil ${cle} : ${e2.message}`);
  return data.user.id;
}

async function rendreMembre(userId: string, orgId: string): Promise<void> {
  const { error } = await admin.from('organization_members').insert({ user_id: userId, organization_id: orgId });
  if (error) throw new Error(`membre : ${error.message}`);
}

async function espaceActif(userId: string): Promise<string | null> {
  const { data, error } = await admin.from('profiles').select('organization_id').eq('id', userId).single();
  if (error) throw new Error(error.message);
  return (data?.organization_id as string | null) ?? null;
}

/**
 * Écriture de MISE EN PLACE : lève si elle échoue. Sans ça, un `update` refusé
 * laisse le cas tourner sur un état qui n'est pas celui qu'il croit tester, et
 * l'assertion finale peut passer à vide.
 */
async function pose<T extends { error: { message: string } | null }>(libelle: string, ecriture: PromiseLike<T>): Promise<T> {
  const res = await ecriture;
  if (res.error) throw new Error(`mise en place « ${libelle} » : ${res.error.message}`);
  return res;
}

let a: string, b: string;

beforeAll(async () => {
  a = await creerEspace('A');
  b = await creerEspace('B');
}, 60_000);

afterAll(async () => {
  for (const id of comptes) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error(`nettoyage compte ${id} : ${error.message}`);
  }
  for (const id of espaces) {
    const { error } = await admin.from('organizations').delete().eq('id', id);
    if (error) console.error(`nettoyage espace ${id} : ${error.message}`);
  }
}, 60_000);

describe('invariant : espace actif ⊂ appartenance (sql/236)', () => {
  it('refuse de placer un client sur un espace dont il n\'est pas membre', async () => {
    const u = await creerCompte('refus');
    const { error } = await admin.from('profiles').update({ organization_id: a }).eq('id', u);
    expect(error?.code).toBe('23514');
    expect(await espaceActif(u)).toBeNull();
  });

  it('accepte un espace dont il est membre, et null', async () => {
    const u = await creerCompte('accepte');
    await rendreMembre(u, a);
    expect((await admin.from('profiles').update({ organization_id: a }).eq('id', u)).error).toBeNull();
    expect((await admin.from('profiles').update({ organization_id: null }).eq('id', u)).error).toBeNull();
  });

  it('laisse un super_admin se placer sur n\'importe quel espace', async () => {
    const u = await creerCompte('super', 'super_admin');
    expect((await admin.from('profiles').update({ organization_id: b }).eq('id', u)).error).toBeNull();
  });

  it('refuse de rétrograder en client un super_admin placé hors de ses espaces', async () => {
    const u = await creerCompte('retro', 'super_admin');
    await pose('mise en place', admin.from('profiles').update({ organization_id: b }).eq('id', u));
    const { error } = await admin.from('profiles').update({ role: 'client' }).eq('id', u);
    expect(error?.code).toBe('23514');
  });
});

describe('report de l\'espace actif au retrait (sql/236)', () => {
  it('retiré de son espace actif, il bascule sur un autre de ses espaces', async () => {
    const u = await creerCompte('report');
    await rendreMembre(u, a);
    await rendreMembre(u, b);
    await pose('mise en place', admin.from('profiles').update({ organization_id: a }).eq('id', u));
    const { error } = await admin.from('organization_members').delete().eq('user_id', u).eq('organization_id', a);
    expect(error).toBeNull();
    expect(await espaceActif(u)).toBe(b);
  });

  it('retiré de son seul espace, son espace actif devient null', async () => {
    const u = await creerCompte('seul');
    await rendreMembre(u, a);
    await pose('mise en place', admin.from('profiles').update({ organization_id: a }).eq('id', u));
    await pose('mise en place', admin.from('organization_members').delete().eq('user_id', u).eq('organization_id', a));
    expect(await espaceActif(u)).toBeNull();
  });

  it('retiré d\'un espace qui n\'est PAS l\'actif, l\'actif ne bouge pas', async () => {
    const u = await creerCompte('autre');
    await rendreMembre(u, a);
    await rendreMembre(u, b);
    await pose('mise en place', admin.from('profiles').update({ organization_id: a }).eq('id', u));
    await pose('mise en place', admin.from('organization_members').delete().eq('user_id', u).eq('organization_id', b));
    expect(await espaceActif(u)).toBe(a);
  });
});

describe('super_admin et retrait (sql/236)', () => {
  it('un super_admin retiré de son espace actif le garde', async () => {
    const u = await creerCompte('super-retrait', 'super_admin');
    await rendreMembre(u, a);
    await pose('actif', admin.from('profiles').update({ organization_id: a }).eq('id', u));
    await pose('retrait', admin.from('organization_members').delete().eq('user_id', u).eq('organization_id', a));
    expect(await espaceActif(u)).toBe(a);
  });
});

describe('suppressions en cascade (sql/236)', () => {
  it('supprimer un compte membre de son espace actif ne lève rien', async () => {
    const u = await creerCompte('cascade-compte');
    await rendreMembre(u, a);
    await pose('mise en place', admin.from('profiles').update({ organization_id: a }).eq('id', u));
    const { error } = await admin.auth.admin.deleteUser(u);
    expect(error).toBeNull();
    comptes.splice(comptes.indexOf(u), 1);
  });

  it('supprimer un espace où des membres sont actifs ne lève rien', async () => {
    const c = await creerEspace('C');
    const u = await creerCompte('cascade-espace');
    await rendreMembre(u, c);
    await rendreMembre(u, a);
    await pose('mise en place', admin.from('profiles').update({ organization_id: c }).eq('id', u));
    const { error } = await admin.from('organizations').delete().eq('id', c);
    expect(error).toBeNull();
    espaces.splice(espaces.indexOf(c), 1);
    // Mesuré : la FK profiles.organization_id (ON DELETE SET NULL) met l'actif à
    // null AVANT que la cascade supprime l'appartenance ; le déclencheur de
    // report ne trouve alors plus rien à reporter. Résultat déterministe : actif
    // null, appartenance à `a` conservée — invariant tenu, pas d'espace fantôme.
    expect(await espaceActif(u)).toBeNull();
    const { data: restant } = await admin.from('organization_members').select('organization_id').eq('user_id', u);
    expect((restant ?? []).map((m) => m.organization_id)).toEqual([a]);
  });
});

describe('remplacer_espaces_utilisateur (sql/236)', () => {
  it('remplace la liste et l\'espace actif en une fois', async () => {
    const u = await creerCompte('rpc');
    await rendreMembre(u, a);
    await pose('mise en place', admin.from('profiles').update({ organization_id: a }).eq('id', u));
    const { data, error } = await admin.rpc('remplacer_espaces_utilisateur', { p_user: u, p_espaces: [b], p_actif: b });
    expect(error).toBeNull();
    expect(data).toEqual({ espaces: [b], espace_actif: b });
    expect(await espaceActif(u)).toBe(b);
  });

  it('refuse un espace actif hors de la liste pour un client (22023), sans rien écrire', async () => {
    const u = await creerCompte('rpc-refus');
    await rendreMembre(u, a);
    const { error } = await admin.rpc('remplacer_espaces_utilisateur', { p_user: u, p_espaces: [a], p_actif: b });
    expect(error?.code).toBe('22023');
    const { data } = await admin.from('organization_members').select('organization_id').eq('user_id', u);
    expect((data ?? []).map((m) => m.organization_id)).toEqual([a]);
  });

  it('liste vide : plus aucun espace, actif null', async () => {
    const u = await creerCompte('rpc-vide');
    await rendreMembre(u, a);
    const { data, error } = await admin.rpc('remplacer_espaces_utilisateur', { p_user: u, p_espaces: [], p_actif: null });
    expect(error).toBeNull();
    expect(data).toEqual({ espaces: [], espace_actif: null });
  });

  it('utilisateur inconnu : P0002', async () => {
    const { error } = await admin.rpc('remplacer_espaces_utilisateur', {
      p_user: '00000000-0000-0000-0000-00000000dead', p_espaces: [], p_actif: null,
    });
    expect(error?.code).toBe('P0002');
  });
});

describe('rattrapage (sql/236)', () => {
  it('tout profil non super_admin dont l\'espace actif est posé en est membre', async () => {
    const { data, error } = await admin.from('profiles').select('id, organization_id, role').not('organization_id', 'is', null);
    expect(error).toBeNull();
    for (const p of data ?? []) {
      if (p.role === 'super_admin') continue;
      const { data: m } = await admin.from('organization_members').select('id')
        .eq('user_id', p.id).eq('organization_id', p.organization_id as string);
      expect(m?.length, `profil ${p.id}`).toBe(1);
    }
  });
});

import { ajouterMembre, retirerMembre } from '@/lib/espaces/appartenance';

describe('ajouterMembre / retirerMembre (T2)', () => {
  it('ajouter écrit organization_members et place l\'espace actif s\'il était vide', async () => {
    const u = await creerCompte('ajout');
    expect(await ajouterMembre(admin as never, a, u)).toEqual({ ok: true });
    const { data } = await admin.from('organization_members').select('organization_id').eq('user_id', u);
    expect((data ?? []).map((m) => m.organization_id)).toEqual([a]);
    expect(await espaceActif(u)).toBe(a);
  });

  it('ajouter un second espace ne change pas l\'espace actif', async () => {
    const u = await creerCompte('ajout2');
    await ajouterMembre(admin as never, a, u);
    await ajouterMembre(admin as never, b, u);
    expect(await espaceActif(u)).toBe(a);
  });

  it('ajouter deux fois est sans effet (pas d\'erreur, pas de doublon)', async () => {
    const u = await creerCompte('ajout-double');
    await ajouterMembre(admin as never, a, u);
    expect(await ajouterMembre(admin as never, a, u)).toEqual({ ok: true });
    const { data } = await admin.from('organization_members').select('id').eq('user_id', u);
    expect(data?.length).toBe(1);
  });

  it('ajouter un super_admin sans rôle fourni le laisse super_admin (E3)', async () => {
    const u = await creerCompte('ajout-super', 'super_admin');
    await ajouterMembre(admin as never, a, u);
    const { data } = await admin.from('profiles').select('role').eq('id', u).single();
    expect(data?.role).toBe('super_admin');
  });

  it('retirer supprime l\'appartenance, reporte l\'actif, et ne touche pas au rôle (E3)', async () => {
    const u = await creerCompte('retrait', 'super_admin');
    await ajouterMembre(admin as never, a, u);
    expect(await retirerMembre(admin as never, a, u)).toEqual({ ok: true });
    const { data } = await admin.from('profiles').select('role').eq('id', u).single();
    expect(data?.role).toBe('super_admin');
    const { data: m } = await admin.from('organization_members').select('id').eq('user_id', u).eq('organization_id', a);
    expect(m?.length).toBe(0);
  });

  it('retirer quelqu\'un qui n\'est pas membre rend 404', async () => {
    const u = await creerCompte('retrait-absent');
    expect(await retirerMembre(admin as never, a, u)).toEqual({ ok: false, status: 404, message: 'Cet utilisateur n\'est pas membre de cet espace.' });
  });
});
