/**
 * @file lib/api/valider-corps.ts
 *
 * Lecture validée du corps d'une requête API.
 *
 * ── Le constat (`SEC-001`) ──────────────────────────────────────────────────
 *
 * `CLAUDE.md` impose la validation Zod sur les routes API. Au 2026-09-11,
 * 39 routes lisaient leur corps sans aucun schéma : `const { x } = await
 * request.json()`. Deux conséquences concrètes, l'une et l'autre mesurées sur
 * des routes réelles :
 *
 *  - un corps qui n'est pas du JSON fait **lever** `request.json()`. Sans
 *    `try/catch`, la route répond 500 là où la faute est celle de l'appelant ;
 *  - une valeur du mauvais type traverse la route jusqu'à la base, où elle
 *    produit une erreur Postgres traduite en message opaque — `/api/admin/users`
 *    répondait « Organization not found or inactive » pour un `organization_id`
 *    qui n'était simplement pas un UUID.
 *
 * ── Pourquoi ce helper plutôt qu'un `safeParse` dans chaque route ───────────
 *
 * Les routes du projet ne partagent PAS une forme de réponse d'erreur : les
 * unes répondent `{ error }`, les autres `{ success: false, error }`. Un helper
 * qui fabriquerait lui-même la `NextResponse` imposerait une forme unique et
 * casserait les clients existants.
 *
 * Il rend donc un résultat, pas une réponse : chaque route garde sa forme,
 * son code de statut et son vocabulaire. C'est la seule façon d'ajouter la
 * validation à comportement de sortie constant.
 *
 * ── Mode permissif ──────────────────────────────────────────────────────────
 *
 * Les schémas écrits au-dessus valident la FORME (type, présence, format d'un
 * UUID), jamais la règle métier. Une route qui acceptait une valeur et en
 * faisait quelque chose d'utile doit continuer à l'accepter : le but est de
 * fermer la porte aux entrées qui ne pouvaient de toute façon que finir en
 * erreur, pas d'en refuser de nouvelles.
 */
import type { z } from 'zod';

export type ResultatCorps<S extends z.ZodTypeAny> =
  | { ok: true; valeur: z.infer<S> }
  | { ok: false; message: string };

/** Nombre d'anomalies citées dans le message. Au-delà, le message devient illisible. */
const MAX_ANOMALIES = 3;

/**
 * Traduction des anomalies Zod courantes.
 *
 * Zod parle anglais. Les messages de ce projet sont en français et finissent
 * dans des toasts vus par l'utilisateur : les traduire ICI évite de devoir
 * écrire un message sur mesure dans chacun des schémas des 39 routes.
 *
 * Un message posé explicitement dans un schéma (`z.string().min(1, 'Nom
 * requis')`) n'est jamais réécrit : il passe tel quel.
 */
function raison(anomalie: z.ZodIssue): string {
  switch (anomalie.code) {
    case 'invalid_type':
      return anomalie.received === 'undefined' || anomalie.received === 'null'
        ? 'requis'
        : `type inattendu (attendu : ${anomalie.expected})`;
    case 'invalid_string':
      return anomalie.validation === 'uuid' ? 'doit être un UUID'
        : anomalie.validation === 'email' ? 'doit être une adresse e-mail'
        : anomalie.validation === 'url' ? 'doit être une URL'
        : 'format invalide';
    case 'invalid_enum_value':
      return `valeur inattendue (attendu : ${anomalie.options.join(', ')})`;
    case 'invalid_union_discriminator':
      return `valeur inattendue (attendu : ${anomalie.options.map(String).join(', ')})`;
    case 'invalid_literal':
      return `valeur inattendue (attendu : ${String(anomalie.expected)})`;
    case 'unrecognized_keys':
      return `clé${anomalie.keys.length > 1 ? 's' : ''} inattendue${anomalie.keys.length > 1 ? 's' : ''} : ${anomalie.keys.join(', ')}`;
    case 'not_finite':
      return 'doit être un nombre fini';
    case 'custom':
      return 'valeur invalide';
    case 'too_small':
      return anomalie.type === 'string' && Number(anomalie.minimum) <= 1
        ? 'ne peut pas être vide'
        : `trop petit (minimum ${anomalie.minimum})`;
    case 'too_big':
      return `trop grand (maximum ${anomalie.maximum})`;
    default:
      return anomalie.message;
  }
}

/** Un message écrit à la main dans le schéma prime sur la traduction. */
const MESSAGES_ZOD_PAR_DEFAUT = /^(Required|Expected |Invalid|String must|Number must|Array must|Unrecognized key)/;

/**
 * Message lisible à partir d'un échec Zod : `champ : raison`, séparés par « ; ».
 *
 * Le chemin est explicité parce qu'une erreur d'API sans nom de champ oblige
 * l'appelant à deviner. Pour une anomalie à la racine (corps qui n'est pas un
 * objet), seul le message est rendu.
 */
