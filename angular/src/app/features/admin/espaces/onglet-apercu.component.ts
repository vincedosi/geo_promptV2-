import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { formaterNombre } from '../../../core/format/nombre';
import { BarreProgressionComponent } from '../../../ui/barre-progression/barre-progression.component';
import { EnteteSectionComponent } from '../../../ui/entete-section/entete-section.component';
import { EspacesApi } from './data/espaces.api';
import { LIBELLES_TYPE, messageErreur } from './logique/libelles';
import type { ApercuEspace, JeuDeDonnees } from './logique/types';

type CleGroupe = 'socle' | 'proprietaire' | 'partage';

const LIBELLES_GROUPE: Record<CleGroupe, string> = {
  socle: 'Du socle',
  proprietaire: "Propres à l'espace",
  partage: "Partagés avec l'espace",
};
const ORDRE: readonly CleGroupe[] = ['socle', 'proprietaire', 'partage'];

interface LigneJeu { id: string; nom: string; type: string; lignes: string }
interface Groupe { cle: CleGroupe; libelle: string; jeux: LigneJeu[] }

/**
 * Onglet « Aperçu » de la fiche d'un espace (spec § 4.5, E4, plan T9) : ce que voit un compte client
 * de cet espace, tel que le serveur le calcule (même règle que la carte et les exports).
 *
 * - Lecture `GET admin/espaces/:id/apercu` à l'initialisation seulement : la fiche ne monte l'onglet
 *   qu'à sa première ouverture. Elle peut durer plusieurs secondes (une requête par catégorie de POI) :
 *   « Calcul de l'aperçu… » et la barre indéterminée.
 * - L'aperçu ne suit pas tout seul les changements de l'onglet Données : « Recalculer » relit. Une
 *   relecture ANNULE la lecture en vol, pour qu'une réponse lente ne remplace pas une plus récente.
 * - Les catégories n'ont pas d'effectif (E4) : les compter coûterait une lecture de la table entière.
 */
