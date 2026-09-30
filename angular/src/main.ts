import { initFederation } from '@angular-architects/native-federation';
import { afficherErreurDemarrage } from './app/core/demarrage/erreur-demarrage';

initFederation()
  .catch((err) => console.error(err))
  .then((_) => import('./bootstrap'))
  .catch((err) => {
    console.error(err);
    afficherErreurDemarrage(err, document);
  });
