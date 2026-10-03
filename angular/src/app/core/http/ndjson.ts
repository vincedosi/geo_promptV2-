import { HttpEventType, type HttpDownloadProgressEvent, type HttpEvent, type HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * Découpe un flux NDJSON reçu par morceaux en objets, un par ligne COMPLÈTE.
 *
 * Alimenté par une requête `observe: 'events', reportProgress: true,
 * responseType: 'text'` : chaque `DownloadProgress` porte le texte CUMULÉ
 * (`partialText`), la `Response` finale le texte entier. On ne lit que les
 * lignes terminées par un saut de ligne — une ligne coupée au milieu d'un
 * morceau attend le suivant — puis, à la fin, le reste, qui peut ne pas finir
 * par un saut de ligne. Une ligne illisible est IGNORÉE (même règle que
 * `lireFlux` de `ContexteSimulation.tsx` : elle ne coupe pas la progression).
 */
export function lignesNdjson<T>(evenements: Observable<HttpEvent<string>>): Observable<T> {
  return new Observable<T>((abonne) => {
    let lu = 0;
    const traiter = (texte: string, fin: boolean) => {
      const bout = fin ? texte.length : texte.lastIndexOf('\n') + 1;
      if (bout <= lu) return;
      for (const ligne of texte.slice(lu, bout).split('\n')) {
        const l = ligne.trim();
        if (!l) continue;
        try {
          abonne.next(JSON.parse(l) as T);
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
