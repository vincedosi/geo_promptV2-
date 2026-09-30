import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DemarrageService } from '../core/demarrage/demarrage.service';

/**
 * Racine de `remoteRoutes` — le « BuilderShell » de la doc AIDA : le premier
 * composant que le shell monte. Il n'affiche ses enfants qu'une fois
 * l'application démarrée ; sinon un message, JAMAIS un écran blanc — et
 * surtout jamais un remplacement du `<body>`, qui effacerait le shell.
 */
@Component({
  selector: 'mg-racine-distante',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (demarrage.erreur(); as message) {
      <p role="alert" class="m-6 rounded border border-danger bg-surface p-4 text-sm text-danger">{{ message }}</p>
    } @else {
      <router-outlet />
    }
  `,
})
export class RacineDistanteComponent {
  protected readonly demarrage = inject(DemarrageService);
}
