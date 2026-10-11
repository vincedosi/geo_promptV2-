import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../../../carte/testing/carte-factice';
import { COUCHE_CLUSTERS, ClustersService } from '../../../couches/clusters.service';
import { CouchesCarteService } from '../../../etat/couches-carte.service';
import { EtatCarteService } from '../../../etat/etat-carte.service';
import { PileEchapService } from '../../../etat/pile-echap.service';
import { PanneauClustersComponent } from './panneau-clusters.component';
import { CLUSTERS, fournisseursClustering } from './testing/clustering-factice';

async function monter(o: { charge?: boolean } = {}) {
  TestBed.configureTestingModule({ providers: [...fournisseursClustering(), provideHttpClientTesting()] });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  TestBed.inject(CouchesCarteService).publier(carte as unknown as maplibregl.Map);
  const service = TestBed.inject(ClustersService);
  const http = TestBed.inject(HttpTestingController);
  if (o.charge) {
    service.charger();
    http.expectOne('/api/poi-clusters?duration=60').flush(CLUSTERS);
  }
  const fixture = TestBed.createComponent(PanneauClustersComponent);
  const el = fixture.nativeElement as HTMLElement;
  await fixture.whenStable();
  const cliquer = async (sel: string) => {
    const b = el.querySelector<HTMLElement>(sel);
    expect(b, `introuvable : ${sel}`).not.toBeNull();
    b!.click();
    await fixture.whenStable();
  };
  /** Un clic sur un point de la couche, comme MapLibre le rend. */
  const cliquerPoint = async (i: number) => {
    const f = CLUSTERS.features[i];
    carte.emettreSurCouche('click', COUCHE_CLUSTERS, { features: [{ properties: f.properties }], lngLat: { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] } });
    await fixture.whenStable();
  };
  const texte = () => el.textContent!.replace(/\s+/g, ' ');
  return { fixture, el, http, service, carte, cliquer, cliquerPoint, texte, pile: TestBed.inject(PileEchapService) };
}

