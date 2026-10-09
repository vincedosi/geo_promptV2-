/**
 * Lectures de la page « Espaces de travail » contre la base locale.
 * On vérifie des RELATIONS, pas des effectifs figés.
 */
import { describe, it, expect } from 'vitest';
import { creerClientTest } from './_client';
import { listerEspaces, membresDeLEspace } from '@/lib/espaces/lister-espaces';
import { donneesDeLEspace, lireSocle } from '@/lib/espaces/donnees-espace';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';

const sb = creerClientTest() as never;

describe('listerEspaces', () => {
  it('rend chaque organisation, l\'interne renommée et rangée en dernier', async () => {
    const { espaces, socle } = await listerEspaces(sb);
    const interne = espaces.find((e) => e.slug === 'genesis-global');
    expect(interne?.nom_affiche).toBe('dentsu.explore (interne)');
    expect(espaces.at(-1)?.interne).toBe(true);
    expect(socle.nb_jeux).toBeGreaterThan(0);
  });

  it('compte les membres par organization_members', async () => {
    const admin = creerClientTest();
    const { espaces } = await listerEspaces(sb);
    for (const e of espaces) {
      const { count } = await admin.from('organization_members').select('id', { count: 'exact', head: true }).eq('organization_id', e.id);
      expect(e.nb_membres, e.slug).toBe(count ?? 0);
    }
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
