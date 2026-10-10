import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ThemeService } from '../../../core/theme/theme.service';
import { ReglagesComponent } from './reglages.component';

@Component({
  imports: [ReglagesComponent],
  template: `<mg-reglages [fond]="fond()" (choisirFond)="choix.push($event)" />`,
})
class Hote {
  readonly fond = signal('liberty');
  readonly choix: string[] = [];
}

@Component({ template: '<p data-acces>accès</p>' })
class PageAcces {}

/** Monté sous la route `carte`, comme dans l'application : les liens du back office sont RELATIFS. */
async function monter() {
  const basculer = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: ThemeService, useValue: { theme: signal('dark'), basculer } },
      provideRouter([{ path: 'carte', component: Hote }, { path: 'admin/acces', component: PageAcces }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  const instance = await harness.navigateByUrl('/carte', Hote);
  const fixture = { componentInstance: instance, whenStable: () => harness.fixture.whenStable() };
  await fixture.whenStable();
  const el = harness.fixture.nativeElement as HTMLElement;
  return { fixture, el, basculer, harness };
}

describe('ReglagesComponent — portage de SettingsOverlay.tsx', () => {
  it("cinq sections dans l'ordre de React : Modèle IA, Fond de carte, Vues sauvegardées, Apparence, Back office", async () => {
    const { el } = await monter();
    const titres = [...el.querySelectorAll('section h4')].map((h) => h.textContent?.trim());
    expect(titres).toEqual(['Modèle IA', 'Fond de carte', 'Vues sauvegardées', 'Apparence', 'Back office']);
  });

  it('« Fond de carte » : quatre fonds, le courant aria-pressed ; un clic émet son id', async () => {
    const { fixture, el } = await monter();
    const fonds = [...el.querySelectorAll<HTMLButtonElement>('[data-section="fond"] button')];
    expect(fonds.map((b) => b.textContent?.trim())).toEqual(['Standard', 'OSM', 'Clair', 'dentsu']);
    expect(fonds.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
    fonds[3].click();
    expect(fixture.componentInstance.choix).toEqual(['magelian']);
    fixture.componentInstance.fond.set('magelian');
    await fixture.whenStable();
    // Clair et MAGELIAN partagent l'URL de Positron : un seul des deux est pressé (défaut React corrigé).
    expect(fonds.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true']);
  });

  it('« Modèle IA » et « Vues sauvegardées » sont INERTES (aria-disabled, Disponible prochainement)', async () => {
    const { el } = await monter();
    const inertes = [
      ...el.querySelectorAll<HTMLButtonElement>('[data-section="modele-ia"] button'),
      ...el.querySelectorAll<HTMLButtonElement>('[data-section="vues"] button'),
    ];
    expect(inertes.map((b) => b.textContent?.trim())).toEqual(['Mistral', 'Gemini', 'Sauvegarder la vue actuelle']);
    for (const b of inertes) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('title')).toBe('Disponible prochainement');
    }
  });

  it('« Apparence » bascule le thème par ThemeService.basculer() seul', async () => {
    const { el, basculer } = await monter();
    el.querySelector<HTMLButtonElement>('[data-section="apparence"] mg-bascule-theme button')!.click();
    expect(basculer).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-section="apparence"]')!.textContent).toContain('Thème clair / sombre');
  });

  it('« Back office » : « Accès » en tête (remplace « Organisations (workspaces) » et « Utilisateurs »), puis les neuf autres liens de React, inertes', async () => {
    const { el } = await monter();
    const entrees = [...el.querySelectorAll<HTMLElement>('[data-section="back-office"] a, [data-section="back-office"] button')];
    expect(entrees.map((b) => b.textContent?.trim())).toEqual([
      'Accès', 'Import POI', 'Import Shapefile', 'Import OOH', 'IRIS crawler',
      'Radio FM/DAB+', 'Connexions API', 'Sources', 'Historique imports', 'Health check',
    ]);
    const inertes = [...el.querySelectorAll<HTMLButtonElement>('[data-section="back-office"] button')];
    expect(inertes).toHaveLength(9);
    expect(inertes.every((b) => b.getAttribute('aria-disabled') === 'true' && b.getAttribute('title') === 'Disponible prochainement')).toBe(true);
  });

  it('« Accès » est ACTIF : icône utilisateurs, lien RELATIF vers `admin/acces`, et il y navigue', async () => {
    const { el, fixture } = await monter();
    const acces = el.querySelector<HTMLAnchorElement>('[data-section="back-office"] a')!;
    expect(acces.hasAttribute('aria-disabled')).toBe(false);
    expect(acces.hasAttribute('title')).toBe(false);
    expect(acces.querySelector('mg-icone')).not.toBeNull();
    expect(acces.getAttribute('href')).toBe('/admin/acces');
    acces.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/admin/acces');
  });
});
