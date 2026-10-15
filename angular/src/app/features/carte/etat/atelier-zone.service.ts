import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Subject, type Subscription } from 'rxjs';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { poserApercuZone, retirerApercuZone } from '../couches/apercu-zone';
import { type ApercuZone, ZonesApi } from '../data/zones.api';
import { messageErreurZone } from '../logique/zones/perimetre-recette';
import { MESSAGES_REFUS, refusPerimetreLocal, type Recette } from '../logique/zones/recette';
import { CouchesCarteService, quandStyleCharge } from './couches-carte.service';

type EchecHttp = { status?: number; error?: unknown };

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
 * l'atelier est vidé comme après un 200.
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

  private geometrieFigee: GeoJSON.Geometry | undefined;
  private volApercu: Subscription | null = null;
  private volEcriture: Subscription | null = null;

  constructor() {
    inject(ChargementService).suivre('atelier-zone', 'Calcul de la zone…', () => this.enCours());
    // Dessin de l'aperçu : suit la forme ET la carte courante (un changement de fond recrée les couches).
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const a = this.apercu();
      const teal = this.couleurs().teal;
      if (!carte) return;
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
    const refus = refusPerimetreLocal(recette);
    if (refus) {
      this.erreur.set(MESSAGES_REFUS[refus]);
      this.enCours.set(false);
      return;
    }
    this.erreur.set(null);
    this.enCours.set(true);
    this.volApercu = this.api.apercu(geometrie ? { recette, geometrie } : { recette }).subscribe({
      next: (a) => { this.apercu.set(a); this.enCours.set(false); },
      error: (e: EchecHttp) => { this.erreur.set(messageErreurZone(e)); this.enCours.set(false); },
    });
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
        if (!b?.zone_id) { this.erreur.set('Enregistrement de la zone impossible.'); return; }
        const cp = b.count_cp ?? 0;
        this.message.set(r.status === 207
          ? (b.message ?? 'Zone créée ; ses codes postaux n’ont pas pu être résolus.')
          : `Zone « ${n} » enregistrée — ${cp} ${cp > 1 ? 'codes postaux touchés' : 'code postal touché'}.`);
        // Un second clic ne doit pas créer un doublon : l'aperçu et la recette sont vidés (le message reste).
        this.recette.set(null);
        this.apercu.set(null);
        this.geometrieFigee = undefined;
        this.zoneCreee.next(b.zone_id);
      },
      // L'aperçu reste : l'utilisateur peut réessayer (un échec HTTP n'a rien écrit, sauf coupure réseau — dite « injoignable »).
      error: (e: EchecHttp) => { this.erreur.set(messageErreurZone(e)); this.enCours.set(false); },
    });
  }

  effacer(): void {
    if (this.ecritureEnVol()) return;
    this.volApercu?.unsubscribe();
    this.recette.set(null);
    this.apercu.set(null);
    this.erreur.set(null);
    this.message.set(null);
    this.enCours.set(false);
    this.geometrieFigee = undefined;
  }
}
