import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Subject, type Subscription } from 'rxjs';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { poserApercuZone, retirerApercuZone } from '../couches/apercu-zone';
import { cadrerSiHorsVue } from '../couches/marge-carte';
import { RECADRAGE_ZONE } from '../couches/zones-custom.service';
import { type ApercuZone, ZonesApi } from '../data/zones.api';
import { MESSAGE_REPONSE_PERDUE, estReponsePerdue } from '../logique/zones/gestes-zone';
import { messageErreurZone } from '../logique/zones/perimetre-recette';
import { bboxDeGeometrie } from '../logique/zones/zones-affichees';
import { MESSAGES_REFUS, estRecalculable, refusPerimetreLocal, type Recette } from '../logique/zones/recette';
import { CouchesCarteService, quandStyleCharge } from './couches-carte.service';

type EchecHttp = { status?: number; error?: unknown };

/**
 * Le recadrage sur l'aperçu : celui d'une zone custom affichée, borné au zoom 14 (comme les campagnes OOH) — une petite
 * forme ne plonge pas au niveau de la rue.
 */
const RECADRAGE_APERCU = { ...RECADRAGE_ZONE, maxZoom: 14 } as const;

/**
 * L'atelier de l'étape ③ (lot 3) : une recette → un aperçu dessiné → une zone enregistrée. Fourni par
 * `mg-panneau-zones` (qui reste MONTÉ entre les étapes : l'aperçu survit à ③ → ① → ③) ; un changement d'espace
 * recrée la page, donc l'atelier (spec droits § 4.1) — sa destruction coupe la requête en vol : aucune réponse de
 * l'ancien espace n'arrive ici.
 *
 * Un aperçu en remplace un autre : l'abonnement précédent est COUPÉ (Review Focus 4). Une recette lourde sans
 * périmètre est refusée avant tout appel. « Enregistrer » envoie la RECETTE : le serveur la rejoue (L3-4) ; seule une
 * forme figée envoie sa géométrie.
 *
 * ⚠ `POST /api/zones` n'est PAS idempotent (deux envois, deux zones — revue de la Task 8). Une écriture en vol n'est
 * donc jamais coupée ni doublée : un second « Enregistrer », un nouvel aperçu ou « Effacer » sont ignorés jusqu'à sa
 * réponse. Un 207 est une RÉUSSITE (la zone existe, seuls ses codes postaux n'ont pas été résolus) : jamais renvoyée,
 * l'atelier est vidé comme après un 200. Une réponse PERDUE (statut 0) ou un 2xx sans `zone_id` vident aussi l'atelier
 * (la zone existe peut-être) et renvoient à « Mes zones » avant tout nouvel essai.
 *
 * ③ finitions (T6) : un aperçu reçu recadre la carte sur SON emprise (lue dans la réponse déjà reçue, aucune requête),
 * seulement si la forme n'est pas entièrement visible hors des panneaux (A-8) — jamais deux fois pour la même emprise.
 * Le message de réussite s'oublie au changement de formulaire, de famille ou de recette (`oublierMessage`, A-9).
 */
@Injectable()
export class AtelierZoneService {
  private readonly api = inject(ZonesApi);
  private readonly couches = inject(CouchesCarteService);
  private readonly couleurs = inject(CouleursService).palette({ teal: 'brand-teal' });

  readonly recette = signal<Recette | null>(null);
  readonly apercu = signal<ApercuZone | null>(null);
  readonly enCours = signal(false);
  readonly erreur = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  /** L'identifiant de chaque zone écrite : « Mes zones » se relit. */
  readonly zoneCreee = new Subject<string>();
  /**
   * Après un 207 : la zone écrite dont les codes postaux n'ont pas été résolus, et si sa recette se recalcule — le pied
   * propose alors « Mes zones » (le recalcul), jamais un second envoi. Vidée au prochain aperçu ou à « Effacer ».
   */
  readonly nonResolue = signal<{ id: string; recalculable: boolean } | null>(null);

  private geometrieFigee: GeoJSON.Geometry | undefined;
  private volApercu: Subscription | null = null;
  private volEcriture: Subscription | null = null;
  /** L'emprise du dernier aperçu reçu : un aperçu identique ne recadre plus (A-8). */
  private derniereEmprise: string | null = null;

