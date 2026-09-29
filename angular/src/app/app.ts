import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'mg-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  // Instancié ici pour que le thème s'applique dès le premier écran,
  // connexion comprise.
  private readonly theme = inject(ThemeService);
}
