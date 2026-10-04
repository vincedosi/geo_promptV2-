import type { HttpResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Observable } from 'rxjs';
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import { JeuxZonesApi } from '../../data/jeux-zones.api';
import { AtelierJeuxService } from '../../etat/atelier-jeux.service';
import { DonneesRisqueService } from '../../etat/donnees-risque.service';
import { EtatRisqueService } from '../../etat/etat-risque.service';
import type { JeuDeZones } from '../../logique/jeu';
import { anneauxParNiveau } from '../../logique/libelle-classe';
import { ActionsJeuComponent } from './actions-jeu.component';
import { BibliothequeComponent } from './bibliotheque.component';
import { DilutionComponent } from './dilution.component';
import { type ModePlan, ModePlanComponent } from './mode-plan.component';
import { PanneauExtractionsComponent } from './panneau-extractions.component';
import { TableauClassesComponent } from './tableau-classes.component';

/** Les textes de l'atelier, MOT POUR MOT d'`OngletZones.tsx`. */
export const TEXTES_ATELIER = {
  conseil: 'Les zones affichées sur la carte sont celles du profil courant. '
    + 'Construisez le jeu pour en tirer des codes postaux.',
  construction: 'Construction des zones et rattachement aux codes postaux. '
    + 'Compter une vingtaine de secondes sur la France entière.',
  echec: 'La construction du jeu de zones a échoué.',
  vide: 'Un jeu de zones fige le profil de rayons courant en objet réutilisable : ses '
    + 'classes, leurs poids, et les codes postaux qu’elles retiennent. C’est ce qu’une '
    + 'campagne reçoit comme plan géographique.',
  boutonConstruire: 'Construire les zones du profil courant',
  aideConstruire: 'Une vingtaine de secondes sur la France entière. Le résultat est mémorisé : '
    + 'revenir au même profil ne relance aucun calcul.',
} as const;

const ALERTE = 'm-0 rounded-[6px] border-fin border-danger/20 bg-danger/10 px-3 py-2 text-[12px] leading-[1.5] text-danger';

/**
 * ④ Zones — l'atelier qui fige le profil de rayons en JEU DE ZONES réutilisable. Portage d'`OngletZones.tsx`.
 *
 * ── CONSTRUIRE EST UN GESTE EXPLICITE ────────────────────────────────────
 *
 * Une vingtaine de secondes (Kong coupe à 60 s). On règle le rayon dans la barre commune, on vient ici quand on a
 * décidé ; ce panneau ne règle aucune distance, il fige, nomme et enregistre ce que la barre a réglé.
 *
 * ── LES TROIS CHIFFRES VIENNENT DU MÊME INSTANTANÉ ───────────────────────
 *
 * Population visée, taux d'utile et codes postaux sont recalculés depuis les CLASSES du détail, jamais lus dans
 * l'en-tête du jeu, écrit par une autre requête. Le numérateur du taux est `population_en_zone_retenue` : le
 * dénominateur ne porte que sur les codes postaux RETENUS, et un ratio dont les deux termes ne comptent pas le même
 * ensemble ne veut rien dire (React annonçait 91,6 % là où la base disait 81,6 %).
 *
 * ── HORS PÉRIMÈTRE DE CETTE TÂCHE ────────────────────────────────────────
 *
 * La double carte arrive en T15 ; les extractions (T14) vivent dans `mg-panneau-extractions`. Le
 * rattachement d'un jeu à une campagne n'existe pas dans l'écran React : il n'est pas porté.
 */
