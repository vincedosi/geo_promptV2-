import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { Subscription } from 'rxjs';
import { ConfirmationComponent } from '../../../ui/confirmation/confirmation.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { OrganisationsListeApi, type OrganisationListe } from '../commun/data/organisations-liste.api';
import type { DataSource } from '../logique/types/admin';
import { RadioAdminApi, type StatsRadio } from '../radio/data/radio-admin.api';
import { DetailSourceComponent } from './detail-source.component';
import { ListeSourcesComponent } from './liste-sources.component';
import { SourcesAdminApi, type ReponseEcriture, type StatsSources, type StatsZones } from './data/sources-admin.api';
import { fmtK, type OngletSources, type TeinteSources } from './logique/constantes';
import { DspComponent } from './panneaux/dsp.component';
import { ZonesCustomComponent } from './panneaux/zones-custom.component';
import { TuilesSourcesComponent } from './tuiles-sources.component';

interface VueOnglet {
  cle: OngletSources;
  libelle: string;
  teinte: TeinteSources;
}

/**
 * `admin/donnees/sources` — portage de `app/admin/sources/page.tsx` (lot 6, T18, amendement A5),
 * PREMIER onglet de la page Données ; `admin/sources` y redirige. Cadre, neuf onglets, vue
 * « Toutes » (tuiles, données système, bloc Radio, liste et détail des sources). Onglets DSP et Zones
 * perso : `mg-sources-dsp` et `mg-sources-zones` (T20). Les panneaux POI, carreaux, OOH, IRIS,
 * transport (T19) sont PROVISOIRES d'ici là : « Disponible prochainement », sans aucune lecture.
 *
 * Lectures : QUATRE à l'ouverture — sources, statistiques, radio, zones perso (le limiteur en laisse
 * passer trois, la quatrième attend : voulu) ; chacune UNE fois par écran (cache, règle d'I/O). Aucune
 * de `transport-stats` tant que son panneau n'est pas porté. Les campagnes DSP sont lues par l'onglet DSP
 * à CHAQUE visite (React, voulu) ; les organisations du filtre des Zones perso, à la PREMIÈRE visite de
 * cet onglet, puis gardées pour l'écran (A2) — relues à la visite suivante seulement si elles ont échoué.
 *
 * Périmètre réduit (A5, qui prime sur le brief du 06/10) : pas de résumé IA, pas de partage, pas de
 * changement d'organisation, pas de lecture des organisations — React les a retirés.
 *
 * Écarts à React (le détail : `liste-sources`, `tuiles-sources`, `detail-source`) :
 * - titre « Sources » remonté dans le cadre (« Données » + onglet), comme Historique (T11′) ; les
 *   badges « Admin » / « N sources » et le sous-titre restent, au texte de React.
 * - **onglet Radio** : React n'y rendait RIEN (le bloc Radio, prévu pour `all || radio`, vit dans le
 *   conteneur de « Toutes ») ; Angular y montre ce bloc.
 * - suppression refusée (409 panneaux d'une campagne, 500…) : le message de la route est lu dans le
 *   corps de l'erreur `HttpClient`, comme React le lisait dans `res.json()`.
 * - teintes des onglets (C9) : `#06b6d4` → `--info`, `#22c55e` → `--success`.
 * - onglets : `role="tab"` et `aria-selected` (React : boutons nus).
 */
