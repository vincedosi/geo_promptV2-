import { groupeDe, groupesDesAutres, rangerParGroupe } from './groupes';
import type { EspaceResume } from './types';

function espace(id: string, groupe: string | null): EspaceResume {
  return { id, nom: id, nom_affiche: id, slug: id, actif: true, interne: false, nb_membres: 0, nb_jeux_prives: 0, groupe_espace: groupe };
}

describe('groupes d\'espaces', () => {
  it('groupeDe : rogne, et une chaîne blanche n\'est pas un groupe', () => {
    expect(groupeDe({ groupe_espace: '  BMW ' })).toBe('BMW');
    expect(groupeDe({ groupe_espace: '   ' })).toBeNull();
    expect(groupeDe({ groupe_espace: null })).toBeNull();
  });

  it('rangerParGroupe : sans groupe d\'abord (ordre du serveur), puis dossiers alphabétiques', () => {
    const lignes = [espace('a', 'BMW'), espace('b', null), espace('c', 'Armées'), espace('d', 'BMW'), espace('e', null)];
    const r = rangerParGroupe(lignes, groupeDe);
    expect(r.sansGroupe.map((e) => e.id)).toEqual(['b', 'e']);
    expect(r.dossiers.map((d) => [d.groupe, d.espaces.map((e) => e.id)])).toEqual([
      ['Armées', ['c']],
      ['BMW', ['a', 'd']],
    ]);
  });

  it('groupesDesAutres : distincts, triés, sans le groupe de l\'espace lui-même s\'il est seul à le porter', () => {
    const espaces = [espace('a', 'BMW'), espace('b', 'Armées'), espace('c', 'BMW'), espace('d', 'Seul'), espace('e', null)];
    expect(groupesDesAutres(espaces, 'd')).toEqual(['Armées', 'BMW']);
    expect(groupesDesAutres(espaces, 'a')).toEqual(['Armées', 'BMW', 'Seul']);
  });
});
