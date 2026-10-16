import { Injectable, inject, signal } from '@angular/core';
import { EMPTY, map, switchMap } from 'rxjs';
import { ScoreService } from '../couches/score.service';
import { type AnalyseResume, AnalysesApi } from '../data/analyses.api';
import { ParcoursService } from '../etat/parcours.service';
import { messageErreurRequete } from '../logique/analyses/commun';
import { corpsRejeuScore, libelleScore } from '../logique/analyses/score';

/** Une action en cours ou échouée sur UNE ligne : rejouer, demander à supprimer, supprimer. */
export interface EtatLigne {
  action: 'rejeu' | 'confirmation' | 'suppression' | null;
  message: string | null;
}

/**
 * « Mes analyses » — `filter-panel/use-analyses.ts` (lot 4, T18), plus deux gestes que React n'offrait pas sur des
 * routes qui existaient déjà : REJOUER un score, SUPPRIMER une analyse. Groupe du panneau Calques jusqu'au 2026-10-13,
 * outil de la boîte à outils depuis (spec § 6, `outil-mes-analyses.component.ts`).
 *
 * ── UNE LECTURE, À LA PREMIÈRE OUVERTURE DE L'OUTIL ──────────────────────
 * `demanderChargement` est appelé à chaque ouverture de l'outil, jamais au chargement de la carte ; il ne lit qu'UNE
 * fois (l'outil est gardé, ruling AT-6). Un échec laisse la réouverture suivante relire. Changer d'espace recrée la
 * page, donc oublie la liste.
 *
 * ── REJOUER ──────────────────────────────────────────────────────────────
 * `POST /api/analyses/[id]/rejouer` n'écrit rien : il rend les paramètres. Pour un score, ils repartent tels quels vers
 * `POST /api/analyses/score` (la LISTE de CP enregistrée, `enregistrer: false`), la carte peint le résultat, et l'étape
 * ④ Analyse s'ouvre (ruling AT-7) — à la réussite seulement : un échec reste dit sur la ligne, l'étape ne bouge pas.
 *
 * ── SUPPRIMER ÉCRIT ──────────────────────────────────────────────────────
 * Confirmation sur la ligne, puis `DELETE /api/analyses/[id]` ; la ligne quitte la liste à la réussite seulement —
 * jamais d'effacement optimiste d'une analyse que la base a gardée.
 *
 * `@Injectable()` sans `providedIn` : fourni par l'outil « Mes analyses ».
 */
@Injectable()
export class MesAnalysesService {
  private readonly api = inject(AnalysesApi);
  private readonly score = inject(ScoreService);
  private readonly parcours = inject(ParcoursService);

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

  /** Pas de garde de périmètre : le rejeu relit la liste de CP ENREGISTRÉE (≤ 7 000, plafond de la route score). */
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
        this.parcours.choisir('analyse');
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
