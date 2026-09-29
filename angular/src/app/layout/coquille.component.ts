import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { ThemeService } from '../core/theme/theme.service';

/** Barre latérale MAGELIAN (DESIGN_SYSTEM.md § 6) autour des pages métier. */
@Component({
  selector: 'mg-coquille',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './coquille.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoquilleComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly email = this.auth.email;
  protected readonly theme = inject(ThemeService);

  protected async deconnecter(): Promise<void> {
    await this.auth.deconnecter();
    await this.router.navigateByUrl('/connexion');
  }
}
