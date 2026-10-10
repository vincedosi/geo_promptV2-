import {
  basculerDansSelection, corpsOperation, libelleSelection, messageRefusOperation, messageZoneCreee, nomZoneCreee, selectionExistante,
} from './operations-zones';

const NOMS = new Map([['a', 'Bretagne'], ['b', 'Finistère']]);

describe('operations-zones (ZonesOperations.tsx)', () => {
  it('corps : base + retirées pour la soustraction, la liste sinon', () => {
    expect(corpsOperation('difference', ['a', 'b', 'c'])).toEqual({ zone_base: 'a', zones_retirees: ['b', 'c'] });
    expect(corpsOperation('intersection', ['a', 'b'])).toEqual({ zone_ids: ['a', 'b'] });
    expect(corpsOperation('union', ['a', 'b'])).toEqual({ zone_ids: ['a', 'b'] });
  });

  it('noms de la zone créée, au singulier et au pluriel, id tronqué pour un nom inconnu', () => {
    expect(nomZoneCreee('difference', ['a', 'b'], NOMS)).toBe('Bretagne — moins 1 zone');
    expect(nomZoneCreee('intersection', ['a', 'b', 'c'], NOMS)).toBe('Bretagne — restreinte à 2 zones');
    expect(nomZoneCreee('union', ['b', 'a'], NOMS)).toBe('Fusion de 2 zones — Finistère…');
    expect(nomZoneCreee('union', ['0123456789abcdef', 'a'], NOMS)).toBe('Fusion de 2 zones — 01234567…');
  });

  it('refus : message de la route, puis codes traduits, puis statut', () => {
    expect(messageRefusOperation(409, { error: 'intersection_vide', message: 'Ces zones n’ont aucune surface en commun.' })).toBe('Ces zones n’ont aucune surface en commun.');
    expect(messageRefusOperation(404, { error: 'zone_not_found' })).toBe('Une des zones est introuvable.');
    expect(messageRefusOperation(400, { error: 'zone_dupliquee' })).toBe('Une même zone est sélectionnée deux fois.');
    expect(messageRefusOperation(400, { error: 'composite_failed' })).toBe('Erreur (400)');
    expect(messageRefusOperation(0, null)).toBe('Erreur (0)');
  });

  it('message de réussite et libellé de sélection', () => {
    expect(messageZoneCreee(1, null)).toBe('Zone créée : 1 code postal');
    expect(messageZoneCreee(1234, 56.7)).toBe(`Zone créée : ${(1234).toLocaleString('fr-FR')} codes postaux · 56,7 km²`);
    expect(messageZoneCreee(undefined, 0)).toBe('Zone créée : 0 code postal');
    expect(libelleSelection(1)).toBe('1 zone sélectionnée');
    expect(libelleSelection(3)).toBe('3 zones sélectionnées');
  });

  it('sélection : ordre de cochage gardé ; zones disparues retirées, même référence si rien ne change', () => {
    expect(basculerDansSelection(['a'], 'b')).toEqual(['a', 'b']);
    expect(basculerDansSelection(['a', 'b'], 'a')).toEqual(['b']);
    const s = ['a', 'b'];
    expect(selectionExistante(s, new Set(['a', 'b', 'c']))).toBe(s);
    expect(selectionExistante(s, new Set(['b']))).toEqual(['b']);
  });
});
