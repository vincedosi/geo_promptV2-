import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { J1, REGISTRE, Z1, monterJeu } from '../../testing/jeu-factice';
import { ExtractionsJeuComponent, MESSAGE_REPONSE_PERDUE } from './extractions-jeu.component';

const BANC = { TestBed, HttpTestingController, provideHttpClientTesting };

const detail = {
  jeu: { id: J1, type: 'zone', nom: 'Lycées BdR', description: null, version: 1, created_at: '2026-10-24', custom_geo_zone_id: Z1, cible: 'ind', mode_plan: 'pondere' },
  zone: { id: Z1, nom: 'Lycées 5 km', recette: null },
  plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }],
};
const LISTE = `/api/zones/jeux/${J1}/extractions`;
const version = (v: number) => ({
  id: `x${v}`, version: v, origine: 'initiale', commentaire: '', seuil_couverture_cp: 20, mode_plan: 'pondere', n_cp: 3, n_retenus: 2,
  taux_utile: 45, part_plan_en_zone: null, created_at: '2026-10-24T10:00:00Z',
  plateformes: [
    { plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null, exacte: false, n_unites: 2, taux_utile: 45 },
    { plateforme: 'ttd', maille: 'polygone', seuil: 20, rayon_m: null, exacte: true, n_unites: 1, taux_utile: 100 },
  ],
});

