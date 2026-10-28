import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { type ZoneCustomResume, ZonesCustomApi } from '../../data/zones-custom.api';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { ReferentielGeoService } from '../../etat/referentiel-geo.service';
import { TiroirsExclusifs } from '../../etat/tiroirs-exclusifs';
import { type FiltreActif, poserFiltre } from '../../logique/filtre';
import { composerFiltreCodePostal, composerFiltreVille, seedDepuisFiltre } from '../../logique/panneau-filtre-logique';
import { FILTRE_FRANCE_ENTIERE, FILTRE_METROPOLE, scopeDuFiltre } from '../../logique/perimetre-national';
import { EnteteFiltreComponent, PerimetreComponent, type SectionPerimetre } from './perimetre.component';

/** Anti-rebond de la recherche locale (ville / code postal) — `DEBOUNCE_MS` de `PanneauFiltre.tsx:109`. */
export const ANTI_REBOND_RECHERCHE_MS = 400;

/** Les tiroirs du panneau : les quatre sections du périmètre, puis « Filtrer sur une zone enregistrée ». */
type TiroirFiltre = SectionPerimetre | 'zones';

/**
 * Le panneau « Filtre » — portage de `app/map/_components/panneaux/PanneauFiltre.tsx` (et de
 * `use-territory-selection.ts` pour l'état du widget). Compose le filtre UNIQUE de la carte
 * (`EtatCarteService.filtre`) depuis trois sources : le découpage administratif + la recherche locale, les pastilles
 * « France Metro » / « France + DROM », et une zone enregistrée.
 *
 * ── LES PASTILLES SONT DES FILTRES (retours du 26/10, T3) ────────────────
 * « France Metro » pose `FILTRE_METROPOLE`, « France + DROM » `FILTRE_FRANCE_ENTIERE` ; `perimetreScope` suit le
 * filtre à chaque écriture (`ecrire`), et la pastille affichée en est DÉRIVÉE (`scope`) : les deux ne se contredisent
 * pas. Le bloc « Périmètre national » (bouton « France entière ») est retiré : il posait le même filtre que « + DROM »
 * (Vincent, 26/10, Q-2). Écart à React : la pastille n'y est qu'un `perimeterScope`, sans filtre (A-1).
 *
 * ── RECRÉÉ À CHAQUE OUVERTURE, COMME REACT ───────────────────────────────
 * Le panneau est rendu sous le `@switch` du cadre : fermer puis rouvrir crée une nouvelle instance. Régions,
 * départements, ville et code postal sont donc RE-SEMÉS depuis le filtre courant (`seedDepuisFiltre`) à la
 * construction, sans jamais réécrire le filtre — un simple affichage.
 *
 * ── SÉLECTION SIMPLE ÉMULÉE SUR UN WIDGET MULTIPLE ───────────────────────
 * La région (ou le département) AJOUTÉE remplace la sélection ; en retirer une retire le filtre s'il portait sur
 * ce type. « Tout sélectionner » ne retient que la première région nouvelle du lot.
 *
 * ── ANTI-REBOND PAR SETTER ───────────────────────────────────────────────
 * La saisie programme l'écriture du filtre (400 ms, 0 si le champ est vidé) ; le semis ne programme rien. Les
 * minuteries en attente sont abandonnées à la destruction : fermer le panneau n'engage pas une saisie en suspens.
 *
 * ── RÉGION / DÉPARTEMENT / COMMUNE / CP SANS BBOX : VOULU ────────────────
 * Le référentiel ne porte pas de bbox ; `bboxPourRequete` repliera sur la métropole. Seule une zone enregistrée
 * porte une bbox résolue (`custom_geo_zones.bbox`).
 *
 * ── TIROIRS EXCLUSIFS (retours du 26/10, T7) ─────────────────────────────
 * Les quatre sections du périmètre et « Filtrer sur une zone enregistrée » sont UN jeu de tiroirs (`TiroirsExclusifs`) :
 * en ouvrir un referme l'autre ; « Périmètre global » est ouvert à l'ouverture (A-11). Écart à React, qui ouvrait
 * Périmètre, Régions, Départements et la liste des zones ensemble. Replier détruit le corps (`@if`) sans rien relire :
 * la liste des zones et le référentiel sont lus par le panneau (une fois) et le service, la saisie vit dans ses signaux.
 *
 * ── UN SEUL APPEL `/api/custom-geo/list` PAR OUVERTURE ───────────────────
 * Paramètres EXACTS de React (`org_id`, `_t`). L'organisation est l'organisation ACTIVE du profil ; sans elle
 * (« toutes », super_admin), aucun appel — et la liste annonce « Aucune zone enregistrée », comme React.
 */
