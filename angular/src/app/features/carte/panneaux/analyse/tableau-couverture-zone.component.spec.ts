import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { formaterNombre } from '../../../../core/format/nombre';
import type { LigneCouverture } from '../../logique/analyses/couverture';
import { TableauCouvertureZoneComponent } from './tableau-couverture-zone.component';

const lignes = (n: number): LigneCouverture[] => Array.from({ length: n }, (_, i) => ({
  code: `13${String(i).padStart(7, '0')}`, nom: `IRIS ${i}`, commune: 'Aix-en-Provence', n_carreaux: 1,
  pop_en_zone: 1000 - i, pop_totale: i === 3 ? null : 2000, part: i === 3 ? null : (1000 - i) / 20, part_brute: i === 3 ? null : (1000 - i) / 20,
}));

async function monter(l: LigneCouverture[], decoupage: 'cp' | 'iris' = 'iris') {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const f = TestBed.createComponent(TableauCouvertureZoneComponent);
  f.componentRef.setInput('lignes', l);
  f.componentRef.setInput('decoupage', decoupage);
  const survols: Array<string | null> = [];
  f.componentInstance.survol.subscribe((c) => survols.push(c));
  const el = f.nativeElement as HTMLElement;
  const stable = () => f.whenStable();
  await stable();
  const codes = () => [...el.querySelectorAll('[data-ligne]')].map((e) => e.getAttribute('data-ligne'));
  const cliquer = async (s: string) => { (el.querySelector(s) as HTMLElement).click(); await stable(); };
  return { f, el, stable, codes, cliquer, survols };
}

describe('mg-tableau-couverture-zone (lot 4, T8)', () => {
  it('5 498 IRIS : 50 lignes par page, compte « page n sur m », jamais tronqué sans le dire', async () => {
    const { el, codes, cliquer } = await monter(lignes(5498));
    expect(codes()).toHaveLength(50);
    expect(el.querySelector('[data-compte]')!.textContent).toContain(`${formaterNombre(5498)} IRIS · page 1 sur 110`);
    await cliquer('[data-suivantes]');
    expect(el.querySelector('[data-compte]')!.textContent).toContain('page 2 sur 110');
    expect(codes()[0]).toBe('130000050');
  });

  it('tri par colonne : la part décroissante, puis croissante ; une part absente toujours en dernier', async () => {
    const { codes, cliquer, el } = await monter(lignes(5));
    expect(codes()).toEqual(['130000000', '130000001', '130000002', '130000003', '130000004']);
    await cliquer('[data-tri="part"]');
    expect(codes().at(-1)).toBe('130000003');
    await cliquer('[data-tri="part"]');
    expect(codes()).toEqual(['130000004', '130000002', '130000001', '130000000', '130000003']);
    expect(el.querySelector('th[aria-sort="ascending"]')).not.toBeNull();
    expect(el.querySelector('[data-ligne="130000003"]')!.textContent).toContain('—');
  });

  it('le survol d’une ligne émet son code, puis null', async () => {
    const { el, survols } = await monter(lignes(2), 'cp');
    const tr = el.querySelector('[data-ligne="130000001"]')!;
    tr.dispatchEvent(new Event('mouseenter'));
    tr.dispatchEvent(new Event('mouseleave'));
    expect(survols).toEqual(['130000001', null]);
    expect(el.querySelector('[data-compte]')!.textContent).toContain('2 codes postaux');
    expect(el.querySelector('[data-suivantes]')).toBeNull();
  });
});
