import { describe, it, expect } from 'vitest';
import {
  formaterNombre, formaterNombreArrondi,
  formaterNombreAbrege, formaterNombreAbregeSansMilliard,
} from '@/lib/format/nombre';

/**
 * `DUP-001` — ces tests figent la sortie des quinze copies remplacées.
 *
 * Ils ne jugent pas le format, ils le CONSTATENT : c'est la seule preuve que
 * l'unification n'a rien changé à ce que voit l'utilisateur. Un test qui
 * déciderait de ce que « devrait » être l'affichage ne prouverait rien.
 *
 * `toLocaleString('fr-FR')` sépare les milliers par une ESPACE INSÉCABLE
 * ÉTROITE (U+202F) sous Node 20, et non par une espace ordinaire. Les
 * attendus la nomment par son point de code : la coller en clair dans le
 * fichier la rendrait indistinguable d'une espace normale à la relecture.
 */
const NBSP = String.fromCharCode(0x202f);

describe('formaterNombre — le brut, 6 copies remplacées', () => {
  it('sépare les milliers à la française', () => {
    expect(formaterNombre(1234567)).toBe(`1${NBSP}234${NBSP}567`);
    expect(formaterNombre(999)).toBe('999');
  });

  it('rend un tiret pour une valeur absente — le comportement de 2 des 6 copies', () => {
    expect(formaterNombre(null)).toBe('—');
    expect(formaterNombre(undefined)).toBe('—');
  });

  it('ne touche pas a zero — 0 n est pas une valeur absente', () => {
    // Piege classique : un `if (!valeur)` aurait rendu « — » pour 0 impression,
    // ce qui n'est pas la meme information qu'une donnee manquante.
    expect(formaterNombre(0)).toBe('0');
  });

  it('garde les decimales telles que toLocaleString les rend', () => {
    expect(formaterNombre(1234.5)).toBe(`1${NBSP}234,5`);
  });
});

describe('formaterNombreArrondi', () => {
  it('arrondit puis met en forme', () => {
    expect(formaterNombreArrondi(1234.6)).toBe(`1${NBSP}235`);
    expect(formaterNombreArrondi(0.4)).toBe('0');
  });
  it('rend un tiret pour absent ou non fini', () => {
    expect(formaterNombreArrondi(null)).toBe('—');
    expect(formaterNombreArrondi(Number.NaN)).toBe('—');
  });
});

describe('formaterNombreAbrege — paliers k/M/G, 5 copies remplacées', () => {
  it('reproduit exactement les paliers des copies remplacées', () => {
    expect(formaterNombreAbrege(1_500_000_000)).toBe('1.5G');
    expect(formaterNombreAbrege(3_400_000)).toBe('3.4M');
    expect(formaterNombreAbrege(1_200)).toBe('1.2k');
    expect(formaterNombreAbrege(999)).toBe('999');
  });

  it('bascule au seuil EXACT, pas juste au-dessus', () => {
    // Les copies comparaient `>=`. Un `>` aurait affiché « 1000 » pour 1e3.
    expect(formaterNombreAbrege(1_000)).toBe('1.0k');
    expect(formaterNombreAbrege(1_000_000)).toBe('1.0M');
    expect(formaterNombreAbrege(1_000_000_000)).toBe('1.0G');
    expect(formaterNombreAbrege(999)).toBe('999');
  });

  it('laisse les negatifs au format complet — comme les copies remplacées', () => {
    // Aucune des copies ne traitait le signe : -1 500 000 ne passe aucun seuil
    // et retombe sur toLocaleString. C'est constate, pas approuve.
    expect(formaterNombreAbrege(-1_500_000)).toBe(`-1${NBSP}500${NBSP}000`);
  });

  it('rend un tiret sur une valeur non finie — le seul ecart assume', () => {
    // Quatre des cinq copies affichaient la chaine « NaN » a l'ecran.
    expect(formaterNombreAbrege(Number.NaN)).toBe('—');
    expect(formaterNombreAbrege(undefined)).toBe('—');
    expect(formaterNombreAbrege('pas un nombre')).toBe('—');
  });

  it('accepte une chaine numerique — SyncMap lui passait des valeurs de tuile', () => {
    expect(formaterNombreAbrege('3400000')).toBe('3.4M');
  });
});

describe('formaterNombreAbregeSansMilliard — la divergence assumée', () => {
  it('rend le milliard en millions, la ou l autre rend des G', () => {
    // C'est LA difference, et elle est visible a l'ecran. La reduire est un
    // arbitrage produit : ce test le documente au lieu de le masquer.
    expect(formaterNombreAbregeSansMilliard(1_200_000_000)).toBe('1200.0M');
    expect(formaterNombreAbrege(1_200_000_000)).toBe('1.2G');
  });

  it('est identique a l autre en dessous du milliard', () => {
    for (const v of [0, 999, 1_000, 12_345, 3_400_000, 999_999_999]) {
      expect(formaterNombreAbregeSansMilliard(v)).toBe(formaterNombreAbrege(v));
    }
  });
});
