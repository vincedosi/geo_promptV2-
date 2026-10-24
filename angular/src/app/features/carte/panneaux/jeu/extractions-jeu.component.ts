import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { map } from 'rxjs';
import type { Subscription } from 'rxjs';
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';
import { dateFr } from '../../../risques/etapes/zones/panneau-extractions.component';
import { type ExtractionJeu, JeuxApi } from '../../data/jeux.api';
import { JeuZonesService } from '../../etat/jeu-zones.service';
import { LectureAnnulable } from '../../etat/lecture-annulable';
import { messageErreurCouverture } from '../../logique/analyses/couverture-erreurs';
import { NOM_PLATEFORME, UNITE_MAILLE } from '../../logique/jeu/ecran';
import { BOUTON_CALCUL, ENCART_ERREUR, LISTE_CHAMP } from '../analyse/styles-analyse';

/** Une réponse PERDUE (aucune réponse lue) : l'extraction a peut-être été créée — leçon du lot 3, on ne relance pas à l'aveugle. */
export const MESSAGE_REPONSE_PERDUE = 'La réponse ne nous est pas parvenue : vérifiez la liste des versions avant de relancer l’extraction.';

/** Une ligne de la liste, mise en forme une fois (aucune méthode appelée dans le gabarit). */
interface LigneVersion {
  version: number;
  recalage: boolean;
  commentaire: string;
  date: string;
  resume: string;
}

/**
 * ⑤ Jeu de zones — extraire le jeu enregistré, et ses versions (lot 5, T12). « Extraire » (commentaire, case
 * « recalage ») → `POST …/extractions` : le SERVEUR rejoue chaque plateforme et fige ses unités (A-11), puis la liste
 * est RELUE (`GET …/extractions`). Une extraction identique à une version existante n'en crée pas : « Cette extraction
 * existe déjà (v2). » ; une réponse perdue (statut 0) ne dit ni succès ni échec : elle renvoie à la liste, relue.
 *
 * La liste montre, par version : son origine, sa date et le résumé FIGÉ par plateforme (maille, unités, taux d'utile).
 * Choisir une version la désigne dans `?x=` (`JeuZonesService.choisirExtraction`). Le serveur fige les réglages
 * ENREGISTRÉS : tant que l'écran en montre d'autres (`JeuZonesService.modifie`), « Extraire » attend qu'on les enregistre. Le téléchargement des fichiers par
 * plateforme arrive au lot 6 : un texte l'annonce, aucun bouton mort.
 *
 * Ce n'est PAS `mg-panneau-extractions` du module risque : celui-là montre un plan CP (seuil, CP retenus, classeur) ;
 * celui-ci un résumé par plateforme. Seul `dateFr` est partagé — la factorisation d'une liste commune forcerait l'un
 * des deux à porter les colonnes de l'autre.
 */
@Component({
  selector: 'mg-extractions-jeu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2 px-4 py-3', 'data-extractions-jeu': '' },
  template: `
    <div class="flex flex-wrap items-center gap-2">
      <input type="text" maxlength="500" [class]="listeChamp + ' flex-[1_1_200px] cursor-text'" placeholder="Pourquoi cette extraction (facultatif)"
        aria-label="Commentaire de l’extraction" [value]="commentaire()" (input)="commentaire.set(texte($event))" />
      <button type="button" data-extraire [disabled]="enCours() || jeu.modifie()" (click)="extraire()" [class]="boutonCalcul">{{ enCours() ? 'Extraction…' : 'Extraire' }}</button>
    </div>
    <!-- Une extraction fige l'ENREGISTRÉ : des réglages modifiés à l'écran doivent d'abord être enregistrés (relecture T10-12). -->
    @if (jeu.modifie()) { <p data-enregistrer-avant role="status" class="m-0 text-[11px] text-secondary">Enregistrez les réglages avant d’extraire.</p> }
    @if (lignes().length > 0) {
      <label class="flex cursor-pointer items-center gap-2 text-[11px] text-tertiary">
        <input type="checkbox" data-recalage [checked]="recalage()" (change)="recalage.set(coche($event))" class="accent-teal" />
        <span>C’est un recalage : cette version corrige une diffusion déjà mesurée.</span>
      </label>
    }
    @if (message(); as m) { <p data-message role="status" class="m-0 text-[11px] text-secondary">{{ m }}</p> }
    @if (erreur(); as e) { <div data-erreur role="alert" [class]="encartErreur">{{ e }}</div> }
    @if (liste.enCours()) { <div class="font-mono text-[11px] text-tertiary">Lecture des versions…</div> }
    @if (liste.erreur(); as e) { <div role="alert" [class]="encartErreur">{{ e }}</div> }
    @if (!liste.enCours() && liste.resultat() && lignes().length === 0) {
      <p data-aucune class="m-0 text-[11px] text-tertiary">Aucune extraction : la première fixera ce qui part aux plateformes.</p>
    }
    <div class="flex flex-col gap-1">
      @for (l of lignes(); track l.version) {
        <button type="button" [attr.data-version]="l.version" [attr.aria-pressed]="l.version === jeu.extraction()" (click)="choisir(l.version)"
          class="flex w-full cursor-pointer flex-col items-start gap-[2px] rounded-[4px] border-fin px-[10px] py-2 text-left"
          [class]="l.version === jeu.extraction() ? 'border-teal' : 'border-subtle'">
          <span class="text-[12px] text-primary">v{{ l.version }}@if (l.recalage) {<span class="ml-2 rounded-[4px] border-fin border-default bg-overlay px-1.5 py-px text-[10px] text-tertiary">recalage</span>}<span class="ml-2 text-[11px] text-tertiary">{{ l.date }}</span></span>
          @if (l.commentaire) { <span class="text-[11px] text-tertiary">{{ l.commentaire }}</span> }
          <span data-resume class="font-mono text-[10px] text-secondary">{{ l.resume }}</span>
        </button>
      }
    </div>
    <p data-lot6 class="m-0 text-[11px] text-tertiary">Les fichiers par plateforme arrivent avec les exports.</p>
  `,
})
export class ExtractionsJeuComponent {
  protected readonly jeu = inject(JeuZonesService);
  private readonly api = inject(JeuxApi);

