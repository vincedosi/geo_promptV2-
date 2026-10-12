import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MODE_DEVELOPPEMENT } from '../core/environnement/mode-developpement';
import { BarreLateraleComponent } from './barre-laterale.component';

async function rendre(options: { dev?: boolean } = {}): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'catalogue', children: [] }, { path: 'carte', children: [{ path: 'risques', children: [] }] }]),
      { provide: MODE_DEVELOPPEMENT, useValue: options.dev ?? true },
    ],
  });
  const f = TestBed.createComponent(BarreLateraleComponent);
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

const texte = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const titres = (el: HTMLElement) => [...el.querySelectorAll('[data-section]')].map((s) => texte(s.querySelector('p')));
const entrees = (el: HTMLElement, section: string) =>
  [...el.querySelectorAll(`[data-section="${section}"] a`)].map((a) => texte(a.querySelector('span')));

describe('BarreLateraleComponent — AppSidebar.tsx porté', () => {
  it('reprend les sections de React, dans l\'ordre, avec les libellés exacts', async () => {
    const el = await rendre({ dev: false });
    expect(titres(el)).toEqual(['Campagnes', 'Carte', 'Administration', 'Systeme']);
    expect(entrees(el, 'Campagnes')).toEqual(['Gestion campagnes']);
    expect(entrees(el, 'Carte')).toEqual(['Explorer', 'Zones custom']);
    expect(entrees(el, 'Administration')).toEqual([
      'Import Shapefile', 'Import POI', 'Import OOH', 'IRIS Crawler', 'Radio FM/DAB+', 'Connexions API',
    ]);
    // « Users » et « Organisations » remplacées par « Accès » : écart VOULU à React
    // (spec espaces de travail 2026-10-08 § 6, décision E6).
    expect(entrees(el, 'Systeme')).toEqual([
      'Sources', 'Accès', 'Imports', 'Health check', 'Qualite des donnees',
    ]);
  });

  it('badges « Admin » sur les six entrées d\'administration, « Sys » sur les deux dernières du système', async () => {
    const el = await rendre({ dev: false });
    const badges = [...el.querySelectorAll('[data-badge]')].map((b) => texte(b));
    expect(badges).toEqual(['Admin', 'Admin', 'Admin', 'Admin', 'Admin', 'Admin', 'Sys', 'Sys']);
  });

  it('chaque entrée porte son icône lucide 16 px, trait 1,5 (comme `size={16} strokeWidth={1.5}`)', async () => {
    const el = await rendre({ dev: false });
    const svgs = [...el.querySelectorAll('nav a mg-icone svg')];
    // 14 et non 15 : deux entrées React remplacées par une (spec espaces de travail § 6, E6).
    expect(svgs.length).toBe(14);
    for (const svg of svgs) {
      expect(svg.getAttribute('width')).toBe('16');
      expect(svg.getAttribute('stroke-width')).toBe('1.5');
    }
  });

  it('« Explorer » mène à la carte principale (lot 4), par un lien RELATIF', async () => {
    const el = await rendre({ dev: false });
    const explorer = [...el.querySelectorAll('[data-section="Carte"] a')].find((a) => texte(a.querySelector('span')) === 'Explorer')!;
    expect(explorer.getAttribute('href')).toBe('/carte');
    expect(explorer.hasAttribute('aria-disabled')).toBe(false);
  });

  it('« Health check » mène à l’administration (lot 6, T3), par un lien RELATIF', async () => {
    const el = await rendre({ dev: false });
    const health = [...el.querySelectorAll('[data-section="Systeme"] a')].find((a) => texte(a.querySelector('span')) === 'Health check')!;
    expect(health.getAttribute('href')).toBe('/admin/health');
    expect(health.hasAttribute('aria-disabled')).toBe(false);
  });

  it('« Qualite des donnees » mène à l’administration (lot 6, T5), par un lien RELATIF', async () => {
    const el = await rendre({ dev: false });
    const qualite = [...el.querySelectorAll('[data-section="Systeme"] a')].find((a) => texte(a.querySelector('span')) === 'Qualite des donnees')!;
    expect(qualite.getAttribute('href')).toBe('/admin/qualite-donnees');
    expect(qualite.hasAttribute('aria-disabled')).toBe(false);
  });

  it('« Accès » mène à `admin/acces` (spec espaces de travail § 6 et § 11, E6), par un lien RELATIF', async () => {
    const el = await rendre({ dev: false });
    const espaces = [...el.querySelectorAll('[data-section="Systeme"] a')].find((a) => texte(a.querySelector('span')) === 'Accès')!;
    expect(espaces.getAttribute('href')).toBe('/admin/acces');
    expect(espaces.hasAttribute('aria-disabled')).toBe(false);
  });

  it('les écrans pas encore portés sont INERTES : aria-disabled, infobulle, aucun lien', async () => {
    const el = await rendre({ dev: false });
    const portes = ['Explorer', 'Health check', 'Qualite des donnees', 'Accès'];
    const liens = [...el.querySelectorAll('nav a')].filter((a) => !portes.includes(texte(a.querySelector('span'))));
    expect(liens.length).toBe(10);
    for (const a of liens) {
      expect(a.getAttribute('aria-disabled')).toBe('true');
      expect(a.getAttribute('title')).toBe('Disponible prochainement');
      expect(a.hasAttribute('href')).toBe(false);
    }
  });

  it('le bouton « Campagnes » est présent et inerte (arbitrage 6)', async () => {
    const el = await rendre();
    const bouton = [...el.querySelectorAll('button')].find((b) => texte(b) === 'Campagnes')!;
    expect(bouton).toBeTruthy();
    expect(bouton.getAttribute('aria-disabled')).toBe('true');
    expect(bouton.getAttribute('title')).toBe('Disponible prochainement');
    expect(bouton.querySelector('mg-hexagone')).toBeNull();
  });

  it('marque en tête (logo, signature), séparée par un filet 0,5 px', async () => {
    const el = await rendre();
    expect(el.querySelector('mg-marque')).not.toBeNull();
    expect(el.querySelector('mg-marque + [data-filet]')).not.toBeNull();
  });

  it('hors production : liens de développement en icônes dans le pied (RELATIFS), pas de section dans le nav', async () => {
    const el = await rendre({ dev: true });
    expect(titres(el)).not.toContain('Développement');
    expect(el.querySelectorAll('nav a').length).toBe(14); // E6 : 15 − 2 + 1
    const liens = [...el.querySelectorAll('[data-pied] [data-liens-dev] a')];
    expect(liens.map((a) => a.getAttribute('aria-label'))).toEqual(['Accueil', 'Catalogue', 'Module risque']);
    expect(liens.map((a) => a.getAttribute('title'))).toEqual(['Accueil', 'Catalogue', 'Module risque']);
    expect(liens.map((a) => a.getAttribute('href'))).toEqual(['/', '/catalogue', '/carte/risques']);
    for (const a of liens) expect(a.hasAttribute('aria-disabled')).toBe(false);
    expect(texte(el.querySelector('[data-pied]'))).toMatch(/^Online/);
  });

  it('en production : ni liens de développement ni pied « Online »', async () => {
    const el = await rendre({ dev: false });
    expect(titres(el)).not.toContain('Développement');
    expect(el.querySelector('[data-pied]')).toBeNull();
    expect(el.querySelector('[data-liens-dev]')).toBeNull();
    expect(el.textContent).not.toContain('Online');
  });

  it('aucun filtre par rôle : React affiche toutes les entrées à tous (le contrôle vit dans les routes)', async () => {
    // Le composant n'injecte ni session ni rôle : la même liste pour tous, par construction.
    const el = await rendre({ dev: false });
    expect(el.querySelectorAll('nav a').length).toBe(14); // E6 : 15 − 2 + 1
  });
});
