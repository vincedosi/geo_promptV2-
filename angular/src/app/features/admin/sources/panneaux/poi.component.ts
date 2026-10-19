import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../../core/format/nombre';
import { ConfirmationComponent } from '../../../../ui/confirmation/confirmation.component';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { SourcesAdminApi, type StatsSources } from '../data/sources-admin.api';
import type { FormulairePoi, LignePoi } from '../data/panneaux.types';
import { DialoguePoiComponent, FORMULAIRE_POI_VIDE } from './dialogue-poi.component';
import { ECHEC_RESEAU, erreurDuCorps, estCoupure } from '../../commun/erreurs-http';

/** Teinte d'une catégorie : la couleur de `POI_META` / `PALETTE` de React, ramenée à un jeton (C9). */
type TeintePoi = 'teal' | 'info' | 'succes' | 'avert' | 'danger' | 'rose' | 'ardoise' | 'gris';

/** `POI_META` de React (`PoiPanel.tsx:45-52`) : libellé, description et teinte des catégories connues. */
const POI_META: Record<string, { libelle: string; description: string; teinte: TeintePoi }> = {
  lycee: { libelle: 'Lycées', description: 'Établissements scolaires du second degré', teinte: 'avert' },
  cirfa: { libelle: 'CIRFA', description: "Centres d'information et de recrutement des forces armées", teinte: 'danger' },
  bmw: { libelle: 'BMW Concessions', description: 'Points de vente BMW', teinte: 'info' },
  concession: { libelle: 'Concessions', description: 'Points de vente automobiles', teinte: 'info' },
  pharmacie: { libelle: 'Pharmacies', description: 'Pharmacies et parapharmacies', teinte: 'succes' },
  supermarche: { libelle: 'Supermarchés', description: 'Grande distribution', teinte: 'info' },
};

/** `PALETTE` de React (teal, `#06b6d4`, vert, `#f59e0b`, `#ec4899`, `#64748b`, `#a0a0a0`, `#34d399`) en jetons. */
const PALETTE: TeintePoi[] = ['teal', 'info', 'succes', 'avert', 'rose', 'ardoise', 'gris', 'succes'];

/** `getCatMeta` : catégorie connue, sinon libellé capitalisé (`_` → espace) et teinte de la palette par rang. */
function metaCategorie(cat: string, rang: number) {
  return POI_META[cat] ?? {
    libelle: cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' '),
    description: `Catégorie : ${cat}`,
    teinte: PALETTE[rang % PALETTE.length],
  };
}

/** Le message d'un refus : `error` du corps, `HTTP <statut>` sans corps lisible, le texte de React en coupure. */
function messageRefus(e: unknown): string {
  if (estCoupure(e)) return ECHEC_RESEAU;
  if (e instanceof HttpErrorResponse) return erreurDuCorps(e) ?? `HTTP ${e.status}`;
  return String(e);
}

/**
 * Onglet « POI » des Sources — portage de `PoiPanel.tsx` et d'`usePoiAdmin.ts` (lot 6, T19) : une carte
 * par catégorie (`sources-stats.poi.by_category`), échantillons paginés par 50, modale de création /
 * édition (`mg-dialogue-poi`), suppression unitaire et purge d'une catégorie.
 *
 * Lectures : AUCUNE à la création — les catégories viennent des statistiques de l'écran. React relisait
 * `sources-stats` à CHAQUE ouverture de l'onglet (`page.tsx:171-173`) ; ici la page les lit une fois
 * (règle d'I/O : statistiques de sources une fois par écran) et les relit en silence après chaque écriture
 * POI réussie (`modifie`), comme `refreshPoiStats` de React. La page garde ce panneau après la première
 * visite (masqué) : la catégorie ouverte et les pages déjà chargées survivent au changement d'onglet,
 * comme l'état de `usePoiAdmin` vivait dans le parent.
 *
 * Écarts à React (défauts corrigés, listés au rapport) :
 * - suppression unitaire et purge : React ne lisait PAS la réponse (`usePoiAdmin.ts:121-137`) — une ligne
 *   refusée disparaissait de l'écran. Ici la réponse est lue : refus → notification « Suppression échouée »
 *   au message de la route, la ligne reste.
 * - suppression unitaire CONFIRMÉE (vague finale D1, ruling) : React supprimait au premier clic sur un ✕ de
 *   9 px voisin d'« éditer » ; ici `mg-confirmation` « Supprimer ce POI » nomme le POI. Une suppression en vol
 *   désactive le ✕ de sa ligne et ignore un second appel (D2 : le double clic envoyait deux DELETE et
 *   décrémentait le total deux fois).
 * - modale : `<dialog>` (C6) au lieu d'un voile `position: fixed`, focus dans le premier champ.
 * - couleurs (C9) : teintes en jetons (`#3b82f6` / `#06b6d4` → `--info`, `#ec4899` → `--nature-8` (Q-6 : le
 *   `--ligne-media-3` d'abord choisi se lisait comme `--danger` en clair, à côté de CIRFA ; à valider par un designer),
 *   `#64748b` → `--text-tertiary`, `#a0a0a0` → `--text-secondary`, `#f59e0b` → `--warning`,
 *   `#34d399` → `--success`) ; fonds à 10 %, bords à 27 % (`44`) ; teal en texte lisible en clair.
 * - cartes au survol : `:hover` CSS au lieu de deux écouteurs.
 */
