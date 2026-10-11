import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApercuClusteringService } from '../../../couches/apercu-clustering.service';
import type { CorpsLancementClustering } from '../../../logique/clustering/assistant';
import { AssistantClusteringComponent } from './assistant-clustering.component';
import { CalculClusteringService } from './calcul-clustering.service';
import { fournisseursClustering } from './testing/clustering-factice';

const TYPES = [
  { type: 'lycee', total: 5584, clustered: 0, has_clusters: false },
  { type: 'bmw', total: 177, clustered: 0, has_clusters: false },
  { type: 'cirfa', total: 101, clustered: 95, has_clusters: true },
];

async function monter() {
  TestBed.configureTestingModule({ providers: [...fournisseursClustering(), provideHttpClientTesting()] });
  const apercu = TestBed.inject(ApercuClusteringService);
  const afficher = vi.spyOn(apercu, 'afficher').mockImplementation(() => undefined);
  const effacer = vi.spyOn(apercu, 'effacer');
  const fixture = TestBed.createComponent(AssistantClusteringComponent);
  const el = fixture.nativeElement as HTMLElement;
  const http = TestBed.inject(HttpTestingController);
  const lances: CorpsLancementClustering[] = [];
  fixture.componentInstance.lancer.subscribe((c) => lances.push(c));
  await fixture.whenStable();
  const cliquer = async (sel: string) => {
    const b = el.querySelector<HTMLElement>(sel);
    expect(b, `introuvable : ${sel}`).not.toBeNull();
    b!.click();
    await fixture.whenStable();
  };
  const texte = (sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  return { fixture, el, http, afficher, effacer, lances, cliquer, texte, calcul: TestBed.inject(CalculClusteringService) };
}

/** Étape 1 : les types arrivent ; « bmw » coché ; étape 2 : Hauts-de-France ; étape 3 : le comptage répond 6. */
async function jusquAuxParametres(m: Awaited<ReturnType<typeof monter>>) {
  m.http.expectOne('/api/poi-clusters/poi-types').flush({ types: TYPES });
  await m.fixture.whenStable();
  await m.cliquer('[data-type-poi="bmw"]');
  await m.cliquer('[data-suivant]');
  await m.cliquer('[data-region="32"]');
  await m.cliquer('[data-suivant]');
  const comptage = m.http.expectOne((r) => r.url === '/api/poi-clusters/count');
  expect(comptage.request.params.get('poi_types')).toBe('bmw');
  expect(comptage.request.params.get('metropolitaine')).toBe('true');
  expect(comptage.request.params.get('depts')).toBe('59,62');
  comptage.flush({ count: 6, poi_types: ['bmw'] });
  await m.fixture.whenStable();
}

describe('mg-assistant-clustering (ClusteringWizard.tsx)', () => {
  it('étape 1 : « Chargement… », puis les types (total fr-FR, « Clustérisé » écrit en clair) ; « Suivant » inactif sans choix', async () => {
    const m = await monter();
    expect(m.el.textContent).toContain('1 / 4 — Types de POI à clustériser');
    expect(m.el.textContent).toContain('Chargement…');
    m.http.expectOne('/api/poi-clusters/poi-types').flush({ types: TYPES });
    await m.fixture.whenStable();
    expect(m.texte('[data-type-poi="lycee"]')).toContain('5 584 POIs');
    expect(m.texte('[data-type-poi="cirfa"]')).toContain('Clustérisé');
    expect(m.texte('[data-type-poi="lycee"]')).not.toContain('Clustérisé');
    expect(m.el.querySelector<HTMLButtonElement>('[data-suivant]')!.disabled).toBe(true);
    await m.cliquer('[data-type-poi="bmw"]');
    expect(m.el.textContent).toContain('1 type sélectionné');
    expect(m.el.querySelector<HTMLButtonElement>('[data-suivant]')!.disabled).toBe(false);
  });

  it('aperçu des POI sur la carte : suit les types et « métropolitaine uniquement » ; effacé à la fermeture', async () => {
    const m = await monter();
    m.http.expectOne('/api/poi-clusters/poi-types').flush({ types: TYPES });
    await m.fixture.whenStable();
    await m.cliquer('[data-type-poi="bmw"]');
    expect(m.afficher).toHaveBeenLastCalledWith(['bmw'], true);
    await m.cliquer('[data-suivant]');
    await m.cliquer('[data-metropole]');
    expect(m.afficher).toHaveBeenLastCalledWith(['bmw'], false);
    expect(m.el.querySelector('[data-avertissement-drom]')).not.toBeNull();
    expect(m.el.querySelector('[data-region="04"]')).not.toBeNull();
    m.fixture.destroy();
    expect(m.effacer).toHaveBeenCalled();
  });

  it('étape 2 : DROM masquées en métropole ; « 1 région — 2 départements » ; « Retour »', async () => {
    const m = await monter();
    m.http.expectOne('/api/poi-clusters/poi-types').flush({ types: TYPES });
    await m.fixture.whenStable();
    await m.cliquer('[data-type-poi="bmw"]');
    await m.cliquer('[data-suivant]');
    expect(m.el.querySelector('[data-region="04"]')).toBeNull();
    expect(m.el.textContent).toContain('Aucune région sélectionnée = toute la France métropolitaine.');
    await m.cliquer('[data-region="32"]');
    expect(m.el.textContent).toContain('1 région — 2 départements');
    await m.cliquer('[data-retour]');
    expect(m.el.textContent).toContain('1 / 4 — Types de POI à clustériser');
  });

  it('étape 3 : le comptage, les variables (préréglage, thématique, avis), et « Lancer » ÉMET le corps exact — sans POST', async () => {
    const m = await monter();
    await jusquAuxParametres(m);
    expect(m.texte('[data-comptage]')).toMatch(/^6\s*POIs dans le périmètre$/);
    expect(m.texte('[data-avis-variables]')).toBe('Toutes les variables (16)');
    await m.cliquer('[data-prereglage="socio_demo"]');
    expect(m.texte('[data-avis-variables]')).toBe('Démographie + Revenus & Précarité (7 vars)');
    await m.cliquer('[data-raccourci="30"]');
    await m.cliquer('[data-transport="walk"]');
    await m.cliquer('[data-lancer]');
    expect(m.lances).toEqual([{
      poi_types: ['bmw'], geo_filter: { metropolitaine: true, regions: ['32'], depts: ['59', '62'] },
      params: { duration: 30, transport: 'walk', dry_run: false },
      features: ['pct_0_17', 'pct_18_39', 'pct_40_54', 'pct_55_79', 'pct_80p', 'revenu_moyen', 'taux_pauvrete'],
    }]);
    m.http.expectNone('/api/poi-clusters/run');
  });

  it('moins de 2 variables : « Lancer » inactif et l’avis le dit', async () => {
    const m = await monter();
    await jusquAuxParametres(m);
    await m.cliquer('[data-theme="demographie"] .case-theme');
    await m.cliquer('[data-theme="logement"] .case-theme');
    await m.cliquer('[data-theme="menages"] .case-theme');
    await m.cliquer('[data-theme="revenus"] [data-deplier]');
    await m.cliquer('[data-variable="taux_pauvrete"]');
    expect(m.texte('[data-avis-variables]')).toBe('! Minimum 2 variables requises');
    expect(m.el.querySelector<HTMLButtonElement>('[data-lancer]')!.disabled).toBe(true);
  });

  it('le refus de la garde n’apparaît qu’après un clic sur « Lancer »', async () => {
    const m = await monter();
    m.fixture.componentRef.setInput('refus', 'La bataille isochrone ne peut pas être calculée…');
    await jusquAuxParametres(m);
    expect(m.el.querySelector('[data-erreur-lancement]')).toBeNull();
    m.fixture.componentRef.setInput('refus', 'Le clustering ne peut pas être calculé sur la France entière — choisissez une région ou un département.');
    await m.cliquer('[data-lancer]');
    expect(m.texte('[data-erreur-lancement]')).toBe('! Le clustering ne peut pas être calculé sur la France entière — choisissez une région ou un département.');
  });

  it('étape 4 : résumé, job, statut sondé, journal ; « done » → message de fin, « Voir résultats » renvoie aux modèles', async () => {
    // Seuls les intervalles sont simulés : `whenStable` garde ses minuteries réelles.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const m = await monter();
      let voir = 0;
      m.fixture.componentInstance.voirModeles.subscribe(() => voir++);
      await jusquAuxParametres(m);
      // Le panneau Analyse lance après sa garde ; ici, on joue son rôle avec le corps émis.
      await m.cliquer('[data-lancer]');
      m.calcul.lancer(m.lances[0]);
      m.http.expectOne('/api/poi-clusters/run').flush({ job_id: 'abcdef1234567890' }, { status: 201, statusText: 'Created' });
      m.http.expectOne('/api/poi-clusters/run?job_id=abcdef1234567890').flush({ status: 'running', log_tail: '[1/6] BMW Lille — 15min — OK (1.2s)' });
      await m.fixture.whenStable();
      expect(m.el.textContent).toContain('4 / 4 — Exécution');
      expect(m.texte('[data-resume]')).toContain('Périmètre: France métro — 1 région(s)');
      expect(m.texte('[data-statut-job]')).toBe('running');
      expect(m.texte('[data-journal]')).toBe('[1/6] BMW Lille — 15min — OK (1.2s)');
      expect(m.el.querySelector('[data-voir-resultats]')).toBeNull();
      vi.advanceTimersByTime(3000);
      m.http.expectOne('/api/poi-clusters/run?job_id=abcdef1234567890').flush({ status: 'done', log_tail: 'fini' });
      m.http.expectOne('/api/poi-clusters/models').flush({ models: [] });
      await m.fixture.whenStable();
      expect(m.texte('[data-fin="done"]')).toContain('✓ Isochrones mis en cache.');
      await m.cliquer('[data-voir-resultats]');
      expect(voir).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('503 « script absent » : le message de la route affiché tel quel à l’étape 3', async () => {
    const m = await monter();
    await jusquAuxParametres(m);
    await m.cliquer('[data-lancer]');
    m.calcul.lancer(m.lances[0]);
    m.http.expectOne('/api/poi-clusters/run').flush(
      { error: 'Moteur de clustering indisponible : le script Python est absent de ce deploiement.' }, { status: 503, statusText: 'Service Unavailable' },
    );
    await m.fixture.whenStable();
    expect(m.texte('[data-erreur-lancement]')).toBe('! Moteur de clustering indisponible : le script Python est absent de ce deploiement.');
    expect(m.el.textContent).toContain('3 / 4 — Paramètres de calcul');
  });

  it('fermé en plein sondage : le job n’est plus sondé', async () => {
    // Seuls les intervalles sont simulés : `whenStable` garde ses minuteries réelles.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const m = await monter();
      await jusquAuxParametres(m);
      await m.cliquer('[data-lancer]');
      m.calcul.lancer(m.lances[0]);
      m.http.expectOne('/api/poi-clusters/run').flush({ job_id: 'job-x' }, { status: 201, statusText: 'Created' });
      m.http.expectOne('/api/poi-clusters/run?job_id=job-x').flush({ status: 'running' });
      m.fixture.destroy();
      vi.advanceTimersByTime(30000);
      m.http.expectNone('/api/poi-clusters/run?job_id=job-x');
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Revue 1 ──────────────────────────────────────────────────────────────

  it('durée frappée chiffre par chiffre « 1 », « 2 », « 0 » : le champ n’est jamais réécrit, la durée finit à 120', async () => {
    const m = await monter();
    await jusquAuxParametres(m);
    const champ = m.el.querySelector<HTMLInputElement>('[data-duree]')!;
    for (const texte of ['1', '12', '120']) {
      champ.value = texte;
      champ.dispatchEvent(new Event('input'));
      await m.fixture.whenStable();
      expect(champ.value).toBe(texte);
    }
    champ.dispatchEvent(new Event('change'));
    await m.fixture.whenStable();
    expect(champ.value).toBe('120');
    await m.cliquer('[data-lancer]');
    expect(m.lances.at(-1)!.params.duration).toBe(120);
  });

  it('durée hors bornes : bornée à la validation (sortie du champ), pas pendant la frappe', async () => {
    const m = await monter();
    await jusquAuxParametres(m);
    const champ = m.el.querySelector<HTMLInputElement>('[data-duree]')!;
    const valider = async (texte: string) => {
      champ.value = texte;
      champ.dispatchEvent(new Event('input'));
      await m.fixture.whenStable();
      expect(champ.value).toBe(texte);
      champ.dispatchEvent(new Event('change'));
      await m.fixture.whenStable();
    };
    await valider('200');
    expect(champ.value).toBe('120');
    await valider('2');
    expect(champ.value).toBe('5');
    await m.cliquer('[data-lancer]');
    expect(m.lances.at(-1)!.params.duration).toBe(5);
  });

  it('refus retenu au clic : un refus posé ENSUITE par un autre outil ne le remplace pas ; filtre posé ou « Retour » l’effacent', async () => {
    const m = await monter();
    await jusquAuxParametres(m);
    const clustering = 'Le clustering ne peut pas être calculé sur la France entière — choisissez une région ou un département.';
    // Le panneau Analyse refuse PENDANT l'émission (synchrone) : on joue son rôle.
    m.fixture.componentInstance.lancer.subscribe(() => m.fixture.componentRef.setInput('refus', clustering));
    await m.cliquer('[data-lancer]');
    await m.fixture.whenStable();
    expect(m.texte('[data-erreur-lancement]')).toBe(`! ${clustering}`);
    m.fixture.componentRef.setInput('refus', 'La bataille isochrone ne peut pas être calculée sur la France entière — choisissez une région ou un département.');
    await m.fixture.whenStable();
    expect(m.texte('[data-erreur-lancement]')).toBe(`! ${clustering}`);
    m.fixture.componentRef.setInput('refus', null);
    await m.fixture.whenStable();
    expect(m.el.querySelector('[data-erreur-lancement]')).toBeNull();
    m.fixture.componentRef.setInput('refus', 'Choisissez un périmètre (filtre ou zone) avant de lancer un calcul');
    await m.fixture.whenStable();
    expect(m.el.querySelector('[data-erreur-lancement]')).toBeNull();
    await m.cliquer('[data-lancer]');
    await m.fixture.whenStable();
    expect(m.texte('[data-erreur-lancement]')).toBe(`! ${clustering}`);
    await m.cliquer('[data-retour]');
    await m.cliquer('[data-suivant]');
    m.http.expectOne((r) => r.url === '/api/poi-clusters/count').flush({ count: 6 });
    await m.fixture.whenStable();
    expect(m.el.querySelector('[data-erreur-lancement]')).toBeNull();
  });

  it('refus au clic avec le MÊME texte qu’avant (la garde générique) : retenu quand même', async () => {
    const m = await monter();
    const generique = 'Choisissez un périmètre (filtre ou zone) avant de lancer un calcul';
    m.fixture.componentRef.setInput('refus', generique);
    await jusquAuxParametres(m);
    expect(m.el.querySelector('[data-erreur-lancement]')).toBeNull();
    await m.cliquer('[data-lancer]');
    await m.fixture.whenStable();
    expect(m.texte('[data-erreur-lancement]')).toBe(`! ${generique}`);
  });

  it('lancement admis : aucun refus affiché, même si la garde refusait avant', async () => {
    const m = await monter();
    m.fixture.componentRef.setInput('refus', 'Choisissez un périmètre (filtre ou zone) avant de lancer un calcul');
    await jusquAuxParametres(m);
    m.fixture.componentInstance.lancer.subscribe((c) => { m.fixture.componentRef.setInput('refus', null); m.calcul.lancer(c); });
    await m.cliquer('[data-lancer]');
    expect(m.calcul.lancement()).toBe(true);
    expect(m.el.querySelector('[data-erreur-lancement]')).toBeNull();
    m.http.expectOne('/api/poi-clusters/run');
  });

  it('fin d’un job lancé sur une SÉLECTION de variables : « modèle entraîné », sans « Lancez --mode full-retrain »', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const m = await monter();
      await jusquAuxParametres(m);
      await m.cliquer('[data-prereglage="habitat"]');
      await m.cliquer('[data-lancer]');
      m.calcul.lancer(m.lances[0]);
      m.http.expectOne('/api/poi-clusters/run').flush({ job_id: 'job-s' }, { status: 201, statusText: 'Created' });
      m.http.expectOne('/api/poi-clusters/run?job_id=job-s').flush({ status: 'done' });
      m.http.expectOne('/api/poi-clusters/models').flush({ models: [] });
      await m.fixture.whenStable();
      expect(m.texte('[data-fin="done"]')).toBe('✓ Isochrones mis en cache et modèle entraîné sur la sélection de variables. voir les résultats →');
      expect(m.el.textContent).not.toContain('full-retrain');
    } finally {
      vi.useRealTimers();
    }
  });
});
