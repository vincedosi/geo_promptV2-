import { TestBed } from '@angular/core/testing';
import type { Type } from '@angular/core';
import type { StatsSources } from '../data/sources-admin.api';
import { CarreauxComponent } from './carreaux.component';

const STATS: StatsSources = {
  success: true,
  ooh: { total: 1253 },
  poi: { total: 105014, by_category: [] },
  transport: { total: 285015, bus: 276390, train: 8258, tram: 142, metro: 225 },
  flux: { total: 1100, cerema: 1100, osm: 0 },
  carreaux: { total: 2324604 },
  iris: { total: 49448, enrichis: 49133 },
};

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

function monter<T>(type: Type<T>, stats: StatsSources | null, chargement = false) {
  const f = TestBed.createComponent(type);
  f.componentRef.setInput('stats', stats);
  f.componentRef.setInput('chargement', chargement);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('CarreauxComponent — fiche de `carreaux_filosofi` (lot 6, T19)', () => {
  it('total en `toFixed(2)` + « M » (React, C17), fiche et note d’utilisation au texte de React', () => {
    const el = monter(CarreauxComponent, STATS);
    expect(texte(el.querySelector('[data-titre]'))).toBe('Carreaux INSEE Filosofi 200m');
    expect(texte(el.querySelector('[data-total]'))).toBe('2.32M');
    expect(texte(el.querySelector('[data-unite]'))).toBe('carreaux');
    expect([...el.querySelectorAll('[data-fiche] [data-ligne]')].map(texte)).toEqual([
      'Source: INSEE Filosofi',
      'Résolution: 200m × 200m',
      'Couverture: France métropolitaine',
      'Données: population, revenus, âge, densité',
      'Table: carreaux_filosofi',
    ]);
    expect(texte(el.querySelector('[data-utilisation]'))).toBe(
      '// utilisation Jointure spatiale avec public.iris via ST_Intersects(iris.geom, carreaux.geom). '
      + 'Agrégation démographique par isochrone ou zone de chalandise.',
    );
  });

  it('sans statistiques : « Chargement... » / « Aucune donnée. »', () => {
    expect(texte(monter(CarreauxComponent, null, true).querySelector('[data-chargement]'))).toBe('Chargement...');
    expect(texte(monter(CarreauxComponent, null, false).querySelector('[data-vide]'))).toBe('Aucune donnée.');
  });
});
