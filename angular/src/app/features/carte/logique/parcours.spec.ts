import {
  CONSIGNE_AUTRES, CONSIGNE_ETAPE, ETAPES_CARTE, LIBELLE_AUTRES, LIBELLE_ETAPE_CARTE, VUE_AUTRES, ecrireEtape, etapeInitiale, etapeParRaccourci,
  etapesDuFil, lienApplicationReact, lireEtape, lireVue, precisionDuPerimetre, rangEtapeCarte, segmentsDuFiltre,
} from './parcours';

const params = (q: string) => new URLSearchParams(q);
const alt = (code: string, key: string, extra: Partial<KeyboardEvent> = {}) =>
  ({ code, key, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...extra }) as KeyboardEvent;

describe('parcours de la carte — logique pure', () => {
  it('huit étapes, dans l’ordre du module risque (Vincent, 13/10, spec § 15), libellés exacts, rangs 1 à 8', () => {
    expect([...ETAPES_CARTE]).toEqual(['perimetre', 'donnees', 'zones', 'analyse', 'jeu', 'plan', 'activation', 'live']);
    expect(ETAPES_CARTE.map((e) => LIBELLE_ETAPE_CARTE[e]))
      .toEqual(['Périmètre', 'Données', 'Zones', 'Analyse', 'Jeu de zones', 'Plan', 'Activation', 'Live']);
    expect(ETAPES_CARTE.map(rangEtapeCarte)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('les consignes de ③ ④ ⑤ disent l’ordre du module risque, sans promettre ce que ③ n’offre pas encore', () => {
    // Lot 3 (T10) : ③ est rangée par familles et chaque zone garde sa recette.
    expect(CONSIGNE_ETAPE.zones).toBe('Définissez vos zones : autour des POI, par seuil sur une donnée, à la main, ou en capturant la carte. Chaque zone garde sa recette et se recalcule.');
    // Les isochrones se lancent en ④ (C3) : ③ ne les annonce pas comme un geste à elle.
    expect(CONSIGNE_ETAPE.zones).not.toMatch(/isochrone/i);
    expect(CONSIGNE_ETAPE.analyse).toContain('sur ces zones');
    // Lot 5 (T10) : ⑤ traduit une zone dans la maille de CHAQUE plateforme et dit ce que la traduction perd.
    expect(CONSIGNE_ETAPE.jeu).toContain('maille de chaque plateforme');
    for (const mot of ['seuil', 'taux d’utile', 'perd', 'extraction']) expect(CONSIGNE_ETAPE.jeu).toContain(mot);
  });
  it('T11b « Autres » : hors du fil — ni étape, ni rang, ni raccourci ; `?etape=autres` se lit par lireVue seulement', () => {
    expect(VUE_AUTRES).toBe('autres');
    expect(LIBELLE_AUTRES).toBe('Autres');
    expect(CONSIGNE_AUTRES).toContain('pas encore');
    expect((ETAPES_CARTE as readonly string[]).includes(VUE_AUTRES)).toBe(false);
    expect(etapesDuFil({ filtrePose: false, calquesActifs: false, analyseAffichee: false, jeuRenseigne: false, planRenseigne: false }).map((e) => e.cle)).not.toContain(VUE_AUTRES);
    expect(lireEtape('autres')).toBeNull();
    expect(lireVue('autres')).toBe('autres');
    expect(lireVue('zones')).toBe('zones');
    for (const illisible of ['Autres', 'autre', '', null, undefined, '9']) expect(lireVue(illisible)).toBeNull();
    // ?etape=autres à l'ouverture : l'étape SOUS « Autres » est celle d'un lien sans étape (① ; ③ avec customZone).
    expect(etapeInitiale(params('etape=autres'))).toBe('perimetre');
    expect(etapeInitiale(params('etape=autres&customZone=z'))).toBe('zones');
    // Aucun Alt+N ne mène à « Autres » : Alt+9 ne fait toujours rien.
    expect(etapeParRaccourci(alt('Digit9', '9'))).toBeNull();
  });
  it('lireEtape : une valeur connue, sinon null — jamais d’exception ; les anciens liens restent valides (identifiants, pas numéros)', () => {
    expect(lireEtape('zones')).toBe('zones');
    expect(lireEtape('jeu')).toBe('jeu');
    for (const ancien of ['perimetre', 'donnees', 'analyse', 'zones', 'plan', 'activation', 'live']) expect(lireEtape(ancien)).toBe(ancien);
    expect(lireEtape('5')).toBeNull();
    expect(lireEtape('ZONES')).toBeNull();
    expect(lireEtape('')).toBeNull();
    expect(lireEtape(null)).toBeNull();
    expect(lireEtape(undefined)).toBeNull();
  });
  it('etapeInitiale : etape valide > customZone (③) > Périmètre (Review Focus 1)', () => {
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
  it('Alt+1…8 par le code physique (AZERTY : key « & »), pavé numérique compris', () => {
    expect(etapeParRaccourci(alt('Digit1', '&'))).toBe('perimetre');
    expect(etapeParRaccourci(alt('Digit2', '2'))).toBe('donnees');
    expect(etapeParRaccourci(alt('Digit3', '"'))).toBe('zones');
    expect(etapeParRaccourci(alt('Numpad4', '4'))).toBe('analyse');
    expect(etapeParRaccourci(alt('Digit5', '('))).toBe('jeu');
    expect(etapeParRaccourci(alt('Numpad7', '7'))).toBe('activation');
    expect(etapeParRaccourci(alt('Digit8', '_'))).toBe('live');
    expect(etapeParRaccourci(alt('Numpad8', '8'))).toBe('live');
    expect(etapeParRaccourci(alt('', '3'))).toBe('zones');
  });
  it('rien hors Alt seul, rien au-delà de 8, Alt+C n’est plus rien', () => {
    expect(etapeParRaccourci(alt('Digit9', '9'))).toBeNull();
    expect(etapeParRaccourci(alt('Numpad9', '9'))).toBeNull();
    expect(etapeParRaccourci(alt('Digit2', '2', { shiftKey: true }))).toBeNull();
    expect(etapeParRaccourci(alt('Digit2', '2', { ctrlKey: true }))).toBeNull();
    expect(etapeParRaccourci(alt('Digit2', '2', { metaKey: true }))).toBeNull();
    expect(etapeParRaccourci({ ...alt('Digit2', '2'), altKey: false } as KeyboardEvent)).toBeNull();
    expect(etapeParRaccourci(alt('KeyC', 'c'))).toBeNull();
  });
  it('etapesDuFil : ① renseignée par le filtre, ② par un calque, les autres jamais (lot 1)', () => {
    const fil = etapesDuFil({ filtrePose: true, calquesActifs: false, analyseAffichee: false, jeuRenseigne: false, planRenseigne: false });
    expect(fil.map((e) => [e.cle, e.rang, e.renseignee])).toEqual([
      ['perimetre', 1, true], ['donnees', 2, false], ['zones', 3, false], ['analyse', 4, false],
      ['jeu', 5, false], ['plan', 6, false], ['activation', 7, false], ['live', 8, false],
    ]);
    expect(etapesDuFil({ filtrePose: false, calquesActifs: true, analyseAffichee: false, jeuRenseigne: false, planRenseigne: false })[1].renseignee).toBe(true);
  });
  it('etapesDuFil : ④ renseignée par une analyse affichée (score composite ou zones à risque), et elle seule (T14)', () => {
    const fil = etapesDuFil({ filtrePose: false, calquesActifs: false, analyseAffichee: true, jeuRenseigne: false, planRenseigne: false });
    expect(fil.filter((e) => e.renseignee).map((e) => e.cle)).toEqual(['analyse']);
  });
  it('etapesDuFil : ⑤ renseignée par une zone ou un jeu (?zoneJeu= / ?jeu=), et elle seule (lot 5, T10)', () => {
    const fil = etapesDuFil({ filtrePose: false, calquesActifs: false, analyseAffichee: false, jeuRenseigne: true, planRenseigne: false });
    expect(fil.filter((e) => e.renseignee).map((e) => e.cle)).toEqual(['jeu']);
  });
  it('etapesDuFil : ⑥ renseignée par une stratégie existante de la campagne courante, et elle seule (lot 6, T3)', () => {
    const fil = etapesDuFil({ filtrePose: false, calquesActifs: false, analyseAffichee: false, jeuRenseigne: false, planRenseigne: true });
    expect(fil.filter((e) => e.renseignee).map((e) => e.cle)).toEqual(['plan']);
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
  it('lienApplicationReact : seulement ⑦-⑧, seulement avec une origine — ⑤ n’a pas d’équivalent React, ⑥ a son panneau (lot 6)', () => {
    expect(lienApplicationReact('http://localhost:3000', 'jeu')).toBeNull();
    expect(lienApplicationReact('http://localhost:3000/', 'plan')).toBeNull();
    expect(lienApplicationReact('http://localhost:3000', 'activation')).toBe('http://localhost:3000/map?tab=activation');
    expect(lienApplicationReact('http://localhost:3000', 'live')).toBe('http://localhost:3000/map?tab=suivi');
    expect(lienApplicationReact('http://localhost:3000', 'zones')).toBeNull();
    expect(lienApplicationReact(undefined, 'activation')).toBeNull();
    expect(lienApplicationReact('', 'activation')).toBeNull();
    // Revue finale du lot 6 (m5) : la campagne courante voyage, le deep-link React la lit en `campaign`.
    expect(lienApplicationReact('http://localhost:3000', 'activation', '0f8fad5b-d9cb-469f-a165-70867728950e'))
      .toBe('http://localhost:3000/map?tab=activation&campaign=0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(lienApplicationReact('http://localhost:3000', 'live', null)).toBe('http://localhost:3000/map?tab=suivi');
  });
});
