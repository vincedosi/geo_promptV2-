import { TestBed } from '@angular/core/testing';
import type { Bandes } from '../data/profil-risque.api';
import { BandeauKpiRisqueComponent, CONSIGNE_BANDEAU, DEFINITION_BANDEAU, gainMarginal } from './bandeau-kpi-risque.component';

/** La réponse MESURÉE sur la base locale, état par défaut (plan, « Chiffres de référence »). */
const MESUREE = {
  total: 14103578, population_reference: 63783569, pop_unites_touchees: 63783571, n_codes_postaux: 1927,
} as unknown as Bandes;

async function rendre(e: { bandes: Bandes | null; sites: unknown; courbe: unknown; rayonMax: number | null }) {
  const f = TestBed.createComponent(BandeauKpiRisqueComponent);
  f.componentRef.setInput('bandes', e.bandes);
  f.componentRef.setInput('sites', e.sites);
  f.componentRef.setInput('courbe', e.courbe);
  f.componentRef.setInput('rayonMax', e.rayonMax);
  f.componentRef.setInput('maille', 'region');
  f.componentRef.setInput('libelleCible', 'Population totale');
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const kpis = [...el.querySelectorAll('mg-kpi')].map((k) => ({
    valeur: k.querySelector('[data-role="valeur"]')?.textContent?.trim(),
    libelle: k.querySelector('[data-role="libelle"]')?.textContent?.trim(),
    note: k.querySelectorAll('span')[2]?.textContent?.trim(),
  }));
  return { el, kpis };
}

describe('BandeauKpiRisqueComponent', () => {
  it('la réponse mesurée : 14 103 578, 22,1 %, 1 259 / 1 259, 1 927, —, +555 930', async () => {
    const courbe = [{ r: 4900, p: 0, i: 1 }, { r: 5000, p: 0, i: 555930 }, { r: 5100, p: 0, i: 2 }];
    const { el, kpis } = await rendre({
      bandes: MESUREE, sites: { retenus: 1259, total: 1259, par_nature: {} }, courbe, rayonMax: 5000,
    });
    // Séparateur de milliers fr-FR : espace insécable étroite, comme React (`toLocaleString('fr-FR')`).
    const n = (s: string) => s.replace(/\s/g, ' ');
    expect(kpis.map((k) => n(k.valeur ?? ''))).toEqual([
      '14 103 578', '22,1 %', '1 259 / 1 259', '1 927', '—', '+555 930',
    ]);
    expect(kpis.map((k) => k.libelle)).toEqual([
      'population totale', 'du territoire étudié', 'sites retenus', 'codes postaux touchés', 'taux d’utile', 'par 100 m de plus',
    ]);
    expect(kpis.map((k) => n(k.note ?? ''))).toEqual([
      'somme exclusive : un carreau, une classe',
      'rapporté au carroyage, pas aux 67,8 M de l’INSEE',
      'ne s’additionne pas avec la population',
      'les retenus se décident à l’étape Zones',
      'toutes les unités sont touchées à la maille région',
      'au rayon de 5 000 m',
    ]);
    const consigne = [...el.querySelectorAll('span')].find((s) => s.textContent?.trim() === CONSIGNE_BANDEAU);
    expect(consigne?.getAttribute('title')).toBe(DEFINITION_BANDEAU);
  });

  it('sans données : six « — », et la note du taux n’affirme rien avant la mesure', async () => {
    const { kpis } = await rendre({ bandes: null, sites: null, courbe: null, rayonMax: null });
    expect(kpis.map((k) => k.valeur)).toEqual(['—', '—', '—', '—', '—', '—']);
    expect(kpis[4].note).toBe('à la maille région');
    expect(kpis[5].note).toBe('aucun anneau posé');
  });

  it('le gain marginal se lit au palier le plus proche AU-DESSOUS du rayon', () => {
    const c = [{ r: 100, p: 0, i: 10 }, { r: 200, p: 0, i: 20 }, { r: 300, p: 0, i: 30 }];
    expect(gainMarginal(c, 250)).toBe(20);
    expect(gainMarginal(c, 50)).toBeNull();
    expect(gainMarginal(null, 250)).toBeNull();
  });
});