/** Un jeu ouvert par l'URL, la liste des versions lue. */
async function ouvert(versions = [version(1)]) {
  const o = await monterJeu(BANC, ExtractionsJeuComponent, `/carte?jeu=${J1}`);
  o.http.expectOne(`/api/zones/jeux/${J1}`).flush(detail);
  o.http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE });
  await o.stable();
  o.http.expectOne(LISTE).flush({ extractions: versions, jeu: { id: J1, nom: 'Lycées BdR', version: 1 } });
  await o.stable();
  return o;
}
const texte = (el: HTMLElement, sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();

describe('mg-extractions-jeu', () => {
  it('les versions : origine, date et résumé FIGÉ par plateforme', async () => {
    const { el } = await ouvert();
    expect(texte(el, '[data-version="1"] [data-resume]')).toBe('DV360 : codes postaux 2, 45,0 % · The Trade Desk : polygones 1, exacte');
  });

  it('A7 tour 1 : un polygone simplifié dit sa tolérance, ses sommets, sa perte et son gain hors zone', async () => {
    const v = { ...version(1), plateformes: [{
      plateforme: 'ttd', maille: 'polygone', seuil: 20, rayon_m: null, exacte: false, n_unites: 1, taux_utile: 99.7,
      simplification: { tolerance_m: 25, sommets_avant: 66000, morceaux_avant: 2000, sommets: 18000, morceaux: 2000, perdue: 400, gagnee: 30 },
    }] };
    const { el } = await ouvert([v]);
    expect(texte(el, '[data-version="1"] [data-resume]')?.replace(/\s/g, ' ')).toBe(
      'The Trade Desk : polygones 1, 99,7 % (simplifié à 25 m : 66 000 → 18 000 sommets, 400 habitants de la zone perdus, 30 hors zone inclus)');
  });

  it('T5 (A-14) : sous chaque version, ses fichiers par plateforme — l’annonce « arrivent avec les exports » a disparu', async () => {
    const { el } = await ouvert([version(2), version(1)]);
    expect(el.textContent).not.toContain('arrivent avec les exports');
    expect(el.querySelector('[data-lot6]')).toBeNull();
    const blocs = [...el.querySelectorAll('[data-fichiers-version="2"]')].map((b) => [
      b.querySelector('span')!.textContent!.trim(), [...b.querySelectorAll('mg-bouton-export button')].map((x) => x.textContent!.trim()),
    ]);
    expect(blocs).toEqual([['DV360', ['Codes postaux', 'SDF DV360']], ['The Trade Desk', ['Polygone (GeoJSON)']]]);
    expect(el.querySelectorAll('[data-fichiers-version="1"]')).toHaveLength(2);
    // TTD au polygone est « à vérifier » dans le registre du banc ; DV360 au CP ne l'est pas.
    expect(el.querySelector('[data-fichiers-version="2"] [data-fichiers-extraction="ttd"] [data-a-verifier]')).not.toBeNull();
    expect(el.querySelector('[data-fichiers-version="2"] [data-fichiers-extraction="dv360"] [data-a-verifier]')).toBeNull();
    expect(el.querySelector('a[href], a[download]')).toBeNull();
  });

  it('T5 : un téléchargement lit la route de la version ; son refus affiche le message de la route', async () => {
    const { el, http, stable } = await ouvert();
    el.querySelector<HTMLButtonElement>('[data-fichiers-version="1"] [data-fichiers-extraction="ttd"] button')!.click();
    await stable();
    const req = http.expectOne(`/api/zones/jeux/${J1}/extractions/1/fichier?plateforme=ttd&format=polygone`);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob([JSON.stringify({ error: 'Aucune unité retenue pour cette plateforme.' })], { type: 'application/json' }), { status: 409, statusText: 'Conflict' });
    await stable();
    expect(texte(el, '[data-fichiers-extraction="ttd"] [role="alert"]')).toBe('Aucune unité retenue pour cette plateforme.');
  });

  it('T5 : une plateforme sans unité n’offre aucun bouton (la route répondrait 409)', async () => {
    const vide = { ...version(1), plateformes: [{ ...version(1).plateformes[0], n_unites: 0 }] };
    const { el } = await ouvert([vide]);
    expect(el.querySelector('[data-fichiers-version]')).toBeNull();
  });

  it('m-1 — pendant une relecture de la liste, aucun bouton de fichier (la liste affichée peut être d’un autre jeu)', async () => {
    const { el, http, stable } = await ouvert();
    expect(el.querySelector('[data-fichiers-version]')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('[data-extraire]')!.click();
    await stable();
    http.expectOne((r) => r.method === 'POST' && r.url === LISTE).flush({ ok: true, deja_extraite: false, id: 'x2', version: 2 }, { status: 201, statusText: 'Created' });
    await stable();
    const relue = http.expectOne(LISTE);
    expect(el.querySelector('[data-fichiers-version]')).toBeNull();
    relue.flush({ extractions: [version(2), version(1)], jeu: { id: J1, nom: 'Lycées BdR', version: 1 } });
    await stable();
    expect(el.querySelector('[data-fichiers-version="2"]')).not.toBeNull();
  });

  it('« Extraire » : un POST, puis la liste RELUE ; la version créée est désignée dans ?x=', async () => {
    const { el, http, router, stable } = await ouvert();
    el.querySelector<HTMLButtonElement>('[data-extraire]')!.click();
    await stable();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === LISTE);
    expect(post.request.body).toEqual({ origine: 'initiale', commentaire: '' });
    post.flush({ ok: true, deja_extraite: false, id: 'x2', version: 2 }, { status: 201, statusText: 'Created' });
    await stable();
    http.expectOne(LISTE).flush({ extractions: [version(2), version(1)], jeu: { id: J1, nom: 'Lycées BdR', version: 1 } });
    await stable();
    expect(texte(el, '[data-message]')).toBe('Extraction v2 enregistrée : elle ne bougera plus.');
    expect(router.url).toBe(`/carte?jeu=${J1}&x=2`);
    expect(el.querySelector('[data-version="2"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('`deja_extraite` : « Cette extraction existe déjà (v1). » ; recalage coché part avec l’origine `recalage`', async () => {
    const { el, http, stable } = await ouvert();
    const recalage = el.querySelector<HTMLInputElement>('[data-recalage]')!;
    recalage.click();
    el.querySelector<HTMLButtonElement>('[data-extraire]')!.click();
    await stable();
    const post = http.expectOne((r) => r.method === 'POST');
    expect(post.request.body).toMatchObject({ origine: 'recalage' });
    post.flush({ ok: true, deja_extraite: true, id: 'x1', version: 1 });
    await stable();
    expect(texte(el, '[data-message]')).toBe('Cette extraction existe déjà (v1).');
  });

  it('P-c : une extraction en vol quand on ouvre un AUTRE jeu est désabonnée — aucun message sous le nouveau jeu (revue finale, point 4)', async () => {
    const { el, http, router, stable } = await ouvert();
    el.querySelector<HTMLButtonElement>('[data-extraire]')!.click();
    await stable();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === LISTE);
    await router.navigateByUrl('/carte?jeu=0b7ece33-4903-4a0b-a57a-f6c54e78a729');
    await stable();
    expect(post.cancelled).toBe(true);
    expect(el.querySelector('[data-message], [data-erreur]')).toBeNull();
  });

  it('réponse PERDUE (statut 0) : ni succès ni échec affirmés — « vérifiez la liste des versions », et la liste est relue', async () => {
    const { el, http, stable } = await ouvert();
    el.querySelector<HTMLButtonElement>('[data-extraire]')!.click();
    await stable();
    http.expectOne((r) => r.method === 'POST').error(new ProgressEvent('error'), { status: 0 });
    await stable();
    expect(texte(el, '[data-erreur]')).toBe(MESSAGE_REPONSE_PERDUE);
    http.expectOne(LISTE);
  });

  it('choisir une version la désigne dans ?x= ; un second clic la retire', async () => {
    const { el, router, stable } = await ouvert();
    el.querySelector<HTMLButtonElement>('[data-version="1"]')!.click();
    await stable();
    expect(router.url).toBe(`/carte?jeu=${J1}&x=1`);
    el.querySelector<HTMLButtonElement>('[data-version="1"]')!.click();
    await stable();
    expect(router.url).toBe(`/carte?jeu=${J1}`);
  });
  it('réglages modifiés à l’écran : « Extraire » désactivé, « Enregistrez les réglages avant d’extraire. », aucune requête', async () => {
    const { el, http, jeu, stable } = await ouvert();
    jeu.regler('dv360', { seuil: 40 });
    await stable();
    const bouton = el.querySelector<HTMLButtonElement>('[data-extraire]')!;
    expect(bouton.disabled).toBe(true);
    expect(texte(el, '[data-enregistrer-avant]')).toBe('Enregistrez les réglages avant d’extraire.');
    bouton.click();
    await stable();
    http.expectNone((r) => r.method === 'POST');
    jeu.regler('dv360', { seuil: 20 });
    await stable();
    expect(bouton.disabled).toBe(false);
  });
});
