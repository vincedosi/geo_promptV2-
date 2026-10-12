import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ROUTES_ADMIN } from './admin.routes';

@Component({ selector: 'mg-factice', template: '<p data-factice>fiche</p>' })
class Factice {}

const enfants = (): Route[] => ROUTES_ADMIN[0].children ?? [];

describe('ROUTES_ADMIN — pages Système et Données (lot 6, T6)', () => {
  it('`systeme` porte `sante` et `fraicheur`, `donnees` porte `qualite` ; chaque page redirige sa racine vers son premier onglet', () => {
    const systeme = enfants().find((r) => r.path === 'systeme');
    const donnees = enfants().find((r) => r.path === 'donnees');
    expect(systeme?.children?.map((r) => r.path)).toEqual(['', 'sante', 'fraicheur']);
    expect(systeme?.children?.[0].redirectTo).toBe('sante');
    expect(donnees?.children?.map((r) => r.path)).toEqual(['', 'qualite']);
    expect(donnees?.children?.[0].redirectTo).toBe('qualite');
  });

  it('`admin`, `admin/health` et `admin/qualite-donnees` redirigent, RELATIVEMENT, sous le préfixe de l’hôte', async () => {
    const parRedirection = enfants().filter((r) => ['', 'health', 'qualite-donnees'].includes(r.path ?? '-') && r.redirectTo);
    expect(parRedirection.length).toBe(3);
    // Aucune redirection absolue : le préfixe de montage appartient au shell.
    expect(enfants().every((r) => typeof r.redirectTo !== 'string' || !r.redirectTo.startsWith('/'))).toBe(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{
          path: 'hote/app/admin',
          children: [
            ...parRedirection,
            { path: 'systeme', children: [{ path: '', pathMatch: 'full', redirectTo: 'sante' }, { path: 'sante', component: Factice }] },
            { path: 'donnees', children: [{ path: 'qualite', component: Factice }] },
          ],
        }]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    for (const [avant, apres] of [
      ['/hote/app/admin', '/hote/app/admin/systeme/sante'],
      ['/hote/app/admin/health', '/hote/app/admin/systeme/sante'],
      ['/hote/app/admin/qualite-donnees', '/hote/app/admin/donnees/qualite'],
    ]) {
      await harness.navigateByUrl(avant);
      expect(router.url, avant).toBe(apres);
    }
  });
});

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
