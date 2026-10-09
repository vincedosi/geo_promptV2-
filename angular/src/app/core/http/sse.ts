import { HttpEventType, type HttpDownloadProgressEvent, type HttpEvent, type HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';

/** Fin de ligne SSE : `\r\n`, `\n` ou `\r` seul (norme « Server-Sent Events »). */
const FIN_DE_LIGNE = /\r\n|\r|\n/;

/**
 * Découpe un flux SSE reçu par morceaux en objets — même contrat que `lignesNdjson`.
 *
 * Sert les deux routes qui répondent `text/event-stream` à un POST (`import-poi/execute`,
 * `campaigns/import`) : `EventSource` ne fait que des GET, et passer par `HttpClient` garde le
 * jeton, le limiteur et la détection de session expirée (arbitrage C4 du lot 6).
 *
 * Alimenté par une requête `observe: 'events', reportProgress: true, responseType: 'text'` :
 * chaque `DownloadProgress` porte le texte CUMULÉ, la `Response` finale le texte entier. Seules
 * les lignes TERMINÉES sont lues (une ligne coupée attend le morceau suivant), puis à la fin le
 * reste. Seules les lignes `data:` comptent — préfixe et espace facultative retirés, puis
 * `JSON.parse` ; lignes vides, `event:`, `id:`, `retry:` et commentaires `:` sont ignorés.
 * Une ligne illisible est IGNORÉE sans couper le flux. Chaque `data:` est lu seul : les routes du
 * projet n'émettent qu'une ligne `data:` par événement (`data: <json>\n\n`).
 */
export function lignesSse<T>(evenements: Observable<HttpEvent<string>>): Observable<T> {
  return new Observable<T>((abonne) => {
    let lu = 0;
    const traiter = (texte: string, fin: boolean) => {
      const bout = fin ? texte.length : Math.max(texte.lastIndexOf('\n'), texte.lastIndexOf('\r')) + 1;
      if (bout <= lu) return;
      for (const ligne of texte.slice(lu, bout).split(FIN_DE_LIGNE)) {
        if (!ligne.startsWith('data:')) continue;
        const valeur = ligne.slice(5).replace(/^ /, '').trim();
        if (!valeur) continue;
        try {
          abonne.next(JSON.parse(valeur) as T);
        } catch {
          /* une ligne illisible ne coupe pas la progression */
        }
      }
      lu = bout;
    };
    const s = evenements.subscribe({
      next: (e) => {
        if (e.type === HttpEventType.DownloadProgress) {
          traiter((e as HttpDownloadProgressEvent).partialText ?? '', false);
        } else if (e.type === HttpEventType.Response) {
          traiter((e as HttpResponse<string>).body ?? '', true);
        }
      },
      error: (err) => abonne.error(err),
      complete: () => abonne.complete(),
    });
    return () => s.unsubscribe();
  });
}
