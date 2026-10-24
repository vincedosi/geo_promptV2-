import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as S from '@/lib/zones/conversion';
import * as SP from '@/lib/zones/plateformes';
import type * as SC from '@/lib/zones/couverture';
import * as A from '../../../angular/src/app/features/carte/logique/jeu/conversion';
import * as AP from '../../../angular/src/app/features/carte/logique/jeu/plateformes';
import type * as AC from '../../../angular/src/app/features/carte/logique/analyses/couverture';
import type { Recette } from '@/lib/zones/recette';

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
] = [true, true, true, true];
void _types;

/** Le code d'un fichier sans son en-tête (premier commentaire de bloc) ni ses lignes d'import. */
const corps = (chemin: string) => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')
  .replace(/^\/\*\*[\s\S]*?\*\/\n/, '')
  .replace(/^import [^\n]+\n/gm, '');

const ligne = (p: Partial<SP.PlateformeGeo> & Pick<SP.PlateformeGeo, 'plateforme' | 'maille'>): SP.PlateformeGeo => ({
  libelle: 'x', natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14', a_verifier: false,
  note: null, ordre: 0, ...p,
});

describe('conversion d’une zone : Angular = serveur', () => {
  it('les types partagés sont égaux (tenu par tsc)', () => {
    expect(_types.every(Boolean)).toBe(true);
  });
  it('les deux fichiers sont identiques hors de leur en-tête et de leurs imports', () => {
    expect(corps('angular/src/app/features/carte/logique/jeu/conversion.ts')).toBe(corps('lib/zones/conversion.ts'));
  });
  it('mêmes plateformes, mêmes mailles, dans le même ordre', () => {
    expect([...AP.PLATEFORMES]).toEqual([...SP.PLATEFORMES]);
    expect([...AP.MAILLES]).toEqual([...SP.MAILLES]);
  });
  it('mêmes messages de refus', () => {
    expect(A.MESSAGES_CONVERSION).toEqual(S.MESSAGES_CONVERSION);
  });
  it('mêmes réponses sur les mêmes cas', () => {
    const lignes = [
      { pop_en_zone: 80, pop_totale: 100, part: 80 }, { pop_en_zone: 10, pop_totale: 100, part: 10 },
      { pop_en_zone: 5, pop_totale: null, part: null }, { pop_en_zone: 20, pop_totale: 100, part: 20 },
    ];
    for (const seuil of [0, 10, 20, 50, 100]) expect(A.appliquerSeuil(lignes, 130, seuil)).toEqual(S.appliquerSeuil(lignes, 130, seuil));
    expect(A.resumeExact(500, 3, 4)).toEqual(S.resumeExact(500, 3, 4));
    const recettes: Recette[] = [
      { v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3, rayon_m: 20_000 },
      { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5_000, perimetre: { type: 'departement', code: '13' } },
      { v: 1, type: 'codes_postaux', codes: ['13001', '13002'] },
      { v: 1, type: 'dessin' },
    ];
    const regles = [
      ligne({ plateforme: 'meta', maille: 'cercle', limites: { rayon_min_m: 1_000, rayon_max_m: 10_000, max_unites: 2 } }),
      ligne({ plateforme: 'meta', maille: 'cp', a_verifier: true }),
      ligne({ plateforme: 'dv360', maille: 'cp' }), ligne({ plateforme: 'dv360', maille: 'cercle' }),
      ligne({ plateforme: 'ttd', maille: 'polygone', a_verifier: true }), ligne({ plateforme: 'ttd', maille: 'cp', a_verifier: true }),
      ligne({ plateforme: 'tiktok', maille: 'commune', limites: { pop_min_groupe: 1_000, max_unites: 1 } }),
      ligne({ plateforme: 'tiktok', maille: 'cercle', disponible: false }),
    ];
    for (const r of recettes) {
      for (const l of regles) {
        for (const rayon of [undefined, 20_000, 5_000]) expect(A.exactitude(r, l.maille, l, rayon)).toBe(S.exactitude(r, l.maille, l, rayon));
      }
      for (const p of SP.PLATEFORMES) expect(A.mailleParDefaut(regles, p, r)).toBe(S.mailleParDefaut(regles, p, r));
    }
    for (const l of regles) {
      expect(A.verifierLimites(A.appliquerSeuil(lignes, 130, 10), l)).toEqual(S.verifierLimites(S.appliquerSeuil(lignes, 130, 10), l));
      expect(A.verifierLimites(A.resumeExact(500, 3, 4), l)).toEqual(S.verifierLimites(S.resumeExact(500, 3, 4), l));
    }
    expect(A.estRetenue({ part: 20 }, 20)).toBe(S.estRetenue({ part: 20 }, 20));
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
  // côté Angular (contraintes du lot 5 : « grep des nombres dans angular/…/jeu/** »).
  const code = sources('angular/src/app/features/carte/logique/jeu')
    .map((f) => readFileSync(f, 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const OP = String.raw`(?:<=?|>=?|===?|!==?|\?\?|\|\||:|=)`;
  const enContexte = (n: string) => new RegExp(String.raw`${OP}\s*${n}(?![\d_])|(?<![\d_])${n}\s*${OP}`);
  it('aucun nombre de la seed en contexte de limite', () => {
    for (const n of ['200', '80000', '80_000', '3000', '3_000', '50000', '50_000', '1000', '1_000']) expect(code, n).not.toMatch(enContexte(n));
  });
  it('aucune clé de limite reçoit un nombre écrit', () => {
    expect(code).not.toMatch(/(max_unites|rayon_min_m|rayon_max_m|pop_min_unite|pop_min_groupe|max_sommets)\s*(?:<=?|>=?|===?|!==?|\?\?|\|\||:|=)\s*\d/);
  });
});
