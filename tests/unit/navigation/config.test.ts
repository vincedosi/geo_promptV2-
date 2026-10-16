import { describe, it, expect } from 'vitest';
import {
  ENTREES_NAVIGATION, LARGEUR_RAIL, entreeParRaccourci,
} from '@/lib/navigation/config';

/** Fabrique un KeyboardEvent minimal sans DOM. */
function touche(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init } as KeyboardEvent;
}

describe('configuration de navigation', () => {
  // Sept entrees : cinq themes + Reglages + Aide. Il y en avait huit
  // jusqu'au 2026-10-12 — l'Assistant (Ctrl+K, chat IA) est retire avec toute
  // l'IA du code (chantier « suppression de toute l'IA », lot 5).
  it('declare exactement les sept entrees de la spec, dans l ordre', () => {
    expect(ENTREES_NAVIGATION.map(e => e.id)).toEqual([
      'campagne', 'filtre', 'calques', 'analyse', 'zones', 'reglages', 'aide',
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

  it('reconnait Alt+1 a Alt+4 et Alt+C', () => {
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
    expect(plusLong).toBeLessThanOrEqual(9);        // « Campagne », « Réglages »
    expect(LARGEUR_RAIL).toBeGreaterThanOrEqual(72); // 9 car. a 9px ≈ 58px + marges
  });

  it('place Reglages et Aide en bas, le reste en haut', () => {
    const bas = ENTREES_NAVIGATION.filter(e => e.position === 'bas').map(e => e.id);
    expect(bas).toEqual(['reglages', 'aide']);
  });

  it('ouvre Campagne en plein ecran, les autres en panneau gauche', () => {
    expect(ENTREES_NAVIGATION.filter(e => e.id !== 'campagne').every(e => e.type === 'panneau-gauche')).toBe(true);
    expect(ENTREES_NAVIGATION.find(e => e.id === 'campagne')?.type).toBe('overlay-plein-ecran');
  });

  it('rejette une combinaison de modificateurs non prevue', () => {
    expect(entreeParRaccourci(touche({ key: 'k', ctrlKey: true, altKey: true }))).toBeNull();
    expect(entreeParRaccourci(touche({ key: 'k', ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(entreeParRaccourci(touche({ key: '1', altKey: true, shiftKey: true }))).toBeNull();
    expect(entreeParRaccourci(touche({ key: 'k', ctrlKey: true, metaKey: true }))).toBeNull();
  });

  it('Ctrl+K et Meta+K sont INERTES : l Assistant est retire (2026-10-12)', () => {
    expect(entreeParRaccourci(touche({ key: 'k', ctrlKey: true }))).toBeNull();
    expect(entreeParRaccourci(touche({ key: 'k', metaKey: true }))).toBeNull();
    expect(ENTREES_NAVIGATION.some(e => e.raccourci?.startsWith('ctrl+'))).toBe(false);
  });
});
