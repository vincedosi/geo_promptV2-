import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ChargementService } from '../../../../core/chargement/chargement.service';
import { ProfilRisqueApi, type RequeteBandes } from '../../data/profil-risque.api';
import { ReferentielApi, type ReponseRefGeo } from '../../data/referentiel.api';
import { SitesRisqueApi } from '../../data/sites-risque.api';
import { ZonesRisqueApi } from '../../data/zones-risque.api';
import { DELAI_BANDES_MS, DonneesRisqueService } from '../../etat/donnees-risque.service';
import { EtatRisqueService } from '../../etat/etat-risque.service';
import { BANDES_PACA_REELLES, BANDES_REGIONS_REELLES } from '../../testing/couverture.fixture';
import { BANDES_CODES_POSTAUX, BANDES_IDF, CONTOURS_DEPARTEMENTS, CONTOURS_REGIONS, DEPTS_IDF } from '../../testing/mini-france.fixture';
import { EtapeCouvertureComponent } from './etape-couverture.component';

const n = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ').replace(/ +/g, ' ').trim();

/** Le texte d'un élément, nœud texte par nœud texte, séparés par une espace : la frontière de deux éléments compte. */
function mots(e: Element | null | undefined): string {
  if (!e) return '';
  const parcours = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  const morceaux: string[] = [];
  for (let t = parcours.nextNode(); t; t = parcours.nextNode()) morceaux.push(t.textContent ?? '');
  return n(morceaux.join(' '));
}

const REF: ReponseRefGeo = {
  regions: [
    { code_region: '93', nom_region: "Provence-Alpes-Côte d'Azur", depts: ['04', '05', '06', '13', '83', '84'].map((c) => ({ code_dept: c, nom_dept: `Département ${c}` })) },
    { code_region: '11', nom_region: 'Île-de-France', depts: DEPTS_IDF.map((c) => ({ code_dept: c, nom_dept: `Département ${c}` })) },
  ],
};

/** L'écran sans l'écran : le VRAI service de données, des API factices qui répondent quand le test le veut. */
function monter(contours: (scale: string) => Observable<unknown> = () => new Subject()) {
  const bandes: { args: RequeteBandes; rep: Subject<unknown>; annule: boolean }[] = [];
  const geo = new Subject<ReponseRefGeo>();
  const navigate = vi.fn(async () => true);
  const parametres = convertToParamMap({});
  TestBed.configureTestingModule({
    providers: [
      ChargementService, EtatRisqueService, DonneesRisqueService,
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: parametres }, queryParamMap: of(parametres) } },
      { provide: Router, useValue: { navigate } },
      {
        provide: ProfilRisqueApi,
        useValue: {
          cibles: () => of({ cibles: [] }),
          bandes: (args: RequeteBandes) => {
            const appel = { args, rep: new Subject<unknown>(), annule: false };
            bandes.push(appel);
            return new Observable((o) => {
              const s = appel.rep.subscribe(o);
              return () => { appel.annule = true; s.unsubscribe(); };
            });
          },
        },
      },
      { provide: ZonesRisqueApi, useValue: { courbe: () => new Subject() } },
      { provide: SitesRisqueApi, useValue: { compter: () => new Subject() } },
      { provide: ReferentielApi, useValue: { geo: () => geo, contours } },
    ],
  });
  const f = TestBed.createComponent(EtapeCouvertureComponent);
  const donnees = TestBed.inject(DonneesRisqueService);
  geo.next(REF);
  return { f, el: f.nativeElement as HTMLElement, donnees, bandes, navigate };
}

async function rendu(f: ReturnType<typeof monter>['f']) {
  TestBed.tick();
  await f.whenStable();
}

const lignes = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
const ligne = (el: HTMLElement, code: string) => el.querySelector(`tr[data-unite="${code}"]`) as HTMLTableRowElement;

