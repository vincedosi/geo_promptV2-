'use client';

/**
 * Éléments partagés par les étapes du wizard d'import universel — extraits de
 * page.tsx (2026-09-03). Tokens et constantes déplacés tels quels, aucune
 * valeur modifiée.
 */

import React from 'react';
import type { FieldMapping, GeoMode } from '@/lib/import/types';

export const C = {
  bg: 'var(--bg-primary)', bgElevated: 'var(--bg-surface)', bgSurface: 'var(--bg-level-2)',
  border: 'var(--border-subtle)', borderLight: 'var(--brand-teal-30)',
  accent: 'var(--brand-teal)', accentDim: 'var(--brand-teal-10)',
  text: 'var(--text-primary)', textDim: 'var(--text-secondary)', textSec: 'var(--text-tertiary)', muted: '#505050',
  green: 'var(--success)', greenDim: 'rgba(61,255,160,0.12)',
  red: '#f87171', redDim: 'rgba(248,113,113,0.1)',
  warn: '#fbbf24', warnDim: 'rgba(251,191,36,0.1)', blue: '#3b82f6',
};

export const fontMono = "'JetBrains Mono',monospace";
export const fontInter = "'Inter',system-ui,sans-serif";

/** Mapping colonne fichier → champ GENESIS, indexable par clé dynamique. */
export interface MappingState extends FieldMapping {
  [key: string]: string | undefined;
}

/** Modes de géolocalisation proposés à l'étape 3. */
export const GEO_MODES: { val: GeoMode; title: string; desc: string }[] = [
  { val: 'gps', title: 'GPS direct', desc: 'Colonnes latitude / longitude deja presentes' },
  { val: 'address', title: 'Geocodage adresse', desc: 'Adresse → coordonnees via API BAN (gratuit)' },
  { val: 'lambert93', title: 'Lambert 93 (X, Y)', desc: 'Coordonnees projetees EPSG:2154 → WGS84' },
];

/** Champs POI cibles du mapping standard (les catégories viennent de la base). */
export const GENESIS_FIELDS_POI = [
  { key: 'nom', label: 'Nom', required: false },
  { key: 'adresse', label: 'Adresse', required: false },
  { key: 'ville', label: 'Ville', required: false },
  { key: 'code_postal', label: 'Code postal', required: false },
  { key: 'departement', label: 'Departement', required: false },
  { key: 'region', label: 'Region', required: false },
];

export function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite', display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
