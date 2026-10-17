import { ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../core/format/nombre';
import { ENREGISTRER_FICHIER } from '../../../core/http/telecharger';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import type { DataSource } from '../logique/types/admin';
import { SourcesAdminApi, type ReponseEcriture } from './data/sources-admin.api';
import { SCHEMA_FILTER_COLS, badgeType, formatDate } from './logique/constantes';

/** `data.error` d'une écriture refusée (HTTP ≠ 2xx), lu dans le corps JSON comme React. */
function erreurDe(e: unknown): string | undefined {
  if (e instanceof HttpErrorResponse) {
    const corps = e.error as ReponseEcriture | null;
    if (corps && typeof corps === 'object' && typeof corps.error === 'string' && corps.error) return corps.error;
  }
  return undefined;
}

/**
 * Panneau de détail d'une source (`app/admin/sources/page.tsx:549-772`) : nom et type, compteurs,
 * informations, champs filtres (lecture de `meta-keys` puis PATCH), renvoi vers la page Accès,
 * édition du nom, export CSV, ré-import, suppression (demandée au parent, qui tient la confirmation
 * comme React tient `ConfirmModal`).
 *
 * Le parent RECRÉE ce composant à chaque changement de source (`@for … track id`) : l'éditeur de
 * filtres et l'édition du nom repartent fermés.
 *
 * Écarts à React :
 * - **éditeur de filtres remis à zéro au changement de source** : React gardait `showFilterEdit`,
 *   les cases et les clés de la source PRÉCÉDENTE — « Sauvegarder les filtres » écrivait alors les
 *   champs d'une source dans une autre.
 * - **export par `HttpClient`, sous jeton** (C8) : `window.open` de React part sans `Authorization` et
 *   ouvre un onglet « 401 ». Fichier enregistré par `ENREGISTRER_FICHIER`, nom de `Content-Disposition`.
 * - **échecs dits** : un PATCH refusé (nom, filtres) ou un export en échec affiche une notification ;
 *   React les avalait (`catch` vide, aucun message).
 * - « Propriétaire et partages : page Accès » : lien RELATIF vers `admin/acces` (React pointe vers
 *   Angular par `NEXT_PUBLIC_URL_ANGULAR`) ; « Re-importer (meme config) » : lien RELATIF vers
 *   l'onglet Importer de Données (C8 ; React : `window.open('/admin/import', '_self')`).
 * - « Sauvegarder » / « Sauvegarder les filtres » : texte `--brand-teal` sur le fond teal à 10 % —
 *   React écrit `color: var(--bg-primary)` (texte noir sur fond quasi noir en thème sombre, illisible).
 * - nombres des compteurs en `fr-FR` (React : `toLocaleString()` sans langue).
 * - teintes (C9) : `rgba(…)` → `color-mix` des jetons à la même opacité.
 *
 * Gardés par parité : libellés `source.detail`, `// champs filtres`, `// modifier`, textes sans
 * accents, `Erreurs` en nombre brut (`String(error_count)`), rayon 2 px, bordures 0,5 px.
 */
@Component({
  selector: 'mg-detail-source',
  imports: [IconeComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './detail-source.component.html',
  styleUrls: ['./sources-commun.css', './detail-source.component.css', './detail-source-filtres.css'],
})
export class DetailSourceComponent {
  private readonly api = inject(SourcesAdminApi);
  private readonly notifications = inject(NotificationsService);
  private readonly enregistrer = inject(ENREGISTRER_FICHIER);
  private readonly document = inject(DOCUMENT);

  readonly source = input.required<DataSource>();
  readonly suppressionEnCours = input(false);
  readonly fermer = output<void>();
  readonly supprimer = output<string>();
  /** Le nom a été enregistré : le parent relit la liste (`fetchSources()` de React). */
  readonly renommee = output<void>();
  /** Les champs filtres ont été enregistrés : le parent met la source à jour en place. */
  readonly filtresModifies = output<string[]>();

  protected readonly colonnesSchema = SCHEMA_FILTER_COLS;

  protected readonly edition = signal(false);
  protected readonly nomEdite = signal('');
  protected readonly editeurFiltres = signal(false);
  protected readonly filtresEdites = signal<string[]>([]);
  protected readonly cles = signal<string[]>([]);
  protected readonly chargementCles = signal(false);
  protected readonly sauvegardeFiltres = signal(false);

  private lectureCles: Subscription | null = null;
  private lectureExport: Subscription | null = null;

  protected readonly vue = computed(() => {
    const s = this.source();
    return {
      nom: s.name,
      badge: badgeType(s.type, s.category, s.regie),
      stats: [
        { libelle: 'Valides', valeur: formaterNombre(s.valid_count), teinte: 'succes' },
        { libelle: 'Total', valeur: formaterNombre(s.row_count), teinte: 'texte' },
        { libelle: 'Erreurs', valeur: String(s.error_count), teinte: 'danger' },
      ],
      org: s.organizations?.name || '—',
      fichier: s.original_filename || '—',
      format: s.file_format || '—',
      date: formatDate(s.import_date),
      filtres: s.filter_fields ?? [],
    };
  });

  protected readonly compteurFiltres = computed(() => {
    const n = this.filtresEdites().length;
    return `${n} filtre${n !== 1 ? 's' : ''}`;
  });

  protected readonly enteteMeta = computed(() => {
    const n = this.cles().length;
    return `colonnes metadata ${n > 0 ? `(${n})` : this.chargementCles() ? '...' : '(aucune)'}`;
  });

  protected readonly casesSchema = computed(() => {
    const choisis = this.filtresEdites();
    return this.colonnesSchema.map((c) => ({ cle: c, coche: choisis.includes(c) }));
  });

  protected readonly casesMeta = computed(() => {
    const choisis = this.filtresEdites();
    return this.cles().map((c) => ({ cle: c, coche: choisis.includes(c) }));
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.lectureCles?.unsubscribe();
      this.lectureExport?.unsubscribe();
    });
  }

  /** « Modifier » / « Fermer » des champs filtres (`page.tsx:609-615`) : l'ouverture relit les clés. */
  protected basculerFiltres(): void {
    const ouvrir = !this.editeurFiltres();
    this.editeurFiltres.set(ouvrir);
    if (!ouvrir) return;
    const s = this.source();
    this.filtresEdites.set([...(s.filter_fields ?? [])]);
    this.lectureCles?.unsubscribe();
    this.chargementCles.set(true);
    this.cles.set([]);
    this.lectureCles = this.api.cles(s.id).subscribe({
      next: (r) => {
        if (r.success) this.cles.set(r.keys ?? []);
        this.chargementCles.set(false);
      },
      error: () => this.chargementCles.set(false),
    });
  }

  protected basculerCase(cle: string): void {
    this.filtresEdites.update((l) => (l.includes(cle) ? l.filter((f) => f !== cle) : [...l, cle]));
  }

  protected toutCocher(): void {
    this.filtresEdites.set([...SCHEMA_FILTER_COLS, ...this.cles()]);
  }

  protected effacer(): void {
    this.filtresEdites.set([]);
  }

  /** `handleSaveFilterFields` (`page.tsx:234-251`). */
  protected sauverFiltres(): void {
    const champs = this.filtresEdites();
    this.sauvegardeFiltres.set(true);
    this.api.modifier(this.source().id, { filter_fields: champs }).subscribe({
      next: (r) => {
        this.sauvegardeFiltres.set(false);
        if (r.success) {
          this.filtresModifies.emit(champs);
          this.editeurFiltres.set(false);
        } else {
          this.notifications.error('Modification échouée', r.error ?? 'Erreur inconnue');
        }
      },
      error: (e: unknown) => {
        this.sauvegardeFiltres.set(false);
        this.notifications.error('Modification échouée', erreurDe(e) ?? 'Erreur inconnue');
      },
    });
  }

  /** « Modifier » / « Annuler modification » (`page.tsx:748-753`). */
  protected basculerEdition(): void {
    this.edition.update((v) => !v);
    this.nomEdite.set(this.source().name);
  }

  /** `handleSaveEdit` (`page.tsx:202-220`) : rien n'est envoyé si le nom rogné est vide. */
  protected sauverNom(): void {
    const nom = this.nomEdite().trim();
    if (!nom) return;
    this.api.modifier(this.source().id, { name: nom }).subscribe({
      next: (r) => {
        if (r.success) {
          this.renommee.emit();
          this.edition.set(false);
        } else {
          this.notifications.error('Modification échouée', r.error ?? 'Erreur inconnue');
        }
      },
      error: (e: unknown) => this.notifications.error('Modification échouée', erreurDe(e) ?? 'Erreur inconnue'),
    });
  }

  protected surSaisieNom(e: Event): void {
    this.nomEdite.set((e.target as HTMLInputElement).value);
  }

  /** Export CSV en blob (C8). */
  protected exporter(): void {
    this.lectureExport?.unsubscribe();
    this.lectureExport = this.api.exporter(this.source().id).subscribe({
      next: (r) => this.enregistrer(this.document, r, 'export.csv'),
      error: (e: unknown) => {
        const statut = e instanceof HttpErrorResponse ? e.status : 0;
        this.notifications.error('Export échoué', statut ? `HTTP ${statut}` : 'Connexion au serveur impossible');
      },
    });
  }
}
