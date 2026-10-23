import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { FABRIQUE_GRAPHIQUE, type GraphiqueMinimal } from '../../../../graphiques/fabrique-graphique';
import { ProfilRisqueApi } from '../../../risques/data/profil-risque.api';
import { CouvertureApi } from '../../data/couverture.api';
import { CataloguePoiService } from '../../etat/catalogue-poi.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { CouvertureRayonService } from '../../etat/couverture-rayon.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { ZoneAnalyseeService } from '../../etat/zone-analysee.service';
import type { ResultatCouvertureRayon } from '../../logique/analyses/couverture-rayon';
import { OutilRayonComponent } from './outil-rayon.component';

const graphique: GraphiqueMinimal = { setOption() {}, resize() {}, dispose() {} };
const RESULTAT: ResultatCouvertureRayon = {
  cible: 'ind', rayon_max_m: 5000, n_poi: 41, poi: [[5.4, 43.3]], population_perimetre: 2_043_110,
  courbes: [
    { cle: '*', total: 900_000, points: [{ r: 1000, p: 120_000, i: 9000 }, { r: 5000, p: 900_000, i: 3000 }] },
    { cle: 'seveso_haut', total: 700_000, points: [{ r: 1000, p: 90_000, i: 7000 }, { r: 5000, p: 700_000, i: 2000 }] },
    { cle: 'seveso_bas', total: 400_000, points: [{ r: 1000, p: 50_000, i: 4000 }, { r: 5000, p: 400_000, i: 1000 }] },
  ],
  classes: [
    { valeur: 'seveso_haut', anneau_m: 500, population: 21_000 },
    { valeur: 'seveso_haut', anneau_m: 1000, population: 64_000 },
    { valeur: 'seveso_haut', anneau_m: 2000, population: 210_000 },
    { valeur: 'seveso_bas', anneau_m: 500, population: 12_000 },
  ],
  hors_classes: 1_736_110,
};

