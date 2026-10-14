import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { PoisService } from '../../couches/pois.service';
import { CarteApi, type CategoriePoi, type CorpsPois, type ZoneData } from '../../data/carte.api';
import { AnnonceService } from '../../etat/annonce.service';
import { CataloguePoiService, DELAI_REPRISE_CATEGORIES_MS } from '../../etat/catalogue-poi.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { AIDE_POI, ActionsPoiComponent } from './actions-poi.component';

const CATALOGUE: CategoriePoi[] = [{ id: 'lycee', label: 'Lycées' }, 'arret_transport', 'risque_industriel'];

function monter(categories: () => ReturnType<CarteApi['categories']> = () => of({ categories: CATALOGUE })) {
  const lectures: boolean[] = [];
  const corps: CorpsPois[] = [];
  const recherche = new Subject<ZoneData>();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), PoisService, CataloguePoiService, EtatCarteService, CouchesCarteService, AnnonceService,
      {
        provide: CarteApi, useValue: {
          categories: (r: boolean) => { lectures.push(r); return categories(); },
          pois: (c: CorpsPois) => { corps.push(c); return recherche; },
        },
      },
      { provide: CouleursService, useValue: { palette: () => signal({}) } },
    ],
  });
  const fixture = TestBed.createComponent(ActionsPoiComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return {
    el, rendre, lectures, corps, recherche,
    etat: TestBed.inject(EtatCarteService), pois: TestBed.inject(PoisService), catalogue: TestBed.inject(CataloguePoiService),
  };
}

describe('ActionsPoiComponent — ce que ② fait des types de POI cochés', () => {
  afterEach(() => {
    localStorage.removeItem('genesis_density_mode');
    vi.useRealTimers();
  });

  it('rien de coché : la ligne « Points d’intérêt » et « ↻ », ni carte ni bouton ; il ne lit pas le catalogue lui-même', async () => {
    const { el, rendre, lectures } = monter();
    await rendre();
    expect(el.querySelector('[data-titre-poi]')!.textContent!.trim()).toBe("Points d'intérêt");
    expect(el.querySelector('[data-titre-poi]')!.getAttribute('title')).toBe(AIDE_POI);
    expect(el.querySelector('[data-rafraichir]')).not.toBeNull();
    expect(el.querySelector('[data-carte-poi]')).toBeNull();
    expect(el.querySelector('[data-afficher-poi]')).toBeNull();
    expect(lectures).toEqual([]);
  });

  it('« ↻ » relit le catalogue avec ?refresh=1', async () => {
    const { el, rendre, lectures } = monter();
    await rendre();
    el.querySelector<HTMLButtonElement>('[data-rafraichir]')!.click();
    expect(lectures).toEqual([true]);
  });

  it('une carte par type choisi (épingle, couleur) ; « Afficher les POI sur la carte » envoie le corps de React (régions, départements, ville vides)', async () => {
    const { el, rendre, etat, corps, pois, recherche } = monter();
    etat.poiSelectionnes.set(['lycee']);
    etat.perimetreScope.set('metro');
    await rendre();
    expect(el.querySelector('[data-titre-poi]')!.textContent!.trim()).toBe("Points d'intérêt — 1 sélectionné");
    expect(el.querySelector('[data-carte-poi="lycee"]')).not.toBeNull();
    const couleur = el.querySelector('select[data-couleur]') as HTMLSelectElement;
    couleur.value = '#ff4444';
    couleur.dispatchEvent(new Event('change'));
    expect(pois.styleDe('lycee')).toEqual({ size: 'Standard', color: '#ff4444' });
    const taille = el.querySelector('select[data-taille]') as HTMLSelectElement;
    taille.value = 'Large';
    taille.dispatchEvent(new Event('change'));
    expect(pois.styleDe('lycee').size).toBe('Large');
    const bouton = el.querySelector('[data-afficher-poi]') as HTMLButtonElement;
    expect(bouton.textContent!.trim()).toBe('Afficher les POI sur la carte');
    bouton.click();
    expect(corps[0]).toEqual({ poi_types: ['lycee'], scope: 'metro', regions: [], depts: [], ville: '', rayon_poi: null, poi_natures: {} });
    await rendre();
    expect(el.querySelector('[data-afficher-poi]')!.textContent!.trim()).toBe('Chargement...');
    // Un second clic pendant la recherche ne relance rien.
    (el.querySelector('[data-afficher-poi]') as HTMLButtonElement).click();
    expect(corps).toHaveLength(1);
    recherche.next({ pois: [], categories: {} } as unknown as ZoneData);
    await rendre();
    expect(el.querySelector('[data-erreur]')!.textContent).toContain('Aucun POI trouvé pour "lycee"');
  });

  it('« Densité » bascule le mode ; la croix d’une carte retire le type ET son épingle ; « 2 sélectionnés »', async () => {
    const { el, rendre, etat, pois } = monter();
    etat.poiSelectionnes.set(['lycee', 'college']);
    pois.reglerStyle('lycee', { size: 'Large' });
    await rendre();
    expect(el.querySelector('[data-titre-poi]')!.textContent!.trim()).toBe("Points d'intérêt — 2 sélectionnés");
    const densite = el.querySelector('[data-densite]') as HTMLButtonElement;
    expect(densite.textContent).toContain('◎ Densité');
    expect(densite.getAttribute('aria-pressed')).toBe('false');
    densite.click();
    await rendre();
    expect(pois.modeDensite()).toBe(true);
    expect(densite.textContent).toContain('◉ Densité');
    (el.querySelector('[data-carte-poi="lycee"] [data-retirer]') as HTMLButtonElement).click();
    expect(etat.poiSelectionnes()).toEqual(['college']);
    expect(pois.styles()['lycee']).toBeUndefined();
  });

  it('erreur du catalogue (après la reprise) : dite, et « réessayer » relit', async () => {
    vi.useFakeTimers();
    const { el, rendre, lectures, catalogue } = monter(() => throwError(() => new Error('panne')));
    catalogue.chargerUneFois();
    vi.advanceTimersByTime(DELAI_REPRISE_CATEGORIES_MS);
    await rendre();
    const erreur = el.querySelector('[data-erreur-catalogue]')!;
    expect(erreur.textContent).toContain('! Erreur chargement catégories :');
    expect(lectures).toEqual([false, false]);
    erreur.querySelector<HTMLButtonElement>('button')!.click();
    expect(lectures).toEqual([false, false, true]);
  });
});
