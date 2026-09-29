import { TestBed } from '@angular/core/testing';
import { ChargementService } from '../../core/chargement/chargement.service';
import { BarreProgressionComponent } from './barre-progression.component';

async function rendre() {
  TestBed.configureTestingModule({ imports: [BarreProgressionComponent], providers: [ChargementService] });
  const f = TestBed.createComponent(BarreProgressionComponent);
  await f.whenStable();
  return { f, el: f.nativeElement as HTMLElement, chargement: TestBed.inject(ChargementService) };
}

describe('BarreProgressionComponent', () => {
  it('reste montée et muette sans travail en cours', async () => {
    const { el } = await rendre();
    const barre = el.querySelector('[role="progressbar"]')!;
    expect(barre.getAttribute('aria-busy')).toBe('false');
    expect(barre.getAttribute('aria-label')).toBe('Aucun calcul en cours');
  });

  it('annonce le travail en cours', async () => {
    const { f, el, chargement } = await rendre();
    chargement.declarer({ cle: 'a', libelle: 'Calcul des classes', actif: true });
    await f.whenStable();
    const barre = el.querySelector('[role="progressbar"]')!;
    expect(barre.getAttribute('aria-busy')).toBe('true');
    expect(barre.getAttribute('aria-label')).toBe('Calcul des classes');
    expect(el.textContent).toContain('Calcul des classes');
  });
});
