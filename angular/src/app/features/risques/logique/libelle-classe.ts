/**
 * Le libellé lisible d'une classe de zone, reconstruit depuis le profil.
 *
 * ── POURQUOI ICI, ET PAS DANS CHAQUE ÉCRAN ────────────────────────────────
 *
 * Une classe voyage sous sa forme courte — `haut:2`, `bas:pprt`, `hors` — qui
 * est la même en base, dans les propriétés d'une tuile MVT et dans les clés de
 * légende (`idClasse`, `lib/risques/affectation.ts`). Cette forme est faite
 * pour être comparée, pas pour être lue.
 *
 * La forme lisible, elle, dépend du PROFIL : `haut:2` se dit « Seveso seuil
 * haut — 1 km à 2 km » sur un profil et « 500 m à 3 km » sur un autre. Chaque
 * écran qui la reconstruit de son côté finit par la reconstruire un peu
 * différemment, et le même code postal se retrouve rangé sous deux intitulés
 * dans deux endroits du produit.
 *
 * Cette fonction vivait dans `app/api/risques/profil/export/route.ts`, donc
 * hors d'atteinte de toute interface. L'atelier de zones en a besoin pour son
 * panneau de classes : elle monte ici plutôt que d'être recopiée.
 */
import { LIBELLE_NIVEAU, libelleRayon, type Niveau, type ProfilRayons, anneauxDuNiveau, NIVEAUX } from './profil';

/** Les anneaux de chaque niveau, sous la forme qu'attend {@link libelleClasse}. */
export function anneauxParNiveau(profil: ProfilRayons): Record<Niveau, number[]> {
  return Object.fromEntries(
    NIVEAUX.map((n) => [n, anneauxDuNiveau(profil, n)]),
  ) as Record<Niveau, number[]>;
}

/**
 * Le libellé lisible d'une classe.
 *
 * @param classe - L'identifiant court, tel que `idClasse` l'écrit.
 * @param anneauxPar - Les anneaux de chaque niveau ({@link anneauxParNiveau}).
 * @returns Une phrase française, jamais un identifiant brut.
 *
 * @example
 * libelleClasse('haut:2', { haut: [1000, 2000], bas: [], autres: [] })
 * // → 'Seveso seuil haut — 1 km à 2 km'
 */
export function libelleClasse(classe: string, anneauxPar: Record<Niveau, number[]>): string {
  if (classe === 'hors') return 'Hors des anneaux';
  const [niveau, bande] = classe.split(':') as [Niveau, string];
  const court = LIBELLE_NIVEAU[niveau] ?? niveau;
  if (bande === 'pprt') return `${court} — périmètre PPRT`;
  const anneaux = anneauxPar[niveau] ?? [];
  const i = Number(bande) - 1;

  /*
   * ⚠ Quand le profil ne porte AUCUN anneau pour ce niveau, on ne bricole pas
   * une borne : on nomme la bande par son rang.
   *
   * `libelleRayon(undefined)` rendait **« NaN km »** — constaté à l'écran le
   * 2026-09-20 sur le bloc « Pression par classe », qui affiche les classes
   * d'un jeu ENREGISTRÉ sans forcément disposer du profil qui les a produites.
   * Un « NaN » dans une interface n'informe de rien et fait douter de tout le
   * reste du tableau, y compris des chiffres qui, eux, étaient justes.
   */
  if (anneaux.length === 0) return `${court} — bande ${i + 1}`;

  const debut = i === 0 ? '0' : anneaux[i - 1] !== undefined ? libelleRayon(anneaux[i - 1]) : '?';
  /*
   * `?` et non une valeur inventée : une classe peut survivre à un anneau
   * retiré du profil — un jeu enregistré porte ses classes, le profil courant
   * peut avoir changé. Afficher une borne plausible mais fausse serait pire
   * qu'avouer qu'on ne la connaît plus.
   */
  const fin = anneaux[i] !== undefined ? libelleRayon(anneaux[i]) : '?';
  return `${court} — ${debut} à ${fin}`;
}