@Component({
  selector: 'mg-sources',
  imports: [ConfirmationComponent, DetailSourceComponent, DspComponent, ListeSourcesComponent, TuilesSourcesComponent, ZonesCustomComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sources.page.html',
  styles: [`
    :host { display: block; font-family: var(--font-sans); }
    @keyframes srcFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .entete { margin-bottom: 20px; animation: srcFadeIn 0.4s ease-out; }
    .badges { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
    .badge { font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 2px; }
    .badge.admin {
      color: var(--warning); background: color-mix(in srgb, var(--warning) 10%, transparent);
      border: 0.5px solid color-mix(in srgb, var(--warning) 27%, transparent);
    }
    .badge.compte { color: var(--text-secondary); background: var(--bg-level-2); border: 0.5px solid var(--border-subtle); }
    .sous-titre { color: var(--text-secondary); font-size: 13px; margin: 0; }
    .onglets { display: flex; gap: 2px; margin-bottom: 16px; border-bottom: 1px solid var(--border-subtle); }
    .onglet {
      background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-secondary); font-family: var(--font-sans);
      font-size: 9px; font-weight: 400; padding: 8px 14px; cursor: pointer; transition: color 0.2s ease, border-color 0.2s ease;
      white-space: nowrap; margin-bottom: -1px;
    }
    .onglet[data-teinte='teal'] { --teinte: var(--brand-teal); }
    .onglet[data-teinte='succes'] { --teinte: var(--success); }
    .onglet[data-teinte='avert'] { --teinte: var(--warning); }
    .onglet[data-teinte='info'] { --teinte: var(--info); }
    .onglet[aria-selected='true'] { border-bottom-color: var(--teinte); color: var(--teinte); font-weight: 700; }
    .onglet:focus-visible { outline: 1px solid var(--brand-teal-50); outline-offset: -1px; }
    .vue { display: flex; gap: 16px; }
    .gauche { flex: 1; min-width: 0; }
    .provisoire {
      background: var(--bg-surface); border: 0.5px solid var(--border-subtle); border-radius: 2px; padding: 40px; text-align: center;
      color: var(--text-secondary); font-size: 13px;
    }
    @media (prefers-reduced-motion: reduce) { .entete { animation: none; } }
  `],
})
export class SourcesPage {
  private readonly api = inject(SourcesAdminApi);
  private readonly radioApi = inject(RadioAdminApi);
  private readonly organisationsApi = inject(OrganisationsListeApi);
  private readonly notifications = inject(NotificationsService);
  private readonly lectures: Subscription[] = [];
  private lectureSources: Subscription | null = null;

  /** L'onglet actif (`activeTab` de React). Le changer passe par `choisirOnglet`, qui vide la sélection. */
  readonly onglet = signal<OngletSources>('all');

  protected readonly sources = signal<DataSource[]>([]);
  protected readonly chargement = signal(true);
  protected readonly stats = signal<StatsSources | null>(null);
  protected readonly statsChargement = signal(true);
  protected readonly radio = signal<StatsRadio | null>(null);
  protected readonly statsZones = signal<StatsZones | null>(null);
  protected readonly zonesChargement = signal(true);
  private readonly selectionId = signal<string | null>(null);
  /** Identifiant dont la suppression attend confirmation (`deleteConfirm`). */
  protected readonly aSupprimer = signal<string | null>(null);
  protected readonly suppressionEnCours = signal(false);
  /** Nombre de campagnes de la dernière lecture de l'onglet DSP (`dsp.dspCampaigns.length`), gardé en le quittant. */
  protected readonly nbCampagnes = signal(0);
  /** Organisations du filtre des Zones perso : lues une fois par écran (A2), à la première visite de l'onglet. */
  protected readonly organisations = signal<OrganisationListe[]>([]);
  private organisationsLues = false;

  protected readonly selection = this.selectionId.asReadonly();
  /** La source choisie, relue dans la liste (zéro ou un élément : le `@for … track id` recrée le détail). */
  protected readonly selectionListe = computed(() => this.sources().filter((s) => s.id === this.selectionId()));

  /** Barre d'onglets (`page.tsx:317-331`). */
  protected readonly onglets = computed<VueOnglet[]>(() => {
    const ss = this.stats();
    const total = ss
      ? ss.ooh.total + ss.poi.total + ss.transport.total + ss.flux.total + ss.carreaux.total + ss.iris.total
      : this.sources().length;
    const r = this.radio();
    return [
      { cle: 'all', libelle: `Toutes (${this.statsChargement() ? '…' : fmtK(total)})`, teinte: 'teal' },
      { cle: 'poi', libelle: `POI (${ss ? fmtK(ss.poi.total) : '…'})`, teinte: 'teal' },
      { cle: 'carreaux', libelle: `Carreaux (${ss ? fmtK(ss.carreaux.total) : '…'})`, teinte: 'succes' },
      { cle: 'panneaux', libelle: `OOH (${ss ? fmtK(ss.ooh.total) : '…'})`, teinte: 'avert' },
      { cle: 'iris', libelle: `IRIS (${ss ? fmtK(ss.iris.total) : '…'})`, teinte: 'info' },
      { cle: 'transport', libelle: `Transport & Flux (${ss ? fmtK(ss.transport.total + ss.flux.total) : '…'})`, teinte: 'succes' },
      { cle: 'radio', libelle: `Radio (${r ? fmtK(r.total_emetteurs) : '…'})`, teinte: 'teal' },
      // `dsp.dspCampaigns.length || '…'` : les campagnes ne sont lues qu'à l'ouverture de l'onglet DSP.
      { cle: 'dsp', libelle: `DSP (${this.nbCampagnes() || '…'})`, teinte: 'avert' },
      { cle: 'custom_zones', libelle: 'Zones perso', teinte: 'teal' },
    ];
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.lectureSources?.unsubscribe();
      for (const l of this.lectures) l.unsubscribe();
    });
    this.lireSources();
    this.lectures.push(
      this.api.stats().subscribe({
        next: (r) => {
          if (r.success) this.stats.set(r);
          this.statsChargement.set(false);
        },
        error: () => this.statsChargement.set(false),
      }),
      this.radioApi.stats().subscribe({ next: (r) => this.radio.set(r), error: () => undefined }),
      this.api.statsZones().subscribe({
        next: (r) => {
          this.statsZones.set(r);
          this.zonesChargement.set(false);
        },
        error: () => this.zonesChargement.set(false),
      }),
    );
  }

  /** `fetchSources` (`page.tsx:114-123`) : relue aussi après un renommage. */
  protected lireSources(): void {
    this.lectureSources?.unsubscribe();
    this.chargement.set(true);
    this.lectureSources = this.api.sources().subscribe({
      next: (r) => {
        if (r.success) this.sources.set(r.sources ?? []);
        this.chargement.set(false);
      },
      error: () => this.chargement.set(false),
    });
  }

  /** Onglet, tuile ou carte de données système : React fait `setActiveTab(t); setSelectedSource(null)`. */
  protected choisirOnglet(o: OngletSources): void {
    this.onglet.set(o);
    this.selectionId.set(null);
    if (o === 'custom_zones') this.lireOrganisations();
  }

  /**
   * `WorkspaceFilter` (`CustomZonesTab/WorkspaceFilter.tsx:19-26`) : React relit à chaque montage et avale
   * l'erreur. Ici une fois par écran ; un échec laisse la liste vide (« Tous les workspaces » seul) et
   * sera retenté à la visite suivante.
   */
  private lireOrganisations(): void {
    if (this.organisationsLues) return;
    this.organisationsLues = true;
    this.lectures.push(this.organisationsApi.lister().subscribe({
      next: (r) => {
        if (r?.organizations) this.organisations.set(r.organizations);
        else this.organisationsLues = false;
      },
      error: () => (this.organisationsLues = false),
    }));
  }

  protected choisirSource(id: string): void {
    this.selectionId.set(id);
  }

  protected fermerDetail(): void {
    this.selectionId.set(null);
  }

  /** Champs filtres enregistrés : la source est mise à jour EN PLACE (`page.tsx:245-246`). */
  protected filtresModifies(id: string, champs: string[]): void {
    this.sources.update((l) => l.map((s) => (s.id === id ? { ...s, filter_fields: champs } : s)));
  }

  /** `handleDelete` (`page.tsx:179-196`). Une écriture : jamais annulée à la destruction. */
  protected supprimer(): void {
    const id = this.aSupprimer();
    if (!id) return;
    this.suppressionEnCours.set(true);
    const fin = () => {
      this.suppressionEnCours.set(false);
      this.aSupprimer.set(null);
    };
    this.api.supprimer(id).subscribe({
      next: (r) => {
        if (r.success) this.retirer(id);
        else this.notifications.error('Suppression échouée', r.error ?? 'Erreur inconnue');
        fin();
      },
      error: (e: unknown) => {
        if (e instanceof HttpErrorResponse && e.status !== 0) {
          const corps = e.error as ReponseEcriture | null;
          const message = corps && typeof corps === 'object' && typeof corps.error === 'string' && corps.error ? corps.error : 'Erreur inconnue';
          this.notifications.error('Suppression échouée', message);
        } else {
          this.notifications.error('Erreur réseau', 'Connexion au serveur impossible');
        }
        fin();
      },
    });
  }

  private retirer(id: string): void {
    this.sources.update((l) => l.filter((s) => s.id !== id));
    this.selectionId.set(null);
    this.notifications.success('Source supprimée');
  }
}