describe('mg-etape-couverture', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function ouvert(contours?: (scale: string) => Observable<unknown>) {
    const m = monter(contours);
    await rendu(m.f);
    vi.advanceTimersByTime(DELAI_BANDES_MS);
    await rendu(m.f);
    m.bandes[0].rep.next(BANDES_REGIONS_REELLES);
    await rendu(m.f);
    return m;
  }

  it('hors exploration : le tableau lit le calcul GLOBAL, sans second appel ni fil local', async () => {
    const { el, f, bandes } = await ouvert();
    vi.advanceTimersByTime(5 * DELAI_BANDES_MS);
    await rendu(f);
    expect(bandes).toHaveLength(1);
    expect(lignes(el)).toHaveLength(15);
    expect(el.querySelector('[data-role="fil-exploration"]')).toBeNull();
    // Racine : rien au-dessus, la flèche gauche est grisée sur chaque ligne.
    expect((ligne(el, '93').querySelector('[data-role="remonter"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('flèche droite sur PACA : second calcul, 6 départements, fil local — l’URL et le bandeau ne bougent pas', async () => {
    const { el, f, bandes, donnees, navigate } = await ouvert();
    const navigations = navigate.mock.calls.length;
    const global = donnees.bandes();
    (ligne(el, '93').querySelector('[data-role="descendre"]') as HTMLButtonElement).click();
    await rendu(f);
    // Pendant le calcul exploré : le tableau attend sa propre réponse, le fil dit déjà où l'on est.
    expect(mots(el.querySelector('mg-tableau-couverture'))).toBe('Calcul en cours…');
    expect(mots(el.querySelector('[data-role="fil-exploration"]'))).toBe(
      "Exploration : France entière › Provence-Alpes-Côte d'Azur — le filtre Territoire de la barre, lui, n’a pas bougé.",
    );
    vi.advanceTimersByTime(DELAI_BANDES_MS);
    await rendu(f);
    expect(bandes).toHaveLength(2);
    expect(bandes[1].args).toMatchObject({ maille: 'departement', region: '93', parent: null });
    bandes[1].rep.next(BANDES_PACA_REELLES);
    await rendu(f);
    expect(lignes(el).map((t) => t.getAttribute('data-unite'))).toEqual(['13', '06', '83', '84', '04', '05']);
    expect(mots(lignes(el)[0])).toBe('13 Bouches-du-Rhone 388 271 20,2 % 76');
    expect(mots(el.querySelector('th'))).toBe('Département');
    // Ni l'URL, ni le calcul du bandeau KPI.
    expect(navigate.mock.calls.length).toBe(navigations);
    expect(donnees.bandes()).toBe(global);
    expect(donnees.bandes().bandes?.total).toBe(14103578);
    expect(donnees.chemin()).toEqual([]);
  });

  it('flèche gauche : retour à la racine, ZÉRO appel, les 15 régions reviennent', async () => {
    const { el, f, bandes } = await ouvert();
    (ligne(el, '93').querySelector('[data-role="descendre"]') as HTMLButtonElement).click();
    await rendu(f);
    vi.advanceTimersByTime(DELAI_BANDES_MS);
    bandes[1].rep.next(BANDES_PACA_REELLES);
    await rendu(f);
    const gauche = ligne(el, '13').querySelector('[data-role="remonter"]') as HTMLButtonElement;
    expect(gauche.disabled).toBe(false);
    gauche.click();
    await rendu(f);
    vi.advanceTimersByTime(5 * DELAI_BANDES_MS);
    await rendu(f);
    expect(bandes).toHaveLength(2);
    expect(lignes(el)).toHaveLength(15);
    expect(el.querySelector('[data-role="fil-exploration"]')).toBeNull();
  });

  it('le premier lien du fil local quitte l’exploration d’un coup', async () => {
    const { el, f, donnees } = await ouvert();
    (ligne(el, '93').querySelector('[data-role="descendre"]') as HTMLButtonElement).click();
    await rendu(f);
    (el.querySelector('[data-role="fil-exploration"] button') as HTMLButtonElement).click();
    await rendu(f);
    expect(donnees.exploration()).toEqual([]);
    expect(lignes(el)).toHaveLength(15);
  });

  it('clic sur une ligne : SÉLECTION seule — ni descente, ni appel', async () => {
    const { el, f, bandes, donnees } = await ouvert();
    ligne(el, '84').click();
    await rendu(f);
    vi.advanceTimersByTime(5 * DELAI_BANDES_MS);
    expect(donnees.selectionCarte()).toBe('84');
    expect(donnees.exploration()).toEqual([]);
    expect(bandes).toHaveLength(1);
  });

  it('survol partagé ; effacé en descendant (homonymes région/département)', async () => {
    const { el, f, donnees } = await ouvert();
    ligne(el, '93').dispatchEvent(new MouseEvent('mouseenter'));
    await rendu(f);
    expect(donnees.actif()).toBe('93');
    expect(ligne(el, '93').classList).toContain('bg-teal-10');
    (ligne(el, '93').querySelector('[data-role="descendre"]') as HTMLButtonElement).click();
    await rendu(f);
    expect(donnees.actif()).toBeNull();
  });
  // ── T12 : la mini-carte suit le TABLEAU ──────────────────────────────────────────────────────────────────────
  describe('mini-carte', () => {
    /** Contours servis à la demande, et la liste des échelles DEMANDÉES. */
    function contoursEspion() {
      const demandes: string[] = [];
      const fn = (scale: string) => {
        demandes.push(scale);
        return of({ type: 'FeatureCollection', features: scale === 'region' ? CONTOURS_REGIONS : CONTOURS_DEPARTEMENTS });
      };
      return { demandes, fn };
    }
    const dessines = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('mg-carte-mini-france svg path[data-code]')).map((p) => p.getAttribute('data-code'));
    const titre = (el: HTMLElement, code: string) =>
      n(el.querySelector(`mg-carte-mini-france path[data-code="${code}"] title`)?.textContent);

    async function descendreDans(m: Awaited<ReturnType<typeof ouvert>>, code: string, rep: unknown) {
      (ligne(m.el, code).querySelector('[data-role="descendre"]') as HTMLButtonElement).click();
      await rendu(m.f);
      vi.advanceTimersByTime(DELAI_BANDES_MS);
      await rendu(m.f);
      m.bandes.at(-1)!.rep.next(rep);
      await rendu(m.f);
    }

    it('racine : les régions, valeurs en PART du calcul global, encodage Part par défaut', async () => {
      const c = contoursEspion();
      const { el } = await ouvert(c.fn);
      expect(c.demandes).toEqual(['region']);
      // 13 régions métropolitaines dessinées + les cartouches des deux régions d'outre-mer EXPOSÉES.
      expect(dessines(el)).toHaveLength(15);
      expect(el.querySelectorAll('mg-carte-mini-france [data-om]')).toHaveLength(2);
      // Île-de-France : 3 076 627 / 11 834 764 = 25,9966… %.
      expect(titre(el, '11')).toBe(n(`Région 11 — ${(3076627 / 11834764 * 100).toLocaleString('fr-FR')} %`));
      expect(el.querySelector('[data-encodage="part"]')?.getAttribute('aria-pressed')).toBe('true');
      expect(el.querySelector('[data-palette="rouge"]')?.getAttribute('aria-pressed')).toBe('true');
      expect(n(el.querySelector('[data-role="libelle-echelle"]')?.textContent)).toBe('Part % · seuils naturels');
    });

    it('exploration de PACA (93) : seuls 04, 05, 06, 13, 83, 84 dessinés, colorés par le calcul EXPLORÉ', async () => {
      const c = contoursEspion();
      const m = await ouvert(c.fn);
      await descendreDans(m, '93', BANDES_PACA_REELLES);
      expect([...dessines(m.el)].sort()).toEqual(['04', '05', '06', '13', '83', '84']);
      expect(titre(m.el, '13')).toBe(n(`Département 13 — ${(388271 / 1918748 * 100).toLocaleString('fr-FR')} %`));
    });

    it('défaut du 2026-09-22 : explorer l’Île-de-France dessine 8 départements et NON 96 — l’Aude n’y est pas', async () => {
      const c = contoursEspion();
      const m = await ouvert(c.fn);
      await descendreDans(m, '11', BANDES_IDF);
      expect([...dessines(m.el)].sort()).toEqual([...DEPTS_IDF].sort());
      expect(dessines(m.el)).not.toContain('11');
      // La valeur de Paris est celle du calcul EXPLORÉ (100 / 10 000 = 1 %), jamais celle d'une région 75.
      expect(titre(m.el, '75')).toBe('Département 75 — 1 %');
    });

    it('contours : UNE requête par échelle, jamais rejouée aux bascules de maille ni d’encodage', async () => {
      const c = contoursEspion();
      const m = await ouvert(c.fn);
      await descendreDans(m, '11', BANDES_IDF);
      (ligne(m.el, '75').querySelector('[data-role="remonter"]') as HTMLButtonElement).click();
      await rendu(m.f);
      (m.el.querySelector('[data-encodage="densite"]') as HTMLButtonElement).click();
      await rendu(m.f);
      await descendreDans(m, '11', BANDES_IDF);
      expect(c.demandes).toEqual(['region', 'departement']);
    });

    it('contours en échec : « Contours indisponibles », jamais gardé — redemandé au changement de maille suivant', async () => {
      const demandes: string[] = [];
      const fn = (scale: string) => {
        demandes.push(scale);
        if (demandes.length === 1) return throwError(() => new Error('500'));
        return of({ type: 'FeatureCollection', features: scale === 'region' ? CONTOURS_REGIONS : CONTOURS_DEPARTEMENTS });
      };
      const m = await ouvert(fn);
      expect(n(m.el.querySelector('[data-role="contours-indisponibles"]')?.textContent)).toBe('Contours indisponibles');
      expect(m.el.textContent).not.toContain('Chargement des contours');
      expect(dessines(m.el)).toHaveLength(0);
      await descendreDans(m, '11', BANDES_IDF);
      (ligne(m.el, '75').querySelector('[data-role="remonter"]') as HTMLButtonElement).click();
      await rendu(m.f);
      expect(demandes).toEqual(['region', 'departement', 'region']);
      expect(m.el.querySelector('[data-role="contours-indisponibles"]')).toBeNull();
      expect(dessines(m.el)).toHaveLength(15);
    });

    it('Effectif : cercles proportionnels sur fond neutre ; Densité : aplat, en hab/km²', async () => {
      const c = contoursEspion();
      const m = await ouvert(c.fn);
      (m.el.querySelector('[data-encodage="exposee"]') as HTMLButtonElement).click();
      await rendu(m.f);
      expect(m.el.querySelectorAll('mg-carte-mini-france circle[data-cercle]')).toHaveLength(13);
      expect((m.el.querySelector('mg-carte-mini-france path[data-code="11"]') as SVGPathElement).style.fill).toBe('var(--bg-level-2)');
      expect(n(m.el.querySelector('[data-role="libelle-echelle"]')?.textContent)).toBe('Effectif · seuils naturels · aire ∝ valeur');
      (m.el.querySelector('[data-encodage="densite"]') as HTMLButtonElement).click();
      await rendu(m.f);
      expect(m.el.querySelectorAll('mg-carte-mini-france circle[data-cercle]')).toHaveLength(0);
      expect(titre(m.el, '11')).toBe(n(`Région 11 — ${(3076627 / 12060.6655136181).toLocaleString('fr-FR')} hab/km²`));
    });

    it('palette Bleu : l’aplat le plus fort prend la dernière teinte bleue (A10)', async () => {
      const c = contoursEspion();
      const m = await ouvert(c.fn);
      (m.el.querySelector('[data-palette="bleu"]') as HTMLButtonElement).click();
      await rendu(m.f);
      const fills = Array.from(m.el.querySelectorAll<SVGPathElement>('mg-carte-mini-france path[data-code]')).map((p) => p.style.fill);
      expect(fills).toContain('rgb(8, 48, 107)'); // #08306B
      expect(m.donnees.palette()).toBe('bleu');
    });

    it('un clic sur la carte SÉLECTIONNE (cadrage), il ne descend pas', async () => {
      const c = contoursEspion();
      const m = await ouvert(c.fn);
      m.el.querySelector('mg-carte-mini-france path[data-code="84"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await rendu(m.f);
      vi.advanceTimersByTime(5 * DELAI_BANDES_MS);
      expect(m.donnees.selectionCarte()).toBe('84');
      expect(m.donnees.exploration()).toEqual([]);
      expect(m.bandes).toHaveLength(1);
      // L'unité cadrée est mise en avant : trait teal.
      expect((m.el.querySelector('mg-carte-mini-france path[data-code="84"]') as SVGPathElement).style.stroke).toBe('var(--brand-teal)');
    });

    it('maille commune : la phrase de React MOT POUR MOT, et AUCUNE requête de contours', async () => {
      const c = contoursEspion();
      const m = await ouvert(c.fn);
      m.donnees.mailleChoisie.set('commune');
      await rendu(m.f);
      expect(n(m.el.querySelector('[data-role="sans-carte"]')?.textContent)).toBe(
        'Pas de carte à la maille commune : 34 921 polygones sur 300 px donneraient une bouillie de traits. Le classement ci-contre reste lisible, lui — c’est ce qu’on vient chercher ici.',
      );
      expect(m.el.querySelector('mg-carte-mini-france')).toBeNull();
      expect(c.demandes).toEqual(['region']);
    });

    it('Part au code postal : bascule sur l’effectif ET le dit', async () => {
      const c = contoursEspion();
      const m = await ouvert(c.fn);
      m.donnees.mailleChoisie.set('code_postal');
      await rendu(m.f);
      vi.advanceTimersByTime(DELAI_BANDES_MS);
      await rendu(m.f);
      m.bandes.at(-1)!.rep.next(BANDES_CODES_POSTAUX);
      await rendu(m.f);
      expect(n(m.el.querySelector('[data-role="encodage-indisponible"]')?.textContent)).toBe(
        'Part et densité ne sont pas disponibles au code postal : aucun référentiel de population n’y est fiable — celui de La Poste recense 110,5 % de la population française. La carte affiche l’effectif.',
      );
      // Pas de contours à cette maille : le texte d'aide suit l'encodage EFFECTIF.
      expect(n(m.el.querySelector('aside[data-role="mini-carte"] > p:last-child')?.textContent)).toMatch(/^Nombre d'habitants exposés/);
    });
  });
});
