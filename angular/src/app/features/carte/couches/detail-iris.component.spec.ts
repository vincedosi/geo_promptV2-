import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { type IrisDetailData, IrisApi } from '../data/iris.api';
import { AnnonceService } from '../etat/annonce.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { IRIS_DB_COLUMNS } from '../logique/iris-colonnes';
import { DetailIrisComponent, formaterValeurIris } from './detail-iris.component';
import { IrisService } from './iris.service';

const col = (nom: string) => IRIS_DB_COLUMNS.find((c) => c.name === nom)!;

function monter() {
  const flux: Subject<IrisDetailData>[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), IrisService, EtatCarteService, CouchesCarteService, AnnonceService,
      {
        provide: IrisApi,
        useValue: {
          urlTuiles: () => '', bornes: vi.fn(),
          detail: vi.fn(() => { const s = new Subject<IrisDetailData>(); flux.push(s); return s; }),
        },
      },
      { provide: CouleursService, useValue: { palette: () => signal({ absente: '#9aa0a6', trait: '#555555' }) } },
    ],
  });
  const fixture = TestBed.createComponent(DetailIrisComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { el, rendre, flux, iris: TestBed.inject(IrisService) };
}

const DONNEES: IrisDetailData = {
  code_iris: '751010201', nom_iris: 'Saint-Germain-l’Auxerrois 2', code_commune: '75101', code_dept: '75', is_true_iris: true,
  population: 1234, pop_15_29: 210, rev_median: 41234.6, taux_chomage: 7.36, indice_gini: 0.4123, part_appartements: 98.5,
  taux_proprio: 22.1, nb_emplois: null,
};

describe('formaterValeurIris (fmtValue de IrisDetailPanel.tsx)', () => {
  it('absent, entier, %, €, flottant, booléen, texte', () => {
    expect(formaterValeurIris(col('population'), null)).toBe('—');
    expect(formaterValeurIris(col('population'), undefined)).toBe('—');
    expect(formaterValeurIris(col('population'), 12345)).toBe((12345).toLocaleString('fr-FR'));
    expect(formaterValeurIris(col('taux_chomage'), 7.36)).toBe('7.4 %');
    expect(formaterValeurIris(col('rev_median'), 41234.6)).toBe(`${(41235).toLocaleString('fr-FR')} €`);
    expect(formaterValeurIris(col('indice_gini'), 0.4123)).toBe('0.41');
    expect(formaterValeurIris(col('is_true_iris'), 1)).toBe('Oui');
    expect(formaterValeurIris(col('population'), 'abc')).toBe('abc');
  });
});

describe('DetailIrisComponent', () => {
  it('rien sans IRIS sélectionné', async () => {
    const { el, rendre } = monter();
    await rendre();
    expect(el.querySelector('[data-detail-iris]')).toBeNull();
  });

  it('chargement : en-tête au code, squelette ; puis données : nom, code, commune, département, sections', async () => {
    const { el, rendre, flux, iris } = monter();
    iris.selectionner('751010201');
    await rendre();
    expect(el.querySelector('[data-detail-iris]')).not.toBeNull();
    expect(el.querySelector('[data-nom]')!.textContent!.trim()).toBe('751010201');
    expect(el.querySelectorAll('[data-squelette-bloc]').length).toBe(4);
    // Flat total (revue 1) : ni ombre portée, ni dégradé miroitant sur le squelette.
    expect(el.querySelector('[data-detail-iris]')!.className).not.toContain('shadow');
    const styles = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    expect(styles).not.toMatch(/linear-gradient\(90deg, var\(--bg-level-2\)/);
    flux[0].next(DONNEES);
    await rendre();
    expect(el.querySelector('[data-squelette-bloc]')).toBeNull();
    expect(el.querySelector('[data-nom]')!.textContent!.trim()).toBe('Saint-Germain-l’Auxerrois 2');
    const sous = el.querySelector('[data-codes]')!.textContent!;
    expect(sous).toContain('751010201');
    expect(sous).toContain('Commune 75101');
    expect(sous).toContain('Dép. 75');
    // Sections dans l'ordre de React, une section sans aucune valeur n'apparaît pas (Emploi, CSP…).
    const titres = [...el.querySelectorAll('[data-section]')].map((s) => s.getAttribute('data-section'));
    expect(titres).toEqual(['Population', 'Âge', 'Revenus', 'Logement']);
    // Une colonne en % : barre ; ailleurs : une ligne simple.
    const chomage = el.querySelector('[data-colonne="taux_chomage"]')!;
    expect(chomage.textContent).toContain('7.4 %');
    expect((chomage.querySelector('[data-barre]') as HTMLElement).style.width).toBe('7.36%');
    expect(el.querySelector('[data-colonne="population"] [data-barre]')).toBeNull();
    expect(el.querySelector('[data-colonne="pop_0_14"]')!.textContent).toContain('—');
  });

  it('« Zone communale (non IRIS) » quand is_true_iris vaut false', async () => {
    const { el, rendre, flux, iris } = monter();
    iris.selectionner('751010201');
    flux[0].next({ ...DONNEES, is_true_iris: false });
    await rendre();
    expect(el.textContent).toContain('Zone communale (non IRIS)');
  });

  it('la croix ferme et vide le panneau', async () => {
    const { el, rendre, flux, iris } = monter();
    iris.selectionner('751010201');
    flux[0].next(DONNEES);
    await rendre();
    el.querySelector<HTMLButtonElement>('button[data-fermer]')!.click();
    await rendre();
    expect(iris.codeSelectionne()).toBeNull();
    expect(el.querySelector('[data-detail-iris]')).toBeNull();
  });

  it('échec de lecture : un message, jamais un panneau qui disparaît sans rien dire', async () => {
    const { el, rendre, flux, iris } = monter();
    iris.selectionner('751010201');
    flux[0].error(new Error('404'));
    await rendre();
    expect(el.querySelector('[data-erreur]')!.textContent).toContain('Détail indisponible');
  });
});
