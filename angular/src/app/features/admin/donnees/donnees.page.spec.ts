import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ROUTES_ADMIN } from '../admin.routes';
import { QualiteApi } from '../qualite-donnees/data/qualite.api';

/** La VRAIE route `donnees` de ROUTES_ADMIN, sous un préfixe d'hôte, sans le garde. */
async function monter(url: string) {
  const donnees = (ROUTES_ADMIN[0].children ?? []).find((r) => r.path === 'donnees') as Route;
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), QualiteApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      provideRouter([{ path: 'hote/app/admin', children: [donnees] }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  const el = harness.fixture.nativeElement as HTMLElement;
  return { el, http: TestBed.inject(HttpTestingController), router: TestBed.inject(Router) };
}

describe('DonneesPage — page Données à onglets (lot 6, T6)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  for (const url of ['/hote/app/admin/donnees', '/hote/app/admin/donnees/qualite']) {
    it(`${url} : titre « Données », un seul onglet « Qualité », actif, et l’écran Qualité des données`, async () => {
      const { el, http, router } = await monter(url);
      expect(router.url).toBe('/hote/app/admin/donnees/qualite');
      expect(el.querySelector('mg-donnees h1')?.textContent?.trim()).toBe('Données');
      const onglets = [...el.querySelectorAll<HTMLAnchorElement>('mg-donnees [role="tab"]')];
      // Pas d'onglet « bientôt » : Sources, Importer, Historique arrivent avec leur écran.
      expect(onglets.map((a) => a.textContent!.trim())).toEqual(['Qualité']);
      expect(onglets[0].getAttribute('aria-selected')).toBe('true');
      expect(onglets[0].getAttribute('href')).toBe('/hote/app/admin/donnees/qualite');
      expect(el.querySelector('mg-donnees mg-qualite-donnees')).not.toBeNull();
      // L'écran lit ses relevés à son ouverture, comme React : UN GET.
      http.expectOne('/api/admin/qualite-donnees').flush({ verifications: [] });
    });
  }
});
