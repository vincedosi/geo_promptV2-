import { TestBed } from '@angular/core/testing';
import { PROFIL_DEFAUT, type ProfilRayons } from '../../logique/profil';
import { TableauBandesComponent } from './tableau-bandes.component';

/** `par_classe` MESURÉ sur la base locale, profil par défaut (2026-10-04). */
const PAR_CLASSE_MESURE: Record<string, number> = {
  'bas:1': 106419, 'bas:2': 410641, 'haut:1': 526874, 'haut:2': 2337495, 'haut:3': 10482317,
  'bas:pprt': 701, 'haut:pprt': 239131,
};
const HORS_ZONE_MESURE = 26980106;
const TOTAL_MESURE = 14103578;

const n = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ').replace(/ +/g, ' ').trim();

async function rendre(profil: ProfilRayons = PROFIL_DEFAUT, parClasse = PAR_CLASSE_MESURE, horsZone = HORS_ZONE_MESURE) {
  const f = TestBed.createComponent(TableauBandesComponent);
  f.componentRef.setInput('profil', profil);
  f.componentRef.setInput('parClasse', parClasse);
  f.componentRef.setInput('horsZone', horsZone);
  f.componentRef.setInput('total', TOTAL_MESURE);
  f.componentRef.setInput('libelleCible', 'Population totale');
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

describe('TableauBandesComponent', () => {
  it('le profil par défaut : deux niveaux, PPRT puis bandes du cœur vers l’extérieur, cumul additif', async () => {
    const el = await rendre();
    const niveaux = [...el.querySelectorAll('[data-niveau]')];
    expect(niveaux.map((x) => x.getAttribute('data-niveau'))).toEqual(['haut', 'bas']);
    expect(niveaux.map((x) => [...x.querySelectorAll('[data-role="entete-niveau"] span')].map((s) => n(s.textContent)).join(' '))).toEqual([
      'Seveso seuil haut 13 585 817', 'Seveso seuil bas 517 761',
    ]);
    const lignes = [...el.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => n(td.textContent)));
    expect(lignes).toEqual([
      ['Périmètre PPRT', 'servitude publiée', '239 131', '239 131'],
      ['Bande 1', '0 à 1 km', '526 874', '766 005'],
      ['Bande 2', '1 km à 2 km', '2 337 495', '3 103 500'],
      ['Bande 3', '2 km à 5 km', '10 482 317', '13 585 817'],
      ['Périmètre PPRT', 'servitude publiée', '701', '701'],
      ['Bande 1', '0 à 500 m', '106 419', '107 120'],
      ['Bande 2', '500 m à 1 km', '410 641', '517 761'],
    ]);
    expect([...el.querySelectorAll('thead')][0].querySelectorAll('th')).toHaveLength(4);
    expect([...el.querySelectorAll('thead')[0].querySelectorAll('th')].map((th) => th.textContent?.trim()))
      .toEqual(['Bande', 'Étendue', 'Population totale', 'Cumulée']);
    expect([...el.querySelectorAll('[data-role="total"] span')].map((s) => n(s.textContent)).join(' ')).toBe('Total, tous niveaux 14 103 578');
    expect(el.textContent?.replace(/\s+/g, ' ')).toContain('La somme des bandes égale donc ce total, exactement.');
    expect(n(el.querySelector('[data-role="hors-zone"]')?.textContent)).toBe(
      '26 980 106 habitants vivent à moins de 10 km d’un site sans être retenus par ces anneaux. Élargir un rayon les fera entrer. Ce n’est pas la population non exposée de France : le calcul ne porte que sur le voisinage des sites.',
    );
  });

  it('trait plein pour la servitude publiée, tirets pour une bande calculée — en jetons', async () => {
    const el = await rendre();
    const traits = [...el.querySelectorAll<HTMLElement>('tbody tr [data-role="trait"]')];
    expect(traits[0].classList).toContain('border-solid');
    expect(traits[0].classList).toContain('border-[var(--text-secondary)]');
    expect(traits[1].classList).toContain('border-dashed');
    expect(traits[1].classList).toContain('border-[var(--text-tertiary)]');
  });

  it('sans PPRT : pas de ligne de périmètre ; une classe absente vaut 0', async () => {
    const el = await rendre({ ...PROFIL_DEFAUT, inclurePPRT: false }, { 'haut:1': 5 }, 0);
    const lignes = [...el.querySelectorAll('tbody tr')].map((tr) => n(tr.querySelector('td')?.textContent));
    expect(lignes).toEqual(['Bande 1', 'Bande 2', 'Bande 3', 'Bande 1', 'Bande 2']);
    // Le hors-zone nul n'a pas de phrase.
    expect(el.querySelector('[data-role="hors-zone"]')).toBeNull();
  });

  it('aucun anneau réglé : il le dit, aucun tableau', async () => {
    const el = await rendre({ ...PROFIL_DEFAUT, haut: [], bas: [], autres: [] });
    expect(el.querySelector('table')).toBeNull();
    expect(el.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Aucun anneau n’est réglé : aucune population n’est classée. Ajoutez un anneau à un niveau pour voir apparaître des bandes.',
    );
  });
});
