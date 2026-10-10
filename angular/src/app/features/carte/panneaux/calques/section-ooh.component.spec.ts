import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { OohService } from '../../couches/ooh.service';
import { PoisService } from '../../couches/pois.service';
import { CarteApi, type CorpsOoh, type ZoneData } from '../../data/carte.api';
import { AnnonceService } from '../../etat/annonce.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { SectionOohComponent } from './section-ooh.component';
import { SelectionsCalquesService } from './selections-calques.service';

function monter() {
  const corps: CorpsOoh[] = [];
  const reponses = new Subject<ZoneData>();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), OohService, PoisService, SelectionsCalquesService, EtatCarteService, CouchesCarteService,
      AnnonceService,
      { provide: CarteApi, useValue: { ooh: (c: CorpsOoh) => { corps.push(c); return reponses; } } },
      { provide: CouleursService, useValue: { palette: () => signal({}) } },
    ],
  });
  const fixture = TestBed.createComponent(SectionOohComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  const selections = TestBed.inject(SelectionsCalquesService);
  selections.basculerSection('ooh');
  return { el, rendre, corps, reponses, selections };
}

describe('SectionOohComponent', () => {
  it('le texte de React, « Afficher tous les panneaux » → { regies: [] }', async () => {
    const { el, rendre, corps } = monter();
    await rendre();
    expect(el.textContent).toContain('1 434 panneaux · Brest Métropole · DECAUX, Clear Channel…');
    const bouton = el.querySelector('[data-afficher-ooh]') as HTMLButtonElement;
    expect(bouton.textContent!.trim()).toBe('Afficher tous les panneaux');
    bouton.click();
    expect(corps[0]).toEqual({ regies: [] });
  });

  it('« Tout » choisit les huit régies (bouton « Afficher — 8 régies »), « ✕ » les retire ; l’échec est dit', async () => {
    const { el, rendre, corps, reponses, selections } = monter();
    await rendre();
    (el.querySelector('[data-tout]') as HTMLButtonElement).click();
    await rendre();
    expect(el.textContent).toContain('— 8 sélectionnées');
    expect(el.querySelector('[data-afficher-ooh]')!.textContent!.trim()).toBe('Afficher — 8 régies');
    (el.querySelector('[data-afficher-ooh]') as HTMLButtonElement).click();
    expect(corps[0].regies).toHaveLength(8);
    reponses.error({ status: 0 });
    await rendre();
    expect(el.querySelector('[data-erreur]')).not.toBeNull();
    (el.querySelector('[data-aucune]') as HTMLButtonElement).click();
    expect(selections.regiesOoh()).toEqual([]);
  });
});
