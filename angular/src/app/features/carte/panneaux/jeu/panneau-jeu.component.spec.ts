import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import type { ZoneCustomResume } from '../../data/zones-custom.api';
import { REGISTRE, Z1, Z2, couvertureCp, monterJeu, pavageMoinsBon, urlCouverture, urlSimulationCercles } from '../../testing/jeu-factice';
import { PanneauJeuComponent } from './panneau-jeu.component';

const BANC = { TestBed, HttpTestingController, provideHttpClientTesting };
/** La liste des zones nomme Z1, recette illisible : la recette est CONNUE, ⑤ peut lire (relecture 2). */
const listerZ1 = () => of({ zones: [{ id: Z1, name: 'Z1', recette: null, updated_at: 'v1' } as unknown as ZoneCustomResume] });

/** Un `ResizeObserver` qui annonce une largeur d'hôte fixe dès l'observation. */
function largeurPanneau(px: number): void {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    constructor(private readonly rappel: (e: Array<{ contentRect: { width: number } }>) => void) {}
    observe() { this.rappel([{ contentRect: { width: px } }]); }
    disconnect() { /* rien à libérer */ }
  };
}

describe('mg-panneau-jeu', () => {
  beforeEach(() => largeurPanneau(400));

  it('ouvert sans zone : AUCUNE requête ; le vide renvoie à l’étape ③', async () => {
    const { el, http, router, stable } = await monterJeu(BANC, PanneauJeuComponent);
    http.verify();
    expect(el.querySelector('[data-jeu-vide]')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('Aucune zone : choisissez une zone enregistrée, ou créez-en une à l’étape ③.');
    el.querySelector<HTMLButtonElement>('[data-vers-zones]')!.click();
    await stable();
    expect(router.url).toBe('/carte?etape=zones');
    http.verify();
  });

  it('une zone : le registre lu une fois, puis la couverture de la SEULE colonne ouverte (empilées)', async () => {
    const { el, http, stable } = await monterJeu(BANC, PanneauJeuComponent, `/carte?zoneJeu=${Z1}`, { lister: listerZ1 });
    http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE });
    await stable();
    http.expectOne(urlCouverture(Z1, 'cp')).flush(couvertureCp);
    await stable();
    // B9 : puis la simulation qui décide du défaut de DV360 (ses cercles), dans la même file.
    http.expectOne(urlSimulationCercles(Z1)).flush(pavageMoinsBon(Z1));
    await stable();
    http.verify();
    expect(el.querySelectorAll('mg-colonne-plateforme')).toHaveLength(4);
    expect(el.querySelectorAll('[data-corps-colonne]')).toHaveLength(1);
    expect(el.querySelector('[data-forme]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('1 000 habitants carroyés · 10 km²');
    // A5 : le minimum de ménages appliqué est TOUJOURS dit, 0 compris (population totale).
    expect(el.querySelector('[data-min-menages]')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('Minimum de ménages par carreau : 0 (population totale : tous les carreaux comptent)');
    expect(el.querySelector('[data-reference]')?.textContent?.trim())
      .toBe('Habitants carroyés (Filosofi 2021) ; la part rapporte chaque territoire à ses propres habitants carroyés.');
    // Déplier TikTok : sa maille seule se lit.
    el.querySelector<HTMLButtonElement>('[data-plateforme="tiktok"] [data-entete-colonne]')!.click();
    await stable();
    http.expectOne(urlCouverture(Z1, 'departement'));
    http.verify();
  });

  it('900 px et plus : les quatre colonnes côte à côte, toutes ouvertes, chacune demande sa conversion (une à la fois)', async () => {
    largeurPanneau(1000);
    const { el, http, stable } = await monterJeu(BANC, PanneauJeuComponent, `/carte?zoneJeu=${Z1}`, { lister: listerZ1 });
    http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE });
    await stable();
    expect(el.querySelector('[data-colonnes]')!.classList).toContain('grid-cols-4');
    expect(el.querySelectorAll('[data-corps-colonne]')).toHaveLength(4);
    http.expectOne(urlCouverture(Z1, 'cp')).flush(couvertureCp);
    await stable();
    http.expectOne(urlSimulationCercles(Z1)).flush(pavageMoinsBon(Z1)); // B9 : la simulation du défaut de DV360
    await stable();
    http.expectOne(urlCouverture(Z1, 'forme'));
  });

  it('bandeau : zone, plateformes chiffrées, meilleur taux d’utile', async () => {
    const lister = () => of({ zones: [{ id: Z1, name: 'Lycées 5 km', recette: null, updated_at: 'v1' } as unknown as ZoneCustomResume] });
    const { el, http, stable } = await monterJeu(BANC, PanneauJeuComponent, `/carte?zoneJeu=${Z1}`, { lister });
    http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE });
    await stable();
    http.expectOne(urlCouverture(Z1, 'cp')).flush(couvertureCp);
    await stable();
    const kpis = [...el.querySelectorAll('[data-kpi-jeu] [data-role="valeur"]')].map((k) => k.textContent?.trim());
    expect(kpis).toEqual(['Lycées 5 km', '1 / 4', '45,0 %', '—']);
  });

  it('la recette donnée par la liste change l’exactitude : une liste de CP se lit « forme », exacte au CP', async () => {
    const zone = { id: Z1, name: 'CP', recette: { v: 1, type: 'codes_postaux', codes: ['13001', '13002'], unites_constitutives: { maille: 'cp', codes: ['13001', '13002'], groupes_partiels: 0 } }, updated_at: 'v1' } as unknown as ZoneCustomResume;
    const { el, http, stable } = await monterJeu(BANC, PanneauJeuComponent, `/carte?zoneJeu=${Z1}`, { lister: () => of({ zones: [zone] }) });
    http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE });
    await stable();
    http.expectOne(urlCouverture(Z1, 'forme')).flush({ ...couvertureCp, decoupage: 'forme', lignes: [] });
    await stable();
    http.expectNone(urlCouverture(Z1, 'cp'));
    expect(el.querySelector('[data-exacte]')?.textContent).toContain('2 codes postaux');
  });

  it('décision du 02/11 : une zone rayon POI de 100 m est refusée (texte exact), aucune conversion, ni enregistrement ni extraction', async () => {
    const zone = {
      id: Z1, name: 'Lycées 100 m', updated_at: 'v1',
      recette: { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 100, perimetre: { type: 'departement', code: '35' } },
    } as unknown as ZoneCustomResume;
    const { el, http, stable } = await monterJeu(BANC, PanneauJeuComponent, `/carte?zoneJeu=${Z1}`, { lister: () => of({ zones: [zone] }) });
    for (const r of http.match('/api/zones/plateformes')) r.flush({ plateformes: REGISTRE });
    await stable();
    http.expectNone((r) => r.url.includes('/couverture') || r.url.includes('/cercles'));
    expect(el.querySelector('[data-refus-activation]')?.textContent?.trim())
      .toBe('Rayon de 100 m : trop fin pour être activé (minimum 250 m). Gardé pour l’analyse uniquement.');
    expect(el.querySelectorAll('mg-colonne-plateforme')).toHaveLength(0);
    expect(el.querySelector('mg-enregistrer-jeu')).toBeNull();
    http.verify();
  });

  it('tour 3 (N-2) : une combinaison dont une source a 100 m de rayon est refusée, la source nommée, sans conversion', async () => {
    const zones = [
      { id: Z1, name: 'Lycées − Dessin', updated_at: 'v1', recette: { v: 1, type: 'combinaison', operation: 'difference', zones: ['s1', 's2'] } },
      { id: 's1', name: 'Lycées 100 m', recette: { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 100, perimetre: { type: 'departement', code: '35' } } },
      { id: 's2', name: 'Dessin', recette: { v: 1, type: 'dessin' } },
    ] as unknown as ZoneCustomResume[];
    const { el, http, stable } = await monterJeu(BANC, PanneauJeuComponent, `/carte?zoneJeu=${Z1}`, { lister: () => of({ zones }) });
    for (const r of http.match('/api/zones/plateformes')) r.flush({ plateformes: REGISTRE });
    await stable();
    http.expectNone((r) => r.url.includes('/couverture') || r.url.includes('/cercles'));
    expect(el.querySelector('[data-refus-activation]')?.textContent?.trim()).toBe(
      'La zone « Lycées 100 m » (rayon de 100 m) est trop fine pour être activée (minimum 250 m) : '
      + 'cette combinaison est gardée pour l’analyse uniquement.');
    expect(el.querySelector('mg-enregistrer-jeu')).toBeNull();
  });

  it('A-13 : la zone analysée en ④ est PROPOSÉE (pas prise) ; un clic la choisit', async () => {
    const lister = () => of({ zones: [{ id: Z2, name: 'Fos', recette: null } as unknown as ZoneCustomResume] });
    const { el, http, jeu, stable } = await monterJeu(BANC, PanneauJeuComponent, `/carte?zoneAnalyse=${Z2}`, { lister });
    expect(jeu.zoneId()).toBeNull();
    http.verify();
    expect(el.querySelector('[data-proposee]')?.textContent?.trim()).toBe('Partir de la zone analysée : Fos');
    el.querySelector<HTMLButtonElement>('[data-proposee]')!.click();
    await stable();
    expect(jeu.zoneId()).toBe(Z2);
  });
});
