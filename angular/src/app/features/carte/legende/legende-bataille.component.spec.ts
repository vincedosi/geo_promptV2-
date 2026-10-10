import { CaptureService } from '../etat/capture.service';
import { TestBed } from '@angular/core/testing';
import { BatailleService } from '../couches/bataille.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { VORONOI_PALETTE } from '../logique/palettes-donnees-carte';
import { LegendeBatailleComponent } from './legende-bataille.component';

const anneaux = (n: number): GeoJSON.Feature[] => Array.from({ length: n }, (_, i) => ({
  type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { id: `p${i}`, nom: `CIRFA ${i}`, palier: 10 },
}));

async function monter() {
  TestBed.configureTestingModule({ providers: [CaptureService, BatailleService, CouchesCarteService] });
  const bataille = TestBed.inject(BatailleService);
  const fixture = TestBed.createComponent(LegendeBatailleComponent);
  const el = fixture.nativeElement as HTMLElement;
  await fixture.whenStable();
  return { fixture, el, bataille };
}

describe('LegendeBatailleComponent (LegendeCarte.tsx:408-460, T17)', () => {
  it('rien tant qu’aucune bataille n’est affichée', async () => {
    const { el } = await monter();
    expect(el.querySelector('[data-bloc="bataille"]')).toBeNull();
  });

  it('bataille affichée : « BATAILLE · cirfa », palier max 90 min, réglette 10-90 pas 10, rampe de sept paliers', async () => {
    const { el, fixture, bataille } = await monter();
    bataille.peindre({ anneaux: anneaux(2), categorie: 'cirfa' });
    await fixture.whenStable();
    const bloc = el.querySelector('[data-bloc="bataille"]')!;
    expect(bloc.textContent).toContain('BATAILLE · cirfa');
    expect(bloc.textContent).toContain('PALIER_MAX');
    expect(bloc.querySelector('[data-palier-max]')!.textContent).toBe('90 min');
    const r = bloc.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect([r.min, r.max, r.step, r.value]).toEqual(['10', '90', '10', '90']);
    expect([...bloc.querySelectorAll('[data-rampe]')].map((c) => c.textContent!.trim())).toEqual(['10', '20', '30', '40', '50', '60', '90']);
    expect([...bloc.querySelectorAll('[data-poi-bataille]')].map((c) => c.textContent!.trim())).toEqual(['CIRFA 0', 'CIRFA 1']);
    expect((bloc.querySelector('[data-poi-bataille] span') as HTMLElement).style.borderColor).toBeTruthy();
    expect(VORONOI_PALETTE[0]).toBe('#4e79a7');
  });

  it('la réglette règle le palier maximum ; les cases au-delà s’éteignent', async () => {
    const { el, fixture, bataille } = await monter();
    bataille.peindre({ anneaux: anneaux(1), categorie: 'cirfa' });
    await fixture.whenStable();
    const r = el.querySelector<HTMLInputElement>('input[type="range"]')!;
    r.value = '30';
    r.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(bataille.palierMax()).toBe(30);
    expect(el.querySelector('[data-palier-max]')!.textContent).toBe('30 min');
    expect([...el.querySelectorAll('[data-rampe]')].map((c) => c.getAttribute('data-actif'))).toEqual(['true', 'true', 'true', 'false', 'false', 'false', 'false']);
  });

  it('plus de huit POI : huit lignes puis « +N autres »', async () => {
    const { el, fixture, bataille } = await monter();
    bataille.peindre({ anneaux: anneaux(11), categorie: 'cirfa' });
    await fixture.whenStable();
    expect(el.querySelectorAll('[data-poi-bataille]').length).toBe(8);
    expect(el.textContent).toContain('+3 autres');
  });

  it('bataille masquée : le bloc disparaît', async () => {
    const { el, fixture, bataille } = await monter();
    bataille.peindre({ anneaux: anneaux(1), categorie: 'cirfa' });
    bataille.visible.set(false);
    await fixture.whenStable();
    expect(el.querySelector('[data-bloc="bataille"]')).toBeNull();
  });
});