  constructor() {
    inject(ChargementService).suivre('atelier-zone', 'Calcul de la zone…', () => this.enCours());
    // Dessin de l'aperçu : suit la forme ET la carte courante (un changement de fond recrée les couches).
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const a = this.apercu();
      if (!carte) return;
      // La couleur n'est lue QUE s'il y a un aperçu à peindre (elle reste suivie : un changement de thème le repeint) :
      // lue d'office, elle levait au montage de ③ quand les jetons ne sont pas encore résolus (relevé en T10).
      const teal = a ? this.couleurs().teal : '';
      const annuler = untracked(() => quandStyleCharge(carte, () => (a ? poserApercuZone(carte, a.geometry, teal) : retirerApercuZone(carte))));
      nettoyer(annuler);
    });
    inject(DestroyRef).onDestroy(() => {
      this.volApercu?.unsubscribe();
      this.volEcriture?.unsubscribe();
      const carte = this.couches.carteCourante();
      if (carte) retirerApercuZone(carte);
    });
  }

  private ecritureEnVol(): boolean {
    return this.volEcriture !== null && !this.volEcriture.closed;
  }

  apercevoir(recette: Recette, geometrie?: GeoJSON.Geometry): void {
    if (this.ecritureEnVol()) return;
    this.volApercu?.unsubscribe();
    this.recette.set(recette);
    this.geometrieFigee = geometrie;
    this.apercu.set(null);
    this.message.set(null);
    this.nonResolue.set(null);
    const refus = refusPerimetreLocal(recette);
    if (refus) {
      this.erreur.set(MESSAGES_REFUS[refus]);
      this.enCours.set(false);
      return;
    }
    this.erreur.set(null);
    this.enCours.set(true);
    this.volApercu = this.api.apercu(geometrie ? { recette, geometrie } : { recette }).subscribe({
      next: (a) => { this.apercu.set(a); this.enCours.set(false); this.recadrer(a); },
      error: (e: EchecHttp) => { this.erreur.set(messageErreurZone(e)); this.enCours.set(false); },
    });
  }

  /** Cadre la carte sur la forme reçue si elle est hors de la partie libre ; pas sans carte, pas deux fois la même. */
  private recadrer(a: ApercuZone): void {
    const carte = this.couches.carteCourante();
    const b = bboxDeGeometrie(a.geometry);
    if (!carte || !b) return;
    const cle = b.join(',');
    if (cle === this.derniereEmprise) return;
    this.derniereEmprise = cle;
    cadrerSiHorsVue(carte, [[b[0], b[1]], [b[2], b[3]]], RECADRAGE_APERCU);
  }

  /** Efface le message de réussite (A-9) et le renvoi d'un 207 qui l'accompagne ; l'erreur et l'aperçu restent. */
  oublierMessage(): void {
    this.message.set(null);
    this.nonResolue.set(null);
  }

  enregistrer(nom: string): void {
    const recette = this.recette();
    const n = nom.trim();
    if (!recette || !this.apercu() || n.length === 0 || this.enCours() || this.ecritureEnVol()) return;
    this.enCours.set(true);
    this.erreur.set(null);
    const corps = this.geometrieFigee ? { nom: n, recette, geometrie: this.geometrieFigee } : { nom: n, recette };
    this.volEcriture = this.api.enregistrer(corps).subscribe({
      next: (r) => {
        this.enCours.set(false);
        const b = r.body;
        // Une réussite sans identifiant : on ne sait pas si la zone existe — traitée comme une réponse perdue.
        if (!b?.zone_id) { this.reponsePerdue(); return; }
        const cp = b.count_cp ?? 0;
        this.message.set(r.status === 207
          ? (b.message ?? 'Zone créée ; ses codes postaux n’ont pas pu être résolus.')
          : `Zone « ${n} » enregistrée — ${cp} ${cp > 1 ? 'codes postaux touchés' : 'code postal touché'}.`);
        this.nonResolue.set(r.status === 207 ? { id: b.zone_id, recalculable: estRecalculable(recette) } : null);
        // Un second clic ne doit pas créer un doublon : l'aperçu et la recette sont vidés (le message reste).
        this.vider();
        this.zoneCreee.next(b.zone_id);
      },
      error: (e: EchecHttp) => {
        this.enCours.set(false);
        // Statut 0, 502, 504 : la requête est peut-être arrivée, la zone peut-être écrite — jamais de second envoi à l'aveugle.
        if (estReponsePerdue(e)) { this.reponsePerdue(); return; }
        // Un refus HTTP n'a rien écrit : l'aperçu reste, l'utilisateur peut réessayer.
        this.erreur.set(messageErreurZone(e, 'Enregistrement impossible.'));
      },
    });
  }

  private vider(): void {
    this.recette.set(null);
    this.apercu.set(null);
    this.geometrieFigee = undefined;
    this.derniereEmprise = null;
  }

  /** On ne sait pas si la zone a été écrite : l'atelier est vidé (aucun second envoi), le message renvoie à « Mes zones ». */
  private reponsePerdue(): void {
    this.erreur.set(MESSAGE_REPONSE_PERDUE);
    this.vider();
  }

  effacer(): void {
    if (this.ecritureEnVol()) return;
    this.volApercu?.unsubscribe();
    this.recette.set(null);
    this.apercu.set(null);
    this.erreur.set(null);
    this.message.set(null);
    this.nonResolue.set(null);
    this.enCours.set(false);
    this.geometrieFigee = undefined;
    this.derniereEmprise = null;
  }
}
