/**
 * Copie des types `NatureSource` et `EtatFraicheur` de `lib/donnees/registre-fraicheur.ts`
 * (lot 6, 2026-10-06) ; parité par assignabilité mutuelle : `tests/unit/angular/admin-logique-paritaire.test.ts`.
 */
export type NatureSource = 'live' | 'cache' | 'referentiel' | 'derive';

export type EtatFraicheur = 'a_jour' | 'en_retard' | 'jamais_mesure' | 'sans_objet';
