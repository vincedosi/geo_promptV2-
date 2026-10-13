import {
  ETAPES_CARTE, LIBELLE_ETAPE_CARTE, ecrireEtape, etapeInitiale, etapeParRaccourci, etapesDuFil, lienApplicationReact,
  lireEtape, precisionDuPerimetre, rangEtapeCarte, segmentsDuFiltre,
} from './parcours';

const params = (q: string) => new URLSearchParams(q);
const alt = (code: string, key: string, extra: Partial<KeyboardEvent> = {}) =>
  ({ code, key, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...extra }) as KeyboardEvent;

describe('parcours de la carte — logique pure', () => {
  it('sept étapes, dans l’ordre de la spec, libellés exacts, rangs 1 à 7', () => {
    expect([...ETAPES_CARTE]).toEqual(['perimetre', 'donnees', 'analyse', 'zones', 'plan', 'activation', 'live']);
    expect(ETAPES_CARTE.map((e) => LIBELLE_ETAPE_CARTE[e])).toEqual(['Périmètre', 'Données', 'Analyse', 'Zones', 'Plan', 'Activation', 'Live']);
    expect(ETAPES_CARTE.map(rangEtapeCarte)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('lireEtape : une valeur connue, sinon null — jamais d’exception', () => {
    expect(lireEtape('zones')).toBe('zones');
    expect(lireEtape('ZONES')).toBeNull();
    expect(lireEtape('')).toBeNull();
    expect(lireEtape(null)).toBeNull();
    expect(lireEtape(undefined)).toBeNull();
  });
  it('etapeInitiale : etape valide > customZone (④) > Périmètre (Review Focus 1)', () => {
    expect(etapeInitiale(params('etape=analyse&customZone=z'))).toBe('analyse');
    expect(etapeInitiale(params('customZone=z'))).toBe('zones');
    expect(etapeInitiale(params('etape=inconnue'))).toBe('perimetre');
    expect(etapeInitiale(params('etape=inconnue&customZone=z'))).toBe('zones');
    expect(etapeInitiale(params(''))).toBe('perimetre');
  });
  it('ecrireEtape : la valeur par défaut ne s’écrit pas', () => {
    expect(ecrireEtape('perimetre')).toBe('');
    expect(ecrireEtape('live')).toBe('live');
  });
  it('Alt+1…7 par le code physique (AZERTY : key « & »), pavé numérique compris', () => {
    expect(etapeParRaccourci(alt('Digit1', '&'))).toBe('perimetre');
    expect(etapeParRaccourci(alt('Digit2', '2'))).toBe('donnees');
    expect(etapeParRaccourci(alt('Numpad7', '7'))).toBe('live');
    expect(etapeParRaccourci(alt('', '4'))).toBe('zones');
  });
  it('rien hors Alt seul, rien au-delà de 7, Alt+C n’est plus rien', () => {
    expect(etapeParRaccourci(alt('Digit8', '8'))).toBeNull();
    expect(etapeParRaccourci(alt('Digit2', '2', { shiftKey: true }))).toBeNull();
    expect(etapeParRaccourci(alt('Digit2', '2', { ctrlKey: true }))).toBeNull();
    expect(etapeParRaccourci(alt('Digit2', '2', { metaKey: true }))).toBeNull();
    expect(etapeParRaccourci({ ...alt('Digit2', '2'), altKey: false } as KeyboardEvent)).toBeNull();
    expect(etapeParRaccourci(alt('KeyC', 'c'))).toBeNull();
  });
  it('etapesDuFil : ① renseignée par le filtre, ② par un calque, les autres jamais (lot 1)', () => {
    const fil = etapesDuFil({ filtrePose: true, calquesActifs: false });
    expect(fil.map((e) => [e.cle, e.rang, e.renseignee])).toEqual([
      ['perimetre', 1, true], ['donnees', 2, false], ['analyse', 3, false], ['zones', 4, false],
      ['plan', 5, false], ['activation', 6, false], ['live', 7, false],
    ]);
    expect(etapesDuFil({ filtrePose: false, calquesActifs: true })[1].renseignee).toBe(true);
  });
  it('segmentsDuFiltre : « France entière » puis le filtre ; une zone ne montre pas son uuid', () => {
    expect(segmentsDuFiltre(null)).toEqual([{ cle: 'france', libelle: 'France entière' }]);
    expect(segmentsDuFiltre({ type: 'france', code: 'FR', label: 'France' })).toEqual([{ cle: 'france', libelle: 'France entière' }]);
    expect(segmentsDuFiltre({ type: 'departement', code: '29', label: 'Finistère' })[1])
      .toEqual({ cle: 'departement:29', libelle: 'Finistère', titre: 'Département 29' });
    expect(segmentsDuFiltre({ type: 'zone', code: '0b7e-uuid', label: 'Brest' })[1].titre).toBe('Zone enregistrée');
  });
  it('precisionDuPerimetre', () => {
    expect(precisionDuPerimetre(null)).toBeUndefined();
    expect(precisionDuPerimetre('metro')).toBe('métropole');
    expect(precisionDuPerimetre('all')).toBe('métropole + DROM');
  });
  it('lienApplicationReact : seulement ⑤-⑦, seulement avec une origine', () => {
    expect(lienApplicationReact('http://localhost:3000/', 'plan')).toBe('http://localhost:3000/map?tab=strategie');
    expect(lienApplicationReact('http://localhost:3000', 'activation')).toBe('http://localhost:3000/map?tab=activation');
    expect(lienApplicationReact('http://localhost:3000', 'live')).toBe('http://localhost:3000/map?tab=suivi');
    expect(lienApplicationReact('http://localhost:3000', 'zones')).toBeNull();
    expect(lienApplicationReact(undefined, 'plan')).toBeNull();
    expect(lienApplicationReact('', 'plan')).toBeNull();
  });
});