@Component({
  selector: 'mg-panneau-filtre',
  imports: [EnteteFiltreComponent, PerimetreComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col overflow-y-auto' },
  template: `
    <mg-perimetre-filtre
      [sections]="sections()"
      [scope]="scope()"
      [regions]="referentiel.regions()"
      [regionsChoisies]="regionsChoisies()"
      [departements]="deptsDisponibles()"
      [deptsChoisis]="deptsChoisis()"
      [ville]="ville()"
      [codePostal]="codePostal()"
      [territoire]="territoire()"
      [aTerritoire]="aTerritoire()"
      [erreurReferentiel]="referentiel.erreur()"
      (basculerSection)="tiroirs.basculer($event)"
      (choisirScope)="choisirScope($event)"
      (changerRegions)="regionsDepuisListe($event)"
      (toutesRegions)="toutesRegions()"
      (changerDepts)="deptsDepuisListe($event)"
      (saisirVille)="saisieVille($event)"
      (saisirCodePostal)="saisirCodePostal($event)"
      (reinitialiser)="reinitialiser()"
    />

    <!-- Filtrer sur une zone enregistrée : liste dynamique, jamais en dur. Le px-4 rend à l'en-tête la gouttière que
         sa marge négative (mx-[-16px]) suppose, comme les sections de mg-perimetre-filtre (sans lui : en-tête décalé et
         barre de défilement horizontale, Excel n° 46). -->
    <div class="px-4">
      <mg-entete-filtre
        libelle="Filtrer sur une zone enregistrée"
        [ouvert]="tiroirs.ouvert() === 'zones'"
        [compte]="filtreZone() ? 1 : 0"
        (basculer)="tiroirs.basculer('zones')"
      />
      @if (tiroirs.ouvert() === 'zones') {
        <div class="flex flex-col gap-1.5 py-3" data-zones>
          @if (zonesChargement()) {
            <div class="font-mono text-[11px] text-tertiary">Chargement…</div>
          }
          @if (zonesErreur(); as erreur) {
            <div class="text-[11px] text-danger">{{ erreur }}</div>
          }
          @if (!zonesChargement() && !zonesErreur() && zones().length === 0) {
            <div class="text-[11px] text-tertiary">Aucune zone enregistrée pour cette organisation.</div>
          }
          @for (zone of zones(); track zone.id) {
            <button
              type="button"
              [attr.data-zone]="zone.id"
              [attr.aria-pressed]="zoneActive() === zone.id"
              (click)="choisirZone(zone)"
              class="flex w-full cursor-pointer flex-col items-start gap-[2px] rounded-[4px] border-fin px-[10px] py-2 text-left text-[12px]"
              [class]="zoneActive() === zone.id ? classeActive : classeInactive"
            >
              <span>{{ zone.name }}</span>
              <span class="font-mono text-[9px] text-tertiary">{{ zone.feature_count_cp }} CP · {{ zone.feature_count_iris }} IRIS</span>
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class PanneauFiltreComponent {
  protected readonly etat = inject(EtatCarteService);
  protected readonly referentiel = inject(ReferentielGeoService);
  private readonly api = inject(ZonesCustomApi);
  private readonly auth = inject(AuthService);

  /** Un tiroir ouvert à la fois ; « Périmètre global » à l'ouverture (A-11). */
  protected readonly tiroirs = new TiroirsExclusifs<TiroirFiltre>('perimetre');
  /** Ce que lit `mg-perimetre-filtre` : la section ouverte, les autres fermées. */
  protected readonly sections = computed<Record<SectionPerimetre, boolean>>(() => {
    const o = this.tiroirs.ouvert();
    return { perimetre: o === 'perimetre', regions: o === 'regions', departements: o === 'departements', recherche: o === 'recherche' };
  });
  protected readonly regionsChoisies = signal<readonly string[]>([]);
  protected readonly deptsChoisis = signal<readonly string[]>([]);
  protected readonly ville = signal('');
  protected readonly codePostal = signal('');

  protected readonly zones = signal<readonly ZoneCustomResume[]>([]);
  protected readonly zonesChargement = signal(false);
  protected readonly zonesErreur = signal<string | null>(null);
  private zonesDemandees = false;
  private abonnementZones: Subscription | null = null;
  private detruit = false;

  private minuterieVille: ReturnType<typeof setTimeout> | undefined;
  private minuterieCp: ReturnType<typeof setTimeout> | undefined;

  // Actif : `--brand-teal-30` / `--brand-teal` ; sinon `C.bgInput` / `C.border` / `C.text` (`PanneauFiltre.tsx:343-346`).
  protected readonly classeActive = 'bg-[var(--brand-teal-30)] border-teal text-teal';
  protected readonly classeInactive = 'bg-elevated border-subtle text-primary';

  /** La pastille allumée, dérivée du filtre (le `perimetreScope` hérité seulement sans filtre). */
  protected readonly scope = computed(() => scopeDuFiltre(this.etat.filtre(), this.etat.perimetreScope()));
  protected readonly filtreZone = computed(() => this.etat.filtre()?.type === 'zone');
  protected readonly zoneActive = computed(() => {
    const f = this.etat.filtre();
    return f?.type === 'zone' ? f.code : null;
  });

  /** Cascade régions → départements (`use-territory-selection.ts:57-61`). */
  protected readonly deptsDisponibles = computed(() => {
    const choisies = this.regionsChoisies();
    if (choisies.length === 0) return this.referentiel.departements();
    return this.referentiel.regions().filter((r) => choisies.includes(r.code_region)).flatMap((r) => r.depts);
  });

  /** La phrase de territoire (`buildTerritoire`, `use-territory-selection.ts:81-99`). */
  protected readonly territoire = computed(() => {
    const ville = this.ville().trim();
    const cp = this.codePostal();
    const depts = this.deptsChoisis();
    const regions = this.regionsChoisies();
    if (ville) return `à ${ville}${cp ? ` (${cp})` : ''}`;
    if (depts.length === 1) {
      const d = this.referentiel.departements().find((x) => x.code_dept === depts[0]);
      return `dans le département ${depts[0]}${d ? ` — ${d.nom_dept}` : ''}`;
    }
    if (depts.length > 1) return `dans les départements ${depts.join(', ')}`;
    if (regions.length === 1) {
      const r = this.referentiel.regions().find((x) => x.code_region === regions[0]);
      return `en ${r?.nom_region ?? regions[0]}`;
    }
    if (regions.length > 1) {
      const noms = regions.map((code) => this.referentiel.regions().find((r) => r.code_region === code)?.nom_region ?? code);
      return `en ${noms.join(' et ')}`;
    }
    const scope = this.scope();
    if (scope === 'metro') return 'de France métropolitaine';
    if (scope === 'all') return 'de France entière';
    return 'de France';
  });
  protected readonly aTerritoire = computed(() =>
    this.scope() !== null || this.regionsChoisies().length > 0 || this.deptsChoisis().length > 0
    || this.ville().trim().length > 0,
  );

  constructor() {
    // Semis depuis le filtre courant, à la construction seulement — jamais d'écriture du filtre.
    const seed = seedDepuisFiltre(untracked(() => this.etat.filtre()));
    this.ville.set(seed.ville);
    this.codePostal.set(seed.codePostal);
    this.regionsChoisies.set(seed.selectedRegions);
    this.deptsChoisis.set(seed.selectedDepts);

    this.referentiel.charger();
    void this.auth.lireProfil().then((p) => this.chargerZones(p?.organisation ?? null));

    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      clearTimeout(this.minuterieVille);
      clearTimeout(this.minuterieCp);
      this.abonnementZones?.unsubscribe();
    });
  }

  /** Un appel par instance, et seulement avec une organisation (`PanneauFiltre.tsx:245-265`). */
  private chargerZones(org: string | null): void {
    if (this.detruit || !org || this.zonesDemandees) return;
    this.zonesDemandees = true;
    this.zonesChargement.set(true);
    this.zonesErreur.set(null);
    const params = new URLSearchParams({ org_id: org, _t: String(Date.now()) });
    this.abonnementZones = this.api.lister(params).subscribe({
      next: (r) => {
        this.zones.set(r.zones ?? []);
        this.zonesChargement.set(false);
      },
      error: (e: unknown) => {
        const statut = (e as { status?: unknown } | null)?.status;
        this.zonesErreur.set(typeof statut === 'number' && statut > 0 ? `HTTP ${statut}` : (e instanceof Error ? e.message : 'Erreur de chargement'));
        this.zonesChargement.set(false);
      },
    });
  }

  /** Toute écriture du filtre depuis ce panneau : `perimetreScope` le suit (métropole, France entière, ou rien). */
  private ecrire(prochain: FiltreActif | null): void {
    this.etat.filtre.set(prochain);
    this.etat.perimetreScope.set(scopeDuFiltre(prochain, null));
  }

  /**
   * Pastille Métro / +DROM (`selectScope` enveloppé, `PanneauFiltre.tsx:143-147`) : vide le widget et pose le filtre
   * national — `FILTRE_METROPOLE` ou `FILTRE_FRANCE_ENTIERE` — par un seul `ecrire`, qui règle aussi `perimetreScope`.
   * Re-cliquer la même pastille les retire tous deux. Comme tout filtre (`poserFiltre`), elle REMPLACE le précédent,
   * zone enregistrée comprise : écart voulu au `filtreApresChangementScope` de React, qui gardait la zone (A-3, 26/10).
   */
  protected choisirScope(s: 'metro' | 'all'): void {
    // Une saisie de ville ou de CP encore dans son anti-rebond poserait sa commune PAR-DESSUS la pastille (T8, m-3).
    clearTimeout(this.minuterieVille);
    clearTimeout(this.minuterieCp);
    this.regionsChoisies.set([]);
    this.deptsChoisis.set([]);
    this.ville.set('');
    this.codePostal.set('');
    this.ecrire(poserFiltre(this.etat.filtre(), s === 'metro' ? FILTRE_METROPOLE : FILTRE_FRANCE_ENTIERE));
  }

  /** La liste des régions a changé (`onChange` de `PerimeterSections.tsx:134`). */
  protected regionsDepuisListe(codes: string[]): void {
    this.changerRegions(codes);
    if (codes.length > 0) this.etat.perimetreScope.set(null);
  }

  /** « Tout sélectionner » / « Tout désélectionner » (`PerimeterSections.tsx:57-64`). */
  protected toutesRegions(): void {
    const toutes = this.referentiel.regions();
    const toutesChoisies = toutes.length > 0 && this.regionsChoisies().length === toutes.length;
    this.changerRegions(toutesChoisies ? [] : toutes.map((r) => r.code_region));
    this.etat.perimetreScope.set(null);
  }

  /** Sélection simple émulée (`PanneauFiltre.tsx:179-189`), puis la purge de la cascade (`use-territory-selection.ts:62-73`). */
  private changerRegions(resolu: readonly string[]): void {
    const avant = this.regionsChoisies();
    if (resolu.length === 0) {
      this.regionsChoisies.set([]);
      if (this.etat.filtre()?.type === 'region') this.ecrire(null);
    } else {
      const ajoutee = resolu.find((code) => !avant.includes(code)) ?? resolu[0];
      this.regionsChoisies.set([ajoutee]);
      const label = this.referentiel.regions().find((r) => r.code_region === ajoutee)?.nom_region ?? ajoutee;
      this.ecrire(poserFiltre(this.etat.filtre(), { type: 'region', code: ajoutee, label }));
    }
    this.purgerDepts();
  }

  /** Les départements hors de la cascade quittent la sélection du widget (jamais le filtre). */
  private purgerDepts(): void {
    if (this.referentiel.departements().length === 0) return;
    const codes = new Set(this.deptsDisponibles().map((d) => d.code_dept));
    const avant = this.deptsChoisis();
    const apres = avant.filter((d) => codes.has(d));
    if (apres.length !== avant.length) this.deptsChoisis.set(apres);
  }

  protected deptsDepuisListe(codes: string[]): void {
    this.changerDepts(codes);
    if (codes.length > 0) this.etat.perimetreScope.set(null);
  }

  /** `PanneauFiltre.tsx:191-201`. */
  private changerDepts(resolu: readonly string[]): void {
    const avant = this.deptsChoisis();
    if (resolu.length === 0) {
      this.deptsChoisis.set([]);
      if (this.etat.filtre()?.type === 'departement') this.ecrire(null);
      return;
    }
    const ajoute = resolu.find((code) => !avant.includes(code)) ?? resolu[0];
    this.deptsChoisis.set([ajoute]);
    const d = this.deptsDisponibles().find((x) => x.code_dept === ajoute);
    const label = d ? `${d.code_dept} — ${d.nom_dept}` : ajoute;
    this.ecrire(poserFiltre(this.etat.filtre(), { type: 'departement', code: ajoute, label }));
  }

  /** Saisie dans le champ Ville (`PerimeterSections.tsx:174`) : le périmètre global est levé dès qu'un texte existe. */
  protected saisieVille(valeur: string): void {
    this.saisirVille(valeur);
    if (valeur) this.etat.perimetreScope.set(null);
  }

  /** Anti-rebond PAR SETTER (`PanneauFiltre.tsx:210-217`). */
  private saisirVille(valeur: string): void {
    this.ville.set(valeur);
    clearTimeout(this.minuterieVille);
    this.minuterieVille = setTimeout(() => {
      this.ecrire(composerFiltreVille(this.etat.filtre(), valeur));
    }, valeur.trim() ? ANTI_REBOND_RECHERCHE_MS : 0);
  }

  /** `PanneauFiltre.tsx:220-226`. */
  protected saisirCodePostal(valeur: string): void {
    this.codePostal.set(valeur);
    clearTimeout(this.minuterieCp);
    this.minuterieCp = setTimeout(() => {
      this.ecrire(composerFiltreCodePostal(this.etat.filtre(), valeur));
    }, valeur.trim() ? ANTI_REBOND_RECHERCHE_MS : 0);
  }

  /** « ✕ Réinitialiser » du résumé (`PerimeterSections.tsx:195`) : un filtre national posé par une pastille part aussi. */
  protected reinitialiser(): void {
    if (this.etat.filtre()?.type === 'france') this.ecrire(null);
    this.etat.perimetreScope.set(null);
    this.changerRegions([]);
    this.changerDepts([]);
    this.saisirVille('');
    this.saisirCodePostal('');
  }

  /** Une zone enregistrée : le seul filtre qui porte une bbox résolue (`PanneauFiltre.tsx:267-274`). */
  protected choisirZone(zone: ZoneCustomResume): void {
    this.ecrire(poserFiltre(this.etat.filtre(), {
      type: 'zone', code: zone.id, label: zone.name, bbox: zone.bbox ?? undefined,
    }));
  }
}
