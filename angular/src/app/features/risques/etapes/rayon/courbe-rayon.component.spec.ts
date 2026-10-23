import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { ENREGISTRER_FICHIER } from '../../../../core/http/telecharger';
import { FABRIQUE_GRAPHIQUE, type GraphiqueMinimal } from '../../../../graphiques/fabrique-graphique';
import { ProfilRisqueApi } from '../../data/profil-risque.api';
import { ZonesRisqueApi } from '../../data/zones-risque.api';
import type { ResultatCourbe } from '../../logique/donnees-risque';
import { COURBE_RAYON_REELLE } from '../../testing/courbe-rayon.fixture';
import { CLE_TOUTES, jetonNature } from './courbe-population.component';
import { COMMANDE_COUVERTURE, CourbeRayonComponent } from './courbe-rayon.component';

class GraphiqueFactice implements GraphiqueMinimal {
  options: Record<string, unknown>[] = [];
  setOption(o: unknown) { this.options.push(o as Record<string, unknown>); }
  resize() {}
  dispose() {}
  derniere() { return this.options.at(-1)!; }
}

class ObservateurFactice { observe() {} disconnect() {} }

const PRET: ResultatCourbe = { data: COURBE_RAYON_REELLE, chargement: false, erreur: null, aConstruire: false };
const n = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ').trim();

async function rendre(courbe: ResultatCourbe = PRET, entrees: Record<string, unknown> = {}) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
  const graphique = new GraphiqueFactice();
  const exportRayon = vi.fn(() => of());
  const courbeApi = vi.fn();
  const enregistrer = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: FABRIQUE_GRAPHIQUE, useValue: () => graphique },
      { provide: CouleursService, useValue: {
        palette: (j: Record<string, string>) => () => Object.fromEntries(Object.keys(j).map((k) => [k, `couleur:${k}`])),
      } },
      { provide: ProfilRisqueApi, useValue: { exportRayon, exportProfil: vi.fn(), bandes: vi.fn() } },
      { provide: ZonesRisqueApi, useValue: { courbe: courbeApi } },
      { provide: ENREGISTRER_FICHIER, useValue: enregistrer },
    ],
  });
  const f = TestBed.createComponent(CourbeRayonComponent);
  const r = f.componentRef;
  r.setInput('courbe', courbe);
  r.setInput('libelleCible', 'Population totale');
  r.setInput('nomPerimetre', 'France entière');
  r.setInput('gravites', ['seveso_haut', 'seveso_bas']);
  r.setInput('natures', []);
  r.setInput('perim', null);
  for (const [k, v] of Object.entries(entrees)) r.setInput(k, v);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const kpis = () => [...el.querySelectorAll('[data-role="kpis"] mg-kpi')].map((k) => ({
    valeur: n(k.querySelector('[data-role="valeur"]')?.textContent),
    libelle: n(k.querySelector('[data-role="libelle"]')?.textContent),
  }));
  const curseur = () => el.querySelector<HTMLInputElement>('input[type="range"]')!;
  async function deplacer(m: number) {
    curseur().value = String(m);
    curseur().dispatchEvent(new Event('input'));
    await f.whenStable();
  }
  return { f, el, graphique, kpis, curseur, deplacer, exportRayon, courbeApi, enregistrer };
}

/** Les séries VISIBLES de la dernière option ECharts (hors séries d'étiquettes). */
function noms(g: GraphiqueFactice): string[] {
  return (g.derniere()['series'] as { name: string; id?: string }[]).filter((s) => !s.id).map((s) => s.name);
}

