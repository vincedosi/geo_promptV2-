import { Injectable, signal } from '@angular/core';
import type { FiltreStations } from '../data/radio-admin.api';

/**
 * Les réglages des onglets Radios et Statistiques (lot 6, T17), que `app/admin/radio/page.tsx` tient au
 * niveau de la PAGE (`radiosPage`, `radiosSearch`, `radiosFilter`, `auditCatFilter`, `auditDiagFilter`,
 * `auditFreqMin`, `auditSearch`, l.111-140) : ils survivent à un passage par un autre onglet. Fourni par
 * `RadioPage`, détruit avec elle. Aucune donnée ici — chaque onglet RELIT la sienne à son ouverture, comme
 * React (`useEffect` sur `tab`, l.336-337).
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
}