@Component({
  selector: 'mg-etape-zones',
  imports: [
    ActionsJeuComponent, BibliothequeComponent, DilutionComponent, IconeComponent, KpiComponent, ModePlanComponent,
    PanneauExtractionsComponent, TableauClassesComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-[18px]' },
  template: `
    @if (atelier.etat() !== 'pret') {
      <p data-role="conseil" class="m-0 text-[11px] leading-[1.55] text-tertiary">{{ textes.conseil }}</p>
    }

    <section>
      <div class="mb-3 flex items-center gap-2 border-t border-subtle bg-elevated px-[14px] py-[10px]">
        <span aria-hidden="true" class="size-1.5 rounded-full bg-teal"></span>
        <h3 class="m-0 text-[12px] font-medium text-primary">Le jeu de zones</h3>
      </div>
      <div class="px-[2px]">
        @switch (atelier.etat()) {
          @case ('vide') {
            <div data-role="vide" class="px-[2px] py-[6px]">
              <p class="mt-0 mb-3 max-w-[620px] text-[12.5px] leading-[1.6] text-secondary">{{ textes.vide }}</p>
              <button type="button" data-role="construire" (click)="construire()"
                      class="inline-flex cursor-pointer items-center gap-[7px] rounded-[6px] border-fin border-teal bg-transparent px-4 py-2 text-[12px] font-medium text-teal">
                <mg-icone nom="calques" [taille]="13" />
                {{ textes.boutonConstruire }}
              </button>
              <p class="mt-[10px] mb-0 text-[11px] text-tertiary">{{ textes.aideConstruire }}</p>
            </div>
          }
          @case ('chargement') {
            <div data-role="construction" class="flex items-center gap-[10px] px-[2px] py-[18px]">
              <mg-icone nom="chargement" [taille]="15" class="animate-spin text-teal" />
              <span class="text-[11.5px] leading-[1.5] text-secondary">{{ textes.construction }}</span>
            </div>
          }
          @case ('echec') {
            <p role="status" data-role="echec" [class]="alerte">{{ atelier.erreur() ?? textes.echec }}</p>
          }
          @case ('pret') {
            @if (jeu(); as j) {
              <div class="mb-[14px] flex flex-wrap gap-[18px]">
                <mg-kpi data-role="visee" [valeur]="viseeTexte()" libelle="Population visée" note="habitants en zone" [taille]="22" />
                <mg-kpi data-role="utile" [valeur]="tauxTexte()" libelle="Taux d’utile" note="visée / achetée" accent [taille]="22" />
                <mg-kpi data-role="codes-postaux" [valeur]="retenusTexte()" libelle="Codes postaux" [note]="noteCodesPostaux()" [taille]="22" />
              </div>

              <mg-dilution [seuil]="seuil()" [visee]="visee()" [achetee]="achetee()"
                           (seuilChange)="regler({ seuil_couverture_cp: $event })" />

              <mg-tableau-classes [classes]="classes()" [poids]="poidsJeu()" [anneauxPar]="anneauxPar()"
                                  (poidsChange)="reglerPoids($event.classe, $event.valeur)" />

              <mg-mode-plan [mode]="modePlan()" (modeChange)="regler({ mode_plan: $event })" />

              <mg-actions-jeu [brouillon]="j.brouillon" [nom]="nomAffiche()" (nomChange)="nom.set($event)"
                              [description]="descriptionAffichee()" (descriptionChange)="description.set($event)"
                              [enregistrer]="enregistrer" [exporter]="exporter()" [erreur]="atelier.erreur()"
                              (dupliquer)="construire()" />
            }
          }
        }
      </div>
    </section>

    <!-- Une SECTION à part et non une ligne de plus dans les actions : extraire ne règle pas le jeu, ça en fige un
         état (OngletZones.tsx:360-370). La liste se relit quand le jeu est reconstruit (« construit_le »). -->
    <section>
      <div class="mb-3 flex items-center gap-2 border-t border-subtle bg-elevated px-[14px] py-[10px]">
        <span aria-hidden="true" class="size-1.5 rounded-full bg-teal"></span>
        <h3 class="m-0 text-[12px] font-medium text-primary">Extractions pour le custom bidding</h3>
      </div>
      <div class="px-[2px]">
        <mg-panneau-extractions [jeuId]="jeuExtractible()" [cleFraicheur]="jeu()?.construit_le ?? ''" />
      </div>
    </section>

    <section>
      <div class="mb-3 flex items-center gap-2 border-t border-subtle bg-elevated px-[14px] py-[10px]">
        <span aria-hidden="true" class="size-1.5 rounded-full bg-teal"></span>
        <h3 class="m-0 text-[12px] font-medium text-primary">Jeux enregistrés</h3>
      </div>
      <div class="px-[2px]">
        <mg-bibliotheque [jeux]="atelier.bibliotheque()" [etat]="atelier.etatBibliotheque()" [ouvert]="etatRisque.etat().jeu"
                         [enCoursId]="enCoursId()" (ouvrir)="ouvrir($event)" (supprimer)="supprimer($event)" />
      </div>
    </section>
  `,
})
export class EtapeZonesComponent {
  protected readonly atelier = inject(AtelierJeuxService);
  protected readonly etatRisque = inject(EtatRisqueService);
  private readonly donnees = inject(DonneesRisqueService);
  private readonly api = inject(JeuxZonesApi);

  protected readonly textes = TEXTES_ATELIER;
  protected readonly alerte = ALERTE;

  /** Nom et description d'un BROUILLON, saisis avant l'enregistrement (locaux, comme React). */
  protected readonly nom = signal('');
  protected readonly description = signal('');
  /** Le jeu en cours de suppression dans la bibliothèque. */
  protected readonly enCoursId = signal<string | null>(null);

  protected readonly jeu = computed(() => this.atelier.detail()?.jeu ?? null);
  /** L'identifiant d'un jeu ENREGISTRÉ ; `null` pour un brouillon ou sans jeu — on n'extrait pas un sans-nom. */
  protected readonly jeuExtractible = computed(() => {
    const j = this.jeu();
    return j && !j.brouillon ? j.id : null;
  });
  protected readonly classes = computed(() => this.atelier.detail()?.classes ?? []);
  /** Les poids du jeu ; un jeu sans poids enregistré vaut « 1 partout » (`OngletZones.tsx:326`). */
  protected readonly poidsJeu = computed<Record<string, number>>(() => this.jeu()?.poids ?? {});
  protected readonly anneauxPar = computed(() => anneauxParNiveau(this.donnees.profilCalcul()));

  protected readonly visee = computed(() => this.classes().reduce((t, c) => t + c.population_en_zone_retenue, 0));
  protected readonly achetee = computed(() => this.classes().reduce((t, c) => t + c.population_achetee, 0));
  private readonly retenus = computed(() => this.classes().reduce((t, c) => t + c.n_cp_retenus, 0));
  private readonly touches = computed(() => this.classes().reduce((t, c) => t + c.n_cp, 0));
  protected readonly viseeTexte = computed(() => formaterNombre(Math.round(this.visee())));
  /** `—` quand rien n'est acheté : un 0 % se lirait « on paie pour ne viser personne ». */
  protected readonly tauxTexte = computed(() => (this.achetee() > 0
    ? `${formaterDecimal((100 * this.visee()) / this.achetee())} %` : '—'));
  protected readonly retenusTexte = computed(() => formaterNombre(this.retenus()));
  protected readonly noteCodesPostaux = computed(() => `sur ${formaterNombre(this.touches())} touchés`);
  protected readonly seuil = computed(() => Number(this.jeu()?.seuil_couverture_cp ?? 20));
  protected readonly modePlan = computed<ModePlan>(() => (this.jeu()?.mode_plan as ModePlan | undefined) ?? 'pondere');
  protected readonly nomAffiche = computed(() => {
    const j = this.jeu();
    return !j || j.brouillon ? this.nom() : j.nom;
  });
  protected readonly descriptionAffichee = computed(() => {
    const j = this.jeu();
    return !j || j.brouillon ? this.description() : (j.description ?? '');
  });
  /** L'export d'un jeu ENREGISTRÉ seulement : on n'exporte pas un sans-nom. */
  protected readonly exporter = computed<(() => Observable<HttpResponse<Blob>>) | null>(() => {
    const j = this.jeu();
    if (!j || j.brouillon) return null;
    const id = j.id;
    return () => this.api.exportJeu(id);
  });

  /**
   * Le jeu, sous la forme que l'API attend (`OngletZones.tsx:159-169`). Le territoire est le DÉPARTEMENT du fil
   * d'Ariane, jamais la région (`AnalysePopulationOverlay.tsx:1346-1352`) : `construire_zone_set` filtre sur
   * `code_departement`, et un code de région ne lèverait pas — il ne trouverait aucun carreau, et le jeu serait vide.
   */
  private readonly jeuCourant = computed<JeuDeZones>(() => {
    const d = this.atelier.detail()?.jeu;
    const e = this.etatRisque.etat();
    return {
      profil: this.donnees.profilCalcul(),
      cible: e.cible,
      gravites: e.gravites,
      natures: this.donnees.natures(),
      modes: ['buffer', 'pprt'],
      territoire: this.donnees.chemin().find((s) => s.niveau === 'departement')?.code ?? null,
      mode_plan: (d?.mode_plan as ModePlan | undefined) ?? 'pondere',
      seuil_couverture_cp: d?.seuil_couverture_cp ?? 20,
      poids: d?.poids ?? {},
    };
  });

  constructor() {
    this.atelier.assurerBibliotheque();
    // Un jeu nommé dans l'URL s'ouvre tout seul — à l'ouverture comme à chaque changement de l'URL. Le service garde
    // le dernier identifiant demandé : un échec n'est pas redemandé en boucle.
    effect(() => {
      const id = this.etatRisque.etat().jeu;
      untracked(() => this.atelier.ouvrirDepuisUrl(id));
    });
  }

  /**
   * Construire (ou « Dupliquer depuis le profil courant ») ouvre un BROUILLON : le jeu nommé par l'URL n'est plus
   * celui qu'on regarde, l'URL le quitte. Défaut de React corrigé (mesuré au navigateur) : l'URL gardait le jeu, et
   * l'effet d'ouverture le rechargeait dès la fin de la construction — le brouillon disparaissait aussitôt construit.
   */
  protected construire(): void {
    this.atelier.construire(untracked(this.jeuCourant));
    if (untracked(this.etatRisque.etat).jeu) this.etatRisque.maj({ jeu: null });
  }

  protected ouvrir(id: string): void {
    this.atelier.ouvrir(id);
    this.etatRisque.maj({ jeu: id });
  }

  protected regler(champs: Parameters<AtelierJeuxService['regler']>[0]): void {
    void this.atelier.regler(champs);
  }

  protected reglerPoids(classe: string, valeur: number): void {
    void this.atelier.regler({ poids: { ...this.poidsJeu(), [classe]: valeur } });
  }

  /** Lu par `mg-actions-jeu` : une fonction stable, attendue jusqu'à la réponse. */
  protected readonly enregistrer = async (): Promise<void> => {
    const brouillon = this.jeu()?.brouillon ?? false;
    const ok = await this.atelier.regler({
      nom: brouillon ? this.nom() : undefined,
      description: brouillon ? (this.description() || null) : undefined,
      enregistrer: true,
    });
    if (ok) {
      this.nom.set('');
      this.description.set('');
    }
  };

  protected async supprimer(id: string): Promise<void> {
    this.enCoursId.set(id);
    await this.atelier.supprimer(id);
    this.enCoursId.set(null);
    if (this.etatRisque.etat().jeu === id) this.etatRisque.maj({ jeu: null });
  }
}
