import { describe, it, expect } from 'vitest';
import {
  perimetreChoisi, messageGardePerimetre, MESSAGE_PERIMETRE_MANQUANT,
  outilAdmetNational, messageRefusNational, messageGardeOutil, type OutilAnalyse,
} from '@/lib/carte/garde-perimetre';
import type { FiltreActif } from '@/lib/carte/filtre';

const dept: FiltreActif = { type: 'departement', code: '13', label: 'Bouches-du-Rhône' };
const zoneFiltre: FiltreActif = { type: 'zone', code: 'z1', label: 'Zone 1' };
const france: FiltreActif = { type: 'france', code: 'france', label: 'France entière' };

describe('garde de perimetre (spec §5)', () => {
  it('aucun filtre et aucune zone : perimetre absent', () => {
    expect(perimetreChoisi(null)).toBe(false);
    expect(perimetreChoisi(null, null)).toBe(false);
    expect(perimetreChoisi(null, undefined)).toBe(false);
  });

  it('un filtre actif (quel que soit son type) suffit', () => {
    expect(perimetreChoisi(dept)).toBe(true);
  });

  it('un filtre de type zone suffit (deja un perimetre)', () => {
    expect(perimetreChoisi(zoneFiltre)).toBe(true);
  });

  it('une zone selectionnee hors filtre suffit', () => {
    expect(perimetreChoisi(null, 'zone-id-123')).toBe(true);
  });

  it('une chaine vide ne compte pas comme une zone selectionnee', () => {
    expect(perimetreChoisi(null, '')).toBe(false);
  });

  it('messageGardePerimetre rend null quand le perimetre est choisi', () => {
    expect(messageGardePerimetre(dept)).toBeNull();
    expect(messageGardePerimetre(null, 'zone-id')).toBeNull();
  });

  it('messageGardePerimetre rend le message exact (verbatim) de la spec quand rien n est choisi', () => {
    expect(messageGardePerimetre(null)).toBe(MESSAGE_PERIMETRE_MANQUANT);
    expect(messageGardePerimetre(null)).toBe('Choisissez un périmètre (filtre ou zone) avant de lancer un calcul');
  });

  it('le message verbatim ne porte pas de point final (la spec n en portait pas)', () => {
    expect(MESSAGE_PERIMETRE_MANQUANT.endsWith('.')).toBe(false);
  });
});

// Le cablage reel de cette garde sur les cinq outils du panneau Analyse est
// verifie structurellement par tests/unit/carte/panneau-analyse-garde.test.ts
// (round 2 de correction, Tache 7) — voir l'en-tete de garde-perimetre.ts
// pour pourquoi une fonction "lancementsAutorises" testee ici a ete retiree :
// elle n'etait appelee nulle part en production.

// ─────────────────────────────────────────────────────────────────────────
// Refus explicite du perimetre national — spec-filtre-france.md §3 (2026-09-15)
// Verification #3 demandee : chaque outil lourd refuse, le score composite
// accepte, couvert ici sur la fonction PURE (le cablage reel des cinq outils
// est verifie structurellement par panneau-analyse-garde.test.ts).
// ─────────────────────────────────────────────────────────────────────────
const OUTILS_LOURDS: OutilAnalyse[] = [
  'voronoi', 'bataille_v1', 'bataille_v2', 'application_bataille', 'clustering',
];

describe('outilAdmetNational — seul le score composite admet la France entiere', () => {
  it.each(OUTILS_LOURDS)('%s REFUSE le perimetre national', (outil) => {
    expect(outilAdmetNational(outil)).toBe(false);
  });

  it('score_composite ADMET le perimetre national (159 ms mesures sur 6 187 CP)', () => {
    expect(outilAdmetNational('score_composite')).toBe(true);
  });
});

describe('messageRefusNational — nomme l outil et propose la suite', () => {
  it.each(OUTILS_LOURDS)('rend un message non nul pour %s', (outil) => {
    const msg = messageRefusNational(outil);
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/France entière/);
    expect(msg).toMatch(/région ou un département/);
  });

  it('le message du Voronoi correspond au verbatim de la spec', () => {
    expect(messageRefusNational('voronoi')).toBe(
      'Le Voronoï ne peut pas être calculé sur la France entière — choisissez une région ou un département.',
    );
  });

  it('rend null pour le score composite', () => {
    expect(messageRefusNational('score_composite')).toBeNull();
  });
});

describe('messageGardeOutil — combine absence de perimetre ET refus national', () => {
  it('aucun perimetre : le message generique prime, quel que soit l outil', () => {
    expect(messageGardeOutil('voronoi', null)).toBe(MESSAGE_PERIMETRE_MANQUANT);
    expect(messageGardeOutil('score_composite', null)).toBe(MESSAGE_PERIMETRE_MANQUANT);
  });

  it('un perimetre regional/departemental : jamais bloque, quel que soit l outil', () => {
    expect(messageGardeOutil('voronoi', dept)).toBeNull();
    expect(messageGardeOutil('clustering', zoneFiltre)).toBeNull();
  });

  it.each(OUTILS_LOURDS)('perimetre france + %s lourd : refuse avec un message specifique', (outil) => {
    const msg = messageGardeOutil(outil, france);
    expect(msg).not.toBeNull();
    expect(msg).not.toBe(MESSAGE_PERIMETRE_MANQUANT);
  });

  it('perimetre france + score composite : jamais bloque', () => {
    expect(messageGardeOutil('score_composite', france)).toBeNull();
  });
});
