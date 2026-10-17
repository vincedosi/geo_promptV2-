import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ROUTES_ADMIN } from './admin.routes';

@Component({ selector: 'mg-factice', template: '<p data-factice>fiche</p>' })
class Factice {}

const enfants = (): Route[] => ROUTES_ADMIN[0].children ?? [];

describe('ROUTES_ADMIN — pages Système et Données (lot 6, T6)', () => {
  it('`systeme` porte `sante` et `fraicheur`, `donnees` porte `sources` en tête ; chaque page redirige sa racine vers son premier onglet', () => {
    const systeme = enfants().find((r) => r.path === 'systeme');
    const donnees = enfants().find((r) => r.path === 'donnees');
    expect(systeme?.children?.map((r) => r.path)).toEqual(['', 'sante', 'fraicheur', 'api']);
    expect(systeme?.children?.[0].redirectTo).toBe('sante');
    expect(donnees?.children?.map((r) => r.path)).toEqual(['', 'sources', 'importer', 'historique', 'qualite']);
    // T18 : la racine mène au PREMIER onglet, « Sources » — la règle redevient vraie pour Données.
    expect(donnees?.children?.[0].redirectTo).toBe(donnees?.children?.[1].path);
    expect(systeme?.children?.[0].redirectTo).toBe(systeme?.children?.[1].path);
  });

  it('`admin`, `admin/health`, `admin/qualite-donnees`, `admin/imports`, `admin/iris-crawler`, `admin/sources` et `admin/radio` redirigent, RELATIVEMENT, sous le préfixe de l’hôte', async () => {
    const parRedirection = enfants().filter((r) => ['', 'health', 'qualite-donnees', 'imports', 'iris-crawler', 'sources', 'radio'].includes(r.path ?? '-') && r.redirectTo);
    expect(parRedirection.length).toBe(7);
    // Aucune redirection absolue : le préfixe de montage appartient au shell.
    expect(enfants().every((r) => typeof r.redirectTo !== 'string' || !r.redirectTo.startsWith('/'))).toBe(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{
          path: 'hote/app/admin',
          children: [
            ...parRedirection,
            { path: 'systeme', children: [{ path: '', pathMatch: 'full', redirectTo: 'sante' }, { path: 'sante', component: Factice }] },
            {
              path: 'donnees',
              children: [
                { path: '', pathMatch: 'full', redirectTo: 'sources' }, { path: 'sources', component: Factice },
                { path: 'qualite', component: Factice }, { path: 'historique', component: Factice },
                { path: 'importer', children: [{ path: 'iris', component: Factice }, { path: 'radio', component: Factice }] },
              ],
            },
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
      ['/hote/app/admin/imports', '/hote/app/admin/donnees/historique'],
      // T15 (A7) : l'IRIS crawler de React (`/dashboard/iris-crawler`, segment `admin/iris-crawler` par C1).
      ['/hote/app/admin/iris-crawler', '/hote/app/admin/donnees/importer/iris'],
      // T18 : `/admin/sources` de React, premier onglet de Données ; la racine de Données y mène aussi.
      ['/hote/app/admin/sources', '/hote/app/admin/donnees/sources'],
      ['/hote/app/admin/donnees', '/hote/app/admin/donnees/sources'],
      // T16 (A7) : `/admin/radio` de React, type « Radio » de l'onglet Importer.
      ['/hote/app/admin/radio', '/hote/app/admin/donnees/importer/radio'],
    ]) {
      await harness.navigateByUrl(avant);
      expect(router.url, avant).toBe(apres);
    }
  });
});

describe('ROUTES_ADMIN — onglet « Importer » de Données (lot 6, T15, amendement A7)', () => {
  it('`donnees/importer` porte UN type par écran d’import porté — `iris` (T15) puis `radio` (T16) — et sa racine mène au premier', () => {
    const donnees = enfants().find((r) => r.path === 'donnees');
    const importer = donnees?.children?.find((r) => r.path === 'importer');
    expect(importer?.loadComponent).toBeTypeOf('function');
    expect(importer?.children?.map((r) => r.path)).toEqual(['', 'iris', 'radio']);
    expect(importer?.children?.[0].redirectTo).toBe('iris');
    expect(importer?.children?.[1].loadComponent).toBeTypeOf('function');
    // Radio garde SES onglets (`page.tsx:356-366`), en sous-routes relatives : seul « Import » est porté (T16).
    const radio = importer?.children?.[2];
    expect(radio?.loadComponent).toBeTypeOf('function');
    expect(radio?.children?.map((r) => r.path)).toEqual(['', 'import']);
    expect(radio?.children?.[0].redirectTo).toBe('import');
  });
});

describe('ROUTES_ADMIN — Connexions API, onglet de Système (lot 6, T9)', () => {
  it('`systeme/api` porte les sous-onglets de React, dans l’ordre ; sa racine mène à `dv360` ; Meta et TTD disent leur fournisseur', () => {
    const systeme = enfants().find((r) => r.path === 'systeme');
    const api = systeme?.children?.find((r) => r.path === 'api');
    expect(api?.loadComponent).toBeTypeOf('function');
    expect(api?.children?.map((r) => r.path)).toEqual(['', 'dv360', 'meta', 'tiktok', 'ttd', 'logs']);
    expect(api?.children?.[0].redirectTo).toBe('dv360');
    expect(api?.children?.filter((r) => r.data).map((r) => [r.path, r.data?.['fournisseur']])).toEqual([['meta', 'meta'], ['ttd', 'ttd']]);
  });

  it('les anciennes adresses `api` et `api/<x>` redirigent, RELATIVEMENT, vers `systeme/api/**` (paramètres gardés)', async () => {
    const redirections = enfants().filter((r) => r.path === 'api' || r.path === 'api/:sous');
    expect(redirections.length).toBe(2);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{
          path: 'hote/app/admin',
          children: [
            ...redirections,
            {
              path: 'systeme',
              children: [{
                path: 'api',
                children: [{ path: '', pathMatch: 'full', redirectTo: 'dv360' }, { path: ':x', component: Factice }],
              }],
            },
          ],
        }]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    for (const [avant, apres] of [
      ['/hote/app/admin/api', '/hote/app/admin/systeme/api/dv360'],
      ['/hote/app/admin/api/ttd', '/hote/app/admin/systeme/api/ttd'],
      ['/hote/app/admin/api/dv360?oauth=success', '/hote/app/admin/systeme/api/dv360?oauth=success'],
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
