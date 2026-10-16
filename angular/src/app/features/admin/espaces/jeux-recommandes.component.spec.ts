import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { JEUX_REFERENTIELS, type JeuRecommandable, type ReponseJeuxRecommandables } from '../../carte/logique/jeux-carte';
import { EspacesApi } from './data/espaces.api';
import { JeuxRecommandesComponent } from './jeux-recommandes.component';

@Component({ imports: [JeuxRecommandesComponent], template: '<mg-jeux-recommandes [espaceId]="id()" />' })
class Hote { id = signal('e1'); }

function reponse(socleIncomplet = false): ReponseJeuxRecommandables {
  const jeux: JeuRecommandable[] = [
    ...JEUX_REFERENTIELS.map((j) => ({ ...j, recommande: j.cle === 'iris:socio-demo' })),
    { cle: 'poi:lycee', nom: 'Lycées', nature: 'poi', maille: 'point', recommande: false },
    { cle: 'poi:panneaux', nom: 'Panneaux', nature: 'poi', maille: 'point', recommande: false },
  ];
  return { jeux, socleIncomplet };
}

/** `EspacesApi` factice : chaque appel rend un `Subject` que le test émet quand il veut, et compte ses abonnés. */
class ApiFactice {
  lectures: { id: string; flux: Subject<ReponseJeuxRecommandables>; desabonne: boolean }[] = [];
  ecritures: { id: string; cles: readonly string[]; flux: Subject<{ cles: string[] }> }[] = [];
  jeuxRecommandables(id: string) {
    const flux = new Subject<ReponseJeuxRecommandables>();
    const entree = { id, flux, desabonne: false };
    this.lectures.push(entree);
    return new Observable<ReponseJeuxRecommandables>((abonne) => {
      const s = flux.subscribe(abonne);
      return () => { entree.desabonne = true; s.unsubscribe(); };
    });
  }
  enregistrerJeuxRecommandes(id: string, cles: readonly string[]) {
    const flux = new Subject<{ cles: string[] }>();
    this.ecritures.push({ id, cles, flux });
    return flux;
  }
}

async function monter() {
  const api = new ApiFactice();
  TestBed.configureTestingModule({ providers: [NotificationsService, { provide: EspacesApi, useValue: api }] });
  const fixture = TestBed.createComponent(Hote);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const notifs = TestBed.inject(NotificationsService);
  const lire = async (r: ReponseJeuxRecommandables = reponse()) => {
    api.lectures.at(-1)!.flux.next(r);
    await fixture.whenStable();
  };
  const caseDe = (cle: string) => el.querySelector<HTMLInputElement>(`[data-jeu-recommandable="${cle}"] input[type="checkbox"]`)!;
  const enregistrer = () => el.querySelector<HTMLButtonElement>('[data-enregistrer]')!;
  const annuler = () => el.querySelector<HTMLButtonElement>('[data-annuler]')!;
  return { api, fixture, el, notifs, lire, caseDe, enregistrer, annuler };
}

