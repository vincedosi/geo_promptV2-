import { formaterNombre } from '../../../core/format/nombre';
import type { BornesIris } from './iris-echelle';
import {
  degradeALegende, libelleRayonPoi, niveauxDuJeuSante, paliersCarreaux, paliersIris, texteComptePprt,
} from './legende';

const ARRETS = ['#1', '#2', '#3', '#4', '#5', '#6'];

describe('degradeALegende', () => {
  it('aucun dégradé, aucun bloc ; score et diffusion portent leur propre légende', () => {
    expect(degradeALegende(null)).toBe(false);
    expect(degradeALegende('score')).toBe(false);
    expect(degradeALegende('diffusion')).toBe(false);
    expect(degradeALegende('carreaux')).toBe(true);
  });
});

describe('paliersCarreaux', () => {
  it('six paliers sur l’échelle log, le dernier ouvert, le choisi marqué', () => {
    const p = paliersCarreaux({ min: 0, max: 6 }, ARRETS, 4);
    expect(p).toHaveLength(6);
    expect(p.map((x) => x.couleur)).toEqual(ARRETS);
    expect(p[4]).toEqual({ index: 4, couleur: '#5', choisi: true, libelle: '10k – 100k' });
    expect(p[5].libelle).toBe('≥ 100k');
    expect(p.filter((x) => x.choisi)).toHaveLength(1);
  });

  it('aucun palier choisi', () => {
    expect(paliersCarreaux({ min: 0, max: 6 }, ARRETS, null).some((x) => x.choisi)).toBe(false);
  });
});

describe('paliersIris', () => {
  it('« ≤ a » en tête, « ≥ z » en fin, aux frontières de la peinture', () => {
    const b: BornesIris = { colonne: 'x', classe: 'effectif', log_min: 0, log_max: 6, val_min: 1, val_max: 1e6 };
    const p = paliersIris(b, ARRETS);
    expect(p).toHaveLength(6);
    expect(p[0].libelle.startsWith('≤ ')).toBe(true);
    expect(p[4].libelle).toBe('10k – 100k');
    expect(p[5].libelle).toBe('≥ 100k');
  });
});

describe('niveauxDuJeuSante', () => {
  it('six niveaux en jetons CSS, estompés sous le seuil', () => {
    const s = niveauxDuJeuSante('pollen', 3);
    expect(s.titre).toBe('Indice pollen');
    expect(s.niveaux).toHaveLength(6);
    expect(s.niveaux[0].couleur.startsWith('var(--')).toBe(true);
    expect(s.niveaux.map((n) => n.estompe)).toEqual([true, true, false, false, false, false]);
    expect(niveauxDuJeuSante('atmo', 0).titre).toBe('Indice ATMO');
    expect(niveauxDuJeuSante('atmo', 0).niveaux.some((n) => n.estompe)).toBe(false);
  });
});

describe('libelleRayonPoi', () => {
  it('mètres sous le kilomètre, kilomètres au-delà, rien sans rayon', () => {
    expect(libelleRayonPoi(800)).toBe('800m');
    expect(libelleRayonPoi(1500)).toBe('1.5km');
    expect(libelleRayonPoi(0)).toBeNull();
    expect(libelleRayonPoi(null)).toBeNull();
  });
});

describe('texteComptePprt', () => {
  it('accorde le verbe et le nom, rien sans site rendu', () => {
    expect(texteComptePprt({ rendus: 1259, avecPprt: 1 })).toBe(`1 site sur ${formaterNombre(1259)} a un périmètre PPRT`);
    expect(texteComptePprt({ rendus: 10, avecPprt: 3 })).toBe('3 sites sur 10 ont un périmètre PPRT');
    expect(texteComptePprt({ rendus: 0, avecPprt: 0 })).toBeNull();
    expect(texteComptePprt(null)).toBeNull();
  });
});
