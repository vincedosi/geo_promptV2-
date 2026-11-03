import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { JeuCarteService } from '../../couches/jeu-carte.service';
import type { PlateformeGeo } from '../../logique/jeu/plateformes';
import { REGISTRE, Z1, couvertureCp, monterJeu, pavageMoinsBon, regle, urlCouverture, urlSimulationCercles } from '../../testing/jeu-factice';
import { ColonnePlateformeComponent } from './colonne-plateforme.component';

const BANC = { TestBed, HttpTestingController, provideHttpClientTesting };

/** Une colonne montée sur une zone de l'URL, le registre lu. */
async function colonne(plateforme: string, registre: PlateformeGeo[] = REGISTRE) {
  const o = await monterJeu(BANC, ColonnePlateformeComponent, `/carte?zoneJeu=${Z1}`, { entrees: { plateforme }, recette: null });
  o.http.expectOne('/api/zones/plateformes').flush({ plateformes: registre });
  await o.stable();
  return o;
}
const texte = (el: HTMLElement, sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();

describe('mg-colonne-plateforme', () => {
  it('A4 (ARB-3) : une unité à population inconnue ENTIÈRE dans la zone est retenue et dite sur une ligne à part', async () => {
    const { el, http, jeu, stable } = await colonne('dv360');
    jeu.valider('dv360');
    const inconnue = { code: '97110', nom: null, commune: null, n_carreaux: 0, pop_en_zone: null, pop_totale: null, part: null, part_brute: null, incluse: true };
    http.expectOne(urlCouverture(Z1, 'cp')).flush({ ...couvertureCp, lignes: [...couvertureCp.lignes, inconnue] });
    await stable();
    // Retenue sans seuil (2 connues + 1 inconnue / 4 touchées), et dans AUCUN chiffre d'habitants : hors zone inchangé.
    expect(texte(el, '[data-unites]')).toBe('3 / 4');
    expect(texte(el, '[data-hors-zone]')).toBe('1 100');
    expect(texte(el, '[data-chiffres]')).toContain('Diffusion à population inconnue');
    expect(texte(el, '[data-population-inconnue]')).toBe('1 code postal, acheté sans chiffre d’habitants');
  });
  it('sans unité à population inconnue retenue : pas de ligne « Diffusion à population inconnue »', async () => {
    const { el, http, jeu, stable } = await colonne('dv360');
    jeu.valider('dv360');
    http.expectOne(urlCouverture(Z1, 'cp')).flush(couvertureCp);
    await stable();
    expect(el.querySelector('[data-population-inconnue]')).toBeNull();
  });
  it('seuil déplacé (relâché) : les chiffres suivent SANS requête — unités, taux d’utile, manqués et leur part, hors zone', async () => {
    const { el, http, jeu, stable } = await colonne('dv360');
    jeu.valider('dv360');
    http.expectOne(urlCouverture(Z1, 'cp')).flush(couvertureCp);
    await stable();
    // B9 : le pavage que DV360 simule pour décider de son défaut, moins bon : le CP reste, et la ligne le dit.
    http.expectOne(urlSimulationCercles(Z1)).flush(pavageMoinsBon(Z1));
    await stable();
    expect(texte(el, '[data-defaut]')).toBe('Codes postaux par défaut (export manuel) : couverture 90 %, taux utile 45 %, contre 90 % / 30 % en cercles (export manuel).');
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
      // B14 (ARB-6 = A) : le département est une maille découpée — le dépassement annonce les blocs (spec restée rouge
      // depuis B14, corrigée au round 1 de B15).
      '2 départements pour 1 admis par la plateforme : découpage automatique en 2 blocs, triés par part décroissante (1 + 1).',
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
      somme_disques: 0, chevauchement: 0,
    });
    await stable();
    expect(texte(el, '[data-motif-vide]')).toBe('Aucun cercle n’atteint le seuil : baissez le seuil ou changez le rayon.');
    expect(texte(el, '[data-chiffres]')).toContain('Cercles retenus / cellules examinées');
    expect(el.querySelector('[data-chevauchement]')).toBeNull();
  });
  it('B10 : le rayon par défaut dit d’où il vient (surface, borne) ; un rayon proposé s’adopte en un geste', async () => {
    const { el, http, jeu, stable } = await colonne('meta');
    expect(texte(el, '[data-rayon-defaut]')).toBe('Rayon par défaut 10 km : surface de la zone inconnue.');
    jeu.choisirZone(Z1, null, null, 20);
    await stable();
    expect(texte(el, '[data-rayon-defaut]')).toBe(
      'Rayon par défaut 1 km : 840 m tiré de la surface (√(surface / π) / 3 pour 20 km²), ramené au minimum de Meta.');
    jeu.valider('meta');
    http.expectOne((r) => r.url.includes('/cercles')).flush(
      { error: 'x', refus: 'trop_de_cercles', n_cercles: 481, plafond: 200, rayon_propose: { rayon_m: 16000, n_cercles: 196, au_pas: true, essais: 5 } },
      { status: 422, statusText: 'Unprocessable' },
    );
    await stable();
    expect(texte(el, '[data-erreur]')).toBe('481 cercles pour 200 admis par la plateforme. Plus petit rayon sous le plafond : 16 km (196 cercles).');
    el.querySelector<HTMLButtonElement>('[data-rayon-propose]')!.click();
    await stable();
    expect(jeu.choix().meta?.rayon_m).toBe(16000);
    expect(el.querySelector('[data-rayon-propose]')).toBeNull();
    expect(el.querySelector('[data-rayon-defaut]')).toBeNull();
  });
  it('A6 : cercles — la somme des disques dépasse la diffusion achetée, le bilan le dit', async () => {
    const { el, http, jeu, stable } = await colonne('meta');
    jeu.valider('meta');
    http.expectOne((r) => r.url.includes('/cercles')).flush({
      zone_id: Z1, cible: 'ind', rayon_m: 10000, seuil: 20, n_candidates: 9, n_cercles: 7, population: 1000, couverte: 900,
      manques: 100, hors_zone: 300, achetee: 1200, taux_utile: 75, n_carreaux: 5, motif_vide: null,
      cercles: [], somme_disques: 1500, chevauchement: 300,
    });
    await stable();
    expect(texte(el, '[data-hors-zone]')).toBe('300');
    expect(texte(el, '[data-chevauchement]')).toBe(
      'Les disques voisins se chevauchent : la somme des cercles (1 500 habitants) dépasse la diffusion achetée (1 200), '
      + 'où chaque habitant n’est compté qu’une fois.');
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

describe('mg-colonne-plateforme — une zone pays (⑤ finitions, T4)', () => {
  const CODES = { METRO: ['FR'], FR: ['FR', 'GP', 'MQ', 'GF', 'RE', 'YT'] };
  const PAYS = regle({ plateforme: 'meta', maille: 'pays', libelle: 'Pays', codes_pays: CODES, pays_a_verifier: ['FR'], ordre: 70 });
  const REGISTRE_PAYS = [...REGISTRE, regle({ plateforme: 'meta', maille: 'commune', libelle: 'Communes', ordre: 65 }), PAYS];
  const forme = { ...couvertureCp, decoupage: 'forme', population: 62_528_975, surface_km2: 547_779, lignes: [] };
  const departements = {
    ...couvertureCp, decoupage: 'departement', population: 64_000_000, surface_km2: 640_000,
    lignes: [
      { code: '13', nom: null, commune: null, n_carreaux: 1, pop_en_zone: 2_000_000, pop_totale: 2_000_000, part: 100, part_brute: 100 },
      { code: '972', nom: null, commune: null, n_carreaux: 1, pop_en_zone: 300_000, pop_totale: 300_000, part: 100, part_brute: 100 },
      { code: '974', nom: null, commune: null, n_carreaux: 1, pop_en_zone: 800_000, pop_totale: 800_000, part: 100, part_brute: 100 },
    ],
  };
  async function surZonePays(code: 'METRO' | 'FR') {
    const o = await colonne('meta', REGISTRE_PAYS);
    o.jeu.choisirZone(Z1, { v: 1, type: 'pays', code });
    await o.stable();
    return o;
  }

  it('« France métropolitaine » : « Pays » d’office, exacte, la population nationale et le code FR ; aucun « à vérifier »', async () => {
    const { el, http, jeu, stable } = await surZonePays('METRO');
    expect(el.querySelector('[data-maille="pays"]')?.getAttribute('aria-pressed')).toBe('true');
    jeu.valider('meta');
    http.expectOne(urlCouverture(Z1, 'forme')).flush(forme);
    await stable();
    expect(texte(el, '[data-exacte] span')).toBe('Exacte : aucune perte');
    expect(texte(el, '[data-exacte] span.font-mono')).toBe('1 pays · 62 528 975 habitants carroyés');
    expect(texte(el, '[data-codes-pays]')).toBe('FR');
    expect(el.querySelector('[data-a-verifier]')).toBeNull();
    expect(el.querySelector('mg-dilution')).toBeNull();
    http.verify();
  });
  it('cercles et communes grisés, avec la phrase de la règle ; aucune lecture pour eux', async () => {
    const { el, http } = await surZonePays('METRO');
    const cercle = el.querySelector<HTMLButtonElement>('[data-maille="cercle"]')!;
    const commune = el.querySelector<HTMLButtonElement>('[data-maille="commune"]')!;
    expect([cercle.disabled, commune.disabled]).toEqual([true, true]);
    const raisons = [...el.querySelectorAll('[data-raison]')].map((r) => r.textContent?.trim());
    expect(raisons).toContain('Sur toute la France, le ciblage par cercles n’a pas de sens : choisissez le pays.');
    expect(raisons.some((r) => r?.startsWith('Sur toute la France, le découpage par IRIS'))).toBe(true);
    cercle.click();
    http.verify();
  });
  it('« France entière » : les six codes, « population inconnue » pour un DROM sans carreau, la ligne à part (A4), et « À vérifier »', async () => {
    const { el, http, jeu, stable } = await surZonePays('FR');
    jeu.valider('meta');
    http.expectOne(urlCouverture(Z1, 'departement')).flush(departements);
    await stable();
    expect(texte(el, '[data-codes-pays]')).toBe('FR, GP, MQ, GF, RE, YT');
    const unites = [...el.querySelectorAll('[data-unite-pays]')].map((u) => u.textContent?.replace(/\s+/g, ' ').trim());
    expect(unites).toContain('Guadeloupe (GP) · population inconnue (non carroyée)');
    // A4 (ARB-3) : GP, GF et YT achetés sans chiffre d’habitants, dits sur une ligne séparée du bilan.
    expect(texte(el, '[data-population-inconnue]')).toBe('Diffusion à population inconnue : 3 pays, achetés sans chiffre d’habitants');
    expect(unites).toContain('La Réunion (RE) · 800 000 habitants');
    expect(texte(el, '[data-a-verifier]')).toBe('À vérifier');
    http.verify();
  });
  it('une zone qui n’est pas nationale : aucune pastille « Pays »', async () => {
    const { el } = await colonne('meta', REGISTRE_PAYS);
    expect(el.querySelector('[data-maille="pays"]')).toBeNull();
    expect(el.querySelector('[data-maille="cercle"]')?.getAttribute('aria-pressed')).toBe('true');
  });
});
