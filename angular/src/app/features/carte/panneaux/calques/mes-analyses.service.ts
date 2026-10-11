import { Injectable, inject, signal } from '@angular/core';
import { EMPTY, map, switchMap } from 'rxjs';
import { ScoreService } from '../../couches/score.service';
import { type AnalyseResume, AnalysesApi } from '../../data/analyses.api';
import { messageErreurRequete } from '../../logique/analyses/commun';
import { corpsRejeuScore, libelleScore } from '../../logique/analyses/score';

/** Une action en cours ou échouée sur UNE ligne : rejouer, demander à supprimer, supprimer. */
export interface EtatLigne {
  action: 'rejeu' | 'confirmation' | 'suppression' | null;
  message: string | null;
}

/**
 * « Mes analyses » du panneau Calques — `filter-panel/use-analyses.ts` (lot 4, T18), plus deux gestes que React
 * n'offrait pas sur des routes qui existaient déjà : REJOUER un score, SUPPRIMER une analyse.
 *
 * ── UNE LECTURE PAR OUVERTURE DU PANNEAU ─────────────────────────────────
 * `demanderChargement` est appelé au PREMIER dépliage du groupe, jamais au montage ; replier puis rouvrir ne relit
 * rien (le contenu du groupe est détruit au repli, cet état vit un cran plus haut — fourni par le panneau Calques).
 * Fermer le panneau oublie la liste, comme React (`page.tsx` démonte le panneau). Un échec laisse un nouveau dépliage
 * relire.
 *
 * ── REJOUER ──────────────────────────────────────────────────────────────
 * `POST /api/analyses/[id]/rejouer` n'écrit rien : il rend les paramètres. Pour un score, ils repartent tels quels vers
 * `POST /api/analyses/score` (la LISTE de CP enregistrée, `enregistrer: false`) et la carte peint le résultat.
 *
 * ── SUPPRIMER ÉCRIT ──────────────────────────────────────────────────────
 * Confirmation sur la ligne, puis `DELETE /api/analyses/[id]` ; la ligne quitte la liste à la réussite seulement —
 * jamais d'effacement optimiste d'une analyse que la base a gardée.
 *
 * `@Injectable()` sans `providedIn` : fourni par le panneau Calques.
 */
@Injectable()
export class MesAnalysesService {
  private readonly api = inject(AnalysesApi);
  private readonly score = inject(ScoreService);

  readonly analyses = signal<AnalyseResume[]>([]);
  readonly chargement = signal(false);
  readonly erreur = signal<string | null>(null);
  readonly lignes = signal<Readonly<Record<string, EtatLigne>>>({});
  private lue = false;

  demanderChargement(): void {
    if (this.lue) return;
    this.lue = true;
    this.chargement.set(true);
    this.erreur.set(null);
    this.api.lister().subscribe({
      next: (r) => {
        this.analyses.set(Array.isArray(r.analyses) ? r.analyses : []);
        this.chargement.set(false);
      },
      error: () => {
        this.erreur.set('Impossible de charger les analyses enregistrées.');
        this.lue = false;
        this.chargement.set(false);
      },
    });
  }

  rejouer(id: string): void {
    if (this.lignes()[id]?.action) return;
    this.poser(id, { action: 'rejeu', message: null });
    this.api.rejouer(id).pipe(
      switchMap(({ rejeu }) => {
        const corps = corpsRejeuScore(rejeu);
        if (!corps) {
          this.poser(id, { action: null, message: 'Cette analyse ne peut pas être rejouée.' });
          return EMPTY;
        }
        return this.api.score(corps).pipe(map((r) => ({ r, n: corps.indicateurs.length })));
      }),
    ).subscribe({
      next: ({ r, n }) => {
        this.score.afficher({ scores: r.scores, libelle: libelleScore(r.indicateurs.map((i) => i.label)), nIndicateurs: n });
        this.poser(id, { action: null, message: null });
      },
      error: (e: unknown) => this.poser(id, { action: null, message: messageErreurRequete(e) }),
    });
  }

  demanderSuppression(id: string): void {
    this.poser(id, { action: 'confirmation', message: null });
  }

  annulerSuppression(id: string): void {
    this.poser(id, { action: null, message: null });
  }

  supprimer(id: string): void {
    if (this.lignes()[id]?.action !== 'confirmation') return;
    this.poser(id, { action: 'suppression', message: null });
    this.api.supprimer(id).subscribe({
      next: () => {
        this.analyses.update((l) => l.filter((a) => a.id !== id));
        this.lignes.update((l) => {
          const reste = { ...l };
          delete reste[id];
          return reste;
        });
      },
      error: (e: unknown) => this.poser(id, { action: null, message: messageErreurRequete(e) }),
    });
  }

  private poser(id: string, etat: EtatLigne): void {
    this.lignes.update((l) => ({ ...l, [id]: etat }));
  }
}
