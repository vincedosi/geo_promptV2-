import { TestBed } from '@angular/core/testing';
import type { Type } from '@angular/core';
import type { StatsSources } from '../data/sources-admin.api';
import { OohComponent } from './ooh.component';
import { espaces, texte } from '../../testing/dom';

const STATS: StatsSources = {
  success: true,
  ooh: { total: 1253 },
  poi: { total: 105014, by_category: [] },
  transport: { total: 285015, bus: 276390, train: 8258, tram: 142, metro: 225 },
  flux: { total: 1100, cerema: 1100, osm: 0 },
  carreaux: { total: 2324604 },
  iris: { total: 49448, enrichis: 49133 },
};

function monter<T>(type: Type<T>, stats: StatsSources | null, chargement = false) {
  const f = TestBed.createComponent(type);
  f.componentRef.setInput('stats', stats);
  f.componentRef.setInput('chargement', chargement);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('OohComponent — panneau OOH réduit à `ooh.total` (lot 6, T19, amendement A6)', () => {
  it('rend le total fr-FR, « panneaux actifs », le titre et la table de React — et RIEN de ce que la RPC ne rend plus', () => {
    const el = monter(OohComponent, STATS);
    expect(texte(el.querySelector('[data-titre]'))).toBe('Data Lake OOH — panneaux_affichage');
    expect(espaces(texte(el.querySelector('[data-total]')))).toBe('1 253');
    expect(texte(el.querySelector('[data-unite]'))).toBe('panneaux actifs');
    expect(texte(el.querySelector('[data-table]'))).toBe('Table: panneaux_affichage (actif = true)');
    // React affichait « Régies: », « Sources: », « Villes: undefined villes couvertes », une grille Villes / Régies /
    // Types et deux blocs (types, top 20 villes), tous vides : `get_sources_stats` ne rend plus que `total` (sql/082).
    for (const absent of ['Régies', 'Sources:', 'Villes', 'Types', 'Top 20', 'undefined']) {
      expect(el.textContent, absent).not.toContain(absent);
    }
  });

  it('sans statistiques : « Chargement... » pendant la lecture, « Aucune donnée. » ensuite (textes de React)', () => {
    expect(texte(monter(OohComponent, null, true).querySelector('[data-chargement]'))).toBe('Chargement...');
    expect(texte(monter(OohComponent, null, false).querySelector('[data-vide]'))).toBe('Aucune donnée.');
  });
});
