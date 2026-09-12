import { describe, it, expect } from 'vitest';
import {
  ENTREES_NAVIGATION, LARGEUR_RAIL, entreeParRaccourci,
  type EntreeNavigation,
} from '@/lib/navigation/config';

/** Fabrique un KeyboardEvent minimal sans DOM. */
function touche(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { key: '', ctrlKey: false, metaKey: false, altKey: false, ...init } as KeyboardEvent;
}

describe('configuration de navigation', () => {
  it('declare exactement les sept entrees de la spec, dans l ordre', () => {
    expect(ENTREES_NAVIGATION.map(e => e.id)).toEqual([
      'assistant', 'campagne', 'filtre', 'calques', 'analyse', 'zones', 'reglages', 'aide',
    ]);
  });

  it('n a aucun id duplique', () => {
    const ids = ENTREES_NAVIGATION.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('donne une phrase de tooltip aux quatre outils', () => {
    const attendu: Record<string, string> = {
      filtre: 'Où je regarde',
      calques: 'Ce que je vois',
      analyse: 'Ce que je calcule',
      zones: 'Ce que je fabrique',
    };
    for (const [id, phrase] of Object.entries(attendu)) {
      expect(ENTREES_NAVIGATION.find(e => e.id === id)?.tooltip).toBe(phrase);
    }
  });

  it('n attribue jamais deux fois le meme raccourci', () => {
    const raccourcis = ENTREES_NAVIGATION.map(e => e.raccourci).filter(Boolean);
    expect(new Set(raccourcis).size).toBe(raccourcis.length);
  });

  it('reconnait Ctrl+K et Alt+1 a Alt+4', () => {
    expect(entreeParRaccourci(touche({ key: 'k', ctrlKey: true }))).toBe('assistant');
    expect(entreeParRaccourci(touche({ key: '1', altKey: true }))).toBe('filtre');
    expect(entreeParRaccourci(touche({ key: '2', altKey: true }))).toBe('calques');
    expect(entreeParRaccourci(touche({ key: '3', altKey: true }))).toBe('analyse');
    expect(entreeParRaccourci(touche({ key: '4', altKey: true }))).toBe('zones');
    expect(entreeParRaccourci(touche({ key: 'c', altKey: true }))).toBe('campagne');
  });

  it('ignore une touche sans modificateur', () => {
    expect(entreeParRaccourci(touche({ key: '1' }))).toBeNull();
  });

  it('laisse la place au plus long libelle', () => {
    // Le rail actuel (48 px) tronquait « Périmètre » a 8 caracteres.
    const plusLong = Math.max(...ENTREES_NAVIGATION.map(e => e.label.length));
    expect(plusLong).toBeLessThanOrEqual(9);        // « Assistant », « Campagne », « Réglages »
    expect(LARGEUR_RAIL).toBeGreaterThanOrEqual(72); // 9 car. a 9px ≈ 58px + marges
  });

  it('place Reglages et Aide en bas, le reste en haut', () => {
    const bas = ENTREES_NAVIGATION.filter(e => e.position === 'bas').map(e => e.id);
    expect(bas).toEqual(['reglages', 'aide']);
  });

  it('donne a chaque entree un type de panneau connu', () => {
    const types = new Set(['tiroir-droit', 'panneau-gauche', 'overlay-plein-ecran', 'lien']);
    for (const e of ENTREES_NAVIGATION as EntreeNavigation[]) {
      expect(types.has(e.type)).toBe(true);
    }
  });

  it('ouvre Assistant a droite et Campagne en plein ecran', () => {
    expect(ENTREES_NAVIGATION.find(e => e.id === 'assistant')?.type).toBe('tiroir-droit');
    expect(ENTREES_NAVIGATION.find(e => e.id === 'campagne')?.type).toBe('overlay-plein-ecran');
  });
});
