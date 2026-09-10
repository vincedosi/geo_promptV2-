/** @type {import('next').NextConfig} */

const securityHeaders = [
  { key: 'X-Frame-Options',           value: 'DENY' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Scripts : 'unsafe-eval' requis par MapLibre GL JS (WebAssembly / Worker init)
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      // Styles : Google Fonts + inline styles (design system terminal)
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // Polices Google Fonts
      "font-src 'self' https://fonts.gstatic.com",
      // Images : tiles OpenFreeMap + Supabase Storage + data URIs + blobs PMTiles
      "img-src 'self' data: blob: https://tiles.openfreemap.org https://*.supabase.co",
      // Connexions API : Supabase (REST+Realtime), ORS, Mistral, Gemini, BAN, data.gouv.fr, tiles
      [
        "connect-src 'self'",
        "https://*.supabase.co",
        "wss://*.supabase.co",
        "https://api.openrouteservice.org",
        "https://api.mistral.ai",
        "https://generativelanguage.googleapis.com",
        "https://tiles.openfreemap.org",
        "https://api-adresse.data.gouv.fr",
        "https://static.data.gouv.fr",
        "https://data.gouv.fr",
        "https://files.data.gouv.fr",
        "https://www.insee.fr",
        "https://github.com",
        "https://objects.githubusercontent.com",
      ].join(' '),
      // Web Workers MapLibre (blob: URL générée dynamiquement)
      "worker-src 'self' blob:",
      // Iframes interdites
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  // Pas de bloc `experimental` : les deux cles qui s'y trouvaient sont parties
  // au passage a Next 15 (2026-09-10).
  //
  //  - `instrumentationHook: true` — `instrumentation.ts` est charge nativement
  //    depuis Next 15. La clef est desormais refusee ("Unrecognized key").
  //
  //  - `serverActions.bodySizeLimit: '50mb'` — etait commente « needed for
  //    multi-GB carreaux imports », ce qui etait faux. `bodySizeLimit` ne
  //    plafonne QUE les Server Actions, et ce projet n'en declare aucune
  //    (`grep "use server"` ne renvoie rien). Les gros imports passent par des
  //    route handlers — `/api/admin/import-geo`, `/api/admin/campaigns/import`
  //    — qui lisent la requete en flux et n'ont pas de limite configurable en
  //    App Router. Le reglage n'avait donc aucun effet.
  //    Si une Server Action est ajoutee un jour, sa limite retombera a 1 Mo :
  //    c'est a ce moment-la qu'il faudra remettre la clef, pas avant.
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // ATTENTION : cette regle ne s'applique qu'a webpack. Turbopack devient le
  // bundler de build par defaut en Next 16 — il faudra revalider /map a ce
  // moment-la, le crash decrit ci-dessous reapparaitrait sinon.
  webpack: (config) => {
    // maplibre-gl v5 ships a pre-built UMD bundle (dist/maplibre-gl.js)
    // but its package.json declares "type": "module".
    // Webpack therefore force-treats every .js inside the package as ESM,
    // SWC re-transpiles the bundle, emitting _define_property helpers that
    // are never injected → runtime crash.
    // Fix: tell webpack the dist files are auto-detect (UMD/CJS), not ESM.
    config.module.rules.push({
      test: /node_modules[\\/]maplibre-gl[\\/]dist[\\/].*\.js$/,
      type: 'javascript/auto',
    });
    return config;
  },
};

module.exports = nextConfig;
