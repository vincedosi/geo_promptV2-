const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');

/**
 * Contrat de fédération AIDA (doc « Création d'une Remote App », §4.5).
 * `name` : identifiant technique du remote dans la fédération. ⚠ À aligner sur
 * le nom attendu par AIDA quand le siège l'aura fourni (avec le slug).
 * `exposes./Routes` : c'est CE module que le shell importe — il contient
 * `remoteRoutes`, dont la forme ne change pas sans concertation.
 */
module.exports = withNativeFederation({
  name: 'magelian',

  exposes: {
    './Routes': './src/app/app.routes.ts',
  },

  shared: {
    ...shareAll({ singleton: true, strictVersion: false, requiredVersion: 'auto' }),
  },

  skip: [
    'rxjs/ajax',
    'rxjs/fetch',
    'rxjs/testing',
    'rxjs/webSocket',
  ],

  features: {
    ignoreUnusedDeps: true,
  },
});
