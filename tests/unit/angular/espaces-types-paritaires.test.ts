/**
 * Les types de la page « Espaces de travail » copiés dans angular/ restent
 * ceux du serveur. Assignabilité mutuelle vérifiée par `npx tsc --noEmit`
 * (Vitest ne type-vérifie pas) — même patron que admin-logique-paritaire.
 */
import { describe, expect, it } from 'vitest';
import type * as R from '@/lib/espaces/types';
import type * as A from '../../../angular/src/app/features/admin/espaces/logique/types';

type Egal<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false;
const _verif: [
  Egal<R.EspaceResume, A.EspaceResume>,
  Egal<R.ReponseEspaces, A.ReponseEspaces>,
  Egal<R.JeuDeDonnees, A.JeuDeDonnees>,
  Egal<R.JeuPourEspace, A.JeuPourEspace>,
  Egal<R.ReponseDonneesEspace, A.ReponseDonneesEspace>,
  Egal<R.ReponseSocle, A.ReponseSocle>,
  Egal<R.MembreEspace, A.MembreEspace>,
  Egal<R.ApercuEspace, A.ApercuEspace>,
  Egal<R.StatutJeu, A.StatutJeu>,
] = [true, true, true, true, true, true, true, true, true];
void _verif;

describe('types des espaces de travail : Angular = serveur', () => {
  it('la copie existe et la parité est tenue par tsc', () => {
    expect(_verif.every(Boolean)).toBe(true);
  });
});
