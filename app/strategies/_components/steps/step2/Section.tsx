'use client';

/**
 * Titre de section de l'étape 2 (pastille teal + tagline) — extrait de
 * Step2Geography.tsx (2026-09-08), JSX inchangé.
 */

import React from 'react';

export function Section({ title, tagline, children }: { title: string; tagline?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-[12px] font-medium text-text-primary mb-1">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-teal" />
        {title}
      </h3>
      {tagline && <p className="text-[11px] text-text-tertiary mb-3">{tagline}</p>}
      <div className={tagline ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}
