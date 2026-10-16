import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ThemeService } from '../../../core/theme/theme.service';
import { ReglagesComponent } from './reglages.component';

@Component({ template: '<p data-acces>accès</p>' })
class PageAcces {}

/** Monté sous la route `carte`, comme dans l'application : les liens du back office sont RELATIFS. */
async function monter() {
  const basculer = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: ThemeService, useValue: { theme: signal('dark'), basculer } },
      provideRouter([
        { path: 'carte', component: ReglagesComponent },
        { path: 'admin/acces', component: PageAcces },
        { path: 'admin/health', component: PageAcces },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  const instance = await harness.navigateByUrl('/carte', ReglagesComponent);
  const fixture = { componentInstance: instance, whenStable: () => harness.fixture.whenStable() };
  await fixture.whenStable();
  const el = harness.fixture.nativeElement as HTMLElement;
  return { fixture, el, basculer, harness };
}

describe('ReglagesComponent — portage de SettingsOverlay.tsx', () => {
  it("deux sections : Apparence, Back office — le fond de carte a son propre outil (tiroir « Fond de carte », 2026-10-13)", async () => {
    const { el } = await monter();
    const titres = [...el.querySelectorAll('section h4')].map((h) => h.textContent?.trim());
    expect(titres).toEqual(['Apparence', 'Back office']);
    expect(el.querySelector('[data-section="fond"]')).toBeNull();
    expect(el.querySelector('[data-fond]')).toBeNull();
    expect(el.textContent).not.toContain('Mistral');
    expect(el.textContent).not.toContain('Gemini');
    expect(el.textContent).not.toContain('Sauvegarder la vue actuelle');
  });

  it('« Apparence » bascule le thème par ThemeService.basculer() seul', async () => {
    const { el, basculer } = await monter();
    el.querySelector<HTMLButtonElement>('[data-section="apparence"] mg-bascule-theme button')!.click();
    expect(basculer).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-section="apparence"]')!.textContent).toContain('Thème clair / sombre');
  });

  it('« Back office » : « Accès » en tête (remplace « Organisations (workspaces) » et « Utilisateurs »), puis les huit autres liens de React ; seules les pages non portées restent inertes', async () => {
    const { el } = await monter();
    const entrees = [...el.querySelectorAll<HTMLElement>('[data-section="back-office"] a, [data-section="back-office"] button')];
    expect(entrees.map((b) => b.textContent?.trim())).toEqual([
      'Accès', 'Import POI', 'Import Shapefile', 'IRIS crawler',
      'Radio FM/DAB+', 'Connexions API', 'Sources', 'Historique imports', 'Health check',
    ]);
    const inertes = [...el.querySelectorAll<HTMLButtonElement>('[data-section="back-office"] button')];
    expect(inertes.map((b) => b.textContent?.trim())).toEqual([
      'Import POI', 'Import Shapefile', 'IRIS crawler', 'Radio FM/DAB+', 'Connexions API', 'Sources', 'Historique imports',
    ]);
    expect(inertes.every((b) => b.getAttribute('aria-disabled') === 'true' && b.getAttribute('title') === 'Disponible prochainement')).toBe(true);
  });

  // Parcours T21 : la page Health check est portée (lot 6, T3-T4, `admin/health`) mais l'entrée restait inerte,
  // alors que la règle de ce panneau est « inerte TANT QUE la page n'est pas portée ». Cible de React : `/admin/health`.
  it('« Health check » est ACTIF : lien RELATIF vers `admin/health`, et il y navigue', async () => {
    const { el, fixture } = await monter();
    const liens = [...el.querySelectorAll<HTMLAnchorElement>('[data-section="back-office"] a')];
    const sante = liens.find((a) => a.textContent?.trim() === 'Health check')!;
    expect(sante).toBeDefined();
    expect(sante.hasAttribute('aria-disabled')).toBe(false);
    expect(sante.getAttribute('href')).toBe('/admin/health');
    sante.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/admin/health');
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
