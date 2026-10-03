import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import maplibregl from 'maplibre-gl';
import { provideRouter } from '@angular/router';
import { FABRIQUE_CARTE } from '../../carte/fabrique-carte';
import { CarteFactice } from '../../carte/testing/carte-factice';
import { ConfigService } from '../../core/config/config.service';
import { CouleursService } from '../../core/theme/couleurs.service';
import { FABRIQUE_GRAPHIQUE } from '../../graphiques/fabrique-graphique';
import { ZonesRisqueApi } from '../risques/data/zones-risque.api';
import {
  CODE_PROFIL_DEFAUT, EssaiCartePage, PROFIL_DEFAUT, basculerLiaison, codeDuProfil, libelleRayon, poserBord,
} from './essai-carte.page';

class ObservateurFactice {
  observe = vi.fn();
  disconnect = vi.fn();
}

const COURBE = {
  rayon_max_m: 10000,
  n_sites: 62,
  n_departements: 3,
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
      provideHttpClient(), provideHttpClientTesting(), provideRouter([]), ZonesRisqueApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
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
    expect(zones.tiles[0]).toMatch(/^https?:\/\/[^/]+\/api\/tiles\/zones-risque\/\{z\}\/\{x\}\/\{y\}\?profil=/);
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
    const habitants = kpis.find((k) => k.textContent?.includes('habitants à moins de 5 km'))!;
    const valeur = habitants.querySelector('[data-role="valeur"]')!.textContent!;
    expect(valeur.replace(/\s/g, '')).toBe('1234567');
  });

  it('le chiffre du bandeau est estompé tant que la courbe charge, puis net (valeurs périmées)', async () => {
    const { f, http } = await rendre();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('mg-bandeau-kpi')).not.toBeNull();
    const kpi = () => el.querySelector<HTMLElement>('mg-bandeau-kpi mg-kpi')!;
    f.detectChanges();
    expect(kpi().style.opacity).toBe('0.42');
    http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut').flush(COURBE);
    await f.whenStable();
    f.detectChanges();
    expect(kpi().style.opacity).toBe('1');
  });

  it('annule la courbe et la préparation des zones encore en vol quand la page est détruite', async () => {
    const { f, http, carte } = await rendre();
    const courbe = http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut');
    carte().emettre('load');
    const preparer = http.expectOne('/api/risques/zones/preparer');
    expect(courbe.cancelled).toBe(false);
    expect(preparer.cancelled).toBe(false);
    f.destroy();
    expect(courbe.cancelled).toBe(true);
    expect(preparer.cancelled).toBe(true);
  });

  it('affiche un message français quand la courbe échoue, et garde le bandeau avec des tuiles « — »', async () => {
    const { f, http } = await rendre();
    http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut')
      .flush({ error: 'Pré-calcul absent.' }, { status: 409, statusText: 'Conflict' });
    await f.whenStable();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Pré-calcul absent.');
    const valeurs = [...el.querySelectorAll('mg-bandeau-kpi mg-kpi [data-role="valeur"]')].map((v) => v.textContent?.trim());
    expect(valeurs).toEqual(['—', '—']);
  });

  describe('squelette de l’écran risque', () => {
    const el = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;

    it('pose en-tête, fil d’étapes sur ② Rayon, barre commune, puis progression et bandeau, dans cet ordre', async () => {
      const { f } = await rendre();
      f.detectChanges();
      const racine = el(f).firstElementChild!;
      const enfants = [...racine.children].map((c) => c.tagName.toLowerCase());
      expect(enfants[0]).toBe('header');
      expect(enfants.indexOf('mg-barre-progression')).toBeGreaterThan(0);
      expect(enfants.indexOf('mg-barre-progression')).toBeLessThan(enfants.indexOf('mg-bandeau-kpi'));
      const courante = el(f).querySelector('mg-fil-etapes [aria-current="step"]')!;
      expect(courante.textContent).toContain('Rayon');
      expect(el(f).querySelector('header')!.textContent).toContain('PPRT à part · 7 classes');
    });

    it('panneau à gauche, 480 px par défaut ; « Carte seule » le replie sans le démonter', async () => {
      const { f } = await rendre();
      f.detectChanges();
      const panneau = el(f).querySelector<HTMLElement>('aside')!;
      expect(panneau.style.width).toBe('480px');
      const bouton = [...el(f).querySelectorAll('button')].find((b) => b.textContent?.includes('Carte seule'))!;
      bouton.click();
      f.detectChanges();
      expect(el(f).querySelector('aside')).toBe(panneau);
      expect(panneau.style.width).toBe('0px');
      expect(panneau.style.visibility).toBe('hidden');
      expect(el(f).querySelector('[role="separator"]')).toBeNull();
    });

    it('la poignée règle la largeur, bornée entre 320 et 900 px', async () => {
      const { f } = await rendre();
      f.detectChanges();
      const poignee = el(f).querySelector<HTMLElement>('[role="separator"]')!;
      const evt = (type: string, x: number) => Object.assign(new Event(type), { clientX: x, pointerId: 1 });
      poignee.dispatchEvent(evt('pointerdown', 500));
      poignee.dispatchEvent(evt('pointermove', 2000));
      f.detectChanges();
      expect(el(f).querySelector<HTMLElement>('aside')!.style.width).toBe('900px');
      poignee.dispatchEvent(evt('pointermove', 0));
      f.detectChanges();
      expect(el(f).querySelector<HTMLElement>('aside')!.style.width).toBe('320px');
      poignee.dispatchEvent(evt('pointerup', 0));
      poignee.dispatchEvent(evt('pointermove', 600));
      f.detectChanges();
      expect(el(f).querySelector<HTMLElement>('aside')!.style.width).toBe('320px');
    });

    it('le curseur du panneau relit la courbe en mémoire, sans aucun appel', async () => {
      const { f, http } = await rendre();
      http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut').flush(COURBE);
      await f.whenStable();
      f.detectChanges();
      const curseur = el(f).querySelector<HTMLInputElement>('aside input[type="range"]')!;
      curseur.value = '5000';
      curseur.dispatchEvent(new Event('input'));
      f.detectChanges();
      const premier = el(f).querySelector('aside mg-kpi [data-role="valeur"]')!.textContent!;
      expect(premier.replace(/\s/g, '')).toBe('1234567');
      expect(el(f).querySelector('aside')!.textContent).toContain('à moins de 5,0 km');
      http.verify();
    });

    it('une réglette de la barre ne recalcule QU’AU RELÂCHEMENT : une préparation, puis les nouvelles tuiles', async () => {
      const { f, http, carte } = await rendre();
      http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut').flush(COURBE);
      carte().emettre('load');
      http.expectOne('/api/risques/zones/preparer').flush({});
      f.detectChanges();
      const reglette = el(f).querySelector<HTMLInputElement>('mg-reglette input[type="range"]')!;
      for (const v of ['5100', '5600', '6000']) {
        reglette.value = v;
        reglette.dispatchEvent(new Event('input'));
      }
      http.expectNone('/api/risques/zones/preparer');
      reglette.dispatchEvent(new Event('pointerup'));
      f.detectChanges();
      const req = http.expectOne('/api/risques/zones/preparer');
      expect(req.request.body).toEqual({ profil: 'h1000.2000.6000_b500.1000_a_L0_P1' });
      req.flush({});
      expect(carte().sources.get('zones')!.tuiles.at(-1)).toEqual([expect.stringContaining('profil=h1000.2000.6000_b500.1000_a_L0_P1')]);
      f.detectChanges();
      expect(el(f).querySelector('mg-bandeau-kpi')!.textContent).toContain('habitants à moins de 6 km');
    });
  });

  describe('modèle de profil de la page d’essai', () => {
    it('le profil par défaut a le code du module risque', () => {
      expect(codeDuProfil(PROFIL_DEFAUT)).toBe(CODE_PROFIL_DEFAUT);
    });
    it('pose le bord, jamais sous le dernier anneau intérieur, dans les bornes du pré-calcul', () => {
      expect(poserBord(PROFIL_DEFAUT, 'haut', 7000).haut).toEqual([1000, 2000, 7000]);
      expect(poserBord(PROFIL_DEFAUT, 'haut', 1500).haut).toEqual([1000, 2000, 2100]);
      expect(poserBord(PROFIL_DEFAUT, 'bas', 50_000).bas).toEqual([500, 10_000]);
    });
    it('cadenas fermé : le seuil bas hérite ; rouvert, il garde les anneaux du haut', () => {
      const lie = basculerLiaison(PROFIL_DEFAUT);
      expect(lie.bas).toEqual([1000, 2000, 5000]);
      expect(codeDuProfil(lie)).toBe('h1000.2000.5000_b1000.2000.5000_a_L1_P1');
      expect(poserBord(lie, 'bas', 8000)).toMatchObject({ haut: [1000, 2000, 8000], bas: [1000, 2000, 8000] });
      expect(basculerLiaison(lie)).toMatchObject({ lie: false, bas: [1000, 2000, 5000] });
    });
    it('libelleRayon écrit comme React', () => {
      expect([500, 1000, 1500, 10_000].map(libelleRayon)).toEqual(['500 m', '1 km', '1,5 km', '10 km']);
    });
  });

  describe('mobilier de carte', () => {
    const texte = (f: { nativeElement: unknown }) => (f.nativeElement as HTMLElement).textContent ?? '';

    it("n'affiche l'avertissement de zoom que sous z7", async () => {
      const { f, http, carte } = await rendre();
      http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut').flush(COURBE);
      carte().emettre('load');
      carte().zoom = 6.9;
      carte().emettre('zoom');
      f.detectChanges();
      expect(texte(f)).toContain('Zoomez pour voir les zones');
      carte().zoom = 7;
      carte().emettre('zoom');
      f.detectChanges();
      expect(texte(f)).not.toContain('Zoomez pour voir les zones');
    });

    it('un bouton de grappe recadre la carte, marge 40, 800 ms', async () => {
      const { f, http, carte } = await rendre();
      http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut').flush(COURBE);
      carte().emettre('load');
      f.detectChanges();
      const bouton = [...(f.nativeElement as HTMLElement).querySelectorAll('button')].find((b) => b.textContent?.includes('Estuaire de la Seine'))!;
      bouton.click();
      const dernier = carte().cadrages.at(-1)!;
      expect(dernier.cadre).toEqual([[0.05, 49.4], [0.55, 49.55]]);
      expect(dernier.options).toEqual({ padding: 40, duration: 800 });
    });

    it("la pastille « Découpage des zones… » n'existe que pendant la préparation", async () => {
      const { f, http, carte } = await rendre();
      http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut').flush(COURBE);
      carte().emettre('load');
      const req = http.expectOne('/api/risques/zones/preparer');
      f.detectChanges();
      expect(texte(f)).toContain('Découpage des zones…');
      req.flush({ deja_construit: true });
      f.detectChanges();
      expect(texte(f)).not.toContain('Découpage des zones…');
    });

    it('annonce « · N sites affichés » après une réponse de sites', async () => {
      const { f, http, carte } = await rendre();
      vi.useFakeTimers();
      http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut').flush(COURBE);
      carte().emettre('load');
      http.expectOne('/api/risques/zones/preparer');
      expect(texte(f)).not.toContain('sites affichés');
      vi.advanceTimersByTime(400);
      http.expectOne((r) => r.url.startsWith('/api/map/risques-industriels'))
        .flush({ type: 'FeatureCollection', features: [{}, {}, {}] });
      f.detectChanges();
      expect(texte(f)).toContain('· 3 sites affichés');
    });

    it("la popup d'un site lit statut · ville · nature, dans cet ordre", async () => {
      const { http, carte } = await rendre();
      http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut').flush(COURBE);
      carte().emettre('load');
      const contenus: HTMLElement[] = [];
      const chaine = { setLngLat: () => chaine, setDOMContent: (c: HTMLElement) => { contenus.push(c); return chaine; }, addTo: () => chaine };
      vi.spyOn(maplibregl, 'Popup').mockImplementation(function () { return chaine; } as never);
      carte().emettreSurCouche('click', 'sites-points', {
        lngLat: { lng: 5, lat: 43.5 },
        features: [{ properties: { nom: 'Site A', ville: 'Martigues', statut_seveso: 'Seveso seuil haut', libelle_nature: 'Explosibles' } }],
      });
      expect(contenus).toHaveLength(1);
      expect(contenus[0].children[0].textContent).toBe('Site A');
      expect(contenus[0].children[1].textContent).toBe('Seveso seuil haut · Martigues · Explosibles');
    });
  });
});