describe('CourbeRayonComponent', () => {
  it('KPI au rayon par défaut (1 km) sur la courbe réelle : 1 647 943, 3,9 % du total à 10 km, 1 259 sites', async () => {
    const { kpis, el } = await rendre();
    expect(kpis()).toEqual([
      { valeur: '1 647 943', libelle: 'à moins de 1,0 km' },
      { valeur: '3,9 %', libelle: 'du total à 10 km' },
      { valeur: '1 259', libelle: 'sites concernés' },
      { valeur: '353 301', libelle: 'au palier suivant' },
    ]);
    expect(n(el.textContent)).toContain('42 409 940 au maximum');
    expect(n(el.textContent)).toContain('98 départements');
    expect(n(el.textContent)).toContain('population totale · France entière');
    expect(n(el.querySelector('[data-role="rayon"]')?.textContent)).toBe('1,0 km');
  });

  it('déplacer le curseur à 5 km → 25 261 303, ZÉRO appel API, repère déplacé', async () => {
    const { kpis, deplacer, graphique, exportRayon, courbeApi } = await rendre();
    const options = graphique.options.length;
    await deplacer(5000);
    expect(kpis()[0]).toEqual({ valeur: '25 261 303', libelle: 'à moins de 5,0 km' });
    expect(kpis()[3].valeur).toBe('555 930');
    expect(courbeApi).not.toHaveBeenCalled();
    expect(exportRayon).not.toHaveBeenCalled();
    expect(graphique.options.length).toBeGreaterThan(options);
    const premiere = (graphique.derniere()['series'] as { markLine?: { data: { xAxis: number }[] } }[])[0];
    expect(premiere.markLine?.data[0].xAxis).toBe(5000);
    // Le point le plus proche SANS dépasser : 5 900 m lit encore le palier de 5 km.
    await deplacer(5900);
    expect(kpis()[0].valeur).toBe('25 261 303');
  });

  it('séries par NOM DE JETON : la totale en `brand-teal` (« Toutes natures »), les natures en `nature-n` recyclées', async () => {
    const { graphique } = await rendre();
    const series = graphique.derniere()['series'] as { name: string; lineStyle: { color: string; width: number } }[];
    expect(series[0]).toMatchObject({ name: 'Toutes natures', lineStyle: { color: 'couleur:brand-teal', width: 2.2 } });
    expect(series[1]).toMatchObject({ name: 'GPL et produits pétroliers', lineStyle: { color: 'couleur:nature-1', width: 1.3 } });
    // Treize natures pour huit teintes : la neuvième reprend `nature-1`, comme React (modulo).
    expect(series[9].lineStyle.color).toBe('couleur:nature-1');
    expect(JSON.stringify(graphique.derniere())).not.toContain('var(');
    expect(jetonNature(0)).toBe('nature-1');
    expect(jetonNature(8)).toBe('nature-1');
    expect(CLE_TOUTES).toBe('*');
  });

  it('masquer une nature par la légende → sa série disparaît des `series`, la légende la garde', async () => {
    const { el, f, graphique } = await rendre();
    expect(noms(graphique)).toContain('Toxicité aiguë');
    const bouton = [...el.querySelectorAll<HTMLButtonElement>('mg-courbe button')].find((b) => b.textContent?.includes('Toxicité aiguë'))!;
    bouton.click();
    await f.whenStable();
    expect(noms(graphique)).not.toContain('Toxicité aiguë');
    expect(noms(graphique)).toContain('Toutes natures');
    expect(bouton.getAttribute('aria-pressed')).toBe('false');
  });

  it('les étiquettes au kilomètre : décochées par défaut, une série d’étiquettes sur la totale une fois cochées', async () => {
    const { el, f, graphique } = await rendre();
    const ids = () => (graphique.derniere()['series'] as { id?: string }[]).filter((s) => s.id).map((s) => s.id);
    expect(ids()).toEqual([]);
    const caseEtiquettes = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    caseEtiquettes.checked = true;
    caseEtiquettes.dispatchEvent(new Event('change'));
    await f.whenStable();
    expect(ids()).toEqual(['etiquettes:*']);
  });

  it('note « Toutes natures n’est pas la somme » ; avertissement `total_est_global` quand les natures sont filtrées', async () => {
    const { el, f } = await rendre();
    const note = () => n(el.querySelector('[data-role="note"]')?.textContent);
    expect(note()).toContain('« Toutes natures » n’est pas la somme des autres courbes');
    expect(el.querySelector('[data-role="total-global"]')).toBeNull();
    f.componentRef.setInput('courbe', { ...PRET, data: { ...COURBE_RAYON_REELLE, total_est_global: true } });
    await f.whenStable();
    expect(note()).toContain('Vous avez filtré les natures : la courbe totale, elle, porte toujours sur l’ensemble.');
  });

  it('`couverture_pct: 80` → bandeau « Pré-calcul partiel » AVANT les chiffres ; absent à 100', async () => {
    const { el, f } = await rendre();
    expect(el.querySelector('[data-role="partiel"]')).toBeNull();
    f.componentRef.setInput('courbe', { ...PRET, data: { ...COURBE_RAYON_REELLE, couverture_pct: 80, n_bandes_construites: 96 } });
    await f.whenStable();
    const bandeau = el.querySelector('[data-role="partiel"]')!;
    expect(n(bandeau.textContent)).toBe(
      `Pré-calcul partiel : 80 % de la métropole (96 bandes construites, plus 2 zones d’outre-mer). Les chiffres ci-dessous SOUS-ESTIMENT la population couverte — ils ne portent que sur la part déjà traitée. Terminer avec ${COMMANDE_COUVERTURE}.`,
    );
    expect(bandeau.compareDocumentPosition(el.querySelector('[data-role="kpis"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('409 `a_construire` → message expliqué et commande, JAMAIS une courbe plate', async () => {
    const { el, graphique } = await rendre({
      data: null, chargement: false, aConstruire: true,
      erreur: 'La couverture par rayon n’a pas encore été construite pour ce périmètre. Elle se calcule une fois après chaque import de sites à risque.',
    });
    const bloc = el.querySelector('[data-role="erreur"]')!;
    expect(bloc.querySelector('p')?.className).toContain('text-warning');
    expect(n(bloc.textContent)).toContain('n’a pas encore été construite');
    expect(n(bloc.textContent)).toContain(`Construction : ${COMMANDE_COUVERTURE}`);
    expect(el.querySelector('mg-courbe')).toBeNull();
    expect(graphique.options).toEqual([]);
  });

  it('autre échec → message en danger, sans commande ; premier chargement → squelette', async () => {
    const echec = await rendre({ data: null, chargement: false, aConstruire: false, erreur: 'Courbe indisponible.' });
    expect(echec.el.querySelector('[data-role="erreur"] p')?.className).toContain('text-danger');
    expect(echec.el.textContent).not.toContain('Construction');
    TestBed.resetTestingModule();
    const chargement = await rendre({ data: null, chargement: true, aConstruire: false, erreur: null });
    expect(chargement.el.querySelector('[data-role="squelette"]')).not.toBeNull();
    expect(chargement.el.querySelector('mg-courbe')).toBeNull();
  });

  it('pendant un recalcul, la courbe précédente reste à l’écran (pas de squelette)', async () => {
    const { el, f } = await rendre();
    f.componentRef.setInput('courbe', { ...PRET, chargement: true });
    await f.whenStable();
    expect(el.querySelector('[data-role="squelette"]')).toBeNull();
    expect(el.querySelector('mg-courbe')).not.toBeNull();
  });

  it('« Export Excel » : paramètres de BoutonExportRayon (rayon du curseur, gravités, natures, périmètre), un seul appel', async () => {
    const { el, f, deplacer, exportRayon } = await rendre(PRET, {
      natures: ['Toxicité aiguë'], perim: { niveau: 'departement', code: '13' },
    });
    await deplacer(2500);
    el.querySelector<HTMLButtonElement>('mg-bouton-export button')!.click();
    await f.whenStable();
    expect(exportRayon).toHaveBeenCalledTimes(1);
    const p = (exportRayon.mock.calls[0] as unknown as [URLSearchParams])[0];
    expect([...p.entries()]).toEqual([
      ['rayon_m', '2500'], ['gravites', 'seveso_haut,seveso_bas'], ['natures', 'Toxicité aiguë'],
      ['perim_niveau', 'departement'], ['perim_code', '13'],
    ]);
  });
});
