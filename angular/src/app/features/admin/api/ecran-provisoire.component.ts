import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Écran PROVISOIRE des sous-onglets « TikTok » et « Logs » de Connexions API, jusqu'à T10 qui porte
 * `app/admin/api/tiktok/page.tsx` et `app/admin/api/logs/page.tsx` (plan du lot 6, Task 9 : « `tiktok`
 * et `logs` provisoires jusqu'à T10 »). Les sous-onglets restent affichés parce qu'ils font partie de
 * l'écran React recopié (`layout.tsx`) ; les deux pages React restent atteignables pendant ce temps.
 * Même patron que la page `health` provisoire de T1, remplacée en T3.
 */
@Component({
  selector: 'mg-ecran-provisoire',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-provisoire class="m-0 text-[13px] text-secondary" role="status">Disponible prochainement.</p>`,
})
export class EcranProvisoireComponent {}
