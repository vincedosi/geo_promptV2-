import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { OngletsRoutesComponent, type OngletRoute } from './onglets-routes.component';

const ONGLETS: OngletRoute[] = [
  { chemin: 'sante', libelle: 'Santé' },
  { chemin: 'fraicheur', libelle: 'Fraîcheur des données' },
];

@Component({ selector: 'mg-ecran-factice', template: '<p data-ecran>écran</p>' })
class EcranFactice {}

/** Un cadre comme ceux de l'administration : la barre, puis l'outlet des onglets. */
@Component({
  selector: 'mg-cadre-factice',
  imports: [OngletsRoutesComponent, RouterOutlet],
  template: '<mg-onglets-routes [onglets]="onglets" libelle="Système" /><router-outlet />',
})
class CadreFactice {
  protected readonly onglets = ONGLETS;
}

async function monter(url: string) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{
        // Un préfixe d'hôte : les liens doivent rester dessous (contrat AIDA).
        path: 'hote/app/admin/systeme',
        component: CadreFactice,
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'sante' },
          { path: 'sante', component: EcranFactice },
          { path: 'fraicheur', component: EcranFactice },
        ],
      }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  const el = harness.fixture.nativeElement as HTMLElement;
  const onglets = () => [...el.querySelectorAll<HTMLAnchorElement>('[role="tab"]')];
  return { harness, el, onglets, router: TestBed.inject(Router) };
}

describe('OngletsRoutesComponent — barre d’onglets liée au routeur', () => {
  it('rend une tablist nommée et un lien RELATIF par onglet, dans l’ordre, sous le préfixe de l’hôte', async () => {
    const { el, onglets } = await monter('/hote/app/admin/systeme/sante');
    const liste = el.querySelector('[role="tablist"]')!;
    expect(liste.getAttribute('aria-label')).toBe('Système');
    expect(onglets().map((a) => a.textContent!.trim())).toEqual(['Santé', 'Fraîcheur des données']);
    expect(onglets().map((a) => a.getAttribute('href'))).toEqual([
      '/hote/app/admin/systeme/sante', '/hote/app/admin/systeme/fraicheur',
    ]);
  });

  it('chargement DIRECT sur le second onglet : lui seul est aria-selected et focalisable', async () => {
    const { onglets } = await monter('/hote/app/admin/systeme/fraicheur');
    expect(onglets().map((a) => a.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(onglets().map((a) => a.getAttribute('tabindex'))).toEqual(['-1', '0']);
  });

  it('la route vide du cadre redirige vers le premier onglet, qui devient actif', async () => {
    const { onglets, router } = await monter('/hote/app/admin/systeme');
    expect(router.url).toBe('/hote/app/admin/systeme/sante');
    expect(onglets().map((a) => a.getAttribute('aria-selected'))).toEqual(['true', 'false']);
  });

  it('un clic navigue et déplace aria-selected', async () => {
    const { harness, onglets, router } = await monter('/hote/app/admin/systeme/sante');
    onglets()[1].click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/hote/app/admin/systeme/fraicheur');
    expect(onglets().map((a) => a.getAttribute('aria-selected'))).toEqual(['false', 'true']);
  });

  it('activation MANUELLE (I-3) : les flèches déplacent le focus seulement, en boucle ; l’URL ne change pas', async () => {
    const { harness, onglets, router, el } = await monter('/hote/app/admin/systeme/sante');
    const liste = el.querySelector<HTMLElement>('[role="tablist"]')!;
    liste.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await harness.fixture.whenStable();
    expect(router.url).toBe('/hote/app/admin/systeme/sante');
    expect(el.ownerDocument.activeElement).toBe(onglets()[1]);
    // En boucle, depuis l'onglet qui a le focus : à droite du dernier, le premier.
    onglets()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await harness.fixture.whenStable();
    expect(el.ownerDocument.activeElement).toBe(onglets()[0]);
    onglets()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await harness.fixture.whenStable();
    expect(el.ownerDocument.activeElement).toBe(onglets()[1]);
    expect(router.url).toBe('/hote/app/admin/systeme/sante');
  });

  it('Entrée puis Espace sur l’onglet qui a le focus : navigation', async () => {
    const { harness, onglets, router } = await monter('/hote/app/admin/systeme/sante');
    onglets()[1].focus();
    const entree = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    onglets()[1].dispatchEvent(entree);
    await harness.fixture.whenStable();
    expect(router.url).toBe('/hote/app/admin/systeme/fraicheur');
    expect(entree.defaultPrevented).toBe(true);
    onglets()[0].focus();
    const espace = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    onglets()[0].dispatchEvent(espace);
    await harness.fixture.whenStable();
    expect(router.url).toBe('/hote/app/admin/systeme/sante');
    expect(espace.defaultPrevented).toBe(true);
  });

  it('Ctrl / Cmd / Maj + Entrée : laissé au navigateur (nouvel onglet), aucun clic synthétique', async () => {
    const { harness, onglets, router } = await monter('/hote/app/admin/systeme/sante');
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      onglets()[1].focus();
      const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...mod });
      onglets()[1].dispatchEvent(e);
      await harness.fixture.whenStable();
      expect(e.defaultPrevented).toBe(false);
      expect(router.url).toBe('/hote/app/admin/systeme/sante');
    }
  });

  it('une autre touche ne fait rien', async () => {
    const { harness, router, el } = await monter('/hote/app/admin/systeme/sante');
    el.querySelector<HTMLElement>('[role="tablist"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await harness.fixture.whenStable();
    expect(router.url).toBe('/hote/app/admin/systeme/sante');
  });

  it('variante : `cadre` par défaut ; `ecran` (sous-onglets d’un écran, T9) posée sur la liste, comportement inchangé', async () => {
    const { el } = await monter('/hote/app/admin/systeme/sante');
    expect(el.querySelector('[role="tablist"]')?.getAttribute('data-variante')).toBe('cadre');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const f = TestBed.createComponent(OngletsRoutesComponent);
    f.componentRef.setInput('onglets', ONGLETS);
    f.componentRef.setInput('libelle', 'Connexions API');
    f.componentRef.setInput('variante', 'ecran');
    await f.whenStable();
    const liste = (f.nativeElement as HTMLElement).querySelector('[role="tablist"]')!;
    expect(liste.getAttribute('data-variante')).toBe('ecran');
    expect(liste.getAttribute('aria-label')).toBe('Connexions API');
    expect(liste.querySelectorAll('[role="tab"]').length).toBe(2);
    // `large` (onglets de l'écran Radio, T16) : même liste, seul le rendu change.
    f.componentRef.setInput('variante', 'large');
    await f.whenStable();
    expect(liste.getAttribute('data-variante')).toBe('large');
    expect(liste.querySelectorAll('[role="tab"]').length).toBe(2);
  });
});