@Component({
  selector: 'mg-sources-poi',
  imports: [ConfirmationComponent, DialoguePoiComponent, IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './poi.component.html',
  styleUrls: ['./panneaux-commun.css', './poi.component.css', './poi-echantillons.css'],
})
export class PoiComponent {
  private readonly api = inject(SourcesAdminApi);
  private readonly notifications = inject(NotificationsService);
  private lecture: Subscription | null = null;

  readonly stats = input<StatsSources | null>(null);
  readonly chargement = input(false);
  /** Une écriture POI a réussi : la page relit ses statistiques, en silence (`refreshPoiStats`). */
  readonly modifie = output<void>();

  protected readonly selection = signal<string | null>(null);
  protected readonly echantillons = signal<LignePoi[]>([]);
  protected readonly total = signal(0);
  private offset = 0;
  protected readonly chargementEchantillons = signal(false);
  /** Modale ouverte : mode et formulaire initial (`poiModal`). */
  protected readonly modale = signal<{ mode: 'creation' | 'edition'; initial: FormulairePoi } | null>(null);
  protected readonly modaleEnCours = signal(false);
  protected readonly modaleErreur = signal('');
  /** Catégorie dont la purge attend confirmation (`confirmDeleteCat`). */
  protected readonly aPurger = signal<string | null>(null);
  protected readonly purgeEnCours = signal(false);
  /** POI dont la suppression attend confirmation (D1). */
  protected readonly aSupprimer = signal<{ id: string; nom: string } | null>(null);
  /** Suppressions unitaires en vol (D2). */
  protected readonly suppressions = signal<ReadonlySet<string>>(new Set());
  protected readonly suppressionEnCours = computed(() => {
    const p = this.aSupprimer();
    return p !== null && this.suppressions().has(p.id);
  });
  protected readonly messageSuppression = computed(() => {
    const p = this.aSupprimer();
    return p ? `« ${p.nom} » sera définitivement supprimé.` : '';
  });

  protected readonly entete = computed(() => {
    const s = this.stats();
    return s ? { categories: s.poi.by_category.map((c) => c.categorie).join(', ') || '—', total: formaterNombre(s.poi.total) } : null;
  });

  protected readonly cartes = computed(() => {
    const s = this.stats();
    if (!s) return [];
    return s.poi.by_category.map(({ categorie, nb }, rang) => ({
      cat: categorie, ...metaCategorie(categorie, rang), nb: formaterNombre(nb),
      pct: s.poi.total > 0 ? Math.round((nb / s.poi.total) * 100) : 0,
    }));
  });

  protected readonly lignes = computed(() => {
    const enVol = this.suppressions();
    return this.echantillons().map((p) => ({
      ...p, latTexte: p.lat?.toFixed(4) ?? '', lngTexte: p.lng?.toFixed(4) ?? '', suppression: enVol.has(p.id),
    }));
  });

  protected readonly resume = computed(() => ({
    entete: `${this.selection()} — ${this.echantillons().length} / ${formaterNombre(this.total())} POI`,
    restants: this.total() - this.echantillons().length,
    plus: `Charger + (${formaterNombre(this.total() - this.echantillons().length)} restants)`,
  }));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
  }

  /** « + voir » / « ✕ fermer » de la carte. */
  protected basculer(cat: string): void {
    if (this.selection() === cat) {
      this.fermer();
      return;
    }
    this.selection.set(cat);
    this.lire(cat, 0);
  }

  protected fermer(): void {
    this.lecture?.unsubscribe();
    this.selection.set(null);
    this.echantillons.set([]);
    this.chargementEchantillons.set(false);
  }

  protected chargerPlus(): void {
    const cat = this.selection();
    if (cat) this.lire(cat, this.offset);
  }

  /** `fetchPoiSamples` (`usePoiAdmin.ts:82-94`) : un échec est avalé, comme React ; une lecture remplacée est annulée. */
  private lire(cat: string, offset: number): void {
    this.lecture?.unsubscribe();
    this.chargementEchantillons.set(true);
    this.lecture = this.api.poiEchantillons(cat, offset).subscribe({
      next: (r) => {
        if (r?.success) {
          const recus = r.samples ?? [];
          this.echantillons.update((l) => (offset === 0 ? recus : [...l, ...recus]));
          this.total.set(r.total ?? 0);
          this.offset = offset + recus.length;
        }
        this.chargementEchantillons.set(false);
      },
      error: () => this.chargementEchantillons.set(false),
    });
  }

  /** `openCreatePoi` : catégorie préremplie pour `lycee` et `cirfa` SEULEMENT, comme React. */
  protected creer(cat: string): void {
    this.modaleErreur.set('');
    this.modale.set({ mode: 'creation', initial: { ...FORMULAIRE_POI_VIDE, categorie: cat === 'lycee' ? 'lycee' : cat === 'cirfa' ? 'cirfa' : '' } });
  }

  /** `openEditPoi` : `id` en tête, puis les champs de `emptyPoiForm` (latitude et longitude en texte). */
  protected editer(p: LignePoi): void {
    this.modaleErreur.set('');
    this.modale.set({
      mode: 'edition',
      initial: {
        id: p.id, nom: p.nom ?? '', categorie: p.categorie, sous_categorie: p.sous_categorie ?? '', lat: String(p.lat), lng: String(p.lng),
        adresse: p.adresse ?? '', ville: p.ville ?? '', departement: p.departement ?? '', code_postal: p.code_postal ?? '', source: p.source ?? '',
      },
    });
  }

  /** `savePoi` (`usePoiAdmin.ts:96-110`). Une écriture : jamais annulée à la destruction. */
  protected enregistrer(formulaire: FormulairePoi): void {
    const m = this.modale();
    if (!m) return;
    this.modaleEnCours.set(true);
    this.modaleErreur.set('');
    this.api.enregistrerPoi(formulaire, m.mode === 'edition').subscribe({
      next: (r) => {
        this.modaleEnCours.set(false);
        if (!r?.success) {
          this.modaleErreur.set(r?.error ?? 'Erreur');
          return;
        }
        this.modale.set(null);
        const cat = this.selection();
        if (cat) this.lire(cat, 0);
        this.modifie.emit();
      },
      error: (e: unknown) => {
        this.modaleEnCours.set(false);
        this.modaleErreur.set(estCoupure(e) ? ECHEC_RESEAU : e instanceof HttpErrorResponse ? (erreurDuCorps(e) ?? 'Erreur') : String(e));
      },
    });
  }

  /** ✕ d'une ligne : la confirmation d'abord (D1), aucune requête. */
  protected demanderSuppression(p: LignePoi): void {
    this.aSupprimer.set({ id: p.id, nom: p.nom ?? p.id });
  }

  protected annulerSuppression(): void {
    if (!this.suppressionEnCours()) this.aSupprimer.set(null);
  }

  protected confirmerSuppression(): void {
    const p = this.aSupprimer();
    if (p) this.supprimer(p.id);
  }

  /** `deletePoi` (`usePoiAdmin.ts:121-127`), réponse LUE ; une seule requête par POI à la fois (D2). */
  protected supprimer(id: string): void {
    if (this.suppressions().has(id)) return;
    this.suppressions.update((s) => new Set(s).add(id));
    const fin = () => {
      this.suppressions.update((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      if (this.aSupprimer()?.id === id) this.aSupprimer.set(null);
    };
    this.api.supprimerPoi(id).subscribe({
      next: (r) => {
        fin();
        if (r && r.success === false) {
          this.notifications.error('Suppression échouée', r.error ?? 'Erreur');
          return;
        }
        this.echantillons.update((l) => l.filter((p) => p.id !== id));
        this.total.update((t) => t - 1);
        this.modifie.emit();
      },
      error: (e: unknown) => {
        fin();
        this.notifications.error('Suppression échouée', messageRefus(e));
      },
    });
  }

  /** `deletePoisBulk` (`usePoiAdmin.ts:129-138`), réponse LUE. */
  protected purger(): void {
    const cat = this.aPurger();
    if (!cat) return;
    this.purgeEnCours.set(true);
    const fin = () => {
      this.purgeEnCours.set(false);
      this.aPurger.set(null);
    };
    this.api.purgerCategoriePoi(cat).subscribe({
      next: (r) => {
        fin();
        if (r && r.success === false) {
          this.notifications.error('Suppression échouée', r.error ?? 'Erreur');
          return;
        }
        if (this.selection() === cat) {
          this.fermer();
          this.total.set(0);
        }
        this.modifie.emit();
      },
      error: (e: unknown) => {
        fin();
        this.notifications.error('Suppression échouée', messageRefus(e));
      },
    });
  }
}
