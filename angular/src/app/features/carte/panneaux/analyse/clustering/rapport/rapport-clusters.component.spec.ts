import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DETAIL_MODELE, fournisseursClustering } from '../testing/clustering-factice';
import { RapportClustersComponent } from './rapport-clusters.component';

const FRANCE = { averages: { pct_0_17: { avg: 0.2016, std: 0, min: 0, max: 1, n_carreaux: 822727 }, revenu_moyen: { avg: 1.2837, std: 0, min: 0, max: 3, n_carreaux: 822727 } }, computed_at: 'x' };

async function monter() {
  TestBed.configureTestingModule({ providers: [...fournisseursClustering(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(RapportClustersComponent);
  fixture.componentRef.setInput('version', 3);
  const el = fixture.nativeElement as HTMLElement;
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  const texte = () => el.textContent!.replace(/\s+/g, ' ');
  const onglet = async (nom: string) => {
    [...el.querySelectorAll<HTMLButtonElement>('[data-onglet]')].find((b) => b.textContent!.trim() === nom)!.click();
    await fixture.whenStable();
  };
  return { fixture, el, http, texte, onglet };
}

describe('mg-rapport-clusters (ClusterResultsOverlay + ClusterDetails.tsx)', () => {
  it('ouvre un <dialog> (jamais un portail), lit le modèle et les moyennes nationales — et PAS l’analyse Gemini', async () => {
    const { el, http, texte, fixture } = await monter();
    expect(el.querySelector('dialog')).not.toBeNull();
    expect(texte()).toContain('Chargement...');
    http.expectOne('/api/poi-clusters/models/3').flush(DETAIL_MODELE);
    http.expectOne('/api/poi-clusters/france-averages').flush(FRANCE);
    http.expectNone('/api/poi-clusters/models/3/analysis');
    await fixture.whenStable();
    expect(texte()).toContain('Clustering v3');
    expect(texte()).toContain('SIL 0.299');
    expect(texte()).toContain('2 clusters · 95 POI · 15min drive');
    expect([...el.querySelectorAll('[data-onglet]')].map((b) => b.textContent!.trim())).toEqual(
      ['Résumé', 'Carte', 'Profils', 'Comparaison', 'Qualité', 'Méthodologie', 'Historique'],
    );
    // Résumé : le panneau du modèle.
    expect(texte()).toMatch(/Silhouette\s*0\.2992/);
    expect(texte()).toMatch(/Variance expliquée\s*86\.1%/);
    expect(texte()).toContain('3 POI classifiés');
    http.verify();
  });

  it('onglets Carte, Qualité, Méthodologie, Historique : chiffres du modèle', async () => {
    const { http, texte, fixture, onglet } = await monter();
    http.expectOne('/api/poi-clusters/models/3').flush(DETAIL_MODELE);
    http.expectOne('/api/poi-clusters/france-averages').flush(FRANCE);
    await fixture.whenStable();
    await onglet('Carte');
    expect(texte()).toContain('1 POI classifiés');
    expect(texte()).toContain('812 carreaux');
    expect(texte()).toContain('1 imputés');
    await onglet('Qualité');
    expect(texte()).toMatch(/0\.299\s*Faible/);
    expect(texte()).toContain('1 / 1 POI avec features imputées');
    await onglet('Méthodologie');
    expect(texte()).toContain('K retenu : 2. Score final : 0.2992.');
    await onglet('Historique');
    expect(texte()).toMatch(/C0 \(v2\)\s*→\s*C1 \(v3\)/);
  });

  it('moyennes nationales absentes (404) : le rapport s’affiche quand même, sans référence', async () => {
    const { http, texte, fixture, onglet } = await monter();
    http.expectOne('/api/poi-clusters/models/3').flush(DETAIL_MODELE);
    http.expectOne('/api/poi-clusters/france-averages').flush({ error: 'Moyennes non calculées' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    await onglet('Profils');
    expect(texte()).not.toContain('Moy. France');
  });

  it('modèle introuvable : « ! message » et « ← Retour » qui ferme', async () => {
    const { el, http, texte, fixture } = await monter();
    let fermetures = 0;
    fixture.componentInstance.fermer.subscribe(() => fermetures++);
    http.expectOne('/api/poi-clusters/france-averages').flush(FRANCE);
    http.expectOne('/api/poi-clusters/models/3').flush({ error: 'Modèle introuvable' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(texte()).toContain('! Modèle introuvable');
    el.querySelector<HTMLButtonElement>('[data-retour]')!.click();
    expect(fermetures).toBe(1);
  });

  it('exports XLSX et PDF : visibles, DÉSACTIVÉS, avec la raison', async () => {
    const { el, http, fixture } = await monter();
    http.expectOne('/api/poi-clusters/models/3').flush(DETAIL_MODELE);
    http.expectOne('/api/poi-clusters/france-averages').flush(FRANCE);
    await fixture.whenStable();
    const exports = [...el.querySelectorAll<HTMLButtonElement>('[data-export]')];
    expect(exports.map((b) => [b.textContent!.trim(), b.disabled])).toEqual([['↓ XLSX', true], ['↓ PDF', true]]);
    expect(exports[0].title).toContain('Export non restauré');
  });

  it('une teinte de cluster invalide retombe sur la donnée absente (valeur calculée), jamais sur une couleur vide', async () => {
    const { el, http, fixture, onglet } = await monter();
    const resume = { ...DETAIL_MODELE.cluster_summary, '1': { ...DETAIL_MODELE.cluster_summary['1'], color: 'red;x' } };
    http.expectOne('/api/poi-clusters/models/3').flush({ ...DETAIL_MODELE, cluster_summary: resume });
    http.expectOne('/api/poi-clusters/france-averages').flush(FRANCE);
    await fixture.whenStable();
    await onglet('Comparaison');
    const entetes = [...el.querySelectorAll<HTMLElement>('mg-onglet-comparaison th')].map((t) => t.style.color);
    // Feature, Moy. Fr, puis les deux clusters : le second, invalide, prend le gris calculé (#123456 du banc).
    expect(entetes.slice(2)).toEqual(['rgb(78, 121, 167)', 'rgb(18, 52, 86)']);
  });
});
