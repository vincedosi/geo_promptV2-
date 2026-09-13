/**
 * @file tests/unit/campaigns/version-strategie.test.ts — dérive d'une
 * stratégie publiée (Tâche 19, 2026-09-13).
 *
 * Les quatre premiers cas sont VERBATIM du plan. Les suivants portent sur ce
 * qu'il ne dit pas et qui décide du comportement réel : l'ordre du résultat
 * (un bandeau d'alerte qui change d'ordre à chaque rendu est illisible), les
 * dates équivalentes écrites différemment, et les formes aberrantes — une
 * empreinte est un `jsonb` relu de la base, rien n'en garantit le contenu.
 */
import { describe, it, expect } from 'vitest';
import { zonesModifiees } from '@/lib/campaigns/version-strategie';

describe('derive d une strategie publiee', () => {
  it('ne signale rien quand aucune zone n a bouge', () => {
    expect(zonesModifiees(
      { z1: '2026-09-01T10:00:00Z' },
      { z1: '2026-09-01T10:00:00Z' },
    )).toEqual([]);
  });
  it('signale la zone dont updated_at a avance', () => {
    expect(zonesModifiees(
      { z1: '2026-09-01T10:00:00Z' },
      { z1: '2026-09-02T08:00:00Z' },
    )).toEqual(['z1']);
  });
  it('signale une zone ajoutee depuis la publication', () => {
    expect(zonesModifiees(
      { z1: '2026-09-01T10:00:00Z' },
      { z1: '2026-09-01T10:00:00Z', z2: '2026-09-03T00:00:00Z' },
    )).toEqual(['z2']);
  });
  it('signale une zone retiree depuis la publication', () => {
    expect(zonesModifiees(
      { z1: '2026-09-01T10:00:00Z', z2: '2026-09-01T10:00:00Z' },
      { z1: '2026-09-01T10:00:00Z' },
    )).toEqual(['z2']);
  });

  // ── Au-delà du plan ────────────────────────────────────────────────────
  it('rend un ordre STABLE, pour que le bandeau d alerte ne danse pas', () => {
    const publiee = { zb: 'a', za: 'a', zc: 'a' };
    const courante = { zb: 'b', za: 'b', zc: 'b' };
    expect(zonesModifiees(publiee, courante)).toEqual(['za', 'zb', 'zc']);
    // Deux appels sur les mêmes données donnent le même ordre.
    expect(zonesModifiees(publiee, courante)).toEqual(zonesModifiees(publiee, courante));
  });

  it('ne signale pas deux ecritures equivalentes de la meme date', () => {
    // Postgres rend « +00:00 », une sérialisation JS rend « Z ». Une stratégie
    // republiée pour rien coûte un aller-retour au DSP.
    expect(zonesModifiees(
      { z1: '2026-09-01T10:00:00Z' },
      { z1: '2026-09-01T10:00:00.000+00:00' },
    )).toEqual([]);
  });

  it('signale une zone dont la date devient illisible', () => {
    // On ne peut plus affirmer qu'elle n'a pas bougé : on alerte.
    expect(zonesModifiees({ z1: '2026-09-01T10:00:00Z' }, { z1: 'pas une date' })).toEqual(['z1']);
  });

  it('traite une date qui RECULE comme un changement', () => {
    // Restauration de sauvegarde, réécriture d'import : la zone n'est plus
    // celle qui a été publiée, peu importe le sens du temps.
    expect(zonesModifiees(
      { z1: '2026-09-02T10:00:00Z' },
      { z1: '2026-09-01T10:00:00Z' },
    )).toEqual(['z1']);
  });

  it('ne jette sur aucune forme aberrante et rend toujours un tableau', () => {
    const aberrations: unknown[] = [null, undefined, [], 'texte', 42, { z1: null }, { z1: 42 }];
    for (const a of aberrations) {
      for (const b of aberrations) {
        const r = zonesModifiees(
          a as Record<string, string>,
          b as Record<string, string>,
        );
        expect(Array.isArray(r)).toBe(true);
      }
    }
  });

  it('rend une liste vide quand les deux empreintes sont vides', () => {
    expect(zonesModifiees({}, {})).toEqual([]);
  });
});
