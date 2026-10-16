import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MODE_DEVELOPPEMENT } from '../core/environnement/mode-developpement';
import { BarreLateraleComponent } from './barre-laterale.component';
import { PAGES_ADMINISTRATION, SECTIONS_NAVIGATION, sectionsRendues } from './navigation';

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
  it('reprend les sections de React, dans l\'ordre, avec les libellés exacts — administration regroupée au rendu', async () => {
    const el = await rendre({ dev: false });
    expect(titres(el)).toEqual(['Campagnes', 'Carte', 'Administration', 'Systeme']);
    expect(entrees(el, 'Campagnes')).toEqual(['Gestion campagnes']);
    expect(entrees(el, 'Carte')).toEqual(['Explorer', 'Zones custom']);
    // Lot 6, T6 (amendement du 2026-10-12) : les trois pages à onglets en tête, puis les écrans React
    // pas encore portés, inchangés. « Accès » (E6) quitte « Systeme » pour rejoindre ses deux sœurs.
    expect(entrees(el, 'Administration')).toEqual([
      'Accès', 'Données', 'Système',
      // « Import OOH » : supprimé le 2026-10-16 (chantier campagnes OOH, feat/angular-lot0).
      'Import Shapefile', 'Import POI', 'IRIS Crawler', 'Radio FM/DAB+',
    ]);
    // T9 : « Connexions API » n'est plus rendue — onglet de Système.
    // « Health check » et « Qualite des donnees » ne sont plus rendues : onglets de Système et Données.
    // T11′ : « Imports » n'est plus rendue — onglet « Historique » de Données.
    expect(entrees(el, 'Systeme')).toEqual(['Sources']);
  });

  it('badges « Admin » sur les quatre écrans d\'administration non portés ; aucun sur les trois pages ; plus de « Sys »', async () => {
    const el = await rendre({ dev: false });
    const badges = [...el.querySelectorAll('[data-badge]')].map((b) => texte(b));
    expect(badges).toEqual(['Admin', 'Admin', 'Admin', 'Admin']);
  });

  it('chaque entrée porte son icône lucide 16 px, trait 1,5 (comme `size={16} strokeWidth={1.5}`)', async () => {
    const el = await rendre({ dev: false });
    const svgs = [...el.querySelectorAll('nav a mg-icone svg')];
    // 11 : 15 de React − Users − Organisations − Health check − Qualité − Connexions API − Import OOH
    // (supprimé le 2026-10-16) − Imports (T11′) + Accès, Données, Système.
    expect(svgs.length).toBe(11);
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

  it('« Accès », « Données », « Système » mènent à leurs pages (lot 6, T6), par des liens RELATIFS', async () => {
    const el = await rendre({ dev: false });
    const lien = (libelle: string) =>
      [...el.querySelectorAll('[data-section="Administration"] a')].find((a) => texte(a.querySelector('span')) === libelle)!;
    expect(lien('Accès').getAttribute('href')).toBe('/admin/acces');
    expect(lien('Données').getAttribute('href')).toBe('/admin/donnees');
    expect(lien('Système').getAttribute('href')).toBe('/admin/systeme');
    for (const l of ['Accès', 'Données', 'Système']) expect(lien(l).hasAttribute('aria-disabled')).toBe(false);
  });

  it('icônes des trois pages : utilisateurs (Accès), base de données (Données), activité (Système)', () => {
    expect(PAGES_ADMINISTRATION.map((p) => [p.libelle, p.icone, p.badge])).toEqual([
      ['Accès', 'utilisateurs', undefined], ['Données', 'base-de-donnees', undefined], ['Système', 'activite', undefined],
    ]);
  });

  it('regroupement : une entrée qui reçoit sa `cible` quitte la barre (son écran devient un onglet), une section vidée disparaît', () => {
    const rendu = sectionsRendues([
      { section: 'Administration', entrees: [{ href: '/admin/x', libelle: 'X', icone: 'radio', cible: 'admin/donnees/x' }] },
      { section: 'Systeme', entrees: [{ href: '/admin/y', libelle: 'Y', icone: 'radio', cible: 'admin/systeme/y' }] },
      { section: 'Carte', entrees: [{ href: '/map', libelle: 'Explorer', icone: 'epingle-carte', cible: 'carte' }] },
    ]);
    expect(rendu.map((s) => [s.section, s.entrees.map((e) => e.libelle)])).toEqual([
      ['Administration', ['Accès', 'Données', 'Système']],
      ['Carte', ['Explorer']],
    ]);
    // La copie verbatim de React n'est PAS modifiée : Health check et Qualité y sont toujours.
    const systeme = SECTIONS_NAVIGATION.find((s) => s.section === 'Systeme')!;
    expect(systeme.entrees.map((e) => e.libelle)).toEqual(['Sources', 'Accès', 'Imports', 'Health check', 'Qualite des donnees']);
    // T11′ : « Imports » mène à l'onglet Historique de Données (chemin relatif).
    expect(systeme.entrees.find((e) => e.libelle === 'Imports')?.cible).toBe('admin/donnees/historique');
  });

  it('les écrans pas encore portés sont INERTES : aria-disabled, infobulle, aucun lien', async () => {
    const el = await rendre({ dev: false });
    const portes = ['Explorer', 'Accès', 'Données', 'Système'];
    const liens = [...el.querySelectorAll('nav a')].filter((a) => !portes.includes(texte(a.querySelector('span'))));
    expect(liens.length).toBe(7);
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
    expect(el.querySelectorAll('nav a').length).toBe(11); // E6 : 15 − 2 + 1 ; T9 : − Connexions API ; − « Import OOH » ; T11′ : − Imports
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
    expect(el.querySelectorAll('nav a').length).toBe(11); // E6 : 15 − 2 + 1 ; T9 : − Connexions API ; − « Import OOH » ; T11′ : − Imports
  });
});
