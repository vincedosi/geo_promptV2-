import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import { FABRIQUE_CARTE, FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { ZonesRisqueApi } from '../data/zones-risque.api';
import { PROFIL_DEFAUT, type ProfilRayons } from '../logique/profil';
import { CarteRisqueComponent } from './carte-risque.component';
import { COUCHES_ZONES, ID_FOND, SOURCE_ZONES } from './couches-zones';
import {
  ID_APERCU, ID_CERCLES, ID_SITES, ID_SURVOL, SOURCE_APERCU, SOURCE_CERCLES, SOURCE_SITES, SOURCE_SURVOL,
} from './couches-sites';

class ObservateurFactice {
  observe = vi.fn();
  disconnect = vi.fn();
}

const SOMBRE = {
  haut: 'rgb(224, 96, 63)', bas: 'rgb(217, 154, 31)', autres: 'rgb(122, 139, 156)', halo: 'rgba(0, 0, 0, 0.75)',
  contourPoint: 'rgba(255, 255, 255, 0.9)',
};
const CLAIR = {
  haut: 'rgb(184, 67, 31)', bas: 'rgb(168, 114, 10)', autres: 'rgb(90, 107, 124)', halo: 'rgba(255, 255, 255, 0.85)',
  contourPoint: 'rgba(26, 26, 26, 0.85)',
};
/** Laisser passer l'anti-rebond de 350 ms de `chargerParCadre`. */
const attendreAntiRebond = () => new Promise((r) => setTimeout(r, 400));

function site(nom: string, gravite: string, lon = 5.1, lat = 43.45): GeoJSON.Feature {
  return {
    type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { nom, gravite, statut_seveso: gravite === 'seveso_haut' ? 'Seveso seuil haut' : 'Seveso seuil bas', ville: 'Berre-l’Étang', libelle_nature: 'Inflammables' },
  };
}
const SITES: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [site('Raffinerie', 'seveso_haut'), site('Dépôt', 'seveso_bas', 5.2), site('Usine', 'seveso_haut', 5.0)],
};

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
  const demandesSites: { bbox: string; filtres: { gravites?: string[]; natures?: string[] }; rep: Subject<GeoJSON.FeatureCollection>; annulee: boolean }[] = [];
  const popups: { options: unknown; lngLat: unknown; contenu: Node | null; ajoutee: boolean }[] = [];
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
          sites: (bbox: string, filtres: { gravites?: string[]; natures?: string[] } = {}) => {
            const d = { bbox, filtres, rep: new Subject<GeoJSON.FeatureCollection>(), annulee: false };
            demandesSites.push(d);
            return new Observable<GeoJSON.FeatureCollection>((o) => {
              const s = d.rep.subscribe(o);
              return () => { d.annulee = true; s.unsubscribe(); };
            });
          },
        },
      },
      {
        provide: FABRIQUE_POPUP,
        useValue: (options: unknown) => {
          const p = { options, lngLat: null as unknown, contenu: null as Node | null, ajoutee: false };
          popups.push(p);
          const api = {
            setLngLat: (l: unknown) => { p.lngLat = l; return api; },
            setDOMContent: (n: Node) => { p.contenu = n; return api; },
            addTo: () => { p.ajoutee = true; return api; },
          };
          return api;
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
  return {
    f, carte: () => carte, nbCartes: () => nbCartes, preparations, theme, charger, repondre, regler, cartesEmises,
    demandesSites, popups,
  };
}

/** Les couches de ZONES seules (la carte porte aussi celles des sites depuis T8). */
const zones = (c: CarteFactice) => c.couches.filter((x) => String(x.couche['id']).startsWith('atelier-zones'));
const tuiles = (c: CarteFactice) => (c.sources.get(SOURCE_ZONES)?.spec as { tiles: string[] } | undefined)?.tiles[0];

describe('CarteRisqueComponent', () => {
  it('(a) préparer UNE fois DÈS LE MONTAGE (avant le load du fond), puis la source `atelier-zones` une fois les deux là', async () => {
    const r = await rendre();
    // React lançait le POST en parallèle du chargement du style (relecture T7, I1).
    expect(r.preparations.map((p) => [p.profil, p.natures])).toEqual([['h1000.2000.5000_b500.1000_a_L0_P1', []]]);
    await r.charger();
    expect(r.preparations).toHaveLength(1);
    expect(r.carte().sources.has(SOURCE_ZONES)).toBe(false); // pas de tuile avant la construction
    await r.repondre(0);
    expect(tuiles(r.carte())).toBe('http://api/tiles/zones-risque/{z}/{x}/{y}?profil=h1000.2000.5000_b500.1000_a_L0_P1');
    expect(zones(r.carte()).map((c) => c.couche['id'])).toEqual([...COUCHES_ZONES]);
    expect(r.cartesEmises).toEqual([r.carte()]);
  });

  it('préparation finie AVANT le load : rien n’est posé tant que le fond n’est pas chargé, puis une seule pose', async () => {
    const r = await rendre();
    await r.repondre(0);
    expect(r.carte().sources.has(SOURCE_ZONES)).toBe(false);
    await r.charger();
    expect(tuiles(r.carte())).toContain('profil=h1000.2000.5000_b500.1000_a_L0_P1');
    expect(zones(r.carte()).map((c) => c.couche['id'])).toEqual([...COUCHES_ZONES]);
    expect(r.preparations).toHaveLength(1);
  });

  it('revenir à la clé déjà posée pendant qu’une autre se prépare : la préparation en vol est annulée, rien n’est reposé', async () => {
    const r = await rendre();
    await r.charger();
    await r.repondre(0);
    await r.regler('profil', { ...PROFIL_DEFAUT, haut: [3000] });
    await r.regler('profil', PROFIL_DEFAUT);
    expect(r.preparations).toHaveLength(2);
    expect(r.preparations[1].annulee).toBe(true);
    expect(r.carte().retraits).toEqual([]);
    expect(TestBed.inject(ChargementService).etat().actif).toBe(false);
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
    const ajoutSource = vi.spyOn(r.carte(), 'addSource');
    const ajoutCouche = vi.spyOn(r.carte(), 'addLayer');
    await r.regler('fusionner', false);
    expect(ajoutSource).not.toHaveBeenCalled();
    expect(ajoutCouche).not.toHaveBeenCalled();
    ajoutSource.mockRestore();
    ajoutCouche.mockRestore();
    expect(r.carte().dispositions.filter((d) => d.couche.startsWith('atelier-zones'))).toEqual(COUCHES_ZONES.map((couche) => ({ couche, propriete: 'visibility', valeur: 'none' })));
    expect(r.preparations).toHaveLength(1);
    expect(r.carte().retraits).toEqual([]);
    // Un anneau déplacé en mode site par site : les couches recréées NAISSENT masquées (`fusionnerRef`).
    await r.regler('profil', { ...PROFIL_DEFAUT, haut: [4000] });
    await r.repondre(1);
    const visibilites = zones(r.carte()).map((c) => (c.couche['layout'] as Record<string, unknown>)['visibility']);
    expect(visibilites).toEqual(['none', 'none', 'none', 'none']);
  });

  it('bascule de `fusionner` PENDANT une préparation : les couches naissent avec la visibilité COURANTE', async () => {
    const r = await rendre();
    await r.charger();
    await r.regler('fusionner', false);
    await r.regler('fusionner', true);
    await r.regler('fusionner', false);
    await r.repondre(0);
    const visibilites = zones(r.carte()).map((c) => (c.couche['layout'] as Record<string, unknown>)['visibility']);
    expect(visibilites).toEqual(['none', 'none', 'none', 'none']);
    expect(r.preparations).toHaveLength(1);
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

describe('CarteRisqueComponent — sites (T8)', () => {
  /** Carte chargée, zones posées, et le premier lot de sites servi. */
  async function avecSites(gravites: string[] = ['seveso_haut', 'seveso_bas']) {
    const r = await rendre();
    await r.regler('gravites', gravites);
    await r.charger();
    await r.repondre(0);
    await attendreAntiRebond();
    await r.f.whenStable();
    return r;
  }
  const donnees = (r: Awaited<ReturnType<typeof rendre>>, source: string) =>
    r.carte().sources.get(source)?.donnees.at(-1) as GeoJSON.FeatureCollection | undefined;
  const legende = (r: Awaited<ReturnType<typeof rendre>>) =>
    (r.f.nativeElement as HTMLElement).querySelector('mg-legende')?.textContent?.replace(/\s+/g, ' ') ?? '';

  it('au load : couches des sites posées, zones INSÉRÉES DESSOUS ; UNE requête IMMÉDIATE (sans anti-rebond), sur la bbox VISIBLE', async () => {
    const r = await rendre();
    await r.regler('gravites', ['seveso_haut', 'seveso_bas']);
    expect(r.demandesSites).toHaveLength(0); // jamais avant que la carte existe — donc jamais la France entière
    await r.charger();
    expect(r.carte().couches.map((c) => c.couche['id'])).toEqual([ID_CERCLES, ID_APERCU, ID_SURVOL, ID_SITES]);
    await r.repondre(0);
    expect(r.carte().couches.filter((c) => String(c.couche['id']).startsWith('atelier-zones')).every((c) => c.avant === ID_CERCLES)).toBe(true);
    // Relecture T8 : le PREMIER chargement n'attend pas les 350 ms (rien ne bouge encore) ; il n'y en a qu'un.
    expect(r.demandesSites).toHaveLength(1);
    await attendreAntiRebond();
    expect(r.demandesSites.map((d) => [d.bbox, d.filtres])).toEqual([
      ['4.7500,43.3500,5.3000,43.6000', { gravites: ['seveso_haut', 'seveso_bas'], natures: [] }],
    ]);
  });

  it('un moveend → une requête, la précédente ANNULÉE ; la réponse remplit la source et le compte « N sites affichés »', async () => {
    const r = await avecSites();
    expect(legende(r)).not.toContain('sites affichés');
    r.carte().cadre = [5, 43.4, 5.2, 43.5];
    r.carte().emettre('moveend');
    await attendreAntiRebond();
    expect(r.demandesSites).toHaveLength(2);
    expect(r.demandesSites[0].annulee).toBe(true);
    expect(r.demandesSites[1].bbox).toBe('5.0000,43.4000,5.2000,43.5000');
    r.demandesSites[1].rep.next(SITES);
    await r.f.whenStable();
    expect(donnees(r, SOURCE_SITES)).toBe(SITES);
    expect(legende(r)).toContain('Trait plein : périmètre publié par l’État. Tireté : rayon que nous calculons. · 3 sites affichés');
  });

  it('changer de niveaux réglementaires relance le chargement avec les nouveaux filtres', async () => {
    const r = await avecSites();
    await r.regler('gravites', ['seveso_haut']);
    await attendreAntiRebond();
    expect(r.demandesSites.at(-1)?.filtres).toEqual({ gravites: ['seveso_haut'], natures: [] });
    expect(r.demandesSites[0].annulee).toBe(true);
  });

  it('survol d’un site : ses anneaux dans la source de survol, AUCUNE requête ; sortie → vidée, curseur rendu', async () => {
    const r = await avecSites();
    r.demandesSites[0].rep.next(SITES);
    await r.f.whenStable();
    const avant = r.demandesSites.length;
    r.carte().emettreSurCouche('mouseenter', ID_SITES, {});
    expect(r.carte().getCanvas().style.cursor).toBe('pointer');
    r.carte().emettreSurCouche('mousemove', ID_SITES, { features: [SITES.features[0]] });
    expect(donnees(r, SOURCE_SURVOL)?.features).toHaveLength(3); // seuil haut : 1, 2 et 5 km
    r.carte().emettreSurCouche('mousemove', ID_SITES, { features: [SITES.features[1]] });
    expect(donnees(r, SOURCE_SURVOL)?.features).toHaveLength(2); // seuil bas : 500 m et 1 km
    r.carte().emettreSurCouche('mouseleave', ID_SITES, {});
    expect(donnees(r, SOURCE_SURVOL)?.features).toEqual([]);
    expect(r.carte().getCanvas().style.cursor).toBe('');
    expect(r.demandesSites).toHaveLength(avant);
  });

  it('clic sur un site : popup 260 px avec bouton de fermeture, nom puis statut · ville · nature, en textContent', async () => {
    const r = await avecSites();
    r.carte().emettreSurCouche('click', ID_SITES, { features: [SITES.features[0]], lngLat: { lng: 5.1, lat: 43.45 } });
    expect(r.popups).toHaveLength(1);
    expect(r.popups[0].options).toEqual({ closeButton: true, maxWidth: '260px' });
    expect(r.popups[0].lngLat).toEqual({ lng: 5.1, lat: 43.45 });
    expect(r.popups[0].ajoutee).toBe(true);
    const texte = [...(r.popups[0].contenu as HTMLElement).children].map((e) => e.textContent);
    expect(texte).toEqual(['Raffinerie', 'Seveso seuil haut · Berre-l’Étang · Inflammables']);
  });

  it('aperçu non nul → cercles d’aperçu depuis les sites DÉJÀ chargés ; `null` → vidés ; aucune requête', async () => {
    const r = await avecSites();
    r.demandesSites[0].rep.next(SITES);
    await r.f.whenStable();
    const avant = r.demandesSites.length;
    await r.regler('apercu', { niveau: 'haut', rayonM: 3000 });
    expect(donnees(r, SOURCE_APERCU)?.features).toHaveLength(2);
    await r.regler('apercu', { niveau: null, rayonM: 3000 });
    expect(donnees(r, SOURCE_APERCU)?.features).toHaveLength(3);
    await r.regler('apercu', null);
    expect(donnees(r, SOURCE_APERCU)?.features).toEqual([]);
    expect(r.demandesSites).toHaveLength(avant);
  });

  it('site par site : cercles dérivés des sites chargés, couche visible, zones masquées, AUCUNE requête', async () => {
    const r = await avecSites();
    r.demandesSites[0].rep.next(SITES);
    await r.f.whenStable();
    expect(donnees(r, SOURCE_CERCLES)?.features ?? []).toEqual([]); // rien construit tant que les zones sont fusionnées
    const avant = r.demandesSites.length;
    await r.regler('fusionner', false);
    expect(donnees(r, SOURCE_CERCLES)?.features).toHaveLength(3 + 2 + 3);
    expect(r.carte().getLayer(ID_CERCLES)!['layout']).toEqual({ visibility: 'visible' });
    expect(r.demandesSites).toHaveLength(avant);
    expect(r.preparations).toHaveLength(1);
    // Un nouveau lot de sites (panoramique) redessine les cercles.
    r.carte().emettre('moveend');
    await attendreAntiRebond();
    r.demandesSites.at(-1)!.rep.next({ type: 'FeatureCollection', features: [SITES.features[1]] });
    await r.f.whenStable();
    expect(donnees(r, SOURCE_CERCLES)?.features).toHaveLength(2);
    await r.regler('fusionner', true);
    expect(donnees(r, SOURCE_CERCLES)?.features).toEqual([]);
    expect(r.carte().getLayer(ID_CERCLES)!['layout']).toEqual({ visibility: 'none' });
  });

  it('bascule de thème : points, cerne, cercles, aperçu et survol repeints ; aucune source, aucune requête', async () => {
    const r = await avecSites();
    const ajoutSource = vi.spyOn(r.carte(), 'addSource');
    const avant = r.demandesSites.length;
    r.carte().peintures.length = 0;
    r.theme.set(CLAIR);
    await r.f.whenStable();
    const peint = (id: string, p: string) => r.carte().peintures.find((x) => x.couche === id && x.propriete === p)?.valeur;
    expect(chaines(peint(ID_SITES, 'circle-color'))).toContain(CLAIR.bas);
    expect(peint(ID_SITES, 'circle-stroke-color')).toBe(CLAIR.contourPoint);
    expect(peint(ID_SURVOL, 'line-color')).toBe(CLAIR.contourPoint);
    expect(peint(ID_APERCU, 'line-color')).toBe(CLAIR.haut);
    expect(ajoutSource).not.toHaveBeenCalled();
    expect(r.demandesSites).toHaveLength(avant);
  });

  it('échec du chargement des sites : les points précédents restent, le message est affiché', async () => {
    const r = await avecSites();
    r.demandesSites[0].rep.error(new HttpErrorResponse({ status: 500, error: { error: 'Sites indisponibles.' } }));
    await r.f.whenStable();
    expect((r.f.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain('Sites indisponibles.');
  });
});
