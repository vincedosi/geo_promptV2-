import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SectionClusteringComponent } from './section-clustering.component';
import { MODELES, fournisseursClustering } from './testing/clustering-factice';

async function monter() {
  TestBed.configureTestingModule({ providers: [...fournisseursClustering(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(SectionClusteringComponent);
  const el = fixture.nativeElement as HTMLElement;
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  const ouvrir = async () => {
    el.querySelector<HTMLButtonElement>('[data-accordeon="clustering"]')!.click();
    await fixture.whenStable();
  };
  return { fixture, el, http, ouvrir };
}

describe('mg-section-clustering (ClusteringSection.tsx)', () => {
  it('replié : aucune requête ; ouvert : la liste des modèles, lue à l’ouverture', async () => {
    const { el, http, ouvrir, fixture } = await monter();
    http.expectNone('/api/poi-clusters/models');
    await ouvrir();
    expect(el.textContent).toContain('Chargement…');
    http.expectOne('/api/poi-clusters/models').flush({ models: MODELES });
    await fixture.whenStable();
    const cartes = [...el.querySelectorAll('[data-modele]')];
    expect(cartes).toHaveLength(2);
    const morceaux = [...cartes[0].querySelectorAll('span, div > div')].map((e) => e.textContent!.trim());
    expect(morceaux).toEqual(expect.arrayContaining(['v3', 'SIL 0.299', '12/09/26', '4 clusters · 95 POI · 15min drive']));
    expect(cartes[1].textContent).toContain('SIL 0.325');
    http.verify();
  });

  it('liste en échec : le message de la route, jamais « Aucun modèle calculé »', async () => {
    const { el, http, ouvrir, fixture } = await monter();
    await ouvrir();
    http.expectOne('/api/poi-clusters/models').flush({ error: 'Accès réservé au super administrateur' }, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    expect(el.textContent).toContain('Accès réservé au super administrateur');
    expect(el.textContent).not.toContain('Aucun modèle calculé');
  });

  it('un modèle cliqué ouvre son rapport ; « + Nouveau clustering » ouvre le panneau de clusters', async () => {
    const { el, http, ouvrir, fixture } = await monter();
    await ouvrir();
    http.expectOne('/api/poi-clusters/models').flush({ models: MODELES });
    await fixture.whenStable();
    el.querySelector<HTMLElement>('[data-modele="3"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('mg-rapport-clusters')).not.toBeNull();
    http.expectOne('/api/poi-clusters/models/3');
    http.expectOne('/api/poi-clusters/france-averages');
    el.querySelector<HTMLButtonElement>('[data-nouveau]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('mg-panneau-clusters')).not.toBeNull();
    expect(el.textContent).toContain('← Liste des modèles');
  });

  it('« Charger les clusters » est RELAYÉ au parent (qui garde le périmètre) — la section ne charge rien elle-même', async () => {
    const { el, http, ouvrir, fixture } = await monter();
    let relais = 0;
    fixture.componentInstance.charger.subscribe(() => relais++);
    await ouvrir();
    http.expectOne('/api/poi-clusters/models').flush({ models: MODELES });
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('[data-nouveau]')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('[data-charger]')!.click();
    expect(relais).toBe(1);
    http.expectNone('/api/poi-clusters?duration=60');
  });

  it('tiroir (retours du 26/10, T7) : rouvrir ne relit PAS la liste ; après un échec, la réouverture la relit', async () => {
    const { http, ouvrir, fixture } = await monter();
    await ouvrir();
    http.expectOne('/api/poi-clusters/models').flush({ models: MODELES });
    await fixture.whenStable();
    await ouvrir();
    await ouvrir();
    http.expectNone('/api/poi-clusters/models');
    // Un échec n'est pas retenu.
    const echec = await (async () => {
      TestBed.resetTestingModule();
      return monter();
    })();
    await echec.ouvrir();
    echec.http.expectOne('/api/poi-clusters/models').flush({ error: 'panne' }, { status: 500, statusText: 'Erreur' });
    await echec.fixture.whenStable();
    await echec.ouvrir();
    await echec.ouvrir();
    echec.http.expectOne('/api/poi-clusters/models').flush({ models: [] });
    echec.http.verify();
  });
});
