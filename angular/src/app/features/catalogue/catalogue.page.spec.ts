import { TestBed } from '@angular/core/testing';
import { CataloguePage } from './catalogue.page';

describe('CataloguePage', () => {
  it('rend chaque famille de composants', async () => {
    const f = TestBed.createComponent(CataloguePage);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    for (const s of ['mg-barre-progression', 'mg-kpi', 'mg-icone', 'button[mgpastille]', 'mg-champ', 'mg-fil-etapes', 'mg-fil-ariane', 'mg-reglette', 'th[mgth]', 'td[mgtd]']) {
      expect(el.querySelector(s), s).not.toBeNull();
    }
  });

  it('lancer un calcul allume la barre', async () => {
    const f = TestBed.createComponent(CataloguePage);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    (el.querySelector('button[mgpastille]') as HTMLButtonElement).click();
    await f.whenStable();
    expect(el.querySelector('[role="progressbar"]')!.getAttribute('aria-busy')).toBe('true');
  });
});