describe('mg-panneau-clusters (ClusterPanel.tsx)', () => {
  it('sans données : texte d’accueil, « Charger les clusters » ÉMET (le parent garde), « Nouveau clustering » ouvre l’assistant (T20)', async () => {
    const { el, fixture, http, texte } = await monter();
    let emis = 0;
    fixture.componentInstance.charger.subscribe(() => emis++);
    expect(texte()).toContain('Visualise les POI regroupés par profil sociodémographique de leur bassin de chalandise.');
    el.querySelector<HTMLButtonElement>('[data-charger]')!.click();
    expect(emis).toBe(1);
    http.expectNone('/api/poi-clusters?duration=60');
    el.querySelector<HTMLButtonElement>('[data-assistant]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('mg-assistant-clustering')).not.toBeNull();
    http.expectOne('/api/poi-clusters/poi-types');
  });

  it('sans données, après un 404 : le message s’affiche', async () => {
    const { service, http, fixture, texte } = await monter();
    service.charger();
    http.expectOne('/api/poi-clusters?duration=60').flush({ error: 'x' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(texte()).toContain('Aucun modèle de clustering à 60 min');
  });

  it('chargé : en-tête (version, K, silhouette, variance), sélecteur 30/45/60, onglets', async () => {
    const { texte, el } = await monter({ charge: true });
    expect(texte()).toContain('Clusters v3');
    expect(texte()).toContain('K=2');
    expect(texte()).toContain('Sil=0.299');
    expect(texte()).toContain('Var=86%');
    expect([...el.querySelectorAll('[data-duree]')].map((b) => b.textContent!.trim())).toEqual(['30 min', '45 min', '60 min']);
    expect(el.querySelector('[data-duree="60"]')!.getAttribute('aria-pressed')).toBe('true');
    expect([...el.querySelectorAll('[data-onglet]')].map((b) => b.textContent!.trim())).toEqual(['Légende', 'POI (3)', 'Comparer']);
    expect(texte()).toContain('2 clusters · 3 POI');
  });

  it('changer de durée → nouvelle requête ; « Visible » → bascule sans requête', async () => {
    const { cliquer, http, carte } = await monter({ charge: true });
    await cliquer('[data-visible]');
    expect(carte.dispositions.filter((d) => d.couche === COUCHE_CLUSTERS).at(-1)!.valeur).toBe('none');
    http.expectNone(() => true);
    await cliquer('[data-duree="30"]');
    http.expectOne('/api/poi-clusters?duration=30');
  });

  it('un cluster de la légende : cadrage sur ses POI, filtre, onglet POI', async () => {
    const { cliquer, carte, texte, el } = await monter({ charge: true });
    await cliquer('[data-cluster="0"]');
    expect(carte.cadrages.at(-1)).toEqual({ cadre: [[4.8, 45.76], [4.83, 45.78]], options: { padding: 60, duration: 1000 } });
    expect(texte()).toContain('Tous · Cluster 0');
    expect(el.querySelectorAll('[data-ligne-poi]')).toHaveLength(2);
    await cliquer('[data-ligne-poi="p1"]');
    expect(carte.vols.at(-1)).toEqual({ center: [4.83, 45.76], zoom: 12, duration: 1000 });
  });

  it('détail d’un POI cliqué sur la carte : fiche, historique (GET /history) et durées (GET /poi)', async () => {
    const { cliquerPoint, cliquer, http, texte, fixture } = await monter({ charge: true });
    await cliquerPoint(0);
    expect(texte()).toContain('Lycée Ampère');
    expect(texte()).toContain('Lyon · lycee');
    await cliquer('[data-historique]');
    http.expectOne('/api/poi-clusters/history/p1').flush([
      { id: 1, cluster_id: 2, cluster_label: null, model_version: 3, action: 'full-retrain', previous_cluster_id: 1, changed: true, created_at: '2026-09-12T09:52:57Z' },
    ]);
    await fixture.whenStable();
    expect(texte()).toContain('Cluster 2');
    expect(texte()).toContain('v3 · full-retrain');
    await cliquer('[data-durees]');
    http.expectOne('/api/poi-clusters/poi/p1').flush({ poi_id: 'p1', durations: { '15': { profile_features: { pct_0_17: 0.2, pct_18_39: 0.3, pct_40_54: 0.1 } } } });
    await fixture.whenStable();
    expect(texte()).toContain('Comparaison durées');
    expect(texte()).toContain('15 min');
  });

  it('comparer deux POI : mode sélection (Échap empilé), second clic → comparaison et verdict', async () => {
    const { cliquerPoint, cliquer, texte, pile, fixture } = await monter({ charge: true });
    await cliquerPoint(0);
    await cliquer('[data-comparer]');
    expect(texte()).toContain('Mode comparaison');
    expect(texte()).toContain('POI A : Lycée Ampère');
    expect(pile.etat().map((e) => e.id)).toContain('cluster-compare');
    await cliquerPoint(1);
    expect(texte()).toContain('Clusters distincts. Différences principales :');
    pile.fermerLePlusHaut();
    await fixture.whenStable();
    expect(pile.etat().map((e) => e.id)).not.toContain('cluster-compare');
    expect(texte()).not.toContain('Clusters distincts.');
  });

  it('clusters chargés : seuls les clics sur un POINT sont réservés au panneau ; la carte n’est pas prise', async () => {
    const { fixture, carte } = await monter({ charge: true });
    const etat = TestBed.inject(EtatCarteService);
    const clic = new MouseEvent('mousedown', { clientX: 10, clientY: 20 });
    expect(etat.carteOccupee()).toBe(false);
    carte.entitesRendues = [];
    expect(etat.clicReserve(clic)).toBe(false);
    carte.entitesRendues = [{ properties: CLUSTERS.features[0].properties }];
    expect(etat.clicReserve(clic)).toBe(true);
    fixture.destroy();
    expect(etat.clicReserve(clic)).toBe(false);
  });

  it('sans clusters : aucun clic réservé', async () => {
    const { carte } = await monter();
    carte.entitesRendues = [{ properties: {} }];
    expect(TestBed.inject(EtatCarteService).clicReserve(new MouseEvent('mousedown'))).toBe(false);
  });

  it('historique de A puis de B : la réponse tardive de A est ANNULÉE, la fiche de B ne montre que B', async () => {
    const { cliquerPoint, cliquer, http, texte, fixture } = await monter({ charge: true });
    await cliquerPoint(0);
    await cliquer('[data-historique]');
    const reqA = http.expectOne('/api/poi-clusters/history/p1');
    await cliquerPoint(1);
    await cliquer('[data-historique]');
    const reqB = http.expectOne('/api/poi-clusters/history/p2');
    expect(reqA.cancelled).toBe(true);
    reqB.flush([{ id: 2, cluster_id: 7, cluster_label: null, model_version: 3, action: 'full-retrain', previous_cluster_id: null, changed: false, created_at: '2026-09-12T09:52:57Z' }]);
    await fixture.whenStable();
    expect(texte()).toContain('Cluster 7');
    expect(texte()).toContain('Lycée du Parc');
  });

  it('historique en échec : un message, au lieu d’un bouton sans effet', async () => {
    const { cliquerPoint, cliquer, http, el, fixture } = await monter({ charge: true });
    await cliquerPoint(0);
    await cliquer('[data-historique]');
    http.expectOne('/api/poi-clusters/history/p1').flush({ error: 'panne' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    expect(el.querySelector('[data-erreur-historique]')!.textContent).toContain('Historique indisponible — panne');
  });

  it('durées en échec : un message d’erreur, DISTINCT de « Aucune donnée multi-durée disponible »', async () => {
    const { cliquerPoint, cliquer, http, el, texte, fixture } = await monter({ charge: true });
    await cliquerPoint(0);
    await cliquer('[data-durees]');
    http.expectOne('/api/poi-clusters/poi/p1').flush({ error: 'panne' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    expect(el.querySelector('[data-erreur-durees]')!.textContent).toContain('Profils multi-durées indisponibles — panne');
    expect(texte()).not.toContain('Aucune donnée multi-durée disponible');
  });

  it('instructions : sentence case, et les vrais boutons « Comparer » / « Durées », durées de la constante', async () => {
    const { cliquer, texte } = await monter({ charge: true });
    await cliquer('[data-onglet]:nth-child(3)');
    expect(texte()).toContain('Cliquez « Comparer » dans sa fiche');
    expect(texte()).toContain('cliquez « Durées » pour voir comment son bassin évolue à 30/45/60 min.');
    expect(texte()).not.toMatch(/COMPARER|DURÉES/);
  });
});
