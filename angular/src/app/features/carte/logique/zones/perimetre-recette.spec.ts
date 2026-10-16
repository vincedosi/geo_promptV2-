import { perimetreDeFiltre, messageErreurZone } from './perimetre-recette';

describe('perimetreDeFiltre', () => {
  it.each([
    [{ type: 'departement', code: '13', label: 'Bouches-du-Rhône' }, { type: 'departement', code: '13' }],
    [{ type: 'region', code: '84', label: 'ARA' }, { type: 'region', code: '84' }],
    // le format RÉEL du filtre commune : le nom tapé, en minuscules (panneau-filtre-logique.ts:59) — résolu en base
    [{ type: 'commune', code: 'marseille', label: 'Marseille' }, { type: 'commune', code: 'marseille' }],
    [{ type: 'cp', code: '13001', label: '13001' }, { type: 'cp', code: '13001' }],
    [{ type: 'zone', code: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', label: 'Ma zone' }, { type: 'zone', code: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }],
    [{ type: 'france', code: 'france', label: 'France' }, { type: 'france', code: 'FR' }],
  ] as const)('%o', (f, attendu) => {
    expect(perimetreDeFiltre(f as never)).toEqual(attendu);
  });
  it('aucun filtre : null', () => expect(perimetreDeFiltre(null)).toBeNull());
});

describe('messageErreurZone', () => {
  it('le message français de la route, sinon un message par statut', () => {
    expect(messageErreurZone({ status: 422, error: { error: 'Plus de 20 000 carreaux retenus : resserrez le périmètre ou relevez le seuil.' } })).toMatch(/^Plus de 20 000/);
    expect(messageErreurZone({ status: 429, error: {} })).toBe('Trop de calculs à la suite : patientez une minute.');
    expect(messageErreurZone({ status: 0 })).toBe('Serveur injoignable : réessayez.');
    expect(messageErreurZone({ status: 500, error: 'texte' })).toBe('Calcul de la zone impossible.');
    // Le défaut se choisit par geste : une écriture ou une suppression n'est pas un « calcul ».
    expect(messageErreurZone({ status: 500, error: 'texte' }, 'Enregistrement impossible.')).toBe('Enregistrement impossible.');
    expect(messageErreurZone({ status: 409, error: { error: 'Cette zone est utilisée.' } }, 'Suppression impossible.')).toBe('Cette zone est utilisée.');
  });
});
