import type { HttpResponse } from '@angular/common/http';

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

/**
 * Enregistre un fichier binaire rendu par une route `requireAuth` (Bearer) :
 * jamais un `<a href>` nu, qui partirait sans jeton.
 *
 * L'ancre n'est JAMAIS insérée dans `document.body` (rien ne doit s'afficher
 * hors d'une racine d'ombre) : détachée, elle déclenche tout de même le
 * téléchargement. L'URL d'objet est révoquée juste après le clic, pour ne pas
 * garder le classeur en mémoire jusqu'au rechargement.
 */
export function enregistrerFichier(doc: Document, reponse: HttpResponse<Blob>, repli: string): void {
  const corps = reponse.body;
  if (!corps) return;
  const url = URL.createObjectURL(corps);
  const a = doc.createElement('a');
  a.href = url;
  a.download = nomDeFichier(reponse, repli);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
