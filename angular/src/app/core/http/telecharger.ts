import type { HttpResponse } from '@angular/common/http';
import { InjectionToken } from '@angular/core';

/**
 * Nom du fichier annoncé par `Content-Disposition`, ou `repli`.
 * React lisait `filename="…"` seulement ; on lit aussi la forme
 * `filename*=UTF-8''…` (sur-ensemble : `filename="x"` donne le même nom).
 */
export function nomDeFichier(reponse: HttpResponse<Blob>, repli: string): string {
  const cd = reponse.headers.get('content-disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
  if (!m) return repli;
  const brut = m[1] ?? m[2];
  try {
    return decodeURIComponent(brut);
  } catch {
    return brut;
  }
}

/** Délai avant de révoquer l'URL d'objet d'un téléchargement (voir `enregistrerFichier`). */
const DELAI_REVOCATION_MS = 1000;

/**
 * Enregistre un fichier binaire rendu par une route `requireAuth` (Bearer) :
 * jamais un `<a href>` nu, qui partirait sans jeton.
 *
 * L'ancre n'est JAMAIS insérée dans `document.body` (rien ne doit s'afficher
 * hors d'une racine d'ombre) : détachée, elle déclenche tout de même le
 * téléchargement. L'URL d'objet est révoquée juste après le clic, pour ne pas
 * garder le classeur en mémoire jusqu'au rechargement — mais APRÈS une
 * seconde et non au tour suivant de la boucle d'événements : le clic lance le
 * téléchargement de façon ASYNCHRONE, et certains navigateurs (Firefox, Safari)
 * lisent l'URL d'objet après le retour de `click()`. Révoquée trop tôt, elle
 * rendrait un téléchargement vide ou en échec.
 */
export function enregistrerFichier(doc: Document, reponse: HttpResponse<Blob>, repli: string): void {
  const corps = reponse.body;
  if (!corps) return;
  const url = URL.createObjectURL(corps);
  const a = doc.createElement('a');
  a.href = url;
  a.download = nomDeFichier(reponse, repli);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), DELAI_REVOCATION_MS);
}

/**
 * `enregistrerFichier` derrière un jeton : la couture des specs (une fonction d'un module ESM ne se remplace pas par
 * `vi.spyOn`). Aucune dépendance HTTP : `providedIn: 'root'` est sans risque dans un hôte, rien du shell n'y est lu.
 */
export const ENREGISTRER_FICHIER = new InjectionToken<typeof enregistrerFichier>('ENREGISTRER_FICHIER', {
  providedIn: 'root',
  factory: () => enregistrerFichier,
});
