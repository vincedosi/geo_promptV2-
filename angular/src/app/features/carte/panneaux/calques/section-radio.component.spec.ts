import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject } from 'rxjs';
import { FABRIQUE_POPUP } from '../../../../carte/fabrique-carte';
import { CarteFactice } from '../../../../carte/testing/carte-factice';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { RadioService } from '../../couches/radio.service';
import { RadioApi, type ReponseOptionsRadio, type RequeteEmetteurs } from '../../data/radio.api';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { COULEURS_COUVERTURE_RADIO } from '../../logique/palettes-donnees-carte';
import { SectionRadioComponent } from './section-radio.component';
import { SelectionsCalquesService } from './selections-calques.service';
import { CaptureService } from '../../etat/capture.service';

function monter() {
  const requetes: RequeteEmetteurs[] = [];
  const emetteurs = new Subject<GeoJSON.FeatureCollection>();
  const options = new Subject<ReponseOptionsRadio>();
  TestBed.configureTestingModule({
    providers: [CaptureService, 
      provideZonelessChangeDetection(), RadioService, CouchesCarteService, SelectionsCalquesService,
      {
        provide: RadioApi,
        useValue: { emetteurs: (r: RequeteEmetteurs) => { requetes.push(r); return emetteurs; }, optionsFiltre: () => options, stations: () => new Subject() },
      },
      { provide: CouleursService, useValue: { palette: () => signal({ grappes: '#4ecdc4', texteGrappes: '#050505', cernes: '#050505', choisie: '#4ecdc4' }) } },
      { provide: FABRIQUE_POPUP, useValue: () => ({}) },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  TestBed.inject(CouchesCarteService).publier(carte as unknown as maplibregl.Map);
  const fixture = TestBed.createComponent(SectionRadioComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  TestBed.inject(SelectionsCalquesService).basculerSection('radio');
  return { el, rendre, requetes, emetteurs, options, carte, radio: TestBed.inject(RadioService) };
}

const q = (el: HTMLElement, s: string) => el.querySelector(s) as HTMLElement;

describe('SectionRadioComponent', () => {
  it('éteinte : « 📻 Afficher les émetteurs » et la source, aucun réglage', async () => {
    const { el, rendre, requetes } = monter();
    await rendre();
    expect(q(el, '[data-basculer-radio]').textContent!.trim()).toBe('📻 Afficher les émetteurs');
    expect(el.querySelector('[data-reglages-radio]')).toBeNull();
    expect(el.textContent).toContain('Source : ANFR data.gouv.fr');
    expect(requetes).toEqual([]);
  });

  it('allumée : « N » émetteurs dans l’en-tête ; le filtre par radios apparaît avec les options, « Nom (cat) »', async () => {
    const { el, rendre, emetteurs, options } = monter();
    await rendre();
    q(el, '[data-basculer-radio]').click();
    await rendre();
    expect(q(el, '[data-basculer-radio]').textContent!.trim()).toBe('📻 Émetteurs visibles');
    expect(el.querySelector('[data-filtre-radios]')).toBeNull();
    options.next({ categories: [], radios_with_emetteurs: [{ id: 'r1', nom: 'NRJ', cat: 'D' }, { id: 'r2', nom: 'Locale', cat: null }] });
    emetteurs.next({ type: 'FeatureCollection', features: [1, 2, 3].map((i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [i, 45] }, properties: {} })) });
    await rendre();
    expect(q(el, '[data-compte]').textContent!.trim()).toBe('3');
    expect(q(el, '[data-filtre-radios]').textContent).toContain('Filtrer par radios(2)');
    expect(el.textContent).toContain('Exclure des categories');
  });

  it('système : pastille active ; couverture puis réglettes : la valeur suit le geste, la carte au relâchement, ZÉRO requête', async () => {
    const { el, rendre, requetes, radio, carte } = monter();
    radio.basculer();
    await rendre();
    q(el, '[data-systeme="FM"]').click();
    await rendre();
    expect(radio.systeme()).toBe('FM');
    expect(q(el, '[data-systeme="FM"]').getAttribute('aria-pressed')).toBe('true');
    (q(el, '[data-couverture]') as HTMLInputElement).click();
    await rendre();
    expect(el.textContent).toContain('Couverture estimée (approximation)');
    expect([...el.querySelectorAll('[data-couleur]')].map((b) => b.getAttribute('data-couleur'))).toEqual([...COULEURS_COUVERTURE_RADIO]);
    expect(q(el, '[data-couleur="#4ecdc4"]').getAttribute('aria-pressed')).toBe('true');
    const n = requetes.length;
    const reglette = q(el, '[data-opacite]') as HTMLInputElement;
    reglette.value = '40';
    reglette.dispatchEvent(new Event('input'));
    await rendre();
    expect(el.textContent).toContain('40%');
    expect(radio.opaciteCouverture()).toBe(15); // pas encore relâchée
    reglette.dispatchEvent(new Event('change'));
    await rendre();
    expect(radio.opaciteCouverture()).toBe(40);
    q(el, '[data-couleur="#ef4444"]').click();
    const taille = q(el, '[data-taille]') as HTMLInputElement;
    taille.value = '9';
    taille.dispatchEvent(new Event('change'));
    await rendre();
    expect(radio.taillePoints()).toBe(9);
    expect(requetes).toHaveLength(n);
    expect(carte.peintures.some((p) => p.propriete === 'fill-opacity' && p.valeur === 0.4)).toBe(true);
  });

  it('radio choisie : bandeau « 📻 Nom », la croix l’oublie ; « Recentrer France » cadre la carte', async () => {
    const { el, rendre, radio, carte } = monter();
    radio.choisirRadio('r1', 'NRJ');
    await rendre();
    expect(q(el, '[data-radio-choisie]').textContent).toContain('📻 NRJ');
    q(el, '[data-oublier-radio]').click();
    await rendre();
    expect(el.querySelector('[data-radio-choisie]')).toBeNull();
    q(el, '[data-recentrer]').click();
    expect(carte.cadrages).toHaveLength(1);
  });
});
