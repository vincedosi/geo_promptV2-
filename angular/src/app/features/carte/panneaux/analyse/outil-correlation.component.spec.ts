import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { FABRIQUE_GRAPHIQUE } from '../../../../graphiques/fabrique-graphique';
import { AnalysesApi } from '../../data/analyses.api';
import { CatalogueIndicateursService } from '../../etat/catalogue-indicateurs.service';
import { OutilCorrelationComponent } from './outil-correlation.component';

const CAMPAGNES = [{ id: 'c-elections', name: 'Élections 2026' }, { id: 'c-rentree', name: null, nom: 'Rentrée' }];
const CATALOGUE = [{ indicator_code: 'rev_median', label: 'Revenu médian', famille: 'Revenus', unit: '€' }];
const resultat = (n: number) => ({
  r: 0.3149, n,
  points: Array.from({ length: n }, (_, i) => ({ code: `1300${i}`, x: 1000 * (i + 1), y: 20 + i })),
  indicateur: { code: 'rev_median', label: 'Revenu médian', unit: '€', calcule_le: '2026-10-11T08:00:00Z' },
  couverture: { cp_apparies: n, cp_campagne: 2041 },
});

async function monter() {
  const options: unknown[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), AnalysesApi, CatalogueIndicateursService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      { provide: CouleursService, useValue: { palette: (j: Record<string, string>) => signal(Object.fromEntries(Object.keys(j).map((k) => [k, `#${k}`]))) } },
      { provide: FABRIQUE_GRAPHIQUE, useValue: () => ({ setOption: (o: unknown) => options.push(o), resize: () => undefined, dispose: () => undefined }) },
    ],
  });
  const fixture = TestBed.createComponent(OutilCorrelationComponent);
  const el = fixture.nativeElement as HTMLElement;
  const http = TestBed.inject(HttpTestingController);
  const rendre = () => fixture.whenStable();
  const choisir = async (sel: string, valeur: string) => {
    const s = el.querySelector<HTMLSelectElement>(sel)!;
    s.value = valeur;
    s.dispatchEvent(new Event('change'));
    await rendre();
  };
  const ouvrir = async () => {
    await rendre();
    el.querySelector<HTMLButtonElement>('[data-entete-outil]')!.click();
    await rendre();
    http.expectOne((r) => r.url.endsWith('/api/digital/campaigns')).flush(CAMPAGNES);
    http.expectOne((r) => r.url.endsWith('/api/cibles/indicators')).flush({ indicators: CATALOGUE });
    await rendre();
  };
  const calculer = async (n: number) => {
    await choisir('[data-campagne]', 'c-elections');
    await choisir('[data-variable]', 'rev_median');
    el.querySelector<HTMLButtonElement>('[data-calculer]')!.click();
    await rendre();
    const req = http.expectOne((r) => r.url.includes('/api/analyses/correlation'));
    expect(req.request.urlWithParams).toContain('/api/analyses/correlation?campaignId=c-elections&variable=rev_median');
    req.flush(resultat(n));
    await rendre();
  };
  return { el, http, rendre, choisir, ouvrir, calculer, options };
}

describe('Outil « Corrélation » (CorrelationTool.tsx, T18)', () => {
  it('fermé : aucune requête ; premier dépliage : campagnes et catalogue, une fois', async () => {
    const m = await monter();
    await m.rendre();
    m.http.verify();
    await m.ouvrir();
    expect([...m.el.querySelectorAll('[data-campagne] option')].map((o) => o.textContent!.trim())).toEqual(['Choisir une campagne…', 'Élections 2026', 'Rentrée']);
    expect([...m.el.querySelectorAll('[data-variable] option')].map((o) => o.textContent!.trim())).toEqual(['Choisir un indicateur…', 'Revenus — Revenu médian']);
    m.el.querySelector<HTMLButtonElement>('[data-entete-outil]')!.click();
    await m.rendre();
    m.el.querySelector<HTMLButtonElement>('[data-entete-outil]')!.click();
    await m.rendre();
    m.http.verify();
  });

  it('r, sa lecture, n ET la couverture ensemble ; le nuage reçoit les points', async () => {
    const m = await monter();
    await m.ouvrir();
    expect(m.el.querySelector<HTMLButtonElement>('[data-calculer]')!.disabled).toBe(true);
    await m.calculer(40);
    expect(m.el.querySelector('[data-r]')!.textContent!.trim()).toBe('0.31');
    expect(m.el.querySelector('[data-lecture]')!.textContent!.trim()).toBe('relation positive faible');
    const details = m.el.querySelector('[data-details]')!.textContent!.replace(/[ \n\t]+/g, ' ').trim();
    expect(details).toBe('Élections 2026 n = 40 codes postaux sur 2 041 touchés par la campagne Revenu médian · calculé le 11/10/2026');
    const option = m.options.at(-1) as { series: { data: unknown[] }[] };
    expect(option.series[0].data).toHaveLength(40);
  });

  it('moins de 3 points : l’avertissement, pas de nuage', async () => {
    const m = await monter();
    await m.ouvrir();
    await m.calculer(2);
    expect(m.el.querySelector('[data-trop-peu]')!.textContent).toContain('Trop peu de codes postaux appariés');
    expect(m.el.querySelector('mg-nuage')).toBeNull();
  });

  it('changer de campagne PÉRIME le résultat', async () => {
    const m = await monter();
    await m.ouvrir();
    await m.calculer(40);
    await m.choisir('[data-campagne]', 'c-rentree');
    expect(m.el.querySelector('[data-r]')).toBeNull();
  });

  it('erreur de la route : son message', async () => {
    const m = await monter();
    await m.ouvrir();
    await m.choisir('[data-campagne]', 'c-elections');
    await m.choisir('[data-variable]', 'rev_median');
    m.el.querySelector<HTMLButtonElement>('[data-calculer]')!.click();
    await m.rendre();
    m.http.expectOne((r) => r.url.includes('/api/analyses/correlation')).flush({ error: 'Campagne introuvable.' }, { status: 404, statusText: 'Not Found' });
    await m.rendre();
    expect(m.el.querySelector('[data-erreur]')!.textContent!.trim()).toBe('Campagne introuvable.');
  });

  it('replier puis rouvrir garde les choix AFFICHÉS (revue 1 : `[selected]` par option, jamais `[value]` sur le select)', async () => {
    const m = await monter();
    await m.ouvrir();
    await m.choisir('[data-campagne]', 'c-rentree');
    await m.choisir('[data-variable]', 'rev_median');
    const entete = m.el.querySelector<HTMLButtonElement>('[data-entete-outil]')!;
    entete.click();
    await m.rendre();
    entete.click();
    await m.rendre();
    const campagne = m.el.querySelector<HTMLSelectElement>('[data-campagne]')!;
    const variable = m.el.querySelector<HTMLSelectElement>('[data-variable]')!;
    expect([campagne.value, campagne.selectedOptions[0].textContent!.trim()]).toEqual(['c-rentree', 'Rentrée']);
    expect([variable.value, variable.selectedOptions[0].textContent!.trim()]).toEqual(['rev_median', 'Revenus — Revenu médian']);
    expect(m.el.querySelector<HTMLButtonElement>('[data-calculer]')!.disabled).toBe(false);
    m.http.verify();
  });
});
