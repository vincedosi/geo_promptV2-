import type maplibregl from 'maplibre-gl';
import { EMPTY, Observable, catchError, debounceTime, defer, merge, of, switchMap } from 'rxjs';
import { type Bbox, bboxDeCarte } from './bbox';

export type CarteEcoutable = Pick<maplibregl.Map, 'on' | 'off' | 'getBounds'>;

/**
 * Charge une donnée pour la bbox VISIBLE : IMMÉDIATEMENT au départ, puis à chaque `moveend` après `delaiMs` de calme
 * (350 ms, comme les sites côté React). La requête précédente est ANNULÉE — une réponse lente d'un ancien cadre ne
 * remplace jamais celle du cadre courant.
 *
 * ⚠ Le PREMIER chargement ne passe pas par l'anti-rebond (relecture de T8) : rien ne bouge encore, attendre 350 ms
 * retardait l'affichage pour rien. Un appelant qui RELANCE `chargerParCadre` quand ses filtres changent (la carte du
 * module risque) obtient donc lui aussi un rechargement immédiat. Seuls les déplacements de la carte attendent le calme.
 *
 * Passe par `HttpClient` côté appelant : les 3 appels simultanés au plus
 * (`limiteurInterceptor`) et le jeton s'appliquent donc d'office.
 */
export function chargerParCadre<T>(
  carte: CarteEcoutable,
  charger: (b: Bbox) => Observable<T>,
  appliquer: (v: T) => void,
  options: { delaiMs?: number; surEchec?: (e: unknown) => void } = {},
): () => void {
  const mouvements = new Observable<Bbox>((abonne) => {
    const emettre = () => abonne.next(bboxDeCarte(carte));
    carte.on('moveend', emettre);
    return () => carte.off('moveend', emettre);
  });
  const cadres = merge(
    defer(() => of(bboxDeCarte(carte))),
    mouvements.pipe(debounceTime(options.delaiMs ?? 350)),
  );
  const abonnement = cadres
    .pipe(
      switchMap((b) =>
        charger(b).pipe(
          catchError((e: unknown) => {
            options.surEchec?.(e);
            return EMPTY;
          }),
        ),
      ),
    )
    .subscribe(appliquer);
  return () => abonnement.unsubscribe();
}
