import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as S from '@/lib/zones/conversion';
import * as SD from '@/lib/zones/conversion-defaut';
import * as SPop from '@/lib/zones/conversion-population';
import * as SP from '@/lib/zones/plateformes';
import type * as SC from '@/lib/zones/couverture';
import * as A from '../../../angular/src/app/features/carte/logique/jeu/conversion';
import * as AD from '../../../angular/src/app/features/carte/logique/jeu/conversion-defaut';
import * as APop from '../../../angular/src/app/features/carte/logique/jeu/conversion-population';
import * as AP from '../../../angular/src/app/features/carte/logique/jeu/plateformes';
import type * as AC from '../../../angular/src/app/features/carte/logique/analyses/couverture';
import type { Recette } from '@/lib/zones/recette';
import { OU_SE_GERE } from '@/lib/zones/charger-jeu';
import { MESSAGE_JEU_RISQUE } from '../../../angular/src/app/features/carte/logique/jeu/ecran';

/**
 * ⑤ Jeu de zones (lot 5, T9) : la conversion PURE est la MÊME des deux côtés (A-5) — l'écran rejoue le seuil sans
 * requête, l'extraction le rejoue côté serveur ; une divergence ferait afficher un bilan que l'extraction ne figerait
 * pas. Verrous : le corps des deux fichiers est identique (seuls l'en-tête et les chemins d'import diffèrent), les
 * listes et messages sont égaux, les fonctions rendent la même chose sur les mêmes cas, et les TYPES partagés
 * (`LigneCouverture`, ligne de `plateformes_geo`) sont mutuellement assignables (`npx tsc --noEmit`).
 */

type Egal<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false;
const _types: [
  Egal<SC.LigneCouverture, AC.LigneCouverture>,
  Egal<SP.PlateformeGeo, AP.PlateformeGeo>,
  Egal<S.Resume, A.Resume>,
  Egal<S.Avertissement, A.Avertissement>,
  Egal<SD.DefautExplique, AD.DefautExplique>,
  Egal<SD.Simulations, AD.Simulations>,
  Egal<SD.MecanismePoussee, AD.MecanismePoussee>,
] = [true, true, true, true, true, true, true];
void _types;

/** Le code d'un fichier sans son en-tête (premier commentaire de bloc) ni ses lignes d'import. */
const corps = (chemin: string) => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')
  .replace(/^\/\*\*[\s\S]*?\*\/\n/, '')
  .replace(/^import [^\n]+\n/gm, '');

const ligne = (p: Partial<SP.PlateformeGeo> & Pick<SP.PlateformeGeo, 'plateforme' | 'maille'>): SP.PlateformeGeo => ({
  libelle: 'x', natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14', a_verifier: false,
  note: null, ordre: 0, ...p,
});

/** B9 : des simulations de toutes formes — complètes, partielles, refusées, sous la cible. */
const SIMULATIONS: SD.Simulations[] = [
  {}, { cp: { couverture: 10, taux_utile: 95 }, cercle: { couverture: 90, taux_utile: 70 } },
  { cp: 'refusee', cercle: { couverture: 50, taux_utile: 40 }, commune: { couverture: 85, taux_utile: 60 } },
  { cercle: 'refusee', cp: 'refusee', polygone: { couverture: 100, taux_utile: 100 } },
];

