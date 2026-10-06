import { ChangeDetectionStrategy, Component } from '@angular/core';
import { EntetePageComponent } from '../../../ui/entete-page/entete-page.component';

/**
 * Page PROVISOIRE du Health check (lot 6, T1) : la redirection `admin` → `admin/health` doit
 * mener quelque part dès le socle. Remplacée par le portage de `app/admin/health/page.tsx` en T3.
 * Aucun appel d'API.
 */
@Component({
  selector: 'mg-health',
  imports: [EntetePageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mg-entete-page titre="Health check" />
    <p class="m-0 text-[13px] text-tertiary">Disponible prochainement</p>
  `,
})
export class HealthPage {}
