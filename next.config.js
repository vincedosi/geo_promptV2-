/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Allow large request bodies — needed for multi-GB carreaux imports
  experimental: {
    serverActions: {
      bodySizeLimit: '10gb',
    },
    instrumentationHook: true,
  },
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
