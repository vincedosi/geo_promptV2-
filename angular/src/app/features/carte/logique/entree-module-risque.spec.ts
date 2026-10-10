import { ecrireEtatUrl, ETAT_DEFAUT, lireEtatUrl } from '../../risques/logique/etat-url';
import { NATURE_NON_PRECISEE } from './familles-icpe';
import { risqueDepuisCalques, risqueDuJeu } from './entree-module-risque';
import { naturesDesTypes } from './natures-risque';

const JEU = '0b7ece33-4903-4a0b-a57a-f6c54e78a729';

describe('naturesDesTypes (B4 — formule de AnalysePopulationOverlay.tsx:582-588)', () => {
  it("['toxique', 'non_precise'] → les libellés du seed pour « toxique », puis « Nature non précisée »", () => {
    expect(naturesDesTypes(['toxique', 'non_precise'])).toEqual(['Toxicité aiguë', NATURE_NON_PRECISEE]);
    expect(NATURE_NON_PRECISEE).toBe('Nature non précisée');
  });

  it('aucun type → aucune nature (le module compte alors toutes les natures)', () => {
    expect(naturesDesTypes([])).toEqual([]);
  });
});

describe('risqueDepuisCalques', () => {
  it('garde le `risque=` courant et y REMPLACE les natures par celles des types cochés', () => {
    const brut = ecrireEtatUrl({ ...ETAT_DEFAUT, etape: 'rayon', natures: ['Déchets'] });
    const sortie = risqueDepuisCalques(brut, ['toxique']);
    expect(sortie).toBe(ecrireEtatUrl({ ...ETAT_DEFAUT, etape: 'rayon', natures: ['Toxicité aiguë'] }));
    expect(lireEtatUrl(new URLSearchParams(sortie!)).natures).toEqual(['Toxicité aiguë']);
  });

  it("une nature à point et parenthèses traverse l'URL intacte (encodage de `ecrireEtatUrl`)", () => {
    const sortie = risqueDepuisCalques(null, ['inflammable']);
    expect(lireEtatUrl(new URLSearchParams(sortie!)).natures).toEqual(naturesDesTypes(['inflammable']));
    expect(naturesDesTypes(['inflammable'])).toContain('Inflammables (ancienne nomenclature)');
  });

  it("aucun type et aucun état : `null` — le paramètre disparaît de l'URL", () => {
    expect(risqueDepuisCalques(null, [])).toBeNull();
    expect(risqueDepuisCalques('', [])).toBeNull();
  });

  it('les gravités du `risque=` courant sont gardées : Calques ne les transmet pas (parité)', () => {
    const brut = ecrireEtatUrl({ ...ETAT_DEFAUT, gravites: ['seveso_haut'] });
    expect(lireEtatUrl(new URLSearchParams(risqueDepuisCalques(brut, [])!)).gravites).toEqual(['seveso_haut']);
  });
});

describe('risqueDuJeu', () => {
  it("l'état PAR DÉFAUT à l'étape ④, sur ce jeu (`ouvrirJeuDeZones`, page.tsx:232-240)", () => {
    expect(risqueDuJeu(JEU)).toBe(`etape=zones&jeu=${JEU}`);
  });
});
