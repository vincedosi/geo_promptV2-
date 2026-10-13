import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ThemeService } from '../../../core/theme/theme.service';
import { PileEchapService } from '../etat/pile-echap.service';
import type { EtapeCarte } from '../logique/parcours';
import { BoiteOutilsComponent, droiteAnnonces, ecartOutils } from './boite-outils.component';
import { OutilsCarteService } from './outils-carte.service';

@Component({
  imports: [BoiteOutilsComponent],
  providers: [OutilsCarteService, PileEchapService],
  template: `<mg-boite-outils [droite]="droite()" [fond]="fond()" [etape]="etape()" [immersif]="immersif()"
                              (choisirFond)="fonds.push($event)" (quitterImmersif)="quitter = quitter + 1" />`,
})
class Hote {
  readonly droite = signal(10);
  readonly fond = signal('liberty');
  readonly etape = signal<EtapeCarte>('perimetre');
  readonly immersif = signal(false);
  readonly fonds: string[] = [];
  quitter = 0;
}

async function monter() {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: ThemeService, useValue: { theme: signal('dark'), basculer: vi.fn() } }],
  });
  const fixture = TestBed.createComponent(Hote);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const outils = fixture.debugElement.children[0].injector.get(OutilsCarteService);
  const bouton = (id: string) => el.querySelector<HTMLButtonElement>(`[role="toolbar"] [data-outil="${id}"]`)!;
  /** Le tiroir VISIBLE (un tiroir fermé reste monté, invisible et inerte : ruling AT-6). */
  const tiroir = () => el.querySelector<HTMLElement>('[data-tiroir-outil]:not([inert])');
  const cliquer = async (id: string) => { bouton(id).click(); await fixture.whenStable(); };
  return { fixture, el, outils, bouton, tiroir, cliquer };
}

