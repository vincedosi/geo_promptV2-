import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, Injectable, computed, effect, inject, input, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../../core/format/nombre';
import { CarteApi, type FicheJeu, type NiveauSourceFiche } from '../../data/carte.api';
import { dateFr } from '../../logique/analyses/commun';

/**
 * Les fiches déjà lues, par clé de jeu, pour la vie du panneau ② (qui le fournit, comme `CacheFichesSante`) : une ligne
 * détruite par une recherche ou un repli ne relit pas sa fiche à la réouverture. Un changement d'espace recrée la page,
 * donc le panneau et ce cache (une fiche dépend des droits de l'espace).
 */
@Injectable()
export class CacheFichesJeu {
  readonly fiches = new Map<string, FicheJeu>();
}

const LIBELLE_NIVEAU: Readonly<Record<NiveauSourceFiche, string>> = { socle: 'Socle', prive: 'Privé', partage: 'Partagé' };

/** Ce que le gabarit lit d'une source : tout est calculé ici. */
interface LigneSource {
  readonly nom: string;
  readonly valeurs: string;
}

type EtatFiche = 'repos' | 'lecture' | 'prete' | 'introuvable' | 'erreur';

/**
 * La fiche d'un jeu de ② (lot « Catalogue et groupes », A-8 ; spec § 7.1, outil « Fiche » de § 6) : dépliée SOUS la
 * ligne par son bouton « i » (`mg-ligne-jeu`), au lieu d'un outil de plus dans la boîte à outils.
 *
 * Contenu : pour un référentiel au socle (sans source, ou avec une source de niveau socle), « Socle dentsu.explore,
 * référentiel système » ; puis une ligne par source qui porte le
 * jeu — « Propriétaire · Niveau · Effectif · Importé le » (niveau vu de l'espace actif, effectif = `valid_count`,
 * chiffres par `formaterNombre`, date en `fr-FR`).
 *
 * - AUCUNE lecture tant que la fiche est fermée (pas de préchargement) ; `GET /api/map/catalogue/fiche` à la PREMIÈRE
 *   ouverture, puis plus rien (cache `CacheFichesJeu`, ou local si le panneau ne le fournit pas).
 * - 404 (jeu inconnu ou devenu invisible de l'espace, indiscernables) : « Ce jeu n'est plus disponible dans cet
 *   espace. », sans relecture. Autre échec : un message et « Réessayer ».
 * - `cle` est un input réactif : à son changement, la lecture en vol est abandonnée et l'état repart de zéro.
 */
@Component({
  selector: 'mg-fiche-jeu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (ouvert()) {
      <div data-fiche class="mx-[14px] mb-2 rounded-[6px] border-fin border-subtle bg-elevated px-3 py-2 text-[11px]">
        @switch (etat()) {
          @case ('prete') {
            @if (referentiel()) {
              <p data-referentiel class="m-0 text-secondary">Socle dentsu.explore, référentiel système</p>
            }
            @if (sources().length > 0) {
              <p class="m-0 mt-1 text-tertiary">Propriétaire · Niveau · Effectif · Importé le</p>
              @for (s of sources(); track $index) {
                <div data-source class="mt-1.5">
                  <div class="truncate text-primary">{{ s.nom }}</div>
                  <div class="font-mono text-secondary">{{ s.valeurs }}</div>
                </div>
              }
            }
          }
          @case ('introuvable') {
            <p data-introuvable class="m-0 text-tertiary">Ce jeu n'est plus disponible dans cet espace.</p>
          }
          @case ('erreur') {
            <div role="alert" class="flex flex-col items-start gap-1.5">
              <p class="m-0 text-danger">La fiche n'a pas pu être lue.</p>
              <button type="button" data-reessayer (click)="lire()"
                class="cursor-pointer rounded-[6px] border-fin border-teal bg-transparent px-3 py-1 text-[11px] font-medium text-teal hover:bg-[var(--brand-teal-10)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-teal-50)]">Réessayer</button>
            </div>
          }
          @default {
            <p data-lecture class="m-0 text-tertiary">Lecture de la fiche…</p>
          }
        }
      </div>
    }
  `,
})
export class FicheJeuComponent {
  private readonly api = inject(CarteApi);
  private readonly cache = inject(CacheFichesJeu, { optional: true })?.fiches ?? new Map<string, FicheJeu>();

  readonly cle = input.required<string>();
  readonly ouvert = input(false);

  protected readonly etat = signal<EtatFiche>('repos');
  private readonly fiche = signal<FicheJeu | null>(null);
  /**
   * « Socle dentsu.explore » ne s'écrit que si c'est vrai : un référentiel sans source (IRIS, carreaux), ou porté par au
   * moins une source de niveau `socle`. Un référentiel dont toutes les sources visibles sont privées ou partagées
   * (l'abstention transférée à Bercy) ne montre que sa provenance réelle (D1 de la preuve navigateur).
   */
  protected readonly referentiel = computed(() => {
    const f = this.fiche();
    if (!f?.referentiel) return false;
    return f.sources.length === 0 || f.sources.some((s) => s.niveau === 'socle');
  });
  protected readonly sources = computed<LigneSource[]>(() => (this.fiche()?.sources ?? []).map((s) => ({
    nom: s.nom,
    valeurs: `${s.proprietaire} · ${LIBELLE_NIVEAU[s.niveau] ?? s.niveau} · ${formaterNombre(s.effectif)} · ${dateFr(s.importe_le)}`,
  })));

  private cleSuivie: string | null = null;
  private lecture: Subscription | null = null;

  constructor() {
    effect(() => {
      const cle = this.cle();
      const ouvert = this.ouvert();
      untracked(() => {
        if (cle !== this.cleSuivie) {
          this.lecture?.unsubscribe();
          this.lecture = null;
          this.cleSuivie = cle;
          this.fiche.set(null);
          this.etat.set('repos');
        }
        if (ouvert && this.etat() === 'repos') this.lire();
      });
    });
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
  }

  /** Lit la fiche (ou la reprend du cache) ; « Réessayer » repasse ici. */
  protected lire(): void {
    const cle = this.cle();
    const connue = this.cache.get(cle);
    if (connue) {
      this.fiche.set(connue);
      this.etat.set('prete');
      return;
    }
    this.lecture?.unsubscribe();
    this.etat.set('lecture');
    this.lecture = this.api.ficheJeu(cle).subscribe({
      next: (f) => {
        this.cache.set(cle, f);
        this.fiche.set(f);
        this.etat.set('prete');
      },
      error: (e: unknown) => this.etat.set(e instanceof HttpErrorResponse && e.status === 404 ? 'introuvable' : 'erreur'),
    });
  }
}
