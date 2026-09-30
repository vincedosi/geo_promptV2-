import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { FABRIQUE_CARTE } from '../../carte/fabrique-carte';
import { CarteFactice } from '../../carte/testing/carte-factice';
import { HttpBaseService } from '../../core/http/http-base.service';
import { CouleursService } from '../../core/theme/couleurs.service';
import { FABRIQUE_GRAPHIQUE } from '../../graphiques/fabrique-graphique';
import { CODE_PROFIL_DEFAUT, EssaiCartePage } from './essai-carte.page';

class ObservateurFactice {
  observe = vi.fn();
  disconnect = vi.fn();
}

const COURBE = {
  rayon_max_m: 10000,
  n_sites: 62,
  courbes: [
    { cle: '*', total: 1, points: [{ r: 4900, p: 111, i: 1 }, { r: 5000, p: 1234567, i: 2 }] },
    { cle: 'Toxique', total: 1, points: [{ r: 5000, p: 9, i: 1 }] },
  ],
};

async function rendre() {
  let carte!: CarteFactice;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: HttpBaseService, useValue: { url: (c: string) => `/api/${c}` } },
      { provide: FABRIQUE_CARTE, useValue: (o: never) => (carte = new CarteFactice(o)) },
      {
        provide: FABRIQUE_GRAPHIQUE,
        useValue: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
      },
      {
        provide: CouleursService,
        useValue: {
          palette: (j: Record<string, string>) =>
            signal(Object.fromEntries(Object.keys(j).map((k) => [k, `teinte-${k}`]))),
        },
      },
    ],
  });
  const f = TestBed.createComponent(EssaiCartePage);
  await f.whenStable();
  const http = TestBed.inject(HttpTestingController);
  return { f, http, carte: () => carte };
}

describe('EssaiCartePage', () => {
  afterEach(() => vi.useRealTimers());

  it('ne demande pas les sites avant le load de la carte', async () => {
    const { http } = await rendre();
    await new Promise((r) => setTimeout(r, 500));
    http.expectNone((r) => r.url.startsWith('/api/map/risques-industriels'));
    http.expectNone('/api/risques/zones/preparer');
    http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut').flush(COURBE);
  });

  it("prépare les zones d'abord, et n'ajoute la source de tuiles qu'à la réponse", async () => {
    const { http, carte } = await rendre();
    http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut').flush(COURBE);
    carte().emettre('load');
    const req = http.expectOne('/api/risques/zones/preparer');
    expect(req.request.body).toEqual({ profil: CODE_PROFIL_DEFAUT });
    expect(carte().sources.has('zones')).toBe(false);
    req.flush({ deja_construit: true });
    const zones = carte().sources.get('zones')!.spec as { tiles: string[]; minzoom: number };
    expect(zones.tiles[0]).toContain('/api/tiles/zones-risque/{z}/{x}/{y}?profil=');
    expect(zones.minzoom).toBe(4);
    const fond = carte().couches.find((c) => c.couche['id'] === 'zones-fond')!;
    expect(fond.couche['source-layer']).toBe('zones_risque');
    expect(fond.avant).toBe('sites-points');
  });

  it('demande les sites avec la bbox visible, après le calme du mouvement', async () => {
    const { http, carte } = await rendre();
    vi.useFakeTimers();
    http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut').flush(COURBE);
    carte().emettre('load');
    http.expectOne('/api/risques/zones/preparer');
    vi.advanceTimersByTime(400);
    http.expectOne('/api/map/risques-industriels?bbox=4.7500,43.3500,5.3000,43.6000&limite=800');
  });

  it('affiche le p du point r = 5000 de la courbe « * » dans le KPI', async () => {
    const { f, http } = await rendre();
    http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut').flush(COURBE);
    await f.whenStable();
    f.detectChanges();
    const kpis = [...(f.nativeElement as HTMLElement).querySelectorAll('mg-kpi')];
    const habitants = kpis.find((k) => k.textContent?.includes('Habitants à moins de 5 km'))!;
    const valeur = habitants.querySelector('[data-role="valeur"]')!.textContent!;
    expect(valeur.replace(/\s/g, '')).toBe('1234567');
  });

  it('affiche un message français quand la courbe échoue', async () => {
    const { f, http } = await rendre();
    http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut')
      .flush({ error: 'Pré-calcul absent.' }, { status: 409, statusText: 'Conflict' });
    await f.whenStable();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('Pré-calcul absent.');
  });
});
