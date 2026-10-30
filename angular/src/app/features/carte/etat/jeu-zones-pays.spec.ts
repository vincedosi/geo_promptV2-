import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { ZoneCustomResume } from '../data/zones-custom.api';
import type { PlateformeGeo } from '../logique/jeu/plateformes';
import { PanneauJeuComponent } from '../panneaux/jeu/panneau-jeu.component';
import { REGISTRE, VideJeu, Z1, couvertureCp, monterJeu, regle, urlCouverture } from '../testing/jeu-factice';

const BANC = { TestBed, HttpTestingController, provideHttpClientTesting };
const PLATEFORMES = ['dv360', 'ttd', 'meta', 'tiktok'] as const;
const CODES = { METRO: ['FR'], FR: ['FR', 'GP', 'MQ', 'GF', 'RE', 'YT'] };
/** Le registre du banc, plus la ligne `pays` de chaque plateforme (sql/300). */
const REGISTRE_PAYS: PlateformeGeo[] = [
  ...REGISTRE,
  ...PLATEFORMES.map((plateforme, i) =>
    regle({ plateforme, maille: 'pays', libelle: 'Pays', codes_pays: CODES, pays_a_verifier: ['FR'], a_verifier: plateforme === 'ttd', ordre: 200 + i })),
];
const METRO = { v: 1, type: 'pays', code: 'METRO' } as const;
const FRANCE = { v: 1, type: 'pays', code: 'FR' } as const;
const forme = { ...couvertureCp, decoupage: 'forme', lignes: [] };
/** Aucune lecture de conversion (couverture ou cercles) en attente. */
const aucuneConversion = (http: HttpTestingController) =>
  expect(http.match((r) => r.url.includes('/couverture') || r.url.includes('/cercles'))).toEqual([]);

/**
 * ⑤ monté sur une zone de l'URL (`suite` : d'autres paramètres), le registre lu, puis la recette donnée comme par le
 * sélecteur. L'hôte vide n'injecte pas l'état : il naît à `o.jeu`, ses effets partent au premier `stable`.
 */
async function monter(suite: string, recette: typeof METRO | typeof FRANCE | { v: 1; type: 'dessin' }) {
  const o = await monterJeu(BANC, VideJeu, `/carte?zoneJeu=${Z1}${suite}`);
  await o.stable();
  o.http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE_PAYS });
  await o.stable();
  o.jeu.choisirZone(Z1, recette);
  await o.stable();
  return o;
}

describe('JeuZonesService — une zone pays (⑤ finitions, T4 ; relecture 2)', () => {
  it('« France métropolitaine » : quatre plateformes au pays, la forme lue UNE fois pour toutes, rien d’autre', async () => {
    const { http, jeu, stable } = await monter('', METRO);
    expect(PLATEFORMES.map((p) => jeu.choix()[p]?.maille)).toEqual(['pays', 'pays', 'pays', 'pays']);
    for (const p of PLATEFORMES) jeu.valider(p);
    http.expectOne(urlCouverture(Z1, 'forme')).flush(forme);
    await stable();
    for (const p of PLATEFORMES) jeu.valider(p);
    aucuneConversion(http);
    http.verify();
    expect(jeu.resumes().meta?.resume).toMatchObject({ exacte: true, n_unites: 1, population: 1000 });
  });

  it('« France entière » : la couverture par département (les DROM), une fois, et jamais la forme', async () => {
    const { http, jeu } = await monter('', FRANCE);
    for (const p of PLATEFORMES) jeu.valider(p);
    http.expectOne(urlCouverture(Z1, 'departement'));
    http.expectNone(urlCouverture(Z1, 'forme'));
    aucuneConversion(http);
  });

  it('une maille sans objet venue de l’URL, puis demandée par un réglage : `valider` ne lit RIEN pour elle', async () => {
    const { http, jeu, stable, router } = await monter('&mailles=meta.cercle.10000.20,tiktok.commune.20', METRO);
    expect([jeu.choix().meta?.maille, jeu.choix().tiktok?.maille]).toEqual(['pays', 'pays']);
    jeu.regler('meta', { maille: 'cercle' });
    jeu.regler('tiktok', { maille: 'commune' });
    await stable();
    jeu.valider('meta');
    jeu.valider('tiktok');
    // La seule lecture : la forme, pour le pays. Ni cercles, ni communes.
    http.expectOne(urlCouverture(Z1, 'forme'));
    aucuneConversion(http);
    http.verify();
    expect(router.url).toContain('mailles=meta.cercle.10000.20');
  });

  it('`meta.pays` sur une zone qui n’est pas nationale : le défaut (cercles), et le pays ne lit rien', async () => {
    const { http, jeu } = await monter('&mailles=meta.pays', { v: 1, type: 'dessin' });
    expect(jeu.choix().meta?.maille).toBe('cercle');
    jeu.regler('meta', { maille: 'pays' });
    expect(jeu.choix().meta?.maille).toBe('cercle');
    http.expectNone(urlCouverture(Z1, 'forme'));
  });
});

describe('⑤ — la recette arrive APRÈS le registre (relecture 2, le vrai panneau)', () => {
  it('rien ne se lit ni ne s’écrit tant que la recette est inconnue ; arrivée « pays », la forme seule', async () => {
    const liste = new Subject<{ zones: ZoneCustomResume[] }>();
    const { http, jeu, router, stable } = await monterJeu(BANC, PanneauJeuComponent, `/carte?zoneJeu=${Z1}`, { lister: () => liste });
    http.expectOne('/api/zones/plateformes').flush({ plateformes: REGISTRE_PAYS });
    await stable();
    // Registre lu, recette inconnue : aucun choix, aucune conversion, aucun `?mailles=` écrit.
    expect(jeu.choix()).toEqual({});
    for (const p of PLATEFORMES) jeu.valider(p);
    jeu.regler('meta', { maille: 'cercle' });
    await stable();
    aucuneConversion(http);
    expect(router.url).not.toContain('mailles=');
    // La liste nomme la zone : une zone pays. La colonne ouverte (DV360) lit la forme, pas les codes postaux.
    liste.next({ zones: [{ id: Z1, name: 'France métropolitaine', recette: METRO, updated_at: 'v1' } as unknown as ZoneCustomResume] });
    await stable();
    expect(jeu.choix().dv360?.maille).toBe('pays');
    http.expectOne(urlCouverture(Z1, 'forme'));
    http.expectNone(urlCouverture(Z1, 'cp'));
    aucuneConversion(http);
    expect(router.url).not.toContain('mailles=');
  });
});
