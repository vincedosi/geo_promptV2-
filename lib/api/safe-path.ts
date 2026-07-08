/**
 * GENESIS — Helpers de sécurité pour la résolution de chemins fichiers
 * temporaires à partir d'identifiants fournis par le client (session/geocode id).
 *
 * Empêche le path traversal : l'id DOIT être un UUID, et le chemin résolu
 * DOIT rester dans le répertoire de base (défense en profondeur).
 */
import path from 'path';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vrai si `id` est un UUID v4-like valide (format standard 8-4-4-4-12). */
export function isValidUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * Résout `<baseDir>/<id>.json` en validant que `id` est un UUID ET que le
 * chemin résolu reste bien sous `baseDir`. Renvoie `null` si l'un des deux
 * contrôles échoue (id invalide, ou tentative de sortie du répertoire).
 */
export function resolveSafeJsonPath(baseDir: string, id: unknown): string | null {
  if (!isValidUuid(id)) return null;
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(resolvedBase, `${id}.json`);
  if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  return resolvedPath;
}
