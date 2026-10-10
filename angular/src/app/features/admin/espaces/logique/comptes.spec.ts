import { filtrerComptes, grouperComptes, normaliser } from './comptes';
import type { CompteResume } from './types';

function compte(p: Partial<CompteResume> & { id: string; email: string }): CompteResume {
  return { nom: null, role: 'client', espace_actif: null, espaces: [], cree_le: '2026-10-01T10:00:00Z', ...p };
}

const MARINE = { id: 'org-marine', nom_affiche: 'MARINE' };
const BMW = { id: 'org-bmw', nom_affiche: 'BMW GROUP' };
const ELYSEE = { id: 'org-elysee', nom_affiche: 'Élysée' };

const COMPTES: CompteResume[] = [
  compte({ id: 'sa1', email: 'admin@dentsu.test', role: 'super_admin' }),
  compte({ id: 'sa2', email: 'zoe@dentsu.test', role: 'super_admin', espace_actif: 'org-marine', espaces: [MARINE] }),
  compte({ id: 'c1', email: 'marin@marine.test', nom: 'Hélène Marin', espace_actif: 'org-marine', espaces: [BMW, MARINE] }),
  compte({ id: 'c2', email: 'pilote@bmw.test', espace_actif: 'org-bmw', espaces: [BMW] }),
  compte({ id: 'c3', email: 'orphelin@exemple.test' }),
  compte({ id: 'c4', email: 'eve@elysee.test', espace_actif: 'org-elysee', espaces: [ELYSEE] }),
  compte({ id: 'c5', email: 'flottant@exemple.test', espaces: [MARINE] }),
];

describe('normaliser', () => {
  it('minuscules, sans accents ni espaces superflus', () => {
    expect(normaliser('  Hélène ÉLYSÉE  ')).toBe('helene elysee');
  });
});

describe('filtrerComptes', () => {
  it('filtre vide → tout', () => {
    expect(filtrerComptes(COMPTES, '   ')).toHaveLength(COMPTES.length);
  });

  it('par nom, insensible à la casse et aux accents', () => {
    expect(filtrerComptes(COMPTES, 'helene').map((c) => c.id)).toEqual(['c1']);
    expect(filtrerComptes(COMPTES, 'HÉLÈNE').map((c) => c.id)).toEqual(['c1']);
  });

  it('par email', () => {
    expect(filtrerComptes(COMPTES, 'BMW.test').map((c) => c.id)).toEqual(['c2']);
  });
});

describe('grouperComptes', () => {
  it('Super admins d\'abord, puis un groupe par espace actif (ordre alphabétique fr), puis « Sans espace » en dernier', () => {
    const groupes = grouperComptes(COMPTES);
    expect(groupes.map((g) => g.libelle)).toEqual([
      'Super admins', 'BMW GROUP', 'Élysée', 'MARINE', 'Aucun espace actif', 'Sans espace',
    ]);
  });

  it('un super_admin reste chez les super admins, même avec un espace actif', () => {
    const [sa] = grouperComptes(COMPTES);
    expect(sa.comptes.map((c) => c.id)).toEqual(['sa1', 'sa2']);
    expect(sa.cle).toBe('super-admins');
  });

  it('« Sans espace » : les comptes rattachés à AUCUN espace ; « Aucun espace actif » : membres sans actif', () => {
    const groupes = grouperComptes(COMPTES);
    expect(groupes.find((g) => g.libelle === 'Sans espace')!.comptes.map((c) => c.id)).toEqual(['c3']);
    expect(groupes.find((g) => g.libelle === 'Aucun espace actif')!.comptes.map((c) => c.id)).toEqual(['c5']);
    expect(groupes.find((g) => g.libelle === 'MARINE')!.comptes.map((c) => c.id)).toEqual(['c1']);
  });

  it('un groupe vide n\'est pas rendu', () => {
    const groupes = grouperComptes(COMPTES.filter((c) => c.role !== 'super_admin' && c.id !== 'c5'));
    expect(groupes.map((g) => g.libelle)).toEqual(['BMW GROUP', 'Élysée', 'MARINE', 'Sans espace']);
    expect(grouperComptes([])).toEqual([]);
  });

  it('le nom d\'un espace actif absent des espaces du compte retombe sur la table fournie, sinon « Espace inconnu »', () => {
    const c = compte({ id: 'x', email: 'x@x.test', espace_actif: 'org-z' });
    expect(grouperComptes([c], new Map([['org-z', 'Zèbre']]))[0].libelle).toBe('Zèbre');
    expect(grouperComptes([c])[0].libelle).toBe('Espace inconnu');
  });
});
