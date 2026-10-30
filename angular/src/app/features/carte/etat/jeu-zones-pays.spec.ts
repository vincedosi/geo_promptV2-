import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { PlateformeGeo } from '../logique/jeu/plateformes';
import { REGISTRE, VideJeu, Z1, couvertureCp, monterJeu, regle, urlCouverture } from '../testing/jeu-factice';

const BANC = { TestBed, HttpTestingController, provideHttpClientTesting };
const CODES = { METRO: ['FR'], FR: ['FR', 'GP', 'MQ', 'GF', 'RE', 'YT'] };
/** Le registre du banc, plus la ligne `pays` de chaque plateforme (sql/300). */
const REGISTRE_PAYS: PlateformeGeo[] = [
  ...REGISTRE,
  ...(['dv360', 'ttd', 'meta', 'tiktok'] as const).map((plateforme, i) =>
    regle({ plateforme, maille: 'pays', libelle: 'Pays', codes_pays: CODES, pays_a_verifier: ['FR'], a_verifier: plateforme === 'ttd', ordre: 200 + i })),
];
const METRO = { v: 1, type: 'pays', code: 'METRO' } as const;
const forme = { ...couvertureCp, decoupage: 'forme', lignes: [] };

/** ⑤ monté sur une zone de l'URL (`suite` : d'autres paramètres), le registre lu ; `recette` donnée comme par le sélecteur. */
async function monter(suite = '', recette: typeof METRO | null = METRO) {
  const o = await monterJeu(BANC, VideJeu, `/carte?zoneJeu=${Z1}${suite}`);
  await o.stable(); // l'hôte vide n'injecte pas l'état : il naît à `o.jeu`, ses effets partent ici
  o.http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE_PAYS });
  await o.stable();
  if (recette) o.jeu.choisirZone(Z1, recette);
  await o.stable();
  return o;
}

describe('JeuZonesService — une zone pays (⑤ finitions, T4)', () => {
  it('les quatre plateformes au pays d’office ; la couverture « telle quelle » lue UNE fois pour toutes, rien d’autre', async () => {
    const { http, jeu, stable } = await monter();
    expect(Object.values(jeu.choix()).map((c) => c?.maille)).toEqual(['pays', 'pays', 'pays', 'pays']);
    for (const p of ['dv360', 'ttd', 'meta', 'tiktok'] as const) jeu.valider(p);
    http.expectOne(urlCouverture(Z1, 'forme')).flush(forme);
    await stable();
    for (const p of ['dv360', 'ttd', 'meta', 'tiktok'] as const) jeu.valider(p);
    http.verify();
    expect(jeu.resumes().meta?.resume).toMatchObject({ exacte: true, n_unites: 1, population: 1000 });
  });

  it('une maille sans objet ne lance AUCUNE lecture : ni cercles par l’URL, ni par un réglage', async () => {
    const { http, jeu, stable } = await monter('&mailles=meta.cercle.10000.20,tiktok.commune.20');
    // Écartées : la plateforme reprend son défaut (le pays), sans requête.
    expect([jeu.choix().meta?.maille, jeu.choix().tiktok?.maille]).toEqual(['pays', 'pays']);
    jeu.regler('meta', { maille: 'cercle' });
    await stable();
    expect(jeu.choix().meta?.maille).toBe('pays');
    http.verify();
  });

  it('`meta.pays` sur une zone qui n’est pas nationale : le défaut, aucune lecture', async () => {
    const { http, jeu } = await monter('&mailles=meta.pays', { v: 1, type: 'dessin' } as unknown as typeof METRO);
    expect(jeu.choix().meta?.maille).toBe('cercle');
    http.verify();
  });
});
