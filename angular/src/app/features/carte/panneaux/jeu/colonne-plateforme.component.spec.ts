import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { JeuCarteService } from '../../couches/jeu-carte.service';
import type { PlateformeGeo } from '../../logique/jeu/plateformes';
import { REGISTRE, Z1, couvertureCp, monterJeu, regle, urlCouverture } from '../../testing/jeu-factice';
import { ColonnePlateformeComponent } from './colonne-plateforme.component';

const BANC = { TestBed, HttpTestingController, provideHttpClientTesting };

/** Une colonne montée sur une zone de l'URL, le registre lu. */
async function colonne(plateforme: string, registre: PlateformeGeo[] = REGISTRE) {
  const o = await monterJeu(BANC, ColonnePlateformeComponent, `/carte?zoneJeu=${Z1}`, { entrees: { plateforme } });
  o.http.expectOne('/api/zones/plateformes').flush({ plateformes: registre });
  await o.stable();
  return o;
}
const texte = (el: HTMLElement, sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();

describe('mg-colonne-plateforme', () => {
  it('seuil déplacé (relâché) : les chiffres suivent SANS requête — unités, taux d’utile, manqués et leur part, hors zone', async () => {
    const { el, http, jeu, stable } = await colonne('dv360');
    jeu.valider('dv360');
    http.expectOne(urlCouverture(Z1, 'cp')).flush(couvertureCp);
    await stable();
    expect(texte(el, '[data-unites]')).toBe('2 / 3');
    expect(texte(el, '[data-taux]')).toBe('45,0 %');
    expect(texte(el, '[data-manques]')).toBe('100 (10,0 % de la zone)');
    expect(texte(el, '[data-hors-zone]')).toBe('1 100');
    expect(texte(el, '[data-chiffres]')).toContain('Codes postaux retenus / touchés');
    // La réglette de seuil (`mg-dilution` du module risque) : le seuil part au relâchement.
    const curseur = el.querySelector<HTMLInputElement>('mg-dilution input[type="range"]')!;
    expect(curseur.getAttribute('aria-label')).toBe('Part minimale de la population de chaque code postal en zone');
    curseur.value = '50';
    curseur.dispatchEvent(new Event('input'));
    curseur.dispatchEvent(new Event('pointerup'));
    await stable();
    expect(texte(el, '[data-unites]')).toBe('1 / 3');
    expect(texte(el, '[data-taux]')).toBe('60,0 %');
    http.verify();
  });
  it('le lien « Doc officielle » est le `doc_url` de la ligne, ouvert à part ; sans `doc_url`, aucun lien', async () => {
    const { el } = await colonne('dv360');
    const lien = el.querySelector<HTMLAnchorElement>('a[data-doc]')!;
    expect(lien.getAttribute('href')).toBe('https://doc.example/dv360');
    expect(lien.target).toBe('_blank');
    expect(lien.rel).toBe('noopener noreferrer');
    expect(texte(el, '[data-corps-colonne]')).toContain('relevé le 14/10/2026');
  });
  it('Review Focus 5 : une limite modifiée dans le registre change l’avertissement, sans livraison', async () => {
    const avec = async (max: number) => {
      const reg = [regle({ plateforme: 'tiktok', maille: 'departement', limites: { max_unites: max, pop_min_groupe: 5000 } })];
      const { el, http, jeu, stable } = await colonne('tiktok', reg);
      jeu.valider('tiktok');
      http.expectOne(urlCouverture(Z1, 'departement')).flush({ ...couvertureCp, decoupage: 'departement' });
      await stable();
      return [...el.querySelectorAll('[data-avertissement]')].map((a) => a.textContent?.replace(/\s+/g, ' ').trim());
    };
    expect(await avec(1)).toEqual([
      '2 départements pour 1 admis par la plateforme.',
      'Palier sous 5 000 personnes : 2 000 achetées, la plateforme peut refuser la diffusion.',
    ]);
    TestBed.resetTestingModule();
    expect((await avec(2))[0]).toBe('Palier sous 5 000 personnes : 2 000 achetées, la plateforme peut refuser la diffusion.');
  });
  it('la phrase du seuil nomme la maille, jusqu’au bout : « …une telle part de son département » (revue finale, point 3)', async () => {
    const { el, http, jeu, stable } = await colonne('tiktok', [regle({ plateforme: 'tiktok', maille: 'departement' })]);
    jeu.valider('tiktok');
    http.expectOne(urlCouverture(Z1, 'departement')).flush({ ...couvertureCp, decoupage: 'departement' });
    await stable();
    expect(texte(el, 'mg-dilution p')).toContain('Un département n’est retenu que si');
    expect(texte(el, 'mg-dilution p')).toContain('une telle part de son département.');
  });
  it('maille exacte (polygone) : « Exacte : aucune perte », ni seuil ni rayon ; badge neutre « À vérifier »', async () => {
    const { el, http, jeu, stable } = await colonne('ttd');
    jeu.valider('ttd');
    http.expectOne(urlCouverture(Z1, 'forme')).flush({ ...couvertureCp, decoupage: 'forme', lignes: [] });
    await stable();
    expect(texte(el, '[data-exacte] span')).toBe('Exacte : aucune perte');
    expect(texte(el, '[data-exacte] span.font-mono')).toBe('1 polygone · 1 000 habitants carroyés');
    expect(el.querySelector('mg-dilution')).toBeNull();
    expect(texte(el, '[data-a-verifier]')).toBe('À vérifier');
  });
  it('cercles : la réglette de rayon est bornée par la ligne et ne règle qu’au relâchement ; un pavage vide dit pourquoi', async () => {
    const { el, http, jeu, stable } = await colonne('meta');
    const rayon = el.querySelector<HTMLInputElement>('[data-rayon] input')!;
    expect([rayon.min, rayon.max]).toEqual(['1000', '80000']);
    rayon.value = '20000';
    rayon.dispatchEvent(new Event('input'));
    expect(jeu.choix().meta?.rayon_m).toBe(10000);
    rayon.dispatchEvent(new Event('pointerup'));
    expect(jeu.choix().meta?.rayon_m).toBe(20000);
    jeu.valider('meta');
    http.expectOne((r) => r.url.includes('/cercles')).flush({
      zone_id: Z1, cible: 'ind', rayon_m: 20000, seuil: 20, n_candidates: 4, n_cercles: 0, cercles: [], population: 1000, couverte: 0,
      manques: 1000, hors_zone: 0, achetee: 0, taux_utile: null, n_carreaux: 5, motif_vide: 'aucune_cellule_au_seuil',
    });
    await stable();
    expect(texte(el, '[data-motif-vide]')).toBe('Aucun cercle n’atteint le seuil : baissez le seuil ou changez le rayon.');
    expect(texte(el, '[data-chiffres]')).toContain('Cercles retenus / cellules examinées');
  });
  it('« Voir sur la carte » (T11) : la plateforme devient la REGARDÉE, une seule à la fois', async () => {
    const { el, stable } = await colonne('dv360');
    const carte = TestBed.inject(JeuCarteService);
    const bouton = el.querySelector<HTMLButtonElement>('[data-voir-carte]')!;
    expect(bouton.textContent?.trim()).toBe('Voir sur la carte');
    bouton.click();
    await stable();
    expect(carte.regardee()).toBe('dv360');
    expect(bouton.getAttribute('aria-pressed')).toBe('true');
    expect(bouton.textContent?.trim()).toBe('Sur la carte');
    carte.regarder('meta');
    await stable();
    expect(bouton.getAttribute('aria-pressed')).toBe('false');
  });
});
