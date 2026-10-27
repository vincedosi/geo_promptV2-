import { type Signal, type WritableSignal, signal } from '@angular/core';

/**
 * Les tiroirs EXCLUSIFS d'un panneau (retours du 26/10, T7 — demande de Vincent) : au plus un tiroir ouvert par niveau
 * et par panneau ; en ouvrir un referme l'autre. Un tiroir est une section à CORPS (réglages, formulaire, outil) ; les
 * replis de LISTE (« Plus de données communes », « POI communs », l'en-tête « Analyse spatiale ») n'en sont pas (A-11).
 *
 * Une seule brique pour ①②③④⑥, sans DI : chaque panneau en instancie une (champ de classe). ④ la partage avec ses
 * outils et ses services par `TIROIRS_ANALYSE` (`tiroirs-analyse.ts`).
 *
 * ── REPLIER NE RELIT RIEN (A-12) ─────────────────────────────────────────
 * `dejaOuvert(k)` est vrai dès le PREMIER dépli et le reste : c'est le patron « monté puis caché » —
 * `@if (t.dejaOuvert(k)) { <corps [hidden]="!t.estOuvert(k)" /> }` — pour un corps qui lit à sa construction sans cache,
 * ou qui porte une saisie. Un corps dont la lecture vient d'un cache de service se replie par `@if (t.estOuvert(k))`.
 */
export class TiroirsExclusifs<K extends string> {
  private readonly courant: WritableSignal<K | null>;
  private readonly vus: WritableSignal<ReadonlySet<K>>;
  /** Le tiroir ouvert, ou `null` : tout est fermé. */
  readonly ouvert: Signal<K | null>;

  constructor(initial: K | null) {
    this.courant = signal<K | null>(initial);
    this.vus = signal<ReadonlySet<K>>(new Set(initial === null ? [] : [initial]));
    this.ouvert = this.courant.asReadonly();
  }

  estOuvert(k: K): boolean {
    return this.courant() === k;
  }

  /** Le tiroir a été ouvert au moins une fois : son corps est monté, et le reste. */
  dejaOuvert(k: K): boolean {
    return this.vus().has(k);
  }

  /** Ouvre `k` (et referme l'autre), ou le referme s'il était ouvert. */
  basculer(k: K): void {
    if (this.courant() === k) this.fermer();
    else this.ouvrir(k);
  }

  ouvrir(k: K): void {
    this.courant.set(k);
    if (!this.vus().has(k)) this.vus.update((v) => new Set([...v, k]));
  }

  fermer(): void {
    this.courant.set(null);
  }
}
