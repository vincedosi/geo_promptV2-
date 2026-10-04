import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { FABRIQUE_CARTE } from '../../carte/fabrique-carte';
import { CarteFactice } from '../../carte/testing/carte-factice';
import { signal } from '@angular/core';
import { NEVER, of, throwError } from 'rxjs';
import { CouleursService } from '../../core/theme/couleurs.service';
import { FABRIQUE_GRAPHIQUE } from '../../graphiques/fabrique-graphique';
import { COURBE_RAYON_REELLE } from './testing/courbe-rayon.fixture';
import { BANDES_PACA_REELLES, BANDES_REGIONS_REELLES } from './testing/couverture.fixture';
import { ProfilRisqueApi } from './data/profil-risque.api';
import { ReferentielApi } from './data/referentiel.api';
import { SitesRisqueApi } from './data/sites-risque.api';
import { ZonesRisqueApi } from './data/zones-risque.api';
import { JeuxZonesApi } from './data/jeux-zones.api';
import { DELAI_BANDES_MS } from './etat/donnees-risque.service';
import { RisquePage } from './risque.page';

@Component({ selector: 'mg-vide', template: '' })
class Vide {}

class ObservateurFactice {
  observe = vi.fn();
  disconnect = vi.fn();
}

/**
 * Un tour de boucle. Sous horloge FACTICE (tests de l'anti-rebond des bandes), on avance l'horloge au lieu d'attendre
 * un `setTimeout` qui ne viendrait jamais ; 20 ms couvrent aussi la course `requestAnimationFrame` de l'ordonnanceur.
 */
const attendre = () => (vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(20) : new Promise((r) => setTimeout(r, 0)));

/** L'écran sous un vrai routeur de test, avec une carte factice qui compte ses créations. */
async function ouvrir(url = '/risques', reponses: {
  compter?: () => unknown; bandes?: (q: unknown) => unknown; courbe?: () => unknown; exportProfil?: (p: URLSearchParams) => unknown;
  lister?: () => unknown; lire?: (id: string) => unknown;
} = {}) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
  const cartes: CarteFactice[] = [];
  const preparations: string[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'risques', component: RisquePage },
        { path: '', component: Vide },
      ]),
      // Les API du module (fournies par la route en vrai) : catalogue et référentiel répondent, les calculs jamais.
      { provide: ProfilRisqueApi, useValue: {
        bandes: reponses.bandes ?? (() => NEVER),
        exportProfil: reponses.exportProfil ?? (() => NEVER),
        exportRayon: () => NEVER,
        cibles:() => of({ cibles: [{ code: 'pop_65_plus', libelle: '65 ans et plus', famille: 'Âge' }] }),
      } },
      { provide: ZonesRisqueApi, useValue: {
        courbe: reponses.courbe ?? (() => NEVER),
        sites: () => NEVER,
        preparer: (profil: string) => { preparations.push(profil); return of({ deja_construit: true }); },
        urlTuilesZones: (profil: string) => `http://api/tiles/zones-risque/{z}/{x}/{y}?profil=${profil}`,
      } },
      { provide: CouleursService, useValue: {
        palette: (j: Record<string, string>) => signal(Object.fromEntries(Object.keys(j).map((k) => [k, `rgb(${k.length}, 0, 0)`]))),
        paletteDuTheme: (j: Record<string, string>) => Object.fromEntries(Object.keys(j).map((k) => [k, `rgb(0, ${k.length}, 0)`])),
      } },
      { provide: SitesRisqueApi, useValue: { compter: reponses.compter ?? (() => NEVER) } },
      // L'atelier des jeux (④) : la bibliothèque n'est lue qu'à la première visite de l'étape.
      { provide: JeuxZonesApi, useValue: {
        lister: reponses.lister ?? (() => NEVER), lire: reponses.lire ?? (() => NEVER),
        construire: () => NEVER, regler: () => NEVER, supprimer: () => NEVER, exportJeu: () => NEVER,
        extractions: () => NEVER, cpGeo: () => NEVER, grappes: () => NEVER,
      } },
      { provide: ReferentielApi, useValue: {
        geo: () => of({ regions: [{ code_region: '93', nom_region: 'Provence-Alpes-Côte d’Azur', depts: [{ code_dept: '13', nom_dept: 'Bouches-du-Rhône' }] }] }),
        contours: () => NEVER,
      } },
      { provide: FABRIQUE_CARTE, useValue: (o: never) => { const c = new CarteFactice(o); cartes.push(c); return c; } },
      { provide: FABRIQUE_GRAPHIQUE, useValue: () => ({ setOption: () => undefined, resize: () => undefined, dispose: () => undefined }) },
    ],
  });
  const harness = await RouterTestingHarness.create();
  const page = await harness.navigateByUrl(url, RisquePage);
  await stabiliser(harness);
  return { harness, page, cartes, preparations, router: TestBed.inject(Router), el: () => harness.routeNativeElement as HTMLElement };
}

