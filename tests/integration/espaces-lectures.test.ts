/**
 * Lectures de la page « Espaces de travail » contre la base locale.
 * On vérifie des RELATIONS, pas des effectifs figés.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { creerClientTest } from './_client';
import { listerEspaces, membresDeLEspace } from '@/lib/espaces/lister-espaces';
import { donneesDeLEspace, lireSocle } from '@/lib/espaces/donnees-espace';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';

const sb = creerClientTest() as never;
let orgJetable: string | null = null;
const comptesJetables: string[] = [];

afterAll(async () => {
  const admin = creerClientTest();
  for (const id of comptesJetables) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error(`nettoyage compte ${id} : ${error.message}`);
  }
  if (orgJetable) {
    const { error } = await admin.from('organizations').delete().eq('id', orgJetable);
    if (error) console.error(`nettoyage espace ${orgJetable} : ${error.message}`);
  }
}, 60_000);

describe('listerEspaces', () => {
  it('rend chaque organisation, l\'interne renommée et rangée en dernier', async () => {
    const { espaces, socle } = await listerEspaces(sb);
    const interne = espaces.find((e) => e.slug === 'genesis-global');
    expect(interne?.nom_affiche).toBe('dentsu.explore (interne)');
    expect(espaces.at(-1)?.interne).toBe(true);
    expect(socle.nb_jeux).toBeGreaterThan(0);
  });

  // Hermétique : un espace jetable et un nombre CONNU de membres. Compter les
  // espaces de la base serait flaky, d'autres fichiers en créent et en
  // suppriment en parallèle.
  it('compte les membres par organization_members', async () => {
    const admin = creerClientTest();
    const { data: org, error: e1 } = await admin.from('organizations')
      .insert({ name: '[ESSAI lectures] membres', slug: `essai-lectures-${Date.now()}` }).select('id').single();
    if (e1 || !org) throw new Error(`mise en place espace : ${e1?.message}`);
    orgJetable = org.id as string;
    for (const cle of ['m1', 'm2']) {
      const email = `essai-lectures-${cle}-${Date.now()}@exemple.test`;
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (error || !data.user) throw new Error(`mise en place compte ${cle} : ${error?.message}`);
      comptesJetables.push(data.user.id);
      const p = await admin.from('profiles').upsert({ id: data.user.id, email, role: 'client', organization_id: null });
      if (p.error) throw new Error(`mise en place profil ${cle} : ${p.error.message}`);
      const m = await admin.from('organization_members').insert({ user_id: data.user.id, organization_id: orgJetable });
      if (m.error) throw new Error(`mise en place membre ${cle} : ${m.error.message}`);
    }
    const { espaces } = await listerEspaces(sb);
    expect(espaces.find((e) => e.id === orgJetable)?.nb_membres).toBe(2);
  });
});

describe('donneesDeLEspace = getOrgSourceIds', () => {
  it('pour chaque espace, les jeux non « non_visible » sont exactement les sources de la règle des routes', async () => {
    const { espaces } = await listerEspaces(sb);
    for (const e of espaces) {
      const reponse = await donneesDeLEspace(sb, e.id);
      const visiblesEcran = reponse!.jeux.filter((j) => j.statut !== 'non_visible').map((j) => j.id).sort();
      const visiblesRegle = ((await getOrgSourceIds({ userId: 't', orgId: e.id, role: 'client' })) ?? []).sort();
      expect(visiblesEcran, e.slug).toEqual(visiblesRegle);
    }
  });

  it('la MARINE possède CIRFA et ne voit pas CONCESSIONS BMW', async () => {
    const { espaces } = await listerEspaces(sb);
    const marine = espaces.find((e) => e.slug === 'marine')!;
    const { jeux } = (await donneesDeLEspace(sb, marine.id))!;
    expect(jeux.find((j) => j.nom === 'CIRFA')?.statut).toBe('proprietaire');
    expect(jeux.find((j) => j.nom === 'CONCESSIONS BMW')?.statut).toBe('non_visible');
  });

  it('espace inconnu → null', async () => {
    expect(await donneesDeLEspace(sb, '00000000-0000-0000-0000-00000000dead')).toBeNull();
  });
});

describe('lireSocle', () => {
  it('range les jeux du socle en tête et compte les espaces clients (hors interne)', async () => {
    const { jeux, nb_espaces_clients } = await lireSocle(sb);
    const premierPrive = jeux.findIndex((j) => j.visibilite === 'privee');
    expect(jeux.slice(premierPrive === -1 ? jeux.length : premierPrive).every((j) => j.visibilite === 'privee')).toBe(true);
    const { espaces } = await listerEspaces(sb);
    expect(nb_espaces_clients).toBe(espaces.filter((e) => !e.interne).length);
  });
});

describe('membresDeLEspace', () => {
  it('chaque membre rendu est bien membre, et ses autres espaces excluent celui-ci', async () => {
    const { espaces } = await listerEspaces(sb);
    const marine = espaces.find((e) => e.slug === 'marine')!;
    const membres = await membresDeLEspace(sb, marine.id);
    expect(membres.length).toBe(marine.nb_membres);
    for (const m of membres) expect(m.autres_espaces.map((x) => x.id)).not.toContain(marine.id);
  });
});
