/**
 * Map configuration and design tokens
 */

// Color Palette - SaaS Premium Dark Mode
export const COLORS = {
  // Backgrounds
  bg: {
    primary: '#0a0a0a',    // Main background (#0a0a0a)
    secondary: '#1a1a1a',  // Secondary background
    tertiary: '#2d2d2d',   // Tertiary background
    overlay: 'rgba(10, 10, 10, 0.8)',
  },

  // Text
  text: {
    primary: '#ffffff',
    secondary: '#cbd5e1',
    tertiary: '#94a3b8',
  },

  // Accents
  accent: {
    blue: '#3b82f6',       // Primary action
    orange: '#f59e0b',     // Highlight/Warning
    red: '#ef4444',        // Danger/High density
    cyan: '#06b6d4',       // Info/Secondary
    green: '#10b981',      // Success
  },

  // Cluster density colors
  cluster: {
    low: '#3b82f6',        // Blue - Low density
    medium: '#f59e0b',     // Orange - Medium density
    high: '#ef4444',       // Red - High density
  },

  // Borders
  border: {
    light: '#2d2d2d',
    medium: '#475569',
    dark: '#1e293b',
  },
} as const;

// Initial Map Viewport (France)
export const INITIAL_VIEWPORT = {
  latitude: 46.6,
  longitude: 2.3,
  zoom: 5.5,
  bearing: 0,
  pitch: 0,
} as const;

// Map Bounds
export const MAP_BOUNDS = {
  minZoom: 3,
  maxZoom: 18,
} as const;

// Clustering Configuration
export const CLUSTERING_CONFIG = {
  maxZoom: 17,
  radius: 40,  // pixels
  minPoints: 2,
} as const;

// Animation Durations
export const TRANSITIONS = {
  map: 500,      // Map zoom/pan animation in ms
  filter: 300,   // Filter change debounce in ms
  hover: 200,    // Hover effect in ms
  resize: 300,   // Window resize debounce in ms
} as const;

// Panel Types for filtering
export const PANEL_TYPES = [
  { value: '4x3', label: '4x3' },
  { value: '2m2', label: '2m²' },
  { value: 'numérique', label: 'Numérique' },
  { value: 'abribus', label: 'Abribus' },
  { value: 'grand_format', label: 'Grand Format' },
  { value: 'digital', label: 'Digital' },
  { value: 'traditional', label: 'Traditionnel' },
] as const;

// Régie operator color mapping
export const REGIE_COLORS = {
  'MULTI': '#ef4444',         // Red
  'JCDecaux': '#3b82f6',      // Blue
  'Décaux': '#3b82f6',        // Blue (variant)
  'ClearChannel': '#10b981',  // Green
  'Clear Channel': '#10b981', // Green (with space)
  'Decaux': '#3b82f6',        // Blue (another variant)
  'default': '#f59e0b',       // Orange fallback
} as const;

// Format size mapping (pixels for circle radius)
export const FORMAT_SIZES = {
  '4x3': 10,
  '2m2': 12,
  '2m²': 12,
  'digital': 14,
  'numérique': 14,
  'abribus': 8,
  'grand_format': 16,
  'traditional': 10,
  'default': 10,
} as const;

// CartoDB Positron - Ultra léger, juste les rues (gratuit, sans clé API)
export const MAP_STYLE = {
  version: 8 as const,
  sources: {
    carto: {
      type: 'raster' as const,
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    },
  },
  layers: [
    {
      id: 'carto-tiles',
      type: 'raster' as const,
      source: 'carto',
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

// Alias pour compatibilité
export const DARK_MAP_STYLE = MAP_STYLE;

// Sidebar Configuration
export const SIDEBAR_CONFIG = {
  width: 280,        // pixels
  collapsible: true,
  defaultCollapsed: false,
} as const;

// Mobile Breakpoints
export const BREAKPOINTS = {
  mobile: 640,
  tablet: 768,
  desktop: 1024,
} as const;

// Search Configuration
export const SEARCH_CONFIG = {
  debounce: 300,
  minChars: 2,
  maxResults: 10,
} as const;

// Z-index layers (from lowest to highest)
export const Z_INDEX = {
  mapContainer: 0,
  mapOverlay: 1,
  sidebar: 2,
  searchBar: 3,
  controls: 4,
  popup: 5,
  modal: 6,
} as const;
