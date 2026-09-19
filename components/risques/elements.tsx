'use client';

import React from 'react';
import { fInter, fMono } from '@/lib/design/polices';

/**
 * Les briques de présentation de l'écran « population à risque ».
 *
 * ── POURQUOI ELLES SONT SORTIES ───────────────────────────────────────────
 *
 * `AnalysePopulationOverlay.tsx` faisait 1 534 lignes pour un seuil projet de
 * 300, et aucun test unitaire ne l'atteignait (constat R-07 de
 * `docs/AUDIT_ZONE_RISQUE.md`).
 *
 * Ce fichier n'emporte que ce qui est PUREMENT présentationnel : aucun état,
 * aucun appel réseau, aucune règle métier. C'est la seule partie qu'on peut
 * déplacer sans toucher au comportement.
 *
 * ⚠ Le corps de l'écran, lui, reste monolithique — dix-sept `useState` que
 * découper imposerait soit un contexte, soit un réducteur. Ce serait une
 * restructuration, pas un refactor à comportement constant : elle est laissée
 * à un arbitrage séparé plutôt que faite à la volée.
 */

/** Bouton qui se lit comme un lien : fond et bordure retires, accent teal. */
export const styleLien: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  fontFamily: fInter, fontSize: 10, color: 'var(--brand-teal)',
};

export function Champ({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>{label}</span>
      {children}
    </label>
  );
}

export function Pastille({
  actif, onClick, children, titre,
}: { actif: boolean; onClick: () => void; children: React.ReactNode; titre?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titre}
      aria-pressed={actif}
      style={{
        background: actif ? 'var(--brand-teal-10)' : 'transparent',
        border: `0.5px solid ${actif ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
        color: actif ? 'var(--brand-teal)' : 'var(--text-secondary)',
        borderRadius: 6, padding: '6px 11px', cursor: 'pointer',
        fontFamily: fInter, fontSize: 12,
        transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out)',
      }}
    >
      {children}
    </button>
  );
}


/**
 * Fil d'Ariane. Chaque segment franchi est cliquable pour y revenir ; le
 * dernier ne l'est pas, on y est deja.
 *
 * Le segment porte le NIVEAU en plus du nom (« Region Normandie »), parce que
 * 18 codes INSEE designent a la fois un departement et une region (sql/171) :
 * un fil qui afficherait « France entiere › 76 » ne dirait pas de quoi 76 est
 * le code. C'est le defaut que l'en-tete de `BarreMaille` (Suivi V2) signale
 * pour lui-meme.
 */
export function FilAriane({ chemin, maille, onRemonter }: {
  chemin: Array<{ niveau: 'region' | 'departement'; code: string; nom: string }>;
  maille: string;
  onRemonter: (n: number) => void;
}) {
  const LIB: Record<string, string> = { region: 'Région', departement: 'Département' };
  return (
    <nav aria-label="Fil d’Ariane" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <button
        type="button"
        onClick={() => onRemonter(0)}
        disabled={chemin.length === 0}
        style={{
          border: 0, background: 'none', padding: 0,
          fontFamily: fInter, fontSize: 12,
          cursor: chemin.length === 0 ? 'default' : 'pointer',
          color: chemin.length === 0 ? 'var(--text-primary)' : 'var(--brand-teal)',
          textDecoration: chemin.length === 0 ? 'none' : 'underline',
          textUnderlineOffset: 3,
        }}
      >
        France entière
      </button>
      {chemin.map((seg, i) => (
        <span key={seg.niveau + seg.code} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span aria-hidden style={{ color: 'var(--text-tertiary)' }}>&rsaquo;</span>
          <button
            type="button"
            onClick={() => onRemonter(i + 1)}
            disabled={i === chemin.length - 1}
            title={LIB[seg.niveau] + ' ' + seg.code}
            style={{
              border: 0, background: 'none', padding: 0,
              fontFamily: fInter, fontSize: 12,
              cursor: i === chemin.length - 1 ? 'default' : 'pointer',
              color: i === chemin.length - 1 ? 'var(--text-primary)' : 'var(--brand-teal)',
              textDecoration: i === chemin.length - 1 ? 'none' : 'underline',
              textUnderlineOffset: 3,
            }}
          >
            {seg.nom}
          </button>
        </span>
      ))}
      <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 2 }}>
        · {maille.toLowerCase()}
      </span>
    </nav>
  );
}

export function Th({ children, align = 'right', titre }: {
  children: React.ReactNode; align?: 'left' | 'right'; titre?: string;
}) {
  return (
    <th
      title={titre}
      style={{
        textAlign: align, padding: '6px 8px', fontWeight: 400,
        fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)',
        // Le pointillé signale qu'il y a une explication à survoler, sans
        // ajouter une icône de plus dans un en-tête déjà dense.
        ...(titre ? { borderBottom: '1px dotted var(--border-default)', cursor: 'help' } : null),
      }}
    >
      {children}
    </th>
  );
}

export function Td({ children, fort, dim }: { children: React.ReactNode; fort?: boolean; dim?: boolean }) {
  return (
    <td
      style={{
        textAlign: 'right', padding: '7px 8px',
        fontFamily: fMono, fontSize: 11,
        color: fort ? 'var(--text-primary)' : dim ? 'var(--text-tertiary)' : 'var(--text-secondary)',
      }}
    >
      {children}
    </td>
  );
}
