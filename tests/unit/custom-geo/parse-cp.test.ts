/**
 * @file tests/unit/custom-geo/parse-cp.test.ts — parseur de liste de codes
 * postaux (Tâche 16, 2026-09-13).
 *
 * Les cinq premiers cas sont VERBATIM du plan. Les suivants couvrent ce qu'un
 * collage réel apporte : un export tableur avec des guillemets, un fichier
 * Windows en CRLF, un BOM UTF-8, et le piège que CLAUDE.md signale
 * explicitement — les espaces invisibles des CSV INSEE.
 */
import { describe, it, expect } from 'vitest';
import { parserCodesPostaux } from '@/lib/custom-geo/parse-cp';

describe('parseur de liste de CP', () => {
  it('accepte virgule, point-virgule, espace et retour ligne', () => {
    expect(parserCodesPostaux('75001,75002; 75003\n75004').codes)
      .toEqual(['75001', '75002', '75003', '75004']);
  });
  it('conserve le zero initial du 01 et de la Corse', () => {
    expect(parserCodesPostaux('01000 20000').codes).toEqual(['01000', '20000']);
  });
  it('dedoublonne en conservant l ordre', () => {
    expect(parserCodesPostaux('75001 75001 75002').codes).toEqual(['75001', '75002']);
  });
  it('signale les entrees invalides sans faire echouer le lot', () => {
    const r = parserCodesPostaux('75001 ABCDE 7500');
    expect(r.codes).toEqual(['75001']);
    expect(r.rejetes).toEqual(['ABCDE', '7500']);
  });
  it('applique trim — les CSV INSEE portent des espaces invisibles', () => {
    expect(parserCodesPostaux(' 75001 \t').codes).toEqual(['75001']);
  });

  // ── Ce qu'un collage réel apporte ───────────────────────────────────────
  it('survit a un fichier Windows en CRLF', () => {
    expect(parserCodesPostaux('75001\r\n75002\r\n').codes).toEqual(['75001', '75002']);
  });
  it('retire les guillemets d un export tableur', () => {
    expect(parserCodesPostaux('"75001";"75002"').codes).toEqual(['75001', '75002']);
  });
  it('retire le BOM UTF-8 d un fichier depose', () => {
    expect(parserCodesPostaux('﻿75001').codes).toEqual(['75001']);
  });
  it('retire les espaces insecables, que les copier-coller web apportent', () => {
    // U+00A0 et U+202F : invisibles a l ecran, fatals a une comparaison.
    expect(parserCodesPostaux('75001  75002 ').codes).toEqual(['75001', '75002']);
  });
  it('rejette un code a six chiffres plutot que de le tronquer', () => {
    const r = parserCodesPostaux('750011');
    expect(r.codes).toEqual([]);
    expect(r.rejetes).toEqual(['750011']);
  });
  it('rend des listes vides sur une entree vide, sans jeter', () => {
    for (const entree of ['', '   ', '\n\n', ';;;']) {
      const r = parserCodesPostaux(entree);
      expect(r.codes).toEqual([]);
      expect(r.rejetes).toEqual([]);
    }
  });
  it('dedoublonne aussi les rejets', () => {
    expect(parserCodesPostaux('ABC ABC').rejetes).toEqual(['ABC']);
  });
  it('borne le nombre de rejets rapportes sans perdre leur compte', () => {
    const entree = Array.from({ length: 500 }, (_, i) => `X${i}`).join(' ');
    const r = parserCodesPostaux(entree);
    expect(r.rejetes.length).toBeLessThanOrEqual(50);
    expect(r.nRejetes).toBe(500);
  });
});