  protected readonly listeChamp = LISTE_CHAMP;
  protected readonly boutonCalcul = BOUTON_CALCUL;
  protected readonly encartErreur = ENCART_ERREUR;

  protected readonly liste = new LectureAnnulable<readonly ExtractionJeu[]>(messageErreurCouverture);
  protected readonly commentaire = signal('');
  protected readonly recalage = signal(false);
  protected readonly enCours = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly erreur = signal<string | null>(null);

  protected readonly lignes = computed<LigneVersion[]>(() => (this.liste.resultat() ?? []).map((e) => ({
    version: e.version,
    recalage: e.origine === 'recalage',
    commentaire: e.commentaire,
    date: dateFr(e.created_at),
    resume: (e.plateformes ?? []).map((p) => `${NOM_PLATEFORME[p.plateforme] ?? p.plateforme} : ${UNITE_MAILLE[p.maille]?.plusieurs ?? p.maille}`
      + ` ${formaterNombre(p.n_unites ?? 0)}, ${p.exacte ? 'exacte' : p.taux_utile == null ? '—' : `${formaterDecimal(Number(p.taux_utile))} %`}`).join(' · '),
  })));

  private envoi: Subscription | null = null;

  constructor() {
    // La liste suit le jeu ouvert : relue à son ouverture, vidée sans jeu (P-c : la réponse d'un jeu quitté est jetée).
    effect(() => {
      const id = this.jeu.jeuId();
      untracked(() => {
        this.message.set(null);
        this.erreur.set(null);
        if (id) this.relire(id);
        else this.liste.perimer();
      });
    });
    inject(DestroyRef).onDestroy(() => this.envoi?.unsubscribe());
  }

  protected texte(ev: Event): string {
    return (ev.target as HTMLInputElement).value;
  }

  protected coche(ev: Event): boolean {
    return (ev.target as HTMLInputElement).checked;
  }

  /** Désigne (ou retire, second clic) une version dans `?x=`. */
  protected choisir(version: number): void {
    this.jeu.choisirExtraction(this.jeu.extraction() === version ? null : version);
  }

  protected extraire(): void {
    const id = this.jeu.jeuId();
    if (!id || this.enCours() || this.jeu.modifie()) return;
    this.enCours.set(true);
    this.message.set(null);
    this.erreur.set(null);
    this.envoi = this.api.extraire(id, { commentaire: this.commentaire().trim(), recalage: this.recalage() }).subscribe({
      next: (r) => {
        this.message.set(r.deja_extraite ? `Cette extraction existe déjà (v${r.version}).` : `Extraction v${r.version} enregistrée : elle ne bougera plus.`);
        this.commentaire.set('');
        this.recalage.set(false);
        this.finir(id, r.version);
      },
      error: (e: unknown) => {
        const perdue = e instanceof HttpErrorResponse && e.status === 0;
        this.erreur.set(perdue ? MESSAGE_REPONSE_PERDUE : messageErreurCouverture(e));
        this.finir(id, perdue ? null : undefined);
      },
    });
  }

  /** Fin d'un envoi : la liste est relue si l'extraction a (peut-être) été créée ; une version créée est désignée. */
  private finir(id: string, version: number | null | undefined): void {
    this.envoi = null;
    this.enCours.set(false);
    if (version === undefined || id !== this.jeu.jeuId()) return;
    if (version !== null) this.jeu.choisirExtraction(version);
    this.relire(id);
  }

  private relire(id: string): void {
    this.liste.lancer(this.api.extractions(id).pipe(map((r) => r.extractions ?? [])));
  }
}