export function messageAnomalies(erreur: z.ZodError): string {
  const anomalies = erreur.issues.slice(0, MAX_ANOMALIES).map((a) => {
    const texte = MESSAGES_ZOD_PAR_DEFAUT.test(a.message) ? raison(a) : a.message;
    const champ = a.path.join('.');
    return champ ? `${champ} : ${texte}` : texte;
  });
  const reste = erreur.issues.length - anomalies.length;
  return anomalies.join(' ; ') + (reste > 0 ? ` (et ${reste} autre${reste > 1 ? 's' : ''})` : '');
}

export interface OptionsLecture {
  /**
   * Traiter un corps ABSENT (vide, ou uniquement des blancs) comme `{}`.
   *
   * Réservé aux routes dont tous les champs ont une valeur par défaut —
   * `/api/admin/init-admin` s'appelle légitimement sans corps. Un corps présent
   * mais mal formé reste une erreur, y compris avec cette option : accepter du
   * JSON cassé reviendrait à exécuter la route sur des valeurs par défaut que
   * l'appelant croyait avoir remplacées.
   */
  corpsAbsentTolere?: boolean;
}

/**
 * Lit et valide le corps JSON d'une requête.
 *
 * Ne lève jamais : un corps illisible devient `{ ok: false }`, au même titre
 * qu'un corps mal formé. C'est ce qui permet à l'appelant de répondre 400 dans
 * les deux cas au lieu de laisser passer une exception.
 *
 * Le corps est lu en texte puis analysé à la main — et non via
 * `request.json()` — pour pouvoir distinguer « absent » de « mal formé ».
 */
export async function lireCorps<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
  options: OptionsLecture = {},
): Promise<ResultatCorps<S>> {
  let texte: string;
  try {
    texte = await request.text();
  } catch {
    return { ok: false, message: 'Corps de requête illisible' };
  }

  let brut: unknown;
  if (texte.trim() === '') {
    if (!options.corpsAbsentTolere) return { ok: false, message: 'Corps JSON invalide' };
    brut = {};
  } else {
    try {
      brut = JSON.parse(texte);
    } catch {
      return { ok: false, message: 'Corps JSON invalide' };
    }
  }

  const analyse = schema.safeParse(brut);
  if (!analyse.success) return { ok: false, message: messageAnomalies(analyse.error) };

  return { ok: true, valeur: analyse.data };
}

// ════════════════════════════════════════════════════════════════════════════
// Formulaires multipart (dépôts de fichiers)
// ════════════════════════════════════════════════════════════════════════════

export type ResultatFormulaire<S extends z.ZodTypeAny> =
  | { ok: true; champs: z.infer<S>; formulaire: FormData }
  | { ok: false; message: string };

/**
 * Lit et valide les champs TEXTE d'un formulaire multipart.
 *
 * Les fichiers ne passent pas par le schéma : leur validation porte sur le nom,
 * l'extension et la taille, et chaque route a ses propres limites. On rend donc
 * le `FormData` en plus des champs validés, et les fichiers se récupèrent avec
 * `fichierDeFormulaire` / `fichiersDeFormulaire`.
 *
 * Comme `lireCorps`, ne lève jamais : un corps qui n'est pas un formulaire
 * multipart devient `{ ok: false }`.
 */
export async function lireFormulaire<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<ResultatFormulaire<S>> {
  let formulaire: FormData;
  try {
    formulaire = await request.formData();
  } catch {
    return { ok: false, message: 'Corps de requête invalide (FormData attendu)' };
  }

  // Seules les entrées texte sont soumises au schéma : une entrée fichier
  // portant le nom d'un champ texte ne doit pas être interprétée comme sa valeur.
  const champs: Record<string, string> = {};
  for (const [clef, valeur] of formulaire.entries()) {
    if (typeof valeur === 'string') champs[clef] = valeur;
  }

  const analyse = schema.safeParse(champs);
  if (!analyse.success) return { ok: false, message: messageAnomalies(analyse.error) };

  return { ok: true, champs: analyse.data, formulaire };
}

/**
 * Un fichier du formulaire, ou `null`.
 *
 * `instanceof File` et non `as File` : les routes écrivaient
 * `formData.get('file') as File | null`, un cast qui MENT quand le client envoie
 * une valeur texte sous ce nom. On lisait alors `file.name` sur une chaîne —
 * `undefined.toLowerCase()` plus loin, donc un 500 pour une requête malformée.
 */
export function fichierDeFormulaire(formulaire: FormData, nom: string): File | null {
  const valeur = formulaire.get(nom);
  return valeur instanceof File ? valeur : null;
}

/** Tous les fichiers déposés sous ce nom. Les entrées non-fichier sont écartées. */
export function fichiersDeFormulaire(formulaire: FormData, nom: string): File[] {
  return formulaire.getAll(nom).filter((v): v is File => v instanceof File);
}
