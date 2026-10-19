import { Injectable, signal } from '@angular/core';
import type { AuditRadio, FiltreStations, StationRadio } from '../data/radio-admin.api';

/** Dernière page de radios lue, et les réglages qui l'ont produite (`page|filtre|recherche`). */
export interface StationsGardees {
  cle: string;
  stations: StationRadio[];
  total: number;
}

/**
 * Les réglages des onglets Radios et Statistiques (lot 6, T17), que `app/admin/radio/page.tsx` tient au
 * niveau de la PAGE (`radiosPage`, `radiosSearch`, `radiosFilter`, `auditCatFilter`, `auditDiagFilter`,
 * `auditFreqMin`, `auditSearch`, l.111-140) : ils survivent à un passage par un autre onglet. Fourni par
 * `RadioPage`, détruit avec elle.
 *
 * Garde aussi le dernier RÉSULTAT de chaque onglet (vague finale, I-3 / Q-3) : React relisait à chaque
 * ouverture d'onglet (`useEffect` sur `tab`, l.336-337) — `count_emetteurs_par_radio` ≈ 407 000 buffers par
 * page de radios, `get_radio_audit` ≈ 1,4 s. Un onglet ne relit donc qu'à sa première ouverture, quand ses
 * réglages ont changé, sur « Rafraîchir », ou après un import terminé ou une suppression (`invalider`).
 */
@Injectable()
export class RadioOngletsService {
  readonly recherche = signal('');
  readonly page = signal(1);
  readonly filtre = signal<FiltreStations>('all');

  readonly auditCategorie = signal('');
  readonly auditDiagnostic = signal('');
  readonly auditFrequencesMin = signal(0);
  readonly auditRecherche = signal('');

  /** Dernière page de radios lue (onglet Radios). */
  readonly stations = signal<StationsGardees | null>(null);
  /** Dernier audit lu (onglet Statistiques). */
  readonly audit = signal<AuditRadio | null>(null);

  /** Clé des réglages courants de l'onglet Radios. */
  cleStations(): string {
    return `${this.page()}|${this.filtre()}|${this.recherche()}`;
  }

  /** Les données ont changé (import terminé, suppression) : les deux onglets reliront à leur prochaine ouverture. */
  invalider(): void {
    this.stations.set(null);
    this.audit.set(null);
  }
}
