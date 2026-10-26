/**
 * ⑦ Activation (lot 7, T3) : la liste des formats de fichier qu'offre une plateforme à une maille est recopiée dans
 * angular/ (`logique/activation/cartes.ts`) — Angular n'importe jamais le serveur. Ce test empêche la copie de dériver
 * de `lib/zones/fichiers-plateformes.ts` (ruling 2 du lot 7) : une carte de ⑦ qui offrirait un format que la route
 * `…/fichier` refuse rendrait un bouton qui échoue à chaque clic.
 */
import { describe, expect, it } from 'vitest';
import * as S from '@/lib/zones/fichiers-plateformes';
import { MAILLES, PLATEFORMES } from '@/lib/zones/plateformes';
import * as A from '../../../angular/src/app/features/carte/logique/activation/cartes';

describe('formats de fichier de ⑦ : Angular = serveur', () => {
  it('mêmes formats, dans le même ordre', () => {
    expect(A.FORMATS_FICHIER).toEqual(S.FORMATS_FICHIER);
  });

  it('formatsDe rend la même chose pour chaque plateforme et chaque maille', () => {
    for (const p of PLATEFORMES) for (const m of MAILLES) {
      expect(A.formatsDe(p, m), `${p} × ${m}`).toEqual(S.formatsDe(p, m));
    }
  });
});
