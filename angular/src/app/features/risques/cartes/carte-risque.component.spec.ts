import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import { FABRIQUE_CARTE } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { ZonesRisqueApi } from '../data/zones-risque.api';
import { PROFIL_DEFAUT, type ProfilRayons } from '../logique/profil';
import { CarteRisqueComponent } from './carte-risque.component';
import { COUCHES_ZONES, ID_FOND, SOURCE_ZONES } from './couches-zones';

class ObservateurFactice {
  observe = vi.fn();
  disconnect = vi.fn();
}

const SOMBRE = { haut: 'rgb(224, 96, 63)', bas: 'rgb(217, 154, 31)', autres: 'rgb(122, 139, 156)', halo: 'rgba(0, 0, 0, 0.75)' };
const CLAIR = { haut: 'rgb(184, 67, 31)', bas: 'rgb(168, 114, 10)', autres: 'rgb(90, 107, 124)', halo: 'rgba(255, 255, 255, 0.85)' };

/** Toutes les chaînes d'une valeur imbriquée (expressions MapLibre). */
function chaines(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(chaines);
  if (v && typeof v === 'object') return Object.values(v).flatMap(chaines);
  return [];
}

async function rendre() {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
  let carte!: CarteFactice;
  let nbCartes = 0;
  const preparations: { profil: string; natures: string[]; rep: Subject<unknown>; annulee: boolean }[] = [];
  const theme = signal(SOMBRE);
  TestBed.configureTestingModule({
    providers: [
      ChargementService,
      { provide: FABRIQUE_CARTE, useValue: (o: never) => { nbCartes++; return (carte = new CarteFactice(o)); } },
      { provide: CouleursService, useValue: { palette: () => theme } },
      {
        provide: ZonesRisqueApi,
        useValue: {
          preparer: (profil: string, natures: string[] = []) => {
            const p = { profil, natures, rep: new Subject<unknown>(), annulee: false };
            preparations.push(p);
            return new Observable((o) => {
              const s = p.rep.subscribe(o);
              return () => { p.annulee = true; s.unsubscribe(); };
            });
          },
          urlTuilesZones: (profil: string, natures: string[] = []) =>
            `http://api/tiles/zones-risque/{z}/{x}/{y}?profil=${profil}${natures.length ? `&natures=${natures.join(',')}` : ''}`,
        },
      },
    ],
  });
  const f = TestBed.createComponent(CarteRisqueComponent);
  f.componentRef.setInput('profil', PROFIL_DEFAUT);
  const cartesEmises: unknown[] = [];
  f.componentInstance.carte.subscribe((c) => cartesEmises.push(c));
  await f.whenStable();
  const charger = async () => {
    carte.emettre('load');
    await f.whenStable();
  };
  const repondre = async (i: number) => {
    preparations[i].rep.next({ deja_construit: true });
    preparations[i].rep.complete();
    await f.whenStable();
  };
  const regler = async (nom: string, valeur: unknown) => {
    f.componentRef.setInput(nom, valeur);
    await f.whenStable();
  };
  return { f, carte: () => carte, nbCartes: () => nbCartes, preparations, theme, charger, repondre, regler, cartesEmises };
}

const tuiles = (c: CarteFactice) => (c.sources.get(SOURCE_ZONES)?.spec as { tiles: string[] } | undefined)?.tiles[0];

