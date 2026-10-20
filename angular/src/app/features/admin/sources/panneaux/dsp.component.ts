import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../../core/format/nombre';
import { ConfirmationComponent } from '../../../../ui/confirmation/confirmation.component';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { SourcesAdminApi, type CampagneDsp } from '../data/sources-admin.api';
import { DialogueImportDspComponent } from './dialogue-import-dsp.component';
import { ECHEC_RESEAU, erreurDuCorps, estCoupure } from '../../commun/erreurs-http';

/** `fmtD` de React (`DspPanel.tsx:36`) : `jj/mm/aa`, « — » sans date. */
function fmtD(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
}

interface VueCampagne {
  id: string;
  nom: string;
  source: string;
  periode: string;
  annonces: string;
  lignes: string;
  pays: string;
  /** `null` sans ligne France (React n'affiche alors rien). */
  iris: { texte: string; rattache: boolean } | null;
}

/**
 * Onglet « DSP » des Sources — portage de `DspPanel.tsx` et de `useDspImport.ts` (lot 6, T20) : la liste
 * des campagnes DSP, l'import (`mg-dialogue-import-dsp`), la suppression (`mg-confirmation`).
 *
 * Lecture : les campagnes sont lues À CHAQUE création du composant, c'est-à-dire à chaque visite de
 * l'onglet — c'est le comportement d'origine, voulu et commenté dans `useDspImport.ts:10-15` (une
 * campagne peut être créée entre deux visites ; une requête sur une petite table). Puis après un import
 * réussi et après une suppression. `nombre` remonte le compte au parent (libellé « DSP (N) »).
 *
 * ⚠ La route ne rend que les campagnes de l'ESPACE ACTIF du super_admin (`profile.organization_id`,
 * `campaigns/route.ts:36-56`), simulations exclues : la liste dépend de l'espace choisi dans la coquille.
 *
 * Écarts à React, voulus :
 * - le nom de la campagne n'est PAS un lien vers `/map?campaign=…&tab=apercu` (la carte React) : jamais
 *   de lien vers React depuis Angular, et la carte Angular ne sait pas encore ouvrir une campagne. Il
 *   est INERTE (« Disponible prochainement », patron de la barre), au teal de React.
 * - suppression en échec réseau : « TypeError: Failed to fetch » (le `String(err)` de React).
 * - couleurs (C9) : `C.warnDim` / `${C.warn}44` → `--warning` à 10 % / 27 %, `C.redDim` et
 *   `rgba(255,87,87,0.2)` → `--danger` à 10 % / 20 % ; teal du nom lisible en clair (`light-dark`, T16).
 * - cartes au survol : bord teal à 30 % en CSS (`:hover`), sans écouteur.
 */