async function monter(zone: string | null = null) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  const reponse = new Subject<ResultatCouvertureRayon>();
  const rayon = vi.fn((_requete: string) => reponse);
  TestBed.configureTestingModule({
    providers: [
      CouvertureRayonService,
      { provide: CouvertureApi, useValue: { rayon } },
      { provide: EtatCarteService, useValue: { filtre: signal({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' }) } },
      { provide: ZoneAnalyseeService, useValue: { zoneId: signal(zone), siIntrouvable: () => false } },
      { provide: CataloguePoiService, useValue: {
        types: signal([{ id: 'lycee', label: 'Lycée' }]), chargerUneFois: vi.fn(),
      } },
      { provide: CouchesCarteService, useValue: { carteCourante: signal(null), inscrireEffacement: () => undefined } },
      { provide: ProfilRisqueApi, useValue: { cibles: () => of({ cibles: [] }) } },
      { provide: FABRIQUE_GRAPHIQUE, useValue: () => graphique },
      { provide: CouleursService, useValue: { palette: (j: Record<string, string>) => () => Object.fromEntries(Object.keys(j).map((k) => [k, `couleur:${k}`])) } },
    ],
  });
  const f = TestBed.createComponent(OutilRayonComponent);
  const el = f.nativeElement as HTMLElement;
  const stable = () => f.whenStable();
  const cliquer = async (sel: string) => { el.querySelector<HTMLElement>(sel)!.click(); await stable(); };
  const saisir = async (sel: string, v: string, i = 0) => {
    const champ = el.querySelectorAll<HTMLInputElement | HTMLSelectElement>(sel)[i];
    champ.value = v;
    champ.dispatchEvent(new Event(champ instanceof HTMLSelectElement ? 'change' : 'input'));
    await stable();
  };
  await stable();
  return { f, el, rayon, reponse, stable, cliquer, saisir };
}

describe('mg-outil-rayon (lot 4, T12)', () => {
  it('fermé par défaut ; déplié : type, rayon maximal 5 km, détail, anneaux, cible ; « Sur » seulement avec une zone', async () => {
    const m = await monter();
    expect(m.el.querySelector('[data-outil-rayon]')).toBeNull();
    await m.cliquer('[data-entete-outil]');
    expect(m.el.querySelector<HTMLSelectElement>('[data-categorie]')!.value).toBe('lycee');
    expect([...m.el.querySelectorAll('[data-categorie] option')].map((o) => o.textContent)).toEqual(['Lycée', 'Sites industriels à risque (ICPE)']);
    expect(m.el.querySelector<HTMLInputElement>('[data-rayon-max]')!.value).toBe('5000');
    expect(m.el.querySelector('[data-champ="aucun"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(m.el.querySelector('mg-choix-cible')).not.toBeNull();
    expect(m.el.querySelector('mg-choix-sur-zone')).toBeNull();
    TestBed.resetTestingModule();
    const z = await monter('0f8fad5b-d9cb-469f-a165-70867728950e');
    await z.cliquer('[data-entete-outil]');
    expect(z.el.querySelector('mg-choix-sur-zone [data-sur="zone"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('Seveso par sous-catégorie, profil haut [500, 1 000, 2 000] / bas [500] → requête, courbe, classes et hors classes', async () => {
    const m = await monter();
    await m.cliquer('[data-entete-outil]');
    await m.saisir('[data-categorie]', 'risque_industriel');
    await m.cliquer('[data-champ="sous_categorie"]');
    await m.cliquer('[data-ajouter-valeur]');
    await m.cliquer('[data-ajouter-valeur]');
    await m.saisir('[data-valeur]', 'seveso_haut', 0);
    await m.saisir('[data-anneaux]', '500, 1000, 2000', 0);
    await m.saisir('[data-valeur]', 'seveso_bas', 1);
    await m.saisir('[data-anneaux]', '500', 1);
    await m.cliquer('[data-calculer]');
    const p = new URLSearchParams(m.rayon.mock.calls[0][0]);
    expect(p.get('categorie')).toBe('risque_industriel');
    expect(p.getAll('valeur')).toEqual(['seveso_haut', 'seveso_bas']);
    expect(JSON.parse(p.get('profil')!)).toEqual({ seveso_haut: [500, 1000, 2000], seveso_bas: [500] });
    m.reponse.next(RESULTAT);
    await m.stable();
    const kpis = [...m.el.querySelectorAll('[data-role="kpis"] mg-kpi [data-role="libelle"]')].map((k) => k.textContent?.trim());
    expect(kpis).toEqual(['à moins de 1,0 km', 'du total à 5 km', 'POI retenus', 'au palier suivant']);
    const lignes = [...m.el.querySelectorAll('[data-classes] tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent!.replace(/\s/g, ' ').trim()));
    expect(lignes).toEqual([
      ['seveso_haut', '0-500 m', '21 000'], ['seveso_haut', '500 m-1 km', '64 000'], ['seveso_haut', '1 km-2 km', '210 000'],
      ['seveso_bas', '0-500 m', '12 000'], ['Hors classes', '1 736 110'],
    ]);
    expect(m.el.querySelector('[data-role="note"]')!.textContent).toContain('n’est pas la somme');
  });

  it('un refus de la route : sa phrase en une ligne, sans courbe', async () => {
    const m = await monter();
    await m.cliquer('[data-entete-outil]');
    await m.cliquer('[data-calculer]');
    m.reponse.error(new HttpErrorResponse({ status: 422, error: { error: 'Calcul trop lourd : réduisez le périmètre, le rayon ou retirez le détail par champ.', refus: 'calcul_trop_lourd' } }));
    await m.stable();
    expect(m.el.querySelector('[data-erreur]')!.textContent).toContain('Calcul trop lourd');
    expect(m.el.querySelector('mg-courbe-population')).toBeNull();
  });
});
