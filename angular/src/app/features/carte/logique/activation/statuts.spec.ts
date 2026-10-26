import { compteLineItems, compteStatut, libelleStatut, statutMinuscule } from './statuts';

describe('statuts de ⑦ — libellés français, accordés (preuve C-2)', () => {
  it('chaque statut de lot et de cible a un libellé en sentence case, jamais le code brut', () => {
    const lots = ['en_cours', 'termine', 'partiel', 'echec', 'annule'].map(libelleStatut);
    expect(lots).toEqual(['En cours', 'Terminé', 'Partiel', 'Échec', 'Annulé']);
    const cibles = ['en_attente', 'pousse', 'echec', 'annule'].map(statutMinuscule);
    expect(cibles).toEqual(['en attente', 'poussé', 'échec', 'annulé']);
  });

  it('les comptes s’accordent : singulier jusqu’à 1, pluriel au-delà', () => {
    expect(compteStatut(0, 'echec')).toBe('0 échec');
    expect(compteStatut(1, 'pousse')).toBe('1 poussé');
    expect(compteStatut(2, 'annule')).toBe('2 annulés');
    expect(compteStatut(1200, 'pousse')).toBe(`${(1200).toLocaleString('fr-FR')} poussés`);
    expect(compteStatut(3, 'en_attente')).toBe('3 en attente');
    expect(compteLineItems(1)).toBe('1 line item');
    expect(compteLineItems(2)).toBe('2 line items');
  });

  it('un code inconnu reste lisible tel quel', () => {
    expect(libelleStatut('autre')).toBe('Autre');
    expect(compteStatut(2, 'autre')).toBe('2 autre');
  });
});
