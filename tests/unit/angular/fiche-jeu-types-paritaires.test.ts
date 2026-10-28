/**
 * La forme de la fiche d'un jeu de ② (`GET /api/map/catalogue/fiche`, lot « Catalogue et groupes », A-8) recopiée
 * dans `angular/…/carte/data/carte.api.ts` reste celle que compose le serveur (`lib/carte/fiche-jeu.ts`).
 * Assignabilité mutuelle vérifiée par `npx tsc --noEmit` (Vitest ne type-vérifie pas) — même patron que
 * `espaces-types-paritaires.test.ts`. Ajouté en fin de lot (T6) : la copie Angular n'était verrouillée par rien.
 */
import { describe, expect, it } from 'vitest';
import type * as R from '@/lib/carte/fiche-jeu';
import type * as A from '../../../angular/src/app/features/carte/data/carte.api';

type Egal<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false;
const _verif: [
  Egal<R.NiveauSource, A.NiveauSourceFiche>,
  Egal<R.SourceDeFiche, A.SourceFicheJeu>,
  Egal<R.FicheJeu, A.FicheJeu>,
] = [true, true, true];
void _verif;

describe('fiche d un jeu : Angular = serveur', () => {
  it('la copie existe et la parité est tenue par tsc', () => {
    expect(_verif.every(Boolean)).toBe(true);
  });
});