describe('conversion d’une zone : Angular = serveur', () => {
  it('les types partagés sont égaux (tenu par tsc)', () => {
    expect(_types.every(Boolean)).toBe(true);
  });
  it('les deux fichiers sont identiques hors de leur en-tête et de leurs imports', () => {
    expect(corps('angular/src/app/features/carte/logique/jeu/conversion.ts')).toBe(corps('lib/zones/conversion.ts'));
    // B8 : le rayon hors des bornes d'une plateforme, sorti de `conversion.ts` (plafond de 400 lignes côté Angular).
    expect(corps('angular/src/app/features/carte/logique/jeu/conversion-rayon.ts')).toBe(corps('lib/zones/conversion-rayon.ts'));
    // B9 : la maille par défaut, sortie de `conversion.ts` pour la même raison.
    expect(corps('angular/src/app/features/carte/logique/jeu/conversion-defaut.ts')).toBe(corps('lib/zones/conversion-defaut.ts'));
    // B13 : les minimums de population et leur comportement, sortis pour la même raison.
    expect(corps('angular/src/app/features/carte/logique/jeu/conversion-population.ts')).toBe(corps('lib/zones/conversion-population.ts'));
    // B15 : l'exactitude par composition (unités constitutives de la recette).
    expect(corps('angular/src/app/features/carte/logique/jeu/exactitude-composition.ts')).toBe(corps('lib/zones/exactitude-composition.ts'));
  });
  it('mêmes plateformes, mêmes mailles, dans le même ordre', () => {
    expect([...AP.PLATEFORMES]).toEqual([...SP.PLATEFORMES]);
    expect([...AP.MAILLES]).toEqual([...SP.MAILLES]);
    // B13 : mêmes paramètres « à vérifier », mêmes comportements de minimum.
    expect([...AP.PARAMETRES_VERIFIABLES]).toEqual([...SP.PARAMETRES_VERIFIABLES]);
    expect([...AP.COMPORTEMENTS_POPULATION]).toEqual([...SP.COMPORTEMENTS_POPULATION]);
  });
  it('mêmes messages de refus', () => {
    expect(A.MESSAGES_CONVERSION).toEqual(S.MESSAGES_CONVERSION);
    expect(AD.REGLAGES_DEFAUT_REPLI).toEqual(SD.REGLAGES_DEFAUT_REPLI);
  });
  it('un jeu risque reçu par ⑤ se dit par la phrase du chargeur serveur (revue finale du lot 5, point 9)', () => {
    expect(MESSAGE_JEU_RISQUE).toBe(OU_SE_GERE.risque);
  });
  it('mêmes réponses sur les mêmes cas', () => {
    const lignes = [
      { pop_en_zone: 80, pop_totale: 100, part: 80, part_brute: 80 }, { pop_en_zone: 10, pop_totale: 100, part: 10, part_brute: 10 },
      { pop_en_zone: 5, pop_totale: null, part: null, part_brute: null }, { pop_en_zone: 20, pop_totale: 100, part: 20, part_brute: 20 },
    ];
    for (const seuil of [0, 10, 20, 50, 100]) expect(A.appliquerSeuil(lignes, 130, seuil)).toEqual(S.appliquerSeuil(lignes, 130, seuil));
    expect(A.resumeExact(500, 3, 4)).toEqual(S.resumeExact(500, 3, 4));
    const recettes: Recette[] = [
      { v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3, rayon_m: 20_000 },
      // A3 : disque entier (exact) et disque tronqué (Strasbourg 20 km, calculé).
      { v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3, rayon_m: 20_000, part_retenue: 1 },
      { v: 1, type: 'rayon_point', lon: 7.7521, lat: 48.5734, rayon_m: 20_000, part_retenue: 0.6586 },
      { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5_000, perimetre: { type: 'departement', code: '13' } },
      { v: 1, type: 'codes_postaux', codes: ['13001', '13002'] },
      { v: 1, type: 'dessin' },
    ];
    const POIDS_POUSSEE: SD.MecanismePoussee[][] = [
      [],
      [{ plateforme: 'dv360', maille: 'cp', mecanisme: 'script', branche: false }],
      [{ plateforme: 'dv360', maille: 'cp', mecanisme: 'script', branche: true }, { plateforme: 'meta', maille: 'cp', mecanisme: 'aucun', branche: false }],
    ];
    const regles = [
      ligne({ plateforme: 'meta', maille: 'cercle', limites: { rayon_min_m: 1_000, rayon_max_m: 10_000, max_unites: 2 } }),
      ligne({ plateforme: 'meta', maille: 'cp', a_verifier: true }),
      ligne({ plateforme: 'dv360', maille: 'cp', poussee_branchee: true }), ligne({ plateforme: 'dv360', maille: 'cercle' }),
      ligne({ plateforme: 'ttd', maille: 'polygone', a_verifier: true }), ligne({ plateforme: 'ttd', maille: 'cp', a_verifier: true }),
      ligne({ plateforme: 'tiktok', maille: 'commune', limites: { pop_min_groupe: 1_000, max_unites: 1 } }),
      ligne({ plateforme: 'tiktok', maille: 'cercle', disponible: false }),
    ];
    for (const r of recettes) {
      for (const l of regles) {
        for (const rayon of [undefined, 20_000, 5_000]) expect(A.exactitude(r, l.maille, l, rayon)).toBe(S.exactitude(r, l.maille, l, rayon));
      }
      for (const p of SP.PLATEFORMES) {
        expect(AD.mailleParDefaut(regles, p, r)).toBe(SD.mailleParDefaut(regles, p, r));
        expect(AD.simulationsRequises(regles, p, r)).toEqual(SD.simulationsRequises(regles, p, r));
        // B16 : les mêmes réponses avec les mécanismes de poids du registre (branchés ou non).
        for (const poids of POIDS_POUSSEE) {
          expect(AD.mailleParDefaut(regles, p, r, poids)).toBe(SD.mailleParDefaut(regles, p, r, poids));
          expect(AD.simulationsRequises(regles, p, r, poids)).toEqual(SD.simulationsRequises(regles, p, r, poids));
          for (const sims of SIMULATIONS) {
            expect(AD.choisirDefaut(regles, p, r, sims, SD.REGLAGES_DEFAUT_REPLI, poids))
              .toEqual(SD.choisirDefaut(regles, p, r, sims, SD.REGLAGES_DEFAUT_REPLI, poids));
          }
        }
      }
      for (const m of SP.MAILLES) expect(A.avertissementsDisque(r, m)).toEqual(S.avertissementsDisque(r, m));
    }
    for (const l of regles) expect(AD.mailleSure(l)).toBe(SD.mailleSure(l));
    for (const l of regles) for (const poids of POIDS_POUSSEE) expect(AD.modePoussee(l, poids)).toBe(SD.modePoussee(l, poids));
    expect(AD.simulationDe(A.appliquerSeuil(lignes, 130, 10))).toEqual(SD.simulationDe(S.appliquerSeuil(lignes, 130, 10)));
    for (const l of regles) {
      expect(A.verifierLimites(A.appliquerSeuil(lignes, 130, 10), l)).toEqual(S.verifierLimites(S.appliquerSeuil(lignes, 130, 10), l));
      expect(A.verifierLimites(A.resumeExact(500, 3, 4), l)).toEqual(S.verifierLimites(S.resumeExact(500, 3, 4), l));
    }
    // B13 : les minimums de population, sous tous les comportements du registre.
    const minimums = [
      ligne({ plateforme: 'dv360', maille: 'cercle', limites: { pop_min_unite: 1_000 }, pop_min_unite_comportement: 'refus', parametres_a_verifier: ['pop_min_unite_comportement'] }),
      ligne({ plateforme: 'dv360', maille: 'cercle', limites: { pop_min_unite: 1_000 }, pop_min_unite_comportement: 'avertissement' }),
      ligne({ plateforme: 'tiktok', maille: 'departement', limites: { pop_min_groupe: 1_000 }, pop_min_groupe_comportement: 'avertissement' }),
      ligne({ plateforme: 'tiktok', maille: 'departement', limites: { pop_min_groupe: 1_000 }, pop_min_groupe_comportement: 'refus' }),
      ligne({ plateforme: 'tiktok', maille: 'commune', limites: { pop_min_groupe: 1_000 } }), ...regles,
    ];
    for (const l of minimums) {
      for (const [bilan, pops] of [[{ achetee: 300 }, [300]], [{ achetee: 5_000 }, [4_000, 800, null]], [{ achetee: 0, n_inconnues: 1 }, [null]]] as const) {
        expect(APop.controlerPopulation(bilan, pops, l)).toEqual(SPop.controlerPopulation(bilan, pops, l));
      }
      expect(APop.popMinPavage(l)).toBe(SPop.popMinPavage(l));
      expect(APop.controlerPopulation({ achetee: 500, n_inconnues: 1 }, [500, null], l)).toEqual(SPop.controlerPopulation({ achetee: 500, n_inconnues: 1 }, [500, null], l));
      expect(APop.avertissementsEcartes({ n_cercles: 2, population_max: 900 }, l)).toEqual(SPop.avertissementsEcartes({ n_cercles: 2, population_max: 900 }, l));
    }
    // Relecture B13 (I-1) : la population d'une forme, inconnue en territoire non carroyé.
    for (const f of [{ population: 0, motif_vide: 'territoire_non_carroye', territoires_non_carroyes: [{}] }, { population: 9, territoires_non_carroyes: [] }]) {
      expect(APop.populationDeForme(f)).toBe(SPop.populationDeForme(f));
    }
    for (const part_brute of [20, 19.96, 0.02, 0, null]) {
      for (const seuil of [0, 20]) expect(A.estRetenue({ part_brute }, seuil)).toBe(S.estRetenue({ part_brute }, seuil));
    }
  });
});