describe('BoiteOutilsComponent — la boîte à outils de la carte (spec § 6)', () => {
  it('une barre role="toolbar" : Fond de carte, Légende, Aide, Réglages, dans cet ordre', async () => {
    const { el } = await monter();
    const barre = el.querySelector('[role="toolbar"]')!;
    const boutons = [...barre.querySelectorAll<HTMLButtonElement>('button[data-outil]')];
    expect(boutons.map((b) => b.getAttribute('data-outil'))).toEqual(['fond', 'legende', 'aide', 'reglages']);
    expect(boutons.map((b) => b.getAttribute('aria-label'))).toEqual(['Fond de carte', 'Légende', 'Aide', 'Réglages']);
    expect(el.querySelector('[data-tiroir-outil]')).toBeNull();
  });

  it('Fond : un tiroir « Fond de carte » qui porte mg-choix-fond, bouton pressé ; un fond choisi est relayé', async () => {
    const { fixture, el, bouton, tiroir, cliquer } = await monter();
    expect(bouton('fond').getAttribute('aria-pressed')).toBe('false');
    await cliquer('fond');
    expect(bouton('fond').getAttribute('aria-pressed')).toBe('true');
    expect(tiroir()!.getAttribute('aria-label')).toBe('Fond de carte');
    expect(tiroir()!.querySelector('header')!.textContent).toContain('Fond de carte');
    expect(tiroir()!.querySelector('mg-choix-fond')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('[data-fond="positron"]')!.click();
    expect(fixture.componentInstance.fonds).toEqual(['positron']);
  });

  it('Légende : une bascule, pas un tiroir', async () => {
    const { outils, bouton, tiroir, cliquer } = await monter();
    expect(bouton('legende').getAttribute('aria-pressed')).toBe('true');
    await cliquer('legende');
    expect(outils.legendeVisible()).toBe(false);
    expect(bouton('legende').getAttribute('aria-pressed')).toBe('false');
    expect(tiroir()).toBeNull();
    await cliquer('legende');
    expect(outils.legendeVisible()).toBe(true);
  });

  it('la croix du tiroir le ferme ; un seul tiroir à la fois (Aide remplace Fond)', async () => {
    const { fixture, outils, bouton, tiroir, cliquer } = await monter();
    await cliquer('fond');
    await cliquer('aide');
    expect(outils.outil()).toBe('aide');
    expect(bouton('fond').getAttribute('aria-pressed')).toBe('false');
    expect(tiroir()!.getAttribute('aria-label')).toBe('Aide');
    expect(tiroir()!.querySelector('mg-aide')).not.toBeNull();
    tiroir()!.querySelector<HTMLButtonElement>('header button[aria-label="Fermer"]')!.click();
    await fixture.whenStable();
    expect(outils.outil()).toBeNull();
    expect(tiroir()).toBeNull();
  });

  it('ruling AT-6 : le contenu est monté à la première ouverture, puis GARDÉ (invisible, inerte) — rouvrir rend la même instance', async () => {
    const { el, tiroir, cliquer } = await monter();
    expect(el.querySelector('mg-reglages')).toBeNull();
    await cliquer('reglages');
    const reglages = el.querySelector('mg-reglages');
    expect(reglages).not.toBeNull();
    await cliquer('reglages');
    expect(tiroir()).toBeNull();
    const garde = el.querySelector<HTMLElement>('[data-tiroir-outil]')!;
    expect(garde.hasAttribute('inert')).toBe(true);
    expect(garde.classList).toContain('invisible');
    expect(el.querySelector('mg-reglages')).toBe(reglages);
    await cliquer('aide');
    // Le contenu des Réglages, gardé, est inerte dans le tiroir de l'Aide.
    expect(el.querySelector('mg-reglages')!.closest('[inert]')).not.toBeNull();
    expect(el.querySelector('mg-choix-fond')).toBeNull();
    await cliquer('reglages');
    expect(el.querySelector('mg-reglages')).toBe(reglages);
    expect(el.querySelector('mg-reglages')!.closest('[inert]')).toBeNull();
  });

  it('l’Aide suit l’étape de la page', async () => {
    const { fixture, tiroir, cliquer } = await monter();
    await cliquer('aide');
    fixture.componentInstance.etape.set('zones');
    await fixture.whenStable();
    expect(tiroir()!.querySelector('[data-aide-etape] h4')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('4. Zones');
  });

  it('immersif : le bouton « quitter le mode immersif » est dans la barre, et relayé', async () => {
    const { fixture, el } = await monter();
    expect(el.querySelector('[data-quitter-immersif]')).toBeNull();
    fixture.componentInstance.immersif.set(true);
    await fixture.whenStable();
    const quitter = el.querySelector<HTMLButtonElement>('[role="toolbar"] [data-quitter-immersif]')!;
    expect(quitter.getAttribute('aria-label')).toBe('Quitter le mode immersif');
    quitter.click();
    expect(fixture.componentInstance.quitter).toBe(1);
  });

  it('droite = 620 (plan média ouvert) : la barre à 620 px du bord, le tiroir à 668 px', async () => {
    const { fixture, el, tiroir, cliquer } = await monter();
    fixture.componentInstance.droite.set(620);
    await fixture.whenStable();
    await cliquer('fond');
    expect(el.querySelector<HTMLElement>('[role="toolbar"]')!.style.right).toBe('620px');
    expect(tiroir()!.style.right).toBe('668px');
    // Plan média ouvert sur un écran étroit : le tiroir rétrécit plutôt que d'être coupé à gauche du conteneur carte.
    expect(tiroir()!.style.maxWidth).toBe('calc(100% - 678px)');
  });

  it('ecartOutils : 10 px, plus le plus large des panneaux ouverts au bord droit (plan média 600, détail IRIS 320, Street View 420) — ruling AT-3', () => {
    const rien = { planMedia: false, detailIris: false, streetView: false };
    expect(ecartOutils(rien)).toBe(10);
    expect(ecartOutils({ ...rien, planMedia: true })).toBe(620);
    expect(ecartOutils({ ...rien, detailIris: true })).toBe(340);
    expect(ecartOutils({ ...rien, streetView: true })).toBe(440);
    // Ils sont tous ancrés à droite 0 et se recouvrent : l'écart est celui du plus large, pas leur somme.
    expect(ecartOutils({ planMedia: true, detailIris: true, streetView: true })).toBe(620);
    expect(ecartOutils({ ...rien, detailIris: true, streetView: true })).toBe(440);
  });

  it('droiteAnnonces : les annonces passent à gauche de la barre, et du tiroir quand il est ouvert (ruling AT-3)', () => {
    expect(droiteAnnonces(10, false)).toBe(58);
    expect(droiteAnnonces(10, true)).toBe(386);
    expect(droiteAnnonces(620, false)).toBe(668);
  });
});
