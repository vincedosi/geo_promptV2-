import { TestBed } from '@angular/core/testing';
import type { ZoneGeo } from '../../logique/mini-france';
import { PALETTES_DONNEES } from '../../logique/palettes-donnees';
import { CONTOURS_REGIONS } from '../../testing/mini-france.fixture';
import { CarteMiniFranceComponent } from './carte-mini-france.component';

const n = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ').replace(/ +/g, ' ').trim();
const ROUGE = PALETTES_DONNEES[0].stops;
const ZONES = CONTOURS_REGIONS as unknown as ZoneGeo[];

async function rendre(entrees: Record<string, unknown> = {}) {
  const f = TestBed.createComponent(CarteMiniFranceComponent);
  f.componentRef.setInput('zones', ZONES);
  f.componentRef.setInput('valeurs', new Map([['11', 26], ['84', 4], ['93', 9], ['02', 3]]));
  f.componentRef.setInput('libelleValeur', 'Part %');
  f.componentRef.setInput('stops', ROUGE);
  for (const [k, v] of Object.entries(entrees)) f.componentRef.setInput(k, v);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const chemin = (code: string) => el.querySelector(`path[data-code="${code}"]`) as SVGPathElement;
  return { f, el, chemin, c: f.componentInstance };
}

describe('mg-carte-mini-france', () => {
  it('aplat : la première teinte (quasi blanche) est écartée, une unité sans valeur est GRISE', async () => {
    const { el, chemin } = await rendre();
    expect(chemin('24').style.fill).toBe('var(--donnee-absente)');
    // Quatre valeurs → quatre classes : la plus forte (Île-de-France) prend la 4e teinte de la rampe RACCOURCIE
    // (#DE2D26, la 5e de la palette), comme React ; aucune unité ne prend #FFF5F0.
    expect(chemin('11').style.fill).toBe('rgb(222, 45, 38)');
    expect(chemin('84').style.fill).toBe('rgb(252, 187, 161)');
    const fills = Array.from(el.querySelectorAll<SVGPathElement>('path[data-code]')).map((p) => p.style.fill);
    expect(fills).not.toContain('rgb(255, 245, 240)');
    expect(el.querySelector('svg')?.getAttribute('aria-label')).toBe('Carte de France — Part %');
  });

  it('cartouches : seuls les territoires lointains EXPOSÉS (Martinique oui, La Réunion non)', async () => {
    const { el } = await rendre();
    expect(Array.from(el.querySelectorAll('[data-om]')).map((g) => g.getAttribute('data-om'))).toEqual(['02']);
    expect(n(el.querySelector('[data-om="02"] text')?.textContent)).toBe('02');
  });

  it('légende : bornes ÉCRITES, libellé, et « aucune exposition » à part', async () => {
    const { el } = await rendre();
    expect(Array.from(el.querySelectorAll('[data-role="bornes"] span')).map((s) => n(s.textContent))).toEqual(['3', '4', '9', '26']);
    expect(n(el.querySelector('[data-role="libelle-echelle"]')?.textContent)).toBe('Part % · seuils naturels');
    expect(n(el.textContent)).toContain('aucune exposition');
  });

  it('survol : infobulle sous la carte, relayé au parent, effacé à la sortie', async () => {
    const { f, el, chemin, c } = await rendre({ formater: (v: number) => `${v} %` });
    const emis: (string | null)[] = [];
    c.survol.subscribe((v) => emis.push(v));
    expect(n(el.querySelector('[data-role="infobulle"]')?.textContent)).toBe('Survolez une unité');
    chemin('11').dispatchEvent(new MouseEvent('mouseenter'));
    await f.whenStable();
    expect(n(el.querySelector('[data-role="infobulle"]')?.textContent)).toBe('Région 11 — 26 %');
    expect(chemin('11').style.stroke).toBe('var(--brand-teal)');
    expect(chemin('11').getAttribute('stroke-width')).toBe('1.6');
    el.querySelector('svg')!.dispatchEvent(new MouseEvent('mouseleave'));
    await f.whenStable();
    expect(emis).toEqual(['11', null]);
    expect(n(el.querySelector('[data-role="infobulle"]')?.textContent)).toBe('Survolez une unité');
  });

  it('cadrage : l’unité sélectionnée remplit le cadre ; un code non dessiné retombe sur la France', async () => {
    const { f, chemin } = await rendre();
    const avant = chemin('93').getAttribute('d');
    f.componentRef.setInput('cadrageSur', '93');
    await f.whenStable();
    expect(chemin('93').getAttribute('d')).not.toBe(avant);
    f.componentRef.setInput('cadrageSur', '99');
    await f.whenStable();
    expect(chemin('93').getAttribute('d')).toBe(avant);
  });

  it('clic : émis tel quel (le parent sélectionne)', async () => {
    const { chemin, c } = await rendre();
    const emis: string[] = [];
    c.clic.subscribe((v) => emis.push(v));
    chemin('84').dispatchEvent(new MouseEvent('click'));
    expect(emis).toEqual(['84']);
  });

  it('cercles : aire ∝ valeur (rayon 2 + √(v/max)·15), fond neutre', async () => {
    const { el, chemin } = await rendre({ mode: 'cercles' });
    const r = (code: string) => Number(el.querySelector(`circle[data-cercle="${code}"]`)?.getAttribute('r'));
    expect(r('11')).toBe(17);
    expect(r('84')).toBeCloseTo(2 + Math.sqrt(4 / 26) * 15, 10);
    expect(el.querySelector('circle[data-cercle="24"]')).toBeNull();
    expect(chemin('11').style.fill).toBe('var(--bg-level-2)');
  });
});