@Component({
  selector: 'mg-sources-dsp',
  imports: [ConfirmationComponent, DialogueImportDspComponent, IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="entete">
      <span class="titre" data-titre>Campagnes DSP importées</span>
      <button type="button" class="importer" data-importer (click)="dialogueOuvert.set(true)">Importer une campagne</button>
    </div>

    @if (chargement()) {
      <div class="carte message" data-chargement><mg-icone nom="chargement" [taille]="20" class="tourne" /> Chargement…</div>
    } @else if (vues().length === 0) {
      <div class="carte message" data-vide>Aucune campagne DSP importée</div>
    } @else {
      <div class="liste">
        @for (c of vues(); track c.id) {
          <div class="carte campagne" [attr.data-campagne]="c.id">
            <div class="ligne-haut">
              <a class="nom" data-nom aria-disabled="true" title="Disponible prochainement">{{ c.nom }}</a>
              <span class="badge" data-badge>{{ c.source }}</span>
              <button type="button" class="supprimer" data-supprimer (click)="aSupprimer.set(c.id)">Supprimer</button>
            </div>
            <div class="meta" data-meta>
              <span>{{ c.periode }}</span>
              <span>{{ c.annonces }}</span>
              <span>{{ c.lignes }}</span>
              <span>{{ c.pays }}</span>
              @if (c.iris; as i) {
                <span data-iris [class.rattache]="i.rattache">{{ i.texte }}</span>
              }
            </div>
          </div>
        }
      </div>
    }

    @if (dialogueOuvert()) {
      <mg-dialogue-import-dsp (fermer)="dialogueOuvert.set(false)" (importe)="lire()" />
    }

    <mg-confirmation
      [ouvert]="aSupprimer() !== null"
      titre="Supprimer cette campagne DSP"
      message="La campagne et toutes ses données seront définitivement supprimées."
      libelleConfirmer="Supprimer"
      variante="danger"
      [enCours]="suppressionEnCours()"
      (confirmer)="supprimer()"
      (annuler)="aSupprimer.set(null)"
    />
  `,
  styles: `
    :host { font-family: var(--font-sans); animation: srcFadeIn 0.3s ease-out; }
    @keyframes srcFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .entete { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .titre { font-size: 12px; font-weight: 500; color: var(--text-primary); }
    .importer {
      background: var(--text-primary); color: var(--bg-primary); border: none; border-radius: 6px; padding: 8px 14px;
      font-family: var(--font-sans); font-weight: 500; font-size: 12px; cursor: pointer; transition: opacity 150ms var(--ease-hover);
    }
    .importer:hover { opacity: 0.85; }
    .importer:focus-visible, .supprimer:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .carte { background: var(--bg-surface); border: 0.5px solid var(--border-subtle); border-radius: 2px; }
    .message {
      display: flex; align-items: center; justify-content: center; gap: 6px; padding: 40px; color: var(--text-secondary); font-size: 13px;
    }
    .tourne { animation: tourne 1s linear infinite; }
    @keyframes tourne { to { transform: rotate(360deg); } }
    .liste { display: flex; flex-direction: column; gap: 8px; }
    .campagne { padding: 12px 16px; transition: border-color 0.15s; }
    .campagne:hover { border-color: var(--brand-teal-30); }
    .ligne-haut { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    /* Teal lisible en clair (≈ 1,8:1 sinon) : --teal-texte du cadre admin (F-3). */
    .nom {
      flex: 1; font-weight: 500; font-size: 14px; text-decoration: none; cursor: default;
      color: var(--teal-texte);
    }
    .badge {
      font-size: 10px; font-weight: 500; padding: 2px 8px; border-radius: 4px; color: var(--warning-texte);
      background: color-mix(in srgb, var(--warning) 10%, transparent); border: 0.5px solid color-mix(in srgb, var(--warning) 27%, transparent);
    }
    .supprimer {
      background: color-mix(in srgb, var(--danger) 10%, transparent); border: 0.5px solid color-mix(in srgb, var(--danger) 20%, transparent);
      border-radius: 4px; padding: 3px 10px; font-family: var(--font-sans); font-size: 10px; color: var(--danger-texte); cursor: pointer;
    }
    .meta { display: flex; gap: 16px; flex-wrap: wrap; font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
    .meta .rattache { color: var(--success-texte); }
    @media (prefers-reduced-motion: reduce) { :host, .tourne { animation: none; } }
  `,
})
export class DspComponent {
  private readonly api = inject(SourcesAdminApi);
  private readonly notifications = inject(NotificationsService);
  private lecture: Subscription | null = null;

  /** Le nombre de campagnes après chaque lecture (`DSP (${dspCampaigns.length || '…'})` du parent). */
  readonly nombre = output<number>();

  protected readonly campagnes = signal<CampagneDsp[]>([]);
  protected readonly chargement = signal(true);
  protected readonly dialogueOuvert = signal(false);
  /** Identifiant dont la suppression attend confirmation (`dspDeleteConfirm`). */
  protected readonly aSupprimer = signal<string | null>(null);
  protected readonly suppressionEnCours = signal(false);

  protected readonly vues = computed<VueCampagne[]>(() => this.campagnes().map((c) => ({
    id: c.id,
    nom: c.name,
    source: c.dsp_source,
    periode: `${fmtD(c.date_start)} → ${fmtD(c.date_end)}`,
    annonces: `${formaterNombre(c.total_tracked_ads)} tracked ads`,
    lignes: `${formaterNombre(c.total_rows)} lignes`,
    pays: c.countries?.join(', ') ?? '—',
    iris: c.france_rows > 0
      ? { texte: `${formaterNombre(c.matched_iris)} IRIS (${Math.round((c.matched_iris / c.france_rows) * 100)}%)`, rattache: c.matched_iris > 0 }
      : null,
  })));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
    this.lire();
  }

  /** `fetchDspCampaigns` (`useDspImport.ts:59-73`) : un échec laisse la liste telle quelle, comme React. */
  protected lire(): void {
    this.lecture?.unsubscribe();
    this.chargement.set(true);
    this.lecture = this.api.campagnes().subscribe({
      next: (data) => {
        const liste = Array.isArray(data) ? data : [];
        this.campagnes.set(liste);
        this.chargement.set(false);
        this.nombre.emit(liste.length);
      },
      error: () => this.chargement.set(false),
    });
  }

  /** `handleDspDelete` (`useDspImport.ts:117-136`). Une écriture : jamais annulée à la destruction. */
  protected supprimer(): void {
    const id = this.aSupprimer();
    if (!id) return;
    this.suppressionEnCours.set(true);
    const fin = () => {
      this.suppressionEnCours.set(false);
      this.aSupprimer.set(null);
    };
    this.api.supprimerCampagne(id).subscribe({
      next: () => {
        this.notifications.success('Campagne supprimée');
        this.campagnes.update((l) => l.filter((c) => c.id !== id));
        fin();
        this.lire();
      },
      error: (e: unknown) => {
        if (estCoupure(e) || !(e instanceof HttpErrorResponse)) {
          this.notifications.error('Erreur réseau', estCoupure(e) ? ECHEC_RESEAU : String(e));
        } else {
          // React : `res.json().catch(() => ({ error: 'HTTP <statut>' }))`, puis `body.error || 'Suppression échouée'`.
          const erreur = erreurDuCorps(e);
          this.notifications.error('Erreur', erreur === null ? `HTTP ${e.status}` : (erreur ?? 'Suppression échouée'));
        }
        fin();
      },
    });
  }
}