async function stabiliser(harness: RouterTestingHarness) {
  for (let i = 0; i < 3; i++) {
    await attendre();
    await harness.fixture.whenStable();
  }
}

function etape(el: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...el.querySelectorAll<HTMLButtonElement>('nav[aria-label="Étapes du parcours"] button')]
    .find((x) => x.textContent?.includes(libelle));
  if (!b) throw new Error(`étape introuvable : ${libelle}`);
  return b;
}

describe('RisquePage', () => {
  // Les tests de l'anti-rebond passent en horloge factice : la rendre même s'ils échouent.
  afterEach(() => vi.useRealTimers());

  it("(f) l'en-tête porte le titre, le fil d'Ariane du territoire et cinq étapes", async () => {
    const { el } = await ouvrir();
    expect(el().querySelector('h2')?.textContent?.trim()).toBe('Population à risque industriel');
    expect(el().querySelector('nav[aria-label="Fil d’Ariane"]')?.textContent).toContain('France entière');
    const etapes = [...el().querySelectorAll('nav[aria-label="Étapes du parcours"] button')];
    expect(etapes.map((b) => b.textContent?.replace(/\s+/g, ' ').trim().replace(/ \(renseignée\)$/, ''))).toEqual([
      '1 Sites', '2 Rayon', '3 Couverture', '4 Zones', '5 Campagne',
    ]);
    expect(etape(el(), 'Sites').getAttribute('aria-current')).toBe('step');
    expect(el().querySelector('[data-panneau]')?.getAttribute('data-panneau')).toBe('sites');
  });

  it("(g) cliquer l'étape ③ réécrit `?risque=` SANS recréer l'écran", async () => {
    const { harness, page, router, el } = await ouvrir();
    etape(el(), 'Couverture').click();
    await stabiliser(harness);
    expect(router.url).toBe('/risques?risque=etape%3Dcouverture');
    expect(harness.routeDebugElement?.componentInstance).toBe(page);
    expect(el().querySelector('[data-panneau]')?.getAttribute('data-panneau')).toBe('couverture');
    expect(etape(el(), 'Couverture').getAttribute('aria-current')).toBe('step');
  });

  it("(h) « Carte seule » replie l'aside en visibility: hidden, largeur nulle ; le panneau reste dans le DOM", async () => {
    const { harness, el } = await ouvrir();
    const aside = el().querySelector('aside')!;
    expect(aside.style.width).toBe('480px');
    const bouton = [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('Carte seule'))!;
    bouton.click();
    await stabiliser(harness);
    expect(aside.style.visibility).toBe('hidden');
    expect(aside.style.width).toBe('0px');
    expect(el().querySelector('aside [data-panneau="sites"]')).not.toBeNull();
    expect(el().querySelector('[role="separator"]')).toBeNull();
    // Et retour : le même aside, jamais recréé.
    [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('Afficher le panneau'))!.click();
    await stabiliser(harness);
    expect(el().querySelector('aside')).toBe(aside);
    expect(aside.style.visibility).toBe('visible');
  });

  it('(i) Échap sur l’hôte navigue vers le parent RELATIF', async () => {
    const { harness, router, el } = await ouvrir('/risques?risque=etape%3Drayon');
    el().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await stabiliser(harness);
    expect(router.url).toBe('/');
  });

  it("(i bis) la croix « Fermer » navigue aussi vers le parent", async () => {
    const { harness, router, el } = await ouvrir();
    el().querySelector<HTMLButtonElement>('button[aria-label="Fermer"]')!.click();
    await stabiliser(harness);
    expect(router.url).toBe('/');
  });

  it('(j) les cartes MapLibre (rayons, codes postaux) sont créées UNE fois, même après trois changements d’étape', async () => {
    const { harness, cartes, page, el } = await ouvrir();
    // Deux instances dès l'ouverture (T15) : la carte des codes postaux est montée à largeur nulle, comme React.
    expect(cartes).toHaveLength(2);
    for (const l of ['Rayon', 'Couverture', 'Zones', 'Sites']) {
      etape(el(), l).click();
      await stabiliser(harness);
    }
    expect(cartes).toHaveLength(2);
    expect(cartes.map((c) => c.retiree)).toEqual([false, false]);
    expect(harness.routeDebugElement?.componentInstance).toBe(page);
  });

  it('T7 : allers-retours ② ↔ ③ ↔ ④ → UNE préparation des zones, UNE source, aucune couche retirée', async () => {
    const { harness, cartes, preparations, el } = await ouvrir();
    cartes[0].emettre('load');
    await stabiliser(harness);
    expect(preparations).toEqual(['h1000.2000.5000_b500.1000_a_L0_P1']);
    const ajouts = cartes[0].couches.length;
    for (const l of ['Rayon', 'Couverture', 'Rayon', 'Zones', 'Couverture']) {
      etape(el(), l).click();
      await stabiliser(harness);
    }
    expect(preparations).toHaveLength(1);
    expect(cartes[0].couches).toHaveLength(ajouts);
    expect(cartes[0].retraits).toEqual([]);
  });

  it('T7 : « Lecture des zones » vient de l’URL — `fusion=0` fait naître les couches masquées, sans autre préparation', async () => {
    const { harness, cartes, preparations } = await ouvrir('/risques?risque=fusion%3D0');
    cartes[0].emettre('load');
    await stabiliser(harness);
    expect(preparations).toHaveLength(1);
    const visibilites = cartes[0].couches
      .filter((c) => String(c.couche['id']).startsWith('atelier-zones'))
      .map((c) => (c.couche['layout'] as Record<string, unknown>)['visibility']);
    expect(visibilites).toEqual(['none', 'none', 'none', 'none']);
  });

  it('une URL malformée ouvre un état partiellement récupéré, jamais un écran blanc', async () => {
    const { el, router } = await ouvrir('/risques?risque=profil%3Dillisible%26onglet%3Dterritoires%26jeu%3Dx%26fusion%3Doui');
    expect(el().querySelector('h2')).not.toBeNull();
    expect(el().querySelector('[data-panneau]')?.getAttribute('data-panneau')).toBe('couverture');
    // L'alias est réécrit sous sa forme courante ; profil, jeu et fusion retombent au défaut, donc ne s'écrivent pas.
    expect(router.url).toBe('/risques?risque=etape%3Dcouverture');
  });

  it("la poignée suit le pointeur par capture sur ELLE-MÊME, bornée 320-900 px", async () => {
    const { harness, el } = await ouvrir();
    const poignee = el().querySelector<HTMLElement>('[role="separator"]')!;
    poignee.setPointerCapture = vi.fn();
    const evenement = (type: string, x: number) => {
      const e = new MouseEvent(type, { clientX: x, bubbles: true }) as MouseEvent & { pointerId: number };
      Object.defineProperty(e, 'pointerId', { value: 1 });
      return e;
    };
    poignee.dispatchEvent(evenement('pointerdown', 500));
    expect(poignee.setPointerCapture).toHaveBeenCalledWith(1);
    poignee.dispatchEvent(evenement('pointermove', 2000));
    await stabiliser(harness);
    expect(el().querySelector('aside')!.style.width).toBe('900px');
    poignee.dispatchEvent(evenement('pointermove', 0));
    await stabiliser(harness);
    expect(el().querySelector('aside')!.style.width).toBe('320px');
    poignee.dispatchEvent(evenement('pointerup', 0));
    poignee.dispatchEvent(evenement('pointermove', 700));
    await stabiliser(harness);
    expect(el().querySelector('aside')!.style.width).toBe('320px');
  });

  it("l'interrupteur « Codes postaux » est désactivé sans jeu ; avec un jeu, ④ dédouble la vue et masque « Carte seule »", async () => {
    const { el } = await ouvrir('/risques?risque=etape%3Dzones%26jeu%3D0b7ece33-4903-4a0b-a57a-f6c54e78a729');
    expect(el().querySelector('[data-vue="rayons"]')).not.toBeNull();
    expect((el().querySelector('[data-vue="codes-postaux"]') as HTMLElement).style.visibility).toBe('visible');
    const seule = [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('Carte seule'))!;
    expect(seule.classList.contains('hidden')).toBe(true);
  });

  it("sans jeu, à l'étape ②, « Codes postaux » est désactivé et la carte des codes postaux n'est pas visible", async () => {
    const { el } = await ouvrir('/risques?risque=etape%3Drayon');
    const cp = [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('Codes postaux'))!;
    expect(cp.disabled).toBe(true);
    expect((el().querySelector('[data-vue="codes-postaux"]') as HTMLElement).style.visibility).toBe('hidden');
    expect((el().querySelector('[data-vue="rayons"]') as HTMLElement).style.visibility).toBe('visible');
  });

  it("T5 : le territoire de l'URL alimente le fil d'Ariane ; remonter le vide ; la cible est lue au catalogue", async () => {
    const { harness, el, router } = await ouvrir('/risques?risque=cible%3Dpop_65_plus%26chemin%3Ddepartement%253A13');
    const fil = el().querySelector('nav[aria-label="Fil d’Ariane"]')!;
    expect(fil.textContent?.replace(/\s+/g, ' ')).toContain('France entière › Bouches-du-Rhône · département');
    expect(fil.querySelector('button[aria-current="location"]')?.getAttribute('title')).toBe('Département 13');
    expect(el().querySelector('header')?.textContent).toContain('65 ans et plus');
    (fil.querySelector('button') as HTMLButtonElement).click();
    await stabiliser(harness);
    expect(router.url).toBe('/risques?risque=cible%3Dpop_65_plus');
    expect(fil.textContent?.replace(/\s+/g, ' ')).toContain('France entière · région');
  });

  it('T5 : barre commune et bandeau KPI montés ; six « — » tant que rien n’a répondu', async () => {
    const { el } = await ouvrir();
    expect(el().querySelector('mg-barre-commune')).not.toBeNull();
    const valeurs = [...el().querySelectorAll('mg-bandeau-kpi-risque [data-role="valeur"]')].map((v) => v.textContent?.trim());
    expect(valeurs).toEqual(['—', '—', '—', '—', '—', '—']);
  });

  it("T4 (mineur) : « Carte seule » actif en entrant à ④ avec un jeu ne laisse pas le panneau replié sans bouton", async () => {
    const { harness, router, el } = await ouvrir();
    [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('Carte seule'))!.click();
    await stabiliser(harness);
    const aside = el().querySelector('aside')!;
    expect(aside.style.visibility).toBe('hidden');
    // Un lien suivi depuis l'écran ouvert : même route, l'état suit l'URL (écran réutilisé).
    await router.navigateByUrl('/risques?risque=etape%3Dzones%26jeu%3D0b7ece33-4903-4a0b-a57a-f6c54e78a729');
    await stabiliser(harness);
    expect(el().querySelector('[data-panneau]')?.getAttribute('data-panneau')).toBe('zones');
    expect(aside.style.visibility).toBe('visible');
    expect(aside.style.width).toBe('480px');
    // Ressorti de ④ : le repli demandé reprend effet, et son bouton est de nouveau là pour le défaire.
    await router.navigateByUrl('/risques?risque=etape%3Drayon');
    await stabiliser(harness);
    expect(aside.style.visibility).toBe('hidden');
    expect([...el().querySelectorAll('button')].some((b) => b.textContent?.includes('Afficher le panneau'))).toBe(true);
  });

  it("T6 : le résumé du profil est dans l'en-tête ; une chip déplie le tiroir, Échap DANS le tiroir le referme sans fermer l'écran", async () => {
    const { harness, router, el } = await ouvrir('/risques?risque=etape%3Drayon');
    const resume = el().querySelector('header mg-resume-profil')!;
    expect(resume.querySelector('button')?.textContent).toContain('1 km · 2 km · 5 km');
    expect(el().querySelector('[data-tiroir="anneaux"]')).toBeNull();
    (resume.querySelector('button') as HTMLButtonElement).click();
    await stabiliser(harness);
    const tiroir = el().querySelector('[data-tiroir="anneaux"]')!;
    expect(tiroir).not.toBeNull();
    expect(router.url).toBe('/risques?risque=etape%3Drayon%26atelier%3D1');
    tiroir.querySelector('input[type="number"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await stabiliser(harness);
    expect(el().querySelector('[data-tiroir="anneaux"]')).toBeNull();
    expect(router.url).toBe('/risques?risque=etape%3Drayon');
    // Le focus est rendu à la chip qui avait ouvert le tiroir ; un second Échap y remonte jusqu'à l'hôte et ferme l'écran.
    const chip = el().querySelector<HTMLButtonElement>('header mg-resume-profil button')!;
    expect(document.activeElement).toBe(chip);
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await stabiliser(harness);
    expect(router.url).toBe('/');
  });

  it('T9 : ① lit le compte PARTAGÉ — un seul appel, le même chiffre que le bandeau ; « — » puis le message pendant le comptage', async () => {
    let appels = 0;
    const { el } = await ouvrir('/risques', {
      compter: () => { appels += 1; return of({ retenus: 1259, total: 1259, par_nature: { 'Toxicité aiguë': 1259 } }); },
    });
    const panneau = el().querySelector('[data-panneau="sites"] mg-panneau-sites')!;
    const n = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ').trim();
    expect(n(panneau.querySelector('[data-role="valeur"]')?.textContent)).toBe('1 259 / 1 259');
    expect(panneau.textContent).toContain('sur la France entière — le total porte le même territoire');
    const bandeau = [...el().querySelectorAll('mg-bandeau-kpi-risque [data-role="valeur"]')].map((v) => n(v.textContent));
    expect(bandeau[2]).toBe('1 259 / 1 259');
    expect(appels).toBe(1);
  });

  it('T9 : ① sans réponse affiche « Comptage des sites… », jamais un zéro', async () => {
    const { el } = await ouvrir();
    expect(el().querySelector('[data-panneau="sites"]')?.textContent?.trim()).toBe('Comptage des sites…');
  });

  it('T9 : ② lit les bandes PARTAGÉES — le tableau et le bandeau portent le même total ; bascule ① ↔ ② sans nouvel appel', async () => {
    // Les bandes attendent 400 ms (anti-rebond) : horloge FACTICE, jamais le délai réel (relecture T9).
    vi.useFakeTimers();
    const delai = () => vi.advanceTimersByTimeAsync(DELAI_BANDES_MS);
    let appels = 0;
    const bandes = {
      total: 14103578, hors_zone: 26980106, n_carreaux: 215646, n_codes_postaux: 1927,
      population_reference: 63783569, pop_unites_touchees: 63783571, unites: [],
      par_classe: { 'bas:1': 106419, 'bas:2': 410641, 'haut:1': 526874, 'haut:2': 2337495, 'haut:3': 10482317, 'bas:pprt': 701, 'haut:pprt': 239131 },
    };
    const { harness, el } = await ouvrir('/risques?risque=etape%3Drayon', { bandes: () => { appels += 1; return of(bandes); } });
    await delai();
    await stabiliser(harness);
    const n = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ').replace(/ +/g, ' ').trim();
    const total = () => [...el().querySelectorAll('[data-panneau="rayon"] [data-role="total"] span')].map((s) => n(s.textContent)).join(' ');
    expect(total()).toBe('Total, tous niveaux 14 103 578');
    expect(n(el().querySelector('mg-bandeau-kpi-risque [data-role="valeur"]')?.textContent)).toBe('14 103 578');
    expect(appels).toBe(1);
    etape(el(), 'Sites').click();
    await stabiliser(harness);
    etape(el(), 'Rayon').click();
    await delai();
    await stabiliser(harness);
    expect(total()).toBe('Total, tous niveaux 14 103 578');
    expect(appels).toBe(1);
    vi.useRealTimers();
  });

  it("T6 : la réglette du seuil haut ne touche l'URL qu'au RELÂCHEMENT ; le tiroir montre le nouveau profil", async () => {
    const { harness, router, el } = await ouvrir('/risques?risque=atelier%3D1');
    const haut = el().querySelector<HTMLInputElement>('mg-barre-commune input[type="range"]')!;
    for (let i = 0; i < 20; i += 1) {
      haut.value = String(5000 - i * 100);
      haut.dispatchEvent(new Event('input'));
      await stabiliser(harness);
    }
    expect(router.url).toBe('/risques?risque=atelier%3D1');
    haut.value = '3000';
    haut.dispatchEvent(new Event('input'));
    haut.dispatchEvent(new Event('pointerup'));
    await stabiliser(harness);
    expect(decodeURIComponent(router.url)).toContain('profil=');
    expect(el().querySelector('header mg-resume-profil')?.textContent?.replace(/\s+/g, ' ')).toContain('1 km · 2 km · 3 km');
    expect(el().querySelector('[data-tiroir="anneaux"] [data-niveau="haut"]')?.textContent).toContain('3 km');
  });

  it("relecture T8 : Échap rend le focus à la chip qui a RÉELLEMENT ouvert le tiroir (la seconde), pas à la première", async () => {
    const { harness, el } = await ouvrir('/risques?risque=etape%3Drayon');
    const chips = () => [...el().querySelectorAll<HTMLButtonElement>('header mg-resume-profil button')];
    expect(chips().length).toBe(2);
    const seconde = chips()[1];
    seconde.focus();
    seconde.click();
    await stabiliser(harness);
    el().querySelector('[data-tiroir="anneaux"] input[type="number"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await stabiliser(harness);
    expect(el().querySelector('[data-tiroir="anneaux"]')).toBeNull();
    expect(document.activeElement).toBe(chips()[1]);
  });

  it('relecture T10 : refermé par la chip, l’ouvreur est oublié — une réouverture par l’URL rend le focus à la PREMIÈRE chip', async () => {
    const { harness, el, router } = await ouvrir('/risques?risque=etape%3Drayon');
    const chips = () => [...el().querySelectorAll<HTMLButtonElement>('header mg-resume-profil button')];
    chips()[1].focus();
    chips()[1].click();
    await stabiliser(harness);
    chips()[1].click(); // referme par la chip
    await stabiliser(harness);
    expect(el().querySelector('[data-tiroir="anneaux"]')).toBeNull();
    await router.navigateByUrl('/risques?risque=etape%3Drayon%26atelier%3D1');
    await stabiliser(harness);
    expect(el().querySelector('[data-tiroir="anneaux"]')).not.toBeNull();
    el().querySelector('[data-tiroir="anneaux"] input[type="number"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await stabiliser(harness);
    expect(document.activeElement).toBe(chips()[0]);
  });

  it('relecture T8 : tiroir ouvert par l’URL (aucun ouvreur) → Échap rend le focus à la PREMIÈRE chip', async () => {
    const { harness, el } = await ouvrir('/risques?risque=etape%3Drayon%26atelier%3D1');
    el().querySelector('[data-tiroir="anneaux"] input[type="number"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await stabiliser(harness);
    expect(document.activeElement).toBe(el().querySelector('header mg-resume-profil button'));
  });

  it('T10 : ② montre la courbe PARTAGÉE (un appel) au rayon 1 km ; ① ↔ ② ne la relance pas', async () => {
    vi.useFakeTimers();
    let appels = 0;
    const { harness, el } = await ouvrir('/risques?risque=etape%3Drayon', {
      bandes: () => of({ total: 1, hors_zone: 0, n_carreaux: 1, n_codes_postaux: 1, population_reference: 1, pop_unites_touchees: 1, unites: [], par_classe: { 'haut:1': 1 } }),
      courbe: () => { appels += 1; return of(COURBE_RAYON_REELLE); },
    });
    await vi.advanceTimersByTimeAsync(DELAI_BANDES_MS); // l'anti-rebond des bandes, horloge factice
    await stabiliser(harness);
    const n = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ').trim();
    const courbe = el().querySelector('[data-panneau="rayon"] [data-role="bloc-courbe"] mg-courbe-rayon')!;
    expect(courbe).not.toBeNull();
    expect(n(courbe.querySelector('[data-role="kpis"] [data-role="valeur"]')?.textContent)).toBe('1 647 943');
    expect(appels).toBe(1);
    etape(el(), 'Sites').click();
    await stabiliser(harness);
    etape(el(), 'Rayon').click();
    await stabiliser(harness);
    expect(appels).toBe(1);
    vi.useRealTimers();
  });

  it('T10 : « Exporter le profil » (en-tête) envoie les paramètres de BoutonExportProfil, profil CALCULÉ compris', async () => {
    const recues: URLSearchParams[] = [];
    const { harness, el } = await ouvrir('/risques', { exportProfil: (p) => { recues.push(p); return NEVER; } });
    const bouton = el().querySelector<HTMLButtonElement>('header mg-bouton-export button')!;
    expect(bouton.textContent?.trim()).toBe('Exporter le profil');
    expect(bouton.disabled).toBe(false);
    bouton.click();
    await stabiliser(harness);
    expect(recues).toHaveLength(1);
    expect([...recues[0].entries()]).toEqual([
      ['profil', 'h1000.2000.5000_b500.1000_a_L0_P1'], ['cible', 'ind'], ['maille', 'departement'],
      ['libelle_cible', 'Population totale'],
    ]);
    expect(bouton.disabled).toBe(true); // export en cours
  });

  it('relecture T9 : ② sur un 409 SANS `a_construire` montre l’encadré qui explique — sans la commande de construction', async () => {
    vi.useFakeTimers();
    const message = 'Ce profil ne porte aucun anneau : il ne retient donc aucun carreau. '
      + 'Ajoutez-en au moins un dans la colonne de gauche.';
    const { harness, el } = await ouvrir('/risques?risque=etape%3Drayon', {
      bandes: () => throwError(() => new HttpErrorResponse({ status: 409, error: { error: message, profil_vide: true } })),
    });
    await vi.advanceTimersByTimeAsync(DELAI_BANDES_MS);
    await stabiliser(harness);
    const encadre = el().querySelector('[data-panneau="rayon"] [data-role="echec"]')!;
    expect(encadre).not.toBeNull();
    expect(encadre.textContent?.trim()).toBe(message);
    expect(encadre.querySelector('p')?.classList).toContain('text-danger');
    expect(encadre.textContent).not.toContain('construire_carreau_risque');
  });

  it('T11 : ③ — descendre dans une région liste ses départements ; ni l’URL ni le bandeau KPI ne bougent', async () => {
    vi.useFakeTimers();
    const requetes: { maille: string; region: string | null }[] = [];
    const { harness, router, el } = await ouvrir('/risques?risque=etape%3Dcouverture', {
      bandes: (q) => {
        const r = q as { maille: string; region: string | null };
        requetes.push({ maille: r.maille, region: r.region });
        return of(r.region === '93' ? BANDES_PACA_REELLES : BANDES_REGIONS_REELLES);
      },
    });
    await vi.advanceTimersByTimeAsync(DELAI_BANDES_MS);
    await stabiliser(harness);
    const n = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ').replace(/ +/g, ' ').trim();
    const bandeau = () => [...el().querySelectorAll('mg-bandeau-kpi-risque [data-role="valeur"]')].map((v) => n(v.textContent));
    const lignes = () => [...el().querySelectorAll('[data-panneau="couverture"] tbody tr')].map((t) => t.getAttribute('data-unite'));
    expect(lignes()).toHaveLength(15);
    const avant = bandeau();
    expect(avant[0]).toBe('14 103 578');
    const url = router.url;

    el().querySelector<HTMLButtonElement>('[data-panneau="couverture"] tr[data-unite="93"] [data-role="descendre"]')!.click();
    await stabiliser(harness);
    await vi.advanceTimersByTimeAsync(DELAI_BANDES_MS);
    await stabiliser(harness);

    expect(lignes()).toEqual(['13', '06', '83', '84', '04', '05']);
    expect(requetes).toEqual([{ maille: 'region', region: null }, { maille: 'departement', region: '93' }]);
    expect(router.url).toBe(url);
    expect(bandeau()).toEqual(avant);
    expect(el().querySelector('[data-panneau="couverture"] [data-role="fil-exploration"]')?.textContent)
      .toContain('le filtre Territoire de la barre, lui, n’a pas bougé.');

    // Aller-retour ② ↔ ③ : l'exploration — et son calcul — survivent, comme dans React (état de l'écran).
    etape(el(), 'Rayon').click();
    await stabiliser(harness);
    etape(el(), 'Couverture').click();
    await stabiliser(harness);
    await vi.advanceTimersByTimeAsync(5 * DELAI_BANDES_MS);
    await stabiliser(harness);
    expect(lignes()).toEqual(['13', '06', '83', '84', '04', '05']);
    expect(requetes).toHaveLength(2);
  });

  it('T13 : ④ lit la bibliothèque à la PREMIÈRE visite seulement, et ouvre le jeu nommé par l’URL', async () => {
    const lectures: string[] = [];
    let listes = 0;
    const jeu = {
      jeu: {
        id: '0b7ece33-4903-4a0b-a57a-f6c54e78a729', nom: 'Seveso France', description: null, version: 1, created_at: '',
        construit_le: '2026-10-01', population_exposee: null, n_cp_retenus: 1006, taux_utile: 81.6, mode_plan: 'pondere',
        seuil_couverture_cp: 35, brouillon: false, profil: {}, profil_hash: 'h', poids: {},
      },
      classes: [
        { classe: 'haut:1', n_cp: 100, n_cp_retenus: 60, population_en_zone: 500, population_en_zone_retenue: 400, population_achetee: 600 },
        { classe: 'bas:1', n_cp: 50, n_cp_retenus: 6, population_en_zone: 50, population_en_zone_retenue: 40, population_achetee: 100 },
      ],
    };
    const { harness, el } = await ouvrir('/risques', {
      lister: () => { listes += 1; return of({ jeux: [] }); },
      lire: (id: string) => { lectures.push(id); return of(jeu); },
    });
    expect(listes).toBe(0);
    await harness.navigateByUrl(`/risques?risque=${encodeURIComponent('etape=zones&jeu=0b7ece33-4903-4a0b-a57a-f6c54e78a729')}`);
    await stabiliser(harness);
    expect(listes).toBe(1);
    expect(lectures).toEqual(['0b7ece33-4903-4a0b-a57a-f6c54e78a729']);
    const valeurs = [...el().querySelectorAll('[data-panneau="zones"] mg-kpi [data-role="valeur"]')].map((v) => v.textContent?.trim());
    expect(valeurs).toEqual(['440', '62,9 %', '66']);

    // ④ → ① → ④ : ni la bibliothèque ni le jeu ne sont relus.
    etape(el(), 'Sites').click();
    await stabiliser(harness);
    etape(el(), 'Zones').click();
    await stabiliser(harness);
    expect(listes).toBe(1);
    expect(lectures).toHaveLength(1);
  });
});
