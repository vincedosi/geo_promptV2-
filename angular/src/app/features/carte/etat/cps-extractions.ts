import { signal } from '@angular/core';
import type { Observable, Subscription } from 'rxjs';
import { messageErreurApi } from '../../../core/http/erreurs';
import type { CpDExtraction } from '../data/plan.api';

const cle = (jeu: string, version: number, plateforme?: string) => `${jeu}|${version}|${plateforme ?? ''}`;

function sans<V>(m: ReadonlyMap<string, V>, c: string): ReadonlyMap<string, V> {
  if (!m.has(c)) return m;
  const copie = new Map(m);
  copie.delete(c);
  return copie;
}

/**
 * ⑥ Plan — les CP achetés des extractions lus pour l'écran (lot 6, T5, A-11) : une lecture par (jeu, version,
 * plateforme), mise en cache — une extraction est figée, ses CP ne se périment jamais. Une lecture en échec garde son
 * message jusqu'à la suivante. Sorti de `PlanCampagneService` à la revue finale (plafond de 400 lignes), qui le compose
 * et en garde les méthodes publiques (`cpDe`, `erreurCp`, `chargerCp`).
 */
export class CpsExtractions {
  private readonly _lus = signal<ReadonlyMap<string, CpDExtraction>>(new Map());
  private readonly _erreurs = signal<ReadonlyMap<string, string>>(new Map());
  private readonly lectures = new Map<string, Subscription>();

  constructor(private readonly lire: (jeu: string, version: number, plateforme?: string) => Observable<CpDExtraction>) {}

  de(jeu: string, version: number, plateforme?: string): CpDExtraction | null {
    return this._lus().get(cle(jeu, version, plateforme)) ?? null;
  }

  erreur(jeu: string, version: number, plateforme?: string): string | null {
    return this._erreurs().get(cle(jeu, version, plateforme)) ?? null;
  }

  /** Lance la lecture si elle n'est ni faite ni en vol. */
  charger(jeu: string, version: number, plateforme?: string): void {
    const c = cle(jeu, version, plateforme);
    if (this._lus().has(c) || this.lectures.has(c)) return;
    this._erreurs.update((m) => sans(m, c));
    this.lectures.set(c, this.lire(jeu, version, plateforme).subscribe({
      next: (r) => {
        this.lectures.delete(c);
        this._lus.update((m) => new Map(m).set(c, r));
      },
      error: (e: unknown) => {
        this.lectures.delete(c);
        this._erreurs.update((m) => new Map(m).set(c, messageErreurApi(e)));
      },
    }));
  }

  /** Abandonne les lectures en vol (destruction de la page). */
  annuler(): void {
    for (const s of this.lectures.values()) s.unsubscribe();
    this.lectures.clear();
  }
}