@Component({
  selector: 'mg-onglet-apercu',
  imports: [BarreProgressionComponent, EnteteSectionComponent],
  providers: [ChargementService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="encart">Ce que voit un compte client de cet espace, calculé par la même règle que la carte et les exports.</p>

    <div class="barre"><mg-barre-progression /></div>

    @if (erreur(); as message) {
      <div role="alert" class="erreur">
        <p class="m-0">{{ message }}</p>
        <button type="button" data-reessayer class="bouton-neutre" (click)="lire()">Réessayer</button>
      </div>
    } @else if (apercu(); as a) {
      <div class="actions">
        <button type="button" data-recalculer class="bouton-neutre" (click)="lire()">Recalculer</button>
      </div>

      <section class="section">
        <mg-entete-section libelle="Jeux de données visibles" class="rounded-t-lg" />
        <div class="corps">
          @for (g of groupes(); track g.cle) {
            <div class="groupe" [attr.data-groupe]="g.cle">
              <h3 class="titre-groupe">{{ g.libelle }}</h3>
              @if (g.jeux.length === 0) {
                <p class="vide">Aucun</p>
              } @else {
                <ul class="liste">
                  @for (j of g.jeux; track j.id) {
                    <li class="jeu">
                      <span class="nom">{{ j.nom }}</span>
                      <span class="meta">{{ j.type }}</span>
                      <span class="nombre">{{ j.lignes }} lignes</span>
                    </li>
                  }
                </ul>
              }
            </div>
          }
        </div>
      </section>

      <section class="section">
        <mg-entete-section [libelle]="libelleCategories()" class="rounded-t-lg" />
        <div class="corps" data-categories>
          @if (a.categories.length === 0) {
            <p class="vide">Aucune</p>
          } @else {
            <ul class="pastilles">
              @for (c of a.categories; track c) {
                <li class="pastille" data-categorie>{{ c }}</li>
              }
            </ul>
          }
          <p class="note">Sans effectif : compter les POI d'une catégorie coûterait une lecture de la table entière.</p>
        </div>
      </section>

      <section class="section">
        <mg-entete-section libelle="Campagnes de l'espace" class="rounded-t-lg" />
        <div class="corps">
          <p class="m-0 text-[12px] text-secondary"><span class="nombre grand" data-campagnes>{{ campagnes() }}</span> campagnes</p>
        </div>
      </section>
    } @else {
      <p class="calcul">Calcul de l'aperçu…</p>
    }
  `,
  styles: `
    :host { display: block; font-family: var(--font-sans); }
    .encart {
      margin: 0 0 12px; padding: 10px 14px; border-radius: 6px; font-size: 12px; color: var(--text-secondary);
      background: var(--bg-level-2); border: 0.5px solid var(--border-subtle);
    }
    .barre { margin-bottom: 12px; min-height: 3px; }
    .calcul { margin: 0; font-size: 12px; color: var(--text-tertiary); }
    .actions { display: flex; justify-content: flex-end; margin-bottom: 12px; }
    .section { margin-bottom: 16px; border: 0.5px solid var(--border-subtle); border-radius: 8px; background: var(--bg-surface); overflow: hidden; }
    .corps { padding: 12px 14px; display: flex; flex-direction: column; gap: 14px; }
    .groupe { display: flex; flex-direction: column; gap: 6px; }
    .titre-groupe { margin: 0; font-size: 12px; font-weight: 500; color: var(--text-primary); }
    .vide { margin: 0; font-size: 12px; color: var(--text-tertiary); }
    .liste, .pastilles { list-style: none; margin: 0; padding: 0; }
    .liste { display: flex; flex-direction: column; gap: 4px; }
    .jeu { display: flex; align-items: baseline; gap: 10px; font-size: 12px; color: var(--text-secondary); }
    .nom { color: var(--text-primary); }
    .meta { color: var(--text-tertiary); font-size: 11px; }
    .nombre { margin-left: auto; font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
    .nombre.grand { margin-left: 0; font-size: 16px; color: var(--text-primary); }
    .pastilles { display: flex; flex-wrap: wrap; gap: 6px; }
    .pastille {
      padding: 2px 8px; border-radius: 4px; font-size: 11px;
      background: var(--bg-level-3); border: 0.5px solid var(--border-default); color: var(--text-secondary);
    }
    .note { margin: 0; font-size: 11px; color: var(--text-tertiary); }
    .bouton-neutre {
      border-radius: 6px; padding: 5px 12px; font-family: var(--font-sans); font-size: 12px; font-weight: 500;
      cursor: pointer; white-space: nowrap; background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary);
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover);
    }
    .bouton-neutre:hover { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
    .bouton-neutre:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .erreur {
      display: flex; flex-direction: column; gap: 10px; align-items: flex-start;
      padding: 12px; border-radius: 6px; font-size: 12px; color: var(--danger);
      background: color-mix(in srgb, var(--danger) 10%, transparent);
      border: 0.5px solid color-mix(in srgb, var(--danger) 20%, transparent);
    }
  `,
})
export class OngletApercuComponent {
  private readonly api = inject(EspacesApi);
  private readonly chargement = inject(ChargementService);

  readonly espaceId = input.required<string>();

  /** `null` tant qu'aucune lecture n'a abouti. Une relecture garde l'ancien aperçu jusqu'à la réponse. */
  protected readonly apercu = signal<ApercuEspace | null>(null);
  protected readonly erreur = signal<string | null>(null);
  private readonly enCours = signal(false);

  private lecture: Subscription | null = null;

  protected readonly groupes = computed<Groupe[]>(() => {
    const jeux = this.apercu()?.jeux;
    return ORDRE.map((cle) => ({
      cle,
      libelle: LIBELLES_GROUPE[cle],
      jeux: (jeux?.[cle] ?? []).map((j: JeuDeDonnees) => ({ id: j.id, nom: j.nom, type: LIBELLES_TYPE[j.type], lignes: formaterNombre(j.nb_lignes) })),
    }));
  });

  protected readonly libelleCategories = computed(() => `Catégories de POI visibles (${this.apercu()?.categories.length ?? 0})`);
  protected readonly campagnes = computed(() => formaterNombre(this.apercu()?.nb_campagnes ?? 0));

  constructor() {
    this.chargement.suivre('apercu', "Calcul de l'aperçu…", () => this.enCours());
    // Lecture à l'initialisation puis à chaque changement d'espace (input réactif).
    effect(() => {
      this.espaceId();
      untracked(() => {
        this.apercu.set(null);
        this.lire();
      });
    });
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
  }

  /** `GET admin/espaces/:id/apercu`. Annule la lecture précédente : seule la dernière demande répond. */
  protected lire(): void {
    this.lecture?.unsubscribe();
    this.erreur.set(null);
    this.enCours.set(true);
    this.lecture = this.api.lireApercu(this.espaceId()).subscribe({
      next: (a) => {
        this.apercu.set(a);
        this.enCours.set(false);
      },
      error: (e: unknown) => {
        this.erreur.set(messageErreur(e));
        this.enCours.set(false);
      },
    });
  }
}
