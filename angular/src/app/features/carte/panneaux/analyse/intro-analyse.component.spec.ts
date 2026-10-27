import { TestBed } from '@angular/core/testing';
import { IntroAnalyseComponent } from './intro-analyse.component';

async function monter(nombrePoi: number) {
  const fixture = TestBed.createComponent(IntroAnalyseComponent);
  fixture.componentRef.setInput('nombrePoi', nombrePoi);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('IntroAnalyseComponent (SpatialAnalysisIntro.tsx, T17)', () => {
  it('aucun POI : l’outil disponible et la condition, textes exacts — le Voronoï n’y est plus (absent du panneau)', async () => {
    const el = await monter(0);
    expect(el.querySelector('[data-intro-vide]')!.textContent).toContain('Analyses spatiales disponibles');
    // L'outil annoncé est la V2 depuis le retrait de la V1 (27/10) — « Isochrones routiers » n'existe plus.
    expect(el.textContent).toContain('Bataille V2 (multi-paliers)');
    expect(el.textContent).toContain('Temps de trajet ORS, lus dans le cache');
    expect(el.textContent).not.toContain('Isochrones routiers');
    expect(el.textContent).toContain('Sélectionnez 1 seul type de POI');
    expect(el.textContent).toContain('Isolez un réseau (ex: CIRFA) pour débloquer le calcul de zone de chalandise.');
    expect(el.textContent).not.toContain('Voronoï');
  });

  it('trop de types : « Retirez N type(s). », singulier et pluriel', async () => {
    expect((await monter(2)).querySelector('[data-intro-trop]')!.textContent).toContain('Les analyses spatiales nécessitent exactement 1 type de POI. Retirez 1 type.');
    TestBed.resetTestingModule();
    expect((await monter(4)).textContent).toContain('Retirez 3 types.');
  });

  it('un seul type : rien', async () => {
    const el = await monter(1);
    expect(el.textContent!.trim()).toBe('');
  });
});
