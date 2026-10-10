import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { PoisService } from '../../couches/pois.service';
import { CarteApi, type CategoriePoi, type CorpsPois, type ZoneData } from '../../data/carte.api';
import { AnnonceService } from '../../etat/annonce.service';
import { CataloguePoiService } from '../../etat/catalogue-poi.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { AIDE_POI, SectionPoiComponent } from './section-poi.component';
import { SelectionsCalquesService } from './selections-calques.service';

function monter() {
  const lectures: boolean[] = [];
  const corps: CorpsPois[] = [];
  const recherche = new Subject<ZoneData>();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), PoisService, CataloguePoiService, SelectionsCalquesService, EtatCarteService,
      CouchesCarteService, AnnonceService,
      {
        provide: CarteApi, useValue: {
          categories: (r: boolean) => {
            lectures.push(r);
            return of({ categories: [{ id: 'lycee', label: 'Lycées' }, 'arret_transport', 'risque_industriel'] as CategoriePoi[] });
          },
          pois: (c: CorpsPois) => { corps.push(c); return recherche; },
        },
      },
      { provide: CouleursService, useValue: { palette: () => signal({}) } },
    ],
  });
  const creer = () => {
    const fixture = TestBed.createComponent(SectionPoiComponent);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };
  const rendre = async (f: ReturnType<typeof creer>['fixture']) => { f.detectChanges(); await f.whenStable(); };
  return {
    creer, rendre, lectures, corps, recherche,
    etat: TestBed.inject(EtatCarteService), pois: TestBed.inject(PoisService), selections: TestBed.inject(SelectionsCalquesService),
  };
}

describe('SectionPoiComponent', () => {
  afterEach(() => localStorage.removeItem('genesis_density_mode'));

  it('repliée à l’ouverture (mode overlay) : aucune lecture du catalogue ; en-tête et aide de React', async () => {
    const { creer, rendre, lectures } = monter();
    const s = creer();
    await rendre(s.fixture);
    expect(s.el.textContent).toContain('Points d\'intérêt (POI)');
    expect(s.el.querySelector('[data-infobulle]')!.getAttribute('title')).toBe(AIDE_POI);
    expect(s.el.querySelector('[data-contenu-poi]')).toBeNull();
    expect(lectures).toEqual([]);
  });

  it('ouverte : catalogue lu UNE fois (même recréée), libellés capitalisés, risque_industriel retiré, compte « (2) » ; ↻ → ?refresh=1', async () => {
    const { creer, rendre, lectures, selections } = monter();
    selections.basculerSection('poi');
    const a = creer();
    await rendre(a.fixture);
    expect(a.el.querySelector('[data-nb-types]')!.textContent).toContain('(2)');
    a.fixture.destroy();
    const b = creer();
    await rendre(b.fixture);
    expect(lectures).toEqual([false]);
    (b.el.querySelector('[data-declencheur]') as HTMLButtonElement).click();
    await rendre(b.fixture);
    const ids = [...b.el.querySelectorAll('[data-element]')].map((x) => x.getAttribute('data-element'));
    expect(ids).toEqual(['lycee', 'arret_transport']);
    expect(b.el.querySelector('[data-element="arret_transport"]')!.textContent).toContain('Arret transport');
    (b.el.querySelector('[data-rafraichir]') as HTMLButtonElement).click();
    expect(lectures).toEqual([false, true]);
  });

  it('une carte par type choisi (épingle, couleur) ; « AFFICHER » envoie le corps de React (régions, départements, ville vides)', async () => {
    const { creer, rendre, etat, corps, pois, recherche } = monter();
    TestBed.inject(SelectionsCalquesService).basculerSection('poi');
    etat.poiSelectionnes.set(['lycee']);
    etat.perimetreScope.set('metro');
    const s = creer();
    await rendre(s.fixture);
    expect(s.el.querySelector('[data-carte-poi="lycee"]')).not.toBeNull();
    const couleur = s.el.querySelector('select[data-couleur]') as HTMLSelectElement;
    couleur.value = '#ff4444';
    couleur.dispatchEvent(new Event('change'));
    expect(pois.styleDe('lycee')).toEqual({ size: 'Standard', color: '#ff4444' });
    (s.el.querySelector('[data-afficher-poi]') as HTMLButtonElement).click();
    expect(corps[0]).toEqual({ poi_types: ['lycee'], scope: 'metro', regions: [], depts: [], ville: '', rayon_poi: null, poi_natures: {} });
    await rendre(s.fixture);
    expect(s.el.querySelector('[data-afficher-poi]')!.textContent).toContain('CHARGEMENT...');
    recherche.next({ pois: [], categories: {} } as unknown as ZoneData);
    await rendre(s.fixture);
    expect(s.el.querySelector('[data-erreur]')!.textContent).toContain('Aucun POI trouvé pour "lycee"');
  });

  it('« Densité » bascule le mode ; la croix d’une carte retire le type ET son épingle', async () => {
    const { creer, rendre, etat, pois } = monter();
    TestBed.inject(SelectionsCalquesService).basculerSection('poi');
    etat.poiSelectionnes.set(['lycee', 'college']);
    pois.reglerStyle('lycee', { size: 'Large' });
    const s = creer();
    await rendre(s.fixture);
    const densite = s.el.querySelector('[data-densite]') as HTMLButtonElement;
    expect(densite.textContent).toContain('◎ Densité');
    densite.click();
    await rendre(s.fixture);
    expect(pois.modeDensite()).toBe(true);
    expect(densite.textContent).toContain('◉ Densité');
    (s.el.querySelector('[data-carte-poi="lycee"] [data-retirer]') as HTMLButtonElement).click();
    expect(etat.poiSelectionnes()).toEqual(['college']);
    expect(pois.styles()['lycee']).toBeUndefined();
  });
});
