import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { afficherErreurDemarrage } from './app/core/demarrage/erreur-demarrage';

bootstrapApplication(App, appConfig)
  .catch((err) => {
    console.error(err);
    afficherErreurDemarrage(err, document);
  });
