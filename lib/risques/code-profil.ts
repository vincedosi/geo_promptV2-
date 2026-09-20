/**
 * Le code court d'un profil de rayons — clé de cache, de tuile et d'URL.
 *
 * ── POURQUOI UN CODE RÉVERSIBLE, LÀ OÙ LE BRIEF DIT « HASH » ──────────────
 *
 * `docs/PROMPT.md` demande un `profil_hash`. Le nom de colonne est conservé,
 * mais ce qu'on y écrit n'est pas une empreinte à sens unique, et c'est
 * délibéré pour deux raisons.
 *
 * **Une empreinte peut entrer en collision.** Deux profils différents
 * partageant la même empreinte se serviraient l'un pour l'autre, en silence :
 * la carte afficherait les zones d'un profil sous la légende d'un autre. C'est
 * la famille exacte du défaut corrigé par sql/196 sur `exposition_cache`, où le
 * résultat d'un calcul précédent repartait avec une date d'apparence légitime —
 * un défaut vicieux parce que rien, dans la réponse, ne trahissait l'erreur.
 * Un code réversible ne peut pas collisionner : il PORTE le profil.
 *
 * **Une empreinte n'est pas diagnosticable.** Devant une tuile en cache qui
 * n'affiche pas ce qu'on attend, `h1000.2000.5000_b500.1000_a_L0_P1` se lit ;
 * `a3f9c2e1` demande une requête en base.
 *
 * ── LA FORME ──────────────────────────────────────────────────────────────
 *
 *     h<anneaux>_b<anneaux>_a<anneaux>_L<0|1>_P<0|1>
 *
 * Anneaux séparés par des points, niveau vide possible, `L` pour la liaison,
 * `P` pour l'inclusion des périmètres PPRT. Uniquement des caractères sûrs dans
 * une URL et dans un nom de fichier.
 */
import {
  normaliserProfil,
  NIVEAUX,
  type Niveau,
  type ProfilRayons,
} from '@/lib/risques/profil';

/** La lettre qui préfixe chaque niveau dans le code. */
const LETTRE: Record<Niveau, string> = { haut: 'h', bas: 'b', autres: 'a' };

/**
 * Le code canonique d'un profil.
 *
 * ⚠ Le profil doit être normalisé AVANT : deux profils équivalents mais non
 * canoniques produiraient deux codes, donc deux caches pour une seule question.
 * `normaliserProfil` est appelée ici par sécurité, ce qui rend la fonction
 * idempotente même mal employée.
 *
 * @param p - Le profil à coder.
 * @returns Le code, par exemple `h1000.2000.5000_b500.1000_a_L0_P1`.
 *
 * @example
 * codeProfil(PROFIL_DEFAUT) // 'h1000.2000.5000_b500.1000_a_L0_P1'
 */
export function codeProfil(p: ProfilRayons): string {
  const c = normaliserProfil(p);
  const niveaux = NIVEAUX.map((n) => `${LETTRE[n]}${c[n].join('.')}`);
  return [...niveaux, `L${c.lie ? 1 : 0}`, `P${c.inclurePPRT ? 1 : 0}`].join('_');
}

/**
 * Relit un code produit par {@link codeProfil}.
 *
 * ⚠ **Ne lève jamais.** Le code arrive de l'URL, donc de l'extérieur : un lien
 * tronqué par un client de messagerie casserait la page. L'appelant retombe sur
 * `PROFIL_DEFAUT` quand cette fonction rend `null`.
 *
 * La validation passe par le schéma Zod complet et non par la seule syntaxe :
 * `h20000_b500_a_L0_P1` est syntaxiquement irréprochable et pourtant hors
 * bornes, 20 km dépassant le plafond du pré-calcul.
 *
 * @param code - Le code à relire.
 * @returns Le profil normalisé, ou `null` si le code est illisible ou invalide.
 */
export function profilDepuisCode(code: string): ProfilRayons | null {
  const morceaux = code.split('_');
  if (morceaux.length !== NIVEAUX.length + 2) return null;

  const anneaux: Record<string, number[]> = {};
  for (let i = 0; i < NIVEAUX.length; i += 1) {
    const niveau = NIVEAUX[i];
    const m = morceaux[i];
    if (!m.startsWith(LETTRE[niveau])) return null;
    const corps = m.slice(1);
    if (corps === '') {
      anneaux[niveau] = [];
      continue;
    }
    const valeurs = corps.split('.').map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
    if (valeurs.some(Number.isNaN)) return null;
    anneaux[niveau] = valeurs;
  }

  const drapeau = (m: string, lettre: string): boolean | null => {
    if (m === `${lettre}0`) return false;
    if (m === `${lettre}1`) return true;
    return null;
  };
  const lie = drapeau(morceaux[NIVEAUX.length], 'L');
  const inclurePPRT = drapeau(morceaux[NIVEAUX.length + 1], 'P');
  if (lie === null || inclurePPRT === null) return null;

  try {
    return normaliserProfil({ ...anneaux, lie, inclurePPRT });
  } catch {
    return null;
  }
}

/**
 * Encodage d'URI STRICT, source unique du projet.
 *
 * ⚠ `encodeURIComponent` laisse passer `!`, `'`, `(`, `)` et `*`. Une nature
 * comme « Chimie (IED) » sortait donc avec ses parenthèses, et le code cessait
 * d'être sûr partout où il voyage — une URL le supporte, un nom de fichier
 * d'export pas toujours.
 *
 * Il vit ICI et non dans `lib/zones/jeu.ts`, qui l'a écrit le premier : ce
 * dernier importe déjà `codeProfil` d'ici, et l'inverse ferait un cycle.
 */
export const encStrict = (s: string): string =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * La clé de cache des zones de risque : un profil, ET les natures retenues.
 *
 * ── POURQUOI LES NATURES DOIVENT Y ÊTRE ──────────────────────────────────
 *
 * `zones_risque_cache` est indexée par cette seule chaîne. Depuis sql/220, la
 * géométrie des zones dépend AUSSI du filtre de nature — les anneaux ne sont
 * plus tracés autour des mêmes sites. Deux vues qui ne diffèrent que par ce
 * filtre partageraient sinon une entrée de cache : la première construite
 * servirait ses zones à la seconde, sous la légende de la seconde.
 *
 * C'est le défaut que l'en-tête de `/api/tiles/zones-risque` écarte pour les
 * empreintes de hachage — « servir les zones d'un profil sous la légende d'un
 * autre ». Une clé incomplète le produit tout aussi bien qu'une collision.
 *
 * @param codeDuProfil - Le code rendu par {@link codeProfil}, déjà normalisé.
 * @param natures - Les libellés retenus. Vide = toutes, et la clé est alors
 *   celle du profil seul — les caches construits avant ce filtre restent donc
 *   valides, et rien n'est à reconstruire.
 * @returns La clé de cache.
 */
export function codeZonesRisque(codeDuProfil: string, natures: string[] = []): string {
  if (natures.length === 0) return codeDuProfil;
  // Trié : deux sélections des mêmes natures dans un ordre différent posent la
  // même question, et ne doivent pas coûter deux constructions.
  const n = [...natures].sort().map(encStrict).join('.');
  return `${codeDuProfil}~n${n}`;
}
