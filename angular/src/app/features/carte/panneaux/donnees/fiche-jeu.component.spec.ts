import { HttpErrorResponse } from '@angular/common/http';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { formaterNombre } from '../../../../core/format/nombre';
import { CarteApi, type FicheJeu } from '../../data/carte.api';
import { CacheFichesJeu, FicheJeuComponent } from './fiche-jeu.component';

const FICHE_POI: FicheJeu = {
  cle: 'poi:bmw',
  referentiel: false,
  sources: [{ nom: 'Concessions BMW 2026', proprietaire: 'BMW GROUP', niveau: 'prive', effectif: 12345, importe_le: '2026-10-12T09:30:00Z' }],
};

const FICHE_CIVIQUE: FicheJeu = {
  cle: 'civique:indicateurs-cp',
  referentiel: true,
  sources: [{ nom: "Taux d'abstention (présidentielle 2022)", proprietaire: 'Bercy', niveau: 'partage', effectif: 6186, importe_le: null }],
};

@Component({
  imports: [FicheJeuComponent],
  template: '<mg-fiche-jeu [cle]="cle()" [ouvert]="ouvert()" />',
})
class Hote {
  readonly cle = signal('poi:bmw');
  readonly ouvert = signal(false);
}

function monter(reponse: () => ReturnType<CarteApi['ficheJeu']> = () => of(FICHE_POI), cache = true) {
  const ficheJeu = vi.fn(reponse);
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: CarteApi, useValue: { ficheJeu } }, ...(cache ? [CacheFichesJeu] : [])],
  });
  const fixture = TestBed.createComponent(Hote);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { el, rendre, hote: fixture.componentInstance, ficheJeu };
}

const texte = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('FicheJeuComponent — la fiche d’un jeu de ② (A-8)', () => {
  it('fermée : aucune lecture, rien de rendu', async () => {
    const { el, rendre, ficheJeu } = monter();
    await rendre();
    expect(ficheJeu).not.toHaveBeenCalled();
    expect(el.querySelector('[data-fiche]')).toBeNull();
  });

  it('une lecture à la 1ʳᵉ ouverture, aucune à la 2ᵉ ; « Propriétaire · Niveau · Effectif · Importé le », une ligne par source', async () => {
    const { el, rendre, hote, ficheJeu } = monter();
    hote.ouvert.set(true);
    await rendre();
    expect(ficheJeu).toHaveBeenCalledExactlyOnceWith('poi:bmw');
    const fiche = el.querySelector('[data-fiche]')!;
    expect(texte(fiche)).toContain('Propriétaire · Niveau · Effectif · Importé le');
    expect(fiche.querySelector('[data-referentiel]')).toBeNull();
    const sources = fiche.querySelectorAll('[data-source]');
    expect(sources).toHaveLength(1);
    expect(texte(sources[0])).toContain('Concessions BMW 2026');
    const date = new Date('2026-10-12T09:30:00Z').toLocaleDateString('fr-FR');
    expect(texte(sources[0])).toContain(texte({ textContent: `BMW GROUP · Privé · ${formaterNombre(12345)} · ${date}` } as Element));
    hote.ouvert.set(false);
    await rendre();
    expect(el.querySelector('[data-fiche]')).toBeNull();
    hote.ouvert.set(true);
    await rendre();
    expect(ficheJeu).toHaveBeenCalledTimes(1);
    expect(el.querySelectorAll('[data-source]')).toHaveLength(1);
  });

  it('référentiel : « Socle dentsu.explore, référentiel système », niveau partagé, date absente « — »', async () => {
    const { el, rendre, hote } = monter(() => of(FICHE_CIVIQUE));
    hote.cle.set('civique:indicateurs-cp');
    hote.ouvert.set(true);
    await rendre();
    expect(texte(el.querySelector('[data-referentiel]'))).toBe('Socle dentsu.explore, référentiel système');
    expect(texte(el.querySelector('[data-source]'))).toContain(`Bercy · Partagé · ${texte({ textContent: formaterNombre(6186) } as Element)} · —`);
  });

  it('404 → « Ce jeu n’est plus disponible dans cet espace. », sans « Réessayer »', async () => {
    const echec = new Subject<FicheJeu>();
    const { el, rendre, hote } = monter(() => echec.asObservable());
    hote.ouvert.set(true);
    await rendre();
    expect(el.querySelector('[data-lecture]')).not.toBeNull();
    echec.error(new HttpErrorResponse({ status: 404, statusText: 'Not Found' }));
    await rendre();
    expect(texte(el.querySelector('[data-introuvable]'))).toBe("Ce jeu n'est plus disponible dans cet espace.");
    expect(el.querySelector('[data-reessayer]')).toBeNull();
  });

  it('autre échec → message et « Réessayer », qui relit', async () => {
    let tour = 0;
    const { el, rendre, hote, ficheJeu } = monter(() => {
      tour += 1;
      const s = new Subject<FicheJeu>();
      queueMicrotask(() => (tour === 1 ? s.error(new HttpErrorResponse({ status: 500 })) : (s.next(FICHE_POI), s.complete())));
      return s.asObservable();
    });
    hote.ouvert.set(true);
    await rendre();
    await rendre();
    expect(texte(el.querySelector('[role="alert"]'))).toContain("La fiche n'a pas pu être lue.");
    el.querySelector<HTMLButtonElement>('[data-reessayer]')!.click();
    await rendre();
    await rendre();
    expect(ficheJeu).toHaveBeenCalledTimes(2);
    expect(el.querySelectorAll('[data-source]')).toHaveLength(1);
  });

  it('changer de clé abandonne la lecture en vol et relit pour la nouvelle clé', async () => {
    const lectures: Subject<FicheJeu>[] = [];
    const { rendre, hote, ficheJeu } = monter(() => {
      const s = new Subject<FicheJeu>();
      lectures.push(s);
      return s.asObservable();
    });
    hote.ouvert.set(true);
    await rendre();
    expect(lectures[0].observed).toBe(true);
    hote.cle.set('civique:indicateurs-cp');
    await rendre();
    expect(lectures[0].observed).toBe(false);
    expect(lectures[1].observed).toBe(true);
    expect(ficheJeu).toHaveBeenLastCalledWith('civique:indicateurs-cp');
    expect(ficheJeu).toHaveBeenCalledTimes(2);
  });

  it('le cache du panneau survit à la fiche : une nouvelle fiche de la même clé ne relit pas', async () => {
    const { rendre, hote, ficheJeu } = monter();
    hote.ouvert.set(true);
    await rendre();
    const cache = TestBed.inject(CacheFichesJeu);
    expect(cache.fiches.get('poi:bmw')).toEqual(FICHE_POI);
    const autre = TestBed.createComponent(Hote);
    autre.componentInstance.ouvert.set(true);
    autre.detectChanges();
    await autre.whenStable();
    expect(ficheJeu).toHaveBeenCalledTimes(1);
    expect((autre.nativeElement as HTMLElement).querySelectorAll('[data-source]')).toHaveLength(1);
  });
});
