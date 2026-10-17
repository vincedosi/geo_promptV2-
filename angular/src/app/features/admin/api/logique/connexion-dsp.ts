/**
 * Ce que les écrans de connexion DSP (DV360 en T9, TikTok en T10) ont d'IDENTIQUE chez React :
 * le message d'une écriture en échec, la ligne du journal (`LogLine`, recopiée telle quelle dans
 * `dv360/page.tsx` et `tiktok/page.tsx`) et l'annulation des lectures au démontage.
 *
 * Seul ce qui est identique au pixel est mis en commun (C16) : les formulaires, eux, diffèrent
 * (client OAuth + Partner ID pour DV360, App ID + secret pour TikTok) et restent dans chaque écran.
 */
import { HttpErrorResponse } from '@angular/common/http';
import type { Observable, Subscription } from 'rxjs';
import type { DspApiLogRow } from '../../logique/types/dsp';

/** Une ligne du journal d'un fournisseur, mise en forme une fois (`LogLine`). */
export interface LigneLog {
  id: string;
  heure: string;
  niveau: string;
  action: string;
  message: string;
  meta: string;
}

/** `LogLine` de React : heure `fr-FR`, niveau, action, message, « statut · durée ». */
export function versLigneLog(l: DspApiLogRow): LigneLog {
  return {
    id: l.id,
    heure: new Date(l.created_at).toLocaleTimeString('fr-FR'),
    niveau: l.level,
    action: l.action,
    message: l.message ?? '',
    meta: [
      l.status_code != null ? `${l.status_code}` : null,
      l.duration_ms != null ? `${l.duration_ms}ms` : null,
    ].filter(Boolean).join(' · '),
  };
}

/**
 * Message d'une écriture en échec, comme React : `json.error ?? <défaut>`. Un échec réseau donne le
 * `Failed to fetch` du `fetch` de React ; un corps illisible, le défaut (React affichait le message
 * de la `SyntaxError` de `res.json()`).
 */
export function messageEchec(e: unknown, defaut: string): string {
  if (e instanceof HttpErrorResponse) {
    const corps = e.error as { error?: unknown } | null;
    if (corps && typeof corps === 'object' && typeof corps.error === 'string' && corps.error) return corps.error;
    return e.status === 0 ? 'Failed to fetch' : defaut;
  }
  return e instanceof Error && e.message ? e.message : defaut;
}

/**
 * Lectures en vol d'un écran, annulées s'il est quitté (règle du lot) ; les ÉCRITURES, elles, vont
 * à leur terme comme le `fetch` de React et ne passent pas par ici.
 */
export class LecturesAnnulables {
  private readonly enVol = new Set<Subscription>();

  /** Une lecture annulable : la promesse reste en suspens si l'écran est détruit avant la réponse. */
  lire<T>(source: Observable<T>): Promise<T> {
    return new Promise<T>((resoudre, rejeter) => {
      const s = source.subscribe({
        next: (v) => resoudre(v),
        error: (e: unknown) => { rejeter(e); this.enVol.delete(s); },
        complete: () => this.enVol.delete(s),
      });
      if (!s.closed) this.enVol.add(s);
    });
  }

  annulerTout(): void {
    for (const s of this.enVol) s.unsubscribe();
    this.enVol.clear();
  }
}

/**
 * La lecture de la connexion a échoué. React (`load`) : une réponse d'erreur JSON (400 « Aucune
 * organisation… ») donne `json.connections` absent → aucune connexion, sans message ; un échec
 * réseau ou un corps illisible → la notification. Rend `true` si l'écran doit afficher « aucune
 * connexion » sans notifier.
 */
export function erreurLueCommeAucuneConnexion(e: unknown): boolean {
  return e instanceof HttpErrorResponse && e.status !== 0 && !!e.error && typeof e.error === 'object';
}