/** Les fichiers `.ts` non-spec d'un dossier, récursivement. */
function sources(dossier: string): string[] {
  return readdirSync(dossier).flatMap((n) => {
    const f = `${dossier}/${n}`;
    if (statSync(f).isDirectory()) return sources(f);
    return n.endsWith('.ts') && !n.endsWith('.spec.ts') ? [f] : [];
  });
}

describe('les règles des plateformes vivent dans plateformes_geo — côté Angular aussi', () => {
  // Même contrôle que `tests/unit/zones/conversion.test.ts` sur `lib/zones/conversion*.ts`, étendu à la logique de ⑤
  // côté Angular (contraintes du lot 5 : « grep des nombres dans angular/…/jeu/** ») : la logique ET l'écran (T10).
  const code = [...sources('angular/src/app/features/carte/logique/jeu'), ...sources('angular/src/app/features/carte/panneaux/jeu')]
    .map((f) => readFileSync(f, 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const OP = String.raw`(?:<=?|>=?|===?|!==?|\?\?|\|\||:|=)`;
  const enContexte = (n: string) => new RegExp(String.raw`${OP}\s*${n}(?![\d_])|(?<![\d_])${n}\s*${OP}`);
  it('aucun nombre de la seed en contexte de limite', () => {
    for (const n of ['200', '80000', '80_000', '3000', '3_000', '50000', '50_000', '1000', '1_000', '20000', '20_000', '2000', '2_000']) expect(code, n).not.toMatch(enContexte(n));
  });
  it('aucune clé de limite reçoit un nombre écrit', () => {
    expect(code).not.toMatch(/(max_unites|rayon_min_m|rayon_max_m|pop_min_unite|pop_min_groupe|max_sommets|polygone_sommets_max|polygone_morceaux_max)\s*(?:<=?|>=?|===?|!==?|\?\?|\|\||:|=)\s*\d/);
  });
});

describe('le plafond de la route des contours de communes, vu de ⑤ (relecture T10-12)', () => {
  it('`MAX_CODES_CONTOURS` (Angular) = `MAX_CODES` de `POST /api/zones/communes/contours`', () => {
    const route = readFileSync('app/api/zones/communes/contours/route.ts', 'utf8').match(/const MAX_CODES = (\d+);/)?.[1];
    const angular = readFileSync('angular/src/app/features/carte/data/jeux.api.ts', 'utf8').match(/export const MAX_CODES_CONTOURS = (\d+);/)?.[1];
    expect(route).toBeDefined();
    expect(angular).toBe(route);
  });
});