describe('CarteRisqueComponent', () => {
  it('(a) au load : préparer UNE fois, PUIS la source `atelier-zones` avec l’URL du code', async () => {
    const r = await rendre();
    expect(r.preparations).toHaveLength(0); // rien avant le load
    await r.charger();
    expect(r.preparations.map((p) => [p.profil, p.natures])).toEqual([['h1000.2000.5000_b500.1000_a_L0_P1', []]]);
    expect(r.carte().sources.has(SOURCE_ZONES)).toBe(false); // pas de tuile avant la construction
    await r.repondre(0);
    expect(tuiles(r.carte())).toBe('http://api/tiles/zones-risque/{z}/{x}/{y}?profil=h1000.2000.5000_b500.1000_a_L0_P1');
    expect(r.carte().couches.map((c) => c.couche['id'])).toEqual([...COUCHES_ZONES]);
    expect(r.cartesEmises).toEqual([r.carte()]);
  });

  it('(b) entrées inchangées (allers-retours d’étapes, nouveaux tableaux au même contenu) → aucun nouvel appel', async () => {
    const r = await rendre();
    await r.charger();
    await r.repondre(0);
    for (let i = 0; i < 3; i++) {
      await r.regler('profil', { ...PROFIL_DEFAUT, haut: [...PROFIL_DEFAUT.haut] });
      await r.regler('natures', []);
      await r.regler('gravites', ['seveso_haut', 'seveso_bas']);
    }
    expect(r.preparations).toHaveLength(1);
    expect(r.carte().retraits).toEqual([]);
    expect(r.nbCartes()).toBe(1);
  });

  it('(c) changement de profil → removeLayer ×4 / removeSource puis nouvelle source au nouveau code', async () => {
    const r = await rendre();
    await r.charger();
    await r.repondre(0);
    const nouveau: ProfilRayons = { ...PROFIL_DEFAUT, haut: [1000, 2000, 3000] };
    await r.regler('profil', nouveau);
    expect(r.preparations[1].profil).toBe('h1000.2000.3000_b500.1000_a_L0_P1');
    expect(r.carte().retraits).toEqual([]); // l'ancienne source reste tant que la nouvelle n'est pas construite
    await r.repondre(1);
    expect(r.carte().retraits).toEqual([...COUCHES_ZONES.map((id) => `couche:${id}`), `source:${SOURCE_ZONES}`]);
    expect(tuiles(r.carte())).toContain('profil=h1000.2000.3000_b500.1000_a_L0_P1');
    expect(r.nbCartes()).toBe(1);
  });

  it('les natures entrent dans la clé : une nature retenue → nouvelle préparation et `natures=` sur les tuiles', async () => {
    const r = await rendre();
    await r.charger();
    await r.repondre(0);
    await r.regler('natures', ['Toxiques']);
    expect(r.preparations[1]).toMatchObject({ profil: 'h1000.2000.5000_b500.1000_a_L0_P1', natures: ['Toxiques'] });
    await r.repondre(1);
    expect(tuiles(r.carte())).toContain('&natures=Toxiques');
  });

  it('une nouvelle clé ANNULE la préparation en vol ; sa réponse tardive ne pose rien', async () => {
    const r = await rendre();
    await r.charger();
    await r.regler('profil', { ...PROFIL_DEFAUT, haut: [3000] });
    expect(r.preparations[0].annulee).toBe(true);
    await r.repondre(0);
    expect(r.carte().sources.has(SOURCE_ZONES)).toBe(false);
    await r.repondre(1);
    expect(tuiles(r.carte())).toContain('profil=h3000_');
  });

  it('(d) bascule de thème → setPaintProperty sur le fond, aucun addSource, aucune préparation', async () => {
    const r = await rendre();
    await r.charger();
    await r.repondre(0);
    const ajoutSource = vi.spyOn(r.carte(), 'addSource');
    const ajoutCouche = vi.spyOn(r.carte(), 'addLayer');
    r.carte().peintures.length = 0;
    r.theme.set(CLAIR);
    await r.f.whenStable();
    const fond = r.carte().peintures.find((p) => p.couche === ID_FOND && p.propriete === 'fill-color');
    expect(chaines(fond?.valeur)).toContain(CLAIR.haut);
    expect(ajoutSource).not.toHaveBeenCalled();
    expect(ajoutCouche).not.toHaveBeenCalled();
    expect(r.preparations).toHaveLength(1);
    expect(r.carte().retraits).toEqual([]);
  });

  it('(e) `fusionner=false` → couches zones `visibility: none`, aucun appel ; à la recréation, elles naissent masquées', async () => {
    const r = await rendre();
    await r.charger();
    await r.repondre(0);
    await r.regler('fusionner', false);
    expect(r.carte().dispositions).toEqual(COUCHES_ZONES.map((couche) => ({ couche, propriete: 'visibility', valeur: 'none' })));
    expect(r.preparations).toHaveLength(1);
    expect(r.carte().retraits).toEqual([]);
    // Un anneau déplacé en mode site par site : les couches recréées NAISSENT masquées (`fusionnerRef`).
    await r.regler('profil', { ...PROFIL_DEFAUT, haut: [4000] });
    await r.repondre(1);
    const visibilites = r.carte().couches.map((c) => (c.couche['layout'] as Record<string, unknown>)['visibility']);
    expect(visibilites).toEqual(['none', 'none', 'none', 'none']);
  });

  it('(f) aucune chaîne `var(` dans les couleurs posées', async () => {
    const r = await rendre();
    await r.charger();
    await r.repondre(0);
    const toutes = r.carte().couches.flatMap((c) => chaines([c.couche['paint'], c.couche['layout']]));
    expect(toutes.some((x) => x.startsWith('var('))).toBe(false);
    expect(toutes).toContain(SOMBRE.haut);
  });

  it('préparation en échec : le message est affiché, la source est posée quand même (React : la carte reste utilisable)', async () => {
    const r = await rendre();
    await r.charger();
    r.preparations[0].rep.error(new HttpErrorResponse({ status: 500, error: { error: 'Construction impossible.' } }));
    await r.f.whenStable();
    expect(r.carte().sources.has(SOURCE_ZONES)).toBe(true);
    expect((r.f.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });

  it('la pastille « Découpage des zones… » vit le temps de la préparation, et la barre commune le sait', async () => {
    const r = await rendre();
    await r.charger();
    const el = r.f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Découpage des zones…');
    expect(TestBed.inject(ChargementService).etat().actif).toBe(true);
    await r.repondre(0);
    expect(el.textContent).not.toContain('Découpage des zones…');
  });

  it('bandeau « Zoomez… » sous z7 seulement ; grappe → fitBounds animé (800 ms, marge 40)', async () => {
    const r = await rendre();
    await r.charger();
    const el = r.f.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Zoomez pour voir les zones');
    r.carte().zoom = 6.5;
    r.carte().emettre('zoom');
    await r.f.whenStable();
    expect(el.textContent).toContain('Zoomez pour voir les zones');
    const berre = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Étang de Berre')!;
    berre.click();
    expect(r.carte().cadrages.at(-1)).toEqual({ cadre: [[4.75, 43.35], [5.3, 43.6]], options: { padding: 40, duration: 800 } });
  });

  it('légende : seuls les niveaux qui portent un anneau (seuil haut 1/2/5 km, seuil bas 500 m/1 km)', async () => {
    const r = await rendre();
    const texte = (r.f.nativeElement as HTMLElement).querySelector('mg-legende')?.textContent?.replace(/\s+/g, ' ');
    expect(texte).toContain('Seveso seuil haut');
    expect(texte).toContain('Seveso seuil bas');
    expect(texte).not.toContain('Autres');
    expect(texte).toContain('500 m');
  });
});
