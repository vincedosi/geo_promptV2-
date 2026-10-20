import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import type { DspApiLogRow, DspLogLevel } from '../logique/types/dsp';
import { DspApi } from './data/dsp.api';
import { LecturesAnnulables, messageEchec } from './logique/connexion-dsp';

/** Une ligne du tableau, mise en forme une fois (`logs/page.tsx:61-71`). */
interface LigneJournal {
  id: string;
  date: string;
  fournisseur: string;
  categorie: string;
  action: string;
  statut: string;
  niveau: DspLogLevel;
  duree: string;
  message: string;
}

function versLigne(l: DspApiLogRow): LigneJournal {
  return {
    id: l.id,
    date: new Date(l.created_at).toLocaleString('fr-FR'),
    fournisseur: l.provider,
    categorie: l.category,
    action: l.action,
    statut: `${l.status_code ?? l.level}`,
    niveau: l.level,
    duree: l.duration_ms != null ? `${l.duration_ms} ms` : '—',
    message: l.message ?? '',
  };
}

/**
 * `admin/systeme/api/logs` — portage de `app/admin/api/logs/page.tsx` (lot 6, T10) : le journal des
 * appels DSP de l'organisation, tous fournisseurs, filtre « Erreurs uniquement ».
 *
 * - Le filtre est `?level=error`, le paramètre que lit la route (`logsQuerySchema`) ; sans filtre,
 *   AUCUN paramètre (la route applique sa limite par défaut, 50) — mêmes requêtes que React.
 * - Cocher ou décocher relance UNE lecture (l'effet de React sur `errorsOnly`) ; une lecture
 *   précédente encore en vol est annulée, sa réponse ne peut plus écraser la nouvelle (React n'annulait
 *   pas : une réponse lente pouvait arriver en second et afficher le mauvais filtre).
 * - Échec : notification `json.error ?? 'Erreur'`, comme React.
 */
@Component({
  selector: 'mg-journal-dsp',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="barre">
      <label class="filtre">
        <input type="checkbox" [checked]="erreursSeules()" (change)="filtrer($event)" />
        Erreurs uniquement
      </label>
      <button type="button" data-action="rafraichir" class="bouton" (click)="charger()">Rafraîchir</button>
    </div>

    @if (chargement()) {
      <p data-etat-journal class="etat">Chargement…</p>
    } @else if (lignes().length === 0) {
      <p data-etat-journal class="etat">Aucun log pour le moment.</p>
    } @else {
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Provider</th>
            <th>Catégorie</th>
            <th>Action</th>
            <th>Statut</th>
            <th>Durée</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          @for (l of lignes(); track l.id) {
            <tr>
              <td class="date">{{ l.date }}</td>
              <td>{{ l.fournisseur }}</td>
              <td>{{ l.categorie }}</td>
              <td>{{ l.action }}</td>
              <td [attr.data-niveau]="l.niveau">{{ l.statut }}</td>
              <td>{{ l.duree }}</td>
              <td class="message">{{ l.message }}</td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: [`
    :host { display: block; font-family: var(--font-sans); font-size: 16px; color: var(--text-primary); }
    .barre { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
    .filtre { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }
    .bouton {
      background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary);
      border-radius: 6px; padding: 6px 12px; font-family: var(--font-sans); font-size: 12px; cursor: pointer;
    }
    .bouton:focus-visible { outline: 1px solid var(--brand-teal-50); outline-offset: 1px; }
    .etat { margin: 0; font-size: 13px; color: var(--text-tertiary); }
    table { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: 11px; }
    thead tr { text-align: left; color: var(--text-tertiary); border-bottom: 1px solid var(--border-subtle); }
    tbody tr { border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary); }
    th, td { padding: 8px 10px; }
    .date { white-space: nowrap; }
    .message { color: var(--text-primary); }
    td[data-niveau='error'] { color: var(--danger-texte); }
    td[data-niveau='warn'] { color: var(--warning-texte); }
  `],
})
export class JournalDspPage {
  private readonly api = inject(DspApi);
  private readonly notifications = inject(NotificationsService);
  private readonly lectures = new LecturesAnnulables();

  protected readonly erreursSeules = signal(false);
  protected readonly chargement = signal(true);
  private readonly logs = signal<DspApiLogRow[]>([]);
  protected readonly lignes = computed(() => this.logs().map(versLigne));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.lectures.annulerTout());
    void this.charger();
  }

  /** `load` (`logs/page.tsx:15-25`). */
  protected async charger(): Promise<void> {
    // La lecture précédente, annulée ici, ne finira jamais (ni `catch` ni `finally`) : c'est CETTE lecture qui
    // remet `chargement` à faux (G2).
    this.lectures.annulerTout();
    this.chargement.set(true);
    try {
      const json = await this.lectures.lire(this.api.journal(this.erreursSeules() ? { level: 'error' } : {}));
      this.logs.set(json.logs ?? []);
    } catch (e) {
      this.notifications.error(messageEchec(e, 'Erreur'));
    } finally {
      this.chargement.set(false);
    }
  }

  protected filtrer(e: Event): void {
    this.erreursSeules.set((e.target as HTMLInputElement).checked);
    void this.charger();
  }
}