describe('JeuxRecommandesComponent', () => {
  it('bandeau et phrase toujours rendus ; squelette de 3 lignes pendant la lecture', async () => {
    const { el, api } = await monter();
    expect(el.querySelector('mg-entete-section')!.textContent).toContain('Sélection recommandée sur la carte');
    expect(el.textContent).toContain('Une recommandation range : elle ne donne ni ne retire aucun droit.');
    expect(el.textContent).toContain('Aucune case cochée : l’espace voit tout, déplié.');
    expect(el.querySelectorAll('[data-squelette]').length).toBe(3);
    expect(api.lectures.map((l) => l.id)).toEqual(['e1']);
  });

  it('lecture → 10 lignes (8 référentiels + 2 POI ; ni OOH ni radio depuis T11b), nature en libellé, iris:socio-demo cochée', async () => {
    const { el, lire, caseDe } = await monter();
    await lire();
    const lignes = el.querySelectorAll('[data-jeu-recommandable]');
    expect(lignes.length).toBe(10);
    expect(el.querySelector('[data-jeu-recommandable="ooh:panneaux"]')).toBeNull();
    expect(el.querySelector('[data-jeu-recommandable="radio:emetteurs"]')).toBeNull();
    expect(el.querySelectorAll('[data-squelette]').length).toBe(0);
    expect(caseDe('iris:socio-demo').checked).toBe(true);
    expect(caseDe('poi:lycee').checked).toBe(false);
    expect(caseDe('poi:lycee').getAttribute('aria-label')).toBe('Recommander Lycées');
    const lycee = el.querySelector('[data-jeu-recommandable="poi:lycee"]')!.textContent!;
    expect(lycee).toContain('Lycées');
    expect(lycee).toContain('POI');
    expect(lycee).toContain('point');
    expect(el.querySelector('[data-jeu-recommandable="iris:socio-demo"]')!.textContent).toContain('Indicateur IRIS');
    const entetes = [...el.querySelectorAll('th')].map((t) => t.textContent!.trim());
    expect(entetes).toEqual(['Jeu', 'Nature', 'Maille', 'Recommandé']);
  });

  it('« Enregistrer » désactivé au départ ; cocher poi:lycee l active ; clic → PUT dans l ordre de la liste, puis succès et relecture', async () => {
    const { api, fixture, lire, caseDe, enregistrer, annuler, notifs } = await monter();
    const ok = vi.spyOn(notifs, 'success');
    await lire();
    expect(enregistrer().disabled).toBe(true);
    expect(annuler().disabled).toBe(true);
    caseDe('poi:lycee').click();
    await fixture.whenStable();
    expect(enregistrer().disabled).toBe(false);
    expect(annuler().disabled).toBe(false);
    enregistrer().click();
    await fixture.whenStable();
    expect(api.ecritures.map((e) => [e.id, e.cles])).toEqual([['e1', ['iris:socio-demo', 'poi:lycee']]]);
    expect(enregistrer().disabled).toBe(true);
    expect(caseDe('poi:panneaux').disabled).toBe(true);
    api.ecritures[0].flux.next({ cles: ['iris:socio-demo', 'poi:lycee'] });
    await fixture.whenStable();
    expect(ok).toHaveBeenCalledWith('Sélection enregistrée');
    expect(api.lectures.length).toBe(2);
  });

  it('écriture en erreur : notification du message serveur, case toujours cochée, bouton toujours actif, aucune relecture', async () => {
    const { api, fixture, lire, caseDe, enregistrer, notifs } = await monter();
    const ko = vi.spyOn(notifs, 'error');
    await lire();
    caseDe('poi:lycee').click();
    await fixture.whenStable();
    enregistrer().click();
    await fixture.whenStable();
    api.ecritures[0].flux.error(new HttpErrorResponse({ status: 400, error: { error: 'Type de POI absent des données communes : poi:lycee.' } }));
    await fixture.whenStable();
    expect(ko).toHaveBeenCalledWith('Type de POI absent des données communes : poi:lycee.');
    expect(caseDe('poi:lycee').checked).toBe(true);
    expect(enregistrer().disabled).toBe(false);
    expect(api.lectures.length).toBe(1);
  });

  it('« Annuler les changements » → l état lu', async () => {
    const { fixture, lire, caseDe, enregistrer, annuler } = await monter();
    await lire();
    caseDe('poi:lycee').click();
    caseDe('iris:socio-demo').click();
    await fixture.whenStable();
    annuler().click();
    await fixture.whenStable();
    expect(caseDe('poi:lycee').checked).toBe(false);
    expect(caseDe('iris:socio-demo').checked).toBe(true);
    expect(enregistrer().disabled).toBe(true);
  });

  it('décocher puis recocher la même case : rien n a changé, boutons désactivés', async () => {
    const { fixture, lire, caseDe, enregistrer } = await monter();
    await lire();
    caseDe('poi:lycee').click();
    await fixture.whenStable();
    caseDe('poi:lycee').click();
    await fixture.whenStable();
    expect(enregistrer().disabled).toBe(true);
  });

  it('changer espaceId pendant une lecture : l abonnement précédent est désabonné, la réponse tardive n est pas affichée', async () => {
    const { api, fixture, el } = await monter();
    fixture.componentInstance.id.set('e2');
    await fixture.whenStable();
    expect(api.lectures.map((l) => l.id)).toEqual(['e1', 'e2']);
    expect(api.lectures[0].desabonne).toBe(true);
    api.lectures[0].flux.next(reponse());
    await fixture.whenStable();
    expect(el.querySelectorAll('[data-jeu-recommandable]').length).toBe(0);
    expect(el.querySelectorAll('[data-squelette]').length).toBe(3);
    api.lectures[1].flux.next(reponse());
    await fixture.whenStable();
    expect(el.querySelectorAll('[data-jeu-recommandable]').length).toBe(10);
  });

  it('lecture en erreur : message et « Réessayer » qui relit', async () => {
    const { api, fixture, el } = await monter();
    api.lectures[0].flux.error(new HttpErrorResponse({ status: 500, error: { error: 'Sélection recommandée indisponible.' } }));
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Sélection recommandée indisponible.');
    el.querySelector<HTMLButtonElement>('[data-reessayer]')!.click();
    await fixture.whenStable();
    expect(api.lectures.length).toBe(2);
    expect(el.querySelectorAll('[data-squelette]').length).toBe(3);
  });

  it('socle lu en partie (socleIncomplet) : erreur explicite, AUCUN moyen d enregistrer, « Réessayer » relit', async () => {
    const { api, fixture, el, lire } = await monter();
    await lire(reponse(true));
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Les types de POI des données communes n’ont pas pu être lus en entier');
    expect(el.querySelector('[data-enregistrer]')).toBeNull();
    expect(el.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    el.querySelector<HTMLButtonElement>('[data-reessayer]')!.click();
    await fixture.whenStable();
    expect(api.lectures.length).toBe(2);
    await lire();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelectorAll('[data-jeu-recommandable]').length).toBe(10);
    expect(api.ecritures.length).toBe(0);
  });
});
