import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';
import { ChargementService } from '../../../../core/chargement/chargement.service';
import { ProfilRisqueApi, type RequeteBandes } from '../../data/profil-risque.api';
import { ReferentielApi, type ReponseRefGeo } from '../../data/referentiel.api';
import { SitesRisqueApi } from '../../data/sites-risque.api';
import { ZonesRisqueApi } from '../../data/zones-risque.api';
import { DELAI_BANDES_MS, DonneesRisqueService } from '../../etat/donnees-risque.service';
import { EtatRisqueService } from '../../etat/etat-risque.service';
import { BANDES_PACA_REELLES, BANDES_REGIONS_REELLES } from '../../testing/couverture.fixture';
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
  regions: [{ code_region: '93', nom_region: "Provence-Alpes-Côte d'Azur", depts: [{ code_dept: '13', nom_dept: 'Bouches-du-Rhône' }] }],
};

/** L'écran sans l'écran : le VRAI service de données, des API factices qui répondent quand le test le veut. */
function monter() {
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
      { provide: ReferentielApi, useValue: { geo: () => geo, contours: () => new Subject() } },
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

  async function ouvert() {
    const m = monter();
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
});
