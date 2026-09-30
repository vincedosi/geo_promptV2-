import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../core/auth/auth.service';
import { ECRIRE_HTML, ThemeService } from '../core/theme/theme.service';
import { OrganisationsApi } from '../features/session/data/organisations.api';
import { ChromeHautComponent } from './chrome-haut.component';

async function rendre(ecrireHtml: boolean) {
  const session = signal<unknown>({ access_token: 'j', user: { email: 'a@exemple.test', user_metadata: {} } });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ECRIRE_HTML, useValue: ecrireHtml },
      {
        provide: AuthService,
        useValue: { session, connecte: computed(() => true), email: computed(() => 'a@exemple.test'), lireRole: async () => null, deconnecter: async () => undefined },
      },
      { provide: OrganisationsApi, useValue: { lister: () => of({ organizations: [], active_org_id: null, is_super_admin: false }), changer: () => of() } },
    ],
  });
  const f = TestBed.createComponent(ChromeHautComponent);
  await f.whenStable();
  const stable = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await f.whenStable();
  };
  return { el: f.nativeElement as HTMLElement, stable, theme: TestBed.inject(ThemeService) };
}

const bascule = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('mg-bascule-theme button')!;

describe('ChromeHautComponent — TopRightChrome.tsx porté', () => {
  const html = document.documentElement;
  beforeEach(() => {
    html.className = 'dark';
    html.removeAttribute('style');
    localStorage.clear();
  });
  afterEach(() => {
    html.className = '';
    html.removeAttribute('style');
    localStorage.clear();
  });

  it('bascule de thème PUIS badge de session, dans cet ordre (ThemeToggle, SessionBadge)', async () => {
    const { el } = await rendre(true);
    const enfants = [...el.children].map((c) => c.localName);
    expect(enfants).toEqual(['mg-bascule-theme', 'mg-badge-session']);
  });

  it('bouton de thème : soleil en sombre, lune en clair ; infobulle et nom accessibles de React', async () => {
    const { el, stable } = await rendre(true);
    expect(bascule(el).getAttribute('title')).toBe('Passer en mode clair');
    expect(bascule(el).getAttribute('aria-label')).toBe('Basculer le thème (actuel : dark)');
    const svg = bascule(el).querySelector('mg-icone svg')!;
    expect(svg.getAttribute('width')).toBe('15');
    expect(svg.getAttribute('stroke-width')).toBe('1.5');
    bascule(el).click();
    await stable();
    expect(bascule(el).getAttribute('title')).toBe('Passer en mode sombre');
    expect(bascule(el).getAttribute('aria-label')).toBe('Basculer le thème (actuel : light)');
  });

  it('en AUTONOME (ECRIRE_HTML vrai), la bascule passe par ThemeService et écrit <html>', async () => {
    const { el, stable, theme } = await rendre(true);
    const espion = vi.spyOn(theme, 'basculer');
    bascule(el).click();
    await stable();
    expect(espion).toHaveBeenCalledTimes(1);
    expect(html.classList.contains('light')).toBe(true);
    expect(html.style.colorScheme).toBe('light');
  });

  it('dans un HÔTE (ECRIRE_HTML faux), la bascule change le thème SANS toucher <html>', async () => {
    const { el, stable, theme } = await rendre(false);
    bascule(el).click();
    await stable();
    expect(theme.theme()).toBe('light');
    expect(html.className).toBe('dark');
    expect(html.getAttribute('style')).toBeNull();
  });
});
