import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ROUTES_ADMIN } from './admin.routes';

@Component({ selector: 'mg-factice', template: '<p data-factice>fiche</p>' })
class Factice {}

const enfants = (): Route[] => ROUTES_ADMIN[0].children ?? [];

describe('ROUTES_ADMIN — page Accès (2026-10-10)', () => {
  it('`acces` porte, dans cet ordre, l\'invite, `socle`, `comptes`, puis `:id` (les chemins fixes AVANT le paramètre)', () => {
    const acces = enfants().find((r) => r.path === 'acces');
    expect(acces?.loadComponent).toBeTypeOf('function');
    expect(acces?.children?.map((r) => r.path)).toEqual(['', 'socle', 'comptes', ':id']);
  });

  it('les anciennes adresses `espaces/**` redirigent vers `acces/**` (un favori ne casse pas)', async () => {
    // Les redirections RÉELLES de ROUTES_ADMIN, montées à côté d'une page `acces` factice.
    const redirections = enfants().filter((r) => r.path?.startsWith('espaces'));
    expect(redirections.length).toBeGreaterThan(0);
    expect(redirections.every((r) => typeof r.redirectTo === 'string' && !r.loadComponent)).toBe(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{
          path: 'admin',
          children: [
            ...redirections,
            { path: 'acces', children: [{ path: '', component: Factice }, { path: ':id', component: Factice }] },
          ],
        }]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    for (const [avant, apres] of [
      ['/admin/espaces', '/admin/acces'],
      ['/admin/espaces/socle', '/admin/acces/socle'],
      ['/admin/espaces/0b6f-org', '/admin/acces/0b6f-org'],
    ]) {
      await harness.navigateByUrl(avant);
      expect(router.url, avant).toBe(apres);
    }
  });
});
