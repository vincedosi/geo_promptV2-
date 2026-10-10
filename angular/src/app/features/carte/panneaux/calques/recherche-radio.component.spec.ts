import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { RadioApi, type StationRadio } from '../../data/radio.api';
import { DELAI_FERMETURE_MS, DELAI_RECHERCHE_RADIO_MS, RechercheRadioComponent } from './recherche-radio.component';

function monter() {
  const recherches: string[] = [];
  const reponses: Subject<{ stations?: StationRadio[] }>[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: RadioApi, useValue: { stations: (q: string) => { recherches.push(q); const s = new Subject<{ stations?: StationRadio[] }>(); reponses.push(s); return s; } } },
    ],
  });
  const fixture = TestBed.createComponent(RechercheRadioComponent);
  const choisies: { id: string; nom: string }[] = [];
  fixture.componentInstance.choisie.subscribe((c) => choisies.push(c));
  const el = fixture.nativeElement as HTMLElement;
  const champ = () => el.querySelector('[data-recherche-radio]') as HTMLInputElement;
  const taper = (v: string) => { champ().value = v; champ().dispatchEvent(new Event('input')); };
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { el, champ, taper, rendre, recherches, reponses, choisies };
}

describe('RechercheRadioComponent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('placeholder de React ; moins de deux caractères : aucune requête', async () => {
    const { champ, taper, rendre, recherches } = monter();
    await rendre();
    expect(champ().placeholder).toBe('Ex: NRJ, France Inter...');
    taper('N');
    vi.advanceTimersByTime(1000);
    expect(recherches).toEqual([]);
  });

  it('anti-rebond de 300 ms : une seule requête pour une frappe rapide', async () => {
    const { taper, rendre, recherches } = monter();
    await rendre();
    taper('NR');
    vi.advanceTimersByTime(DELAI_RECHERCHE_RADIO_MS - 1);
    taper('NRJ');
    vi.advanceTimersByTime(DELAI_RECHERCHE_RADIO_MS - 1);
    expect(recherches).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(recherches).toEqual(['NRJ']);
  });

  it('résultats listés avec leur catégorie ; mousedown choisit, recopie le nom, ferme ; le blur ferme après 200 ms', async () => {
    const { el, champ, taper, rendre, reponses, choisies } = monter();
    await rendre();
    taper('NRJ');
    vi.advanceTimersByTime(DELAI_RECHERCHE_RADIO_MS);
    reponses[0].next({ stations: [{ id: 'a', nom: 'NRJ', categorie_arcom: 'D' }, { id: 'b', nom: 'NRJ Lyon', categorie_arcom: null }] });
    await rendre();
    const items = [...el.querySelectorAll('[data-station]')];
    expect(items.map((b) => b.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['NRJ (D)', 'NRJ Lyon']);
    items[0].dispatchEvent(new MouseEvent('mousedown'));
    await rendre();
    expect(choisies).toEqual([{ id: 'a', nom: 'NRJ' }]);
    expect(champ().value).toBe('NRJ');
    expect(el.querySelector('[data-resultats-radio]')).toBeNull();
    champ().dispatchEvent(new Event('focus'));
    await rendre();
    expect(el.querySelector('[data-resultats-radio]')).not.toBeNull();
    champ().dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(DELAI_FERMETURE_MS);
    await rendre();
    expect(el.querySelector('[data-resultats-radio]')).toBeNull();
  });
});
