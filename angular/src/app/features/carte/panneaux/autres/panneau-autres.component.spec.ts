import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { FABRIQUE_POPUP } from '../../../../carte/fabrique-carte';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { OohService } from '../../couches/ooh.service';
import { PoisService } from '../../couches/pois.service';
import { RadioService } from '../../couches/radio.service';
import { CarteApi } from '../../data/carte.api';
import { RadioApi } from '../../data/radio.api';
import { AnnonceService } from '../../etat/annonce.service';
import { CaptureService } from '../../etat/capture.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { SelectionsCalquesService } from '../calques/selections-calques.service';
import { PanneauAutresComponent, TEXTE_AUTRES } from './panneau-autres.component';

/**
 * `SelectionsCalquesService` n'est PAS fourni ici : le panneau doit le fournir lui-même (sans quoi l'injection des
 * sections lèverait) — un état à lui, distinct de celui du panneau Calques.
 */
function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), CaptureService, OohService, PoisService, RadioService, EtatCarteService, CouchesCarteService, AnnonceService,
      { provide: CarteApi, useValue: { ooh: () => new Subject() } },
      { provide: RadioApi, useValue: { emetteurs: () => new Subject(), optionsFiltre: () => new Subject(), stations: () => new Subject() } },
      { provide: CouleursService, useValue: { palette: () => signal({}) } },
      { provide: FABRIQUE_POPUP, useValue: () => ({}) },
    ],
  });
  const fixture = TestBed.createComponent(PanneauAutresComponent);
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, rendre: async () => { fixture.detectChanges(); await fixture.whenStable(); } };
}

describe('PanneauAutresComponent (T11b, Vincent 14/10)', () => {
  it('en-tête en bandeau (fond surélevé, filet haut, dot teal), puis la ligne tertiaire qui dit pourquoi c’est hors du fil', async () => {
    const { el, rendre } = monter();
    await rendre();
    // Le bandeau PARTAGÉ (`mg-entete-section`, F1 de la revue finale), sous un h2 : un titre de niveau 2 pour les
    // lecteurs d'écran, dont le nom est le libellé.
    const titre = el.querySelector('h2[data-entete-autres]')!;
    expect(titre).not.toBeNull();
    expect(titre.classList).toContain('m-0');
    expect(titre.textContent!.trim()).toBe('Médias offline');
    const entete = titre.querySelector('mg-entete-section')!;
    expect(entete).not.toBeNull();
    for (const c of ['bg-elevated', 'border-t', 'border-subtle', 'flex', 'items-center', 'gap-2']) expect(entete.classList, c).toContain(c);
    // Non repliable : ni bouton ni focus, rien qui masque le titre.
    expect(entete.getAttribute('role')).toBeNull();
    expect(entete.getAttribute('tabindex')).toBeNull();
    const dot = entete.querySelector('span')!;
    for (const c of ['rounded-full', 'bg-teal']) expect(dot.classList, c).toContain(c);
    // Plus d'en-tête recopié à la main dans le panneau.
    expect(el.querySelector('[data-dot]')).toBeNull();
    const texte = el.querySelector('[data-texte-autres]')!;
    expect(texte.textContent!.trim()).toBe(TEXTE_AUTRES);
    expect(TEXTE_AUTRES).toBe('Ces données s’affichent sur la carte mais ne servent pas encore à construire des zones.');
    expect(texte.classList).toContain('text-tertiary');
  });

  it('porte les sections Panneaux OOH puis Radio, dans cet ordre, avec SON état de sections et de régies', async () => {
    const { fixture, el, rendre } = monter();
    await rendre();
    const sections = [...el.querySelectorAll('mg-section-ooh, mg-section-radio')].map((s) => s.tagName.toLowerCase());
    expect(sections).toEqual(['mg-section-ooh', 'mg-section-radio']);
    // Repliées à l'ouverture, comme dans l'ancien groupe « Médias offline » (mode overlay de `sectionsInitiales`).
    expect(el.querySelector('[data-contenu-ooh]')).toBeNull();
    expect(el.querySelector('[data-contenu-radio]')).toBeNull();
    const selections = fixture.debugElement.injector.get(SelectionsCalquesService);
    (el.querySelector('mg-section-ooh mg-entete-filtre') as HTMLElement).click();
    await rendre();
    (el.querySelector('[data-tout]') as HTMLButtonElement).click();
    await rendre();
    expect(selections.regiesOoh()).toHaveLength(8);
    expect(el.querySelector('[data-afficher-ooh]')!.textContent!.trim()).toBe('Afficher — 8 régies');
  });
});
