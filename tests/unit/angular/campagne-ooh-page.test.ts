import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * La campagne OOH vit et meurt avec la page carte (spec 2026-10-16-ooh-campagnes § 6.5) : `CampagneOohService` est
 * fourni par `CartePage`, que `CarteHoteComponent` RECRÉE à chaque changement d'espace — l'overlay et la couche se
 * vident d'eux-mêmes. L'ancienne lecture par régies (`OohService`) n'existe plus côté Angular.
 */
const PAGE = 'angular/src/app/features/carte/carte.page.ts';

describe('campagne OOH — fournie par la page carte', () => {
  it('CampagneOohService est dans les providers de CartePage, OohService n y est plus', () => {
    const source = readFileSync(PAGE, 'utf8');
    const providers = source.slice(source.indexOf('providers: ['), source.indexOf('templateUrl'));
    expect(providers).toContain('CampagneOohService');
    expect(providers).not.toMatch(/\bOohService\b/);
  });

  it('la fiche d un emplacement est montée par la page, hors du @for du fond', () => {
    expect(readFileSync('angular/src/app/features/carte/carte.page.html', 'utf8')).toContain('<mg-fiche-emplacement-ooh />');
  });

  it('l ancien service par régies est supprimé', () => {
    expect(existsSync('angular/src/app/features/carte/couches/ooh.service.ts')).toBe(false);
  });
});
