import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SimulationService } from '../../etat/simulation.service';
import { type VueSimulation, construireVue } from '../../logique/simulation/vue';
import { reponseSimulation } from '../../testing/simulation.fixture';
import { BandeauCampagneComponent, CONSIGNE_CAMPAGNE, DEFINITION_CAMPAGNE } from './bandeau-campagne.component';

async function rendre(vue: VueSimulation | null, etat: 'vide' | 'chargement' | 'echec' | 'pret' = 'pret') {
  const service = { vue: signal(vue), etat: signal(etat) };
  TestBed.configureTestingModule({ providers: [{ provide: SimulationService, useValue: service }] });
  const f = TestBed.createComponent(BandeauCampagneComponent);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const tuiles = [...el.querySelectorAll('mg-kpi')].map((k) => [...k.querySelectorAll('span')].map((s) => s.textContent!.trim()));
  return { f, el, tuiles, service };
}

describe('BandeauCampagneComponent', () => {
  it('six chiffres depuis la vue, formats `pct` et `eur` de React, notes qui disent la période', async () => {
    const vue = construireVue(reponseSimulation('v2'), 'tout')!;
    const i = vue.indicateurs;
    const { tuiles, el } = await rendre(vue);
    expect(tuiles).toEqual([
      ['116,0 k', 'impressions', 'toute la campagne · jours 1 à 4'],
      [String(Math.round(i.score!)), 'alignement / 100', 'par zone, sur la population exposée'],
      ['100,0 %', 'part en zone', 'impressions sur les codes postaux achetés'],
      ['42,8 %', 'taux d’utile réel', 'impressions qui touchent des exposés'],
      ['600 €', 'dépense', 'au CPM réel de chaque partenaire'],
      [`${(i.cout_expose_touche!).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €`,
        'coût par exposé touché', `${Math.round(i.exposes_touches).toLocaleString('fr-FR')} exposés touchés au moins une fois`],
    ]);
    // L'alignement et le taux d'utile portent l'accent, comme React.
    const accents = [...el.querySelectorAll('[data-role="valeur"]')].map((v) => v.classList.contains('text-teal'));
    expect(accents).toEqual([false, true, false, true, false, false]);
    const consigne = [...el.querySelectorAll('span')].find((s) => s.textContent === CONSIGNE_CAMPAGNE)!;
    expect(consigne.getAttribute('title')).toBe(DEFINITION_CAMPAGNE);
  });

  it('période v1 : la note le dit (« semaines 1-2 · v1 · jours 1 à 2 »)', async () => {
    const { tuiles } = await rendre(construireVue(reponseSimulation('v2'), 'v1'));
    expect(tuiles[0][2]).toBe('semaines 1-2 · v1 · jours 1 à 2');
  });

  it('sans simulation : des tirets, jamais des zéros ; la note dit pourquoi', async () => {
    const { tuiles } = await rendre(null, 'pret');
    expect(tuiles.map((t) => t[0])).toEqual(['—', '—', '—', '—', '—', '—']);
    expect(tuiles[0][2]).toBe('aucune campagne simulée');
    expect(tuiles[5][2]).toBe('portée estimée par zone');
    TestBed.resetTestingModule();
    const enLecture = await rendre(null, 'chargement');
    expect(enLecture.tuiles[0][2]).toBe('lecture de la simulation');
  });
});
