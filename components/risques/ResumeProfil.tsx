'use client';

/**
 * Le résumé du profil de rayons, en chips cliquables.
 *
 * ── POURQUOI IL EST DANS LA BARRE DE FILTRES ──────────────────────────────
 *
 * Le profil décide de la classe de chaque carreau, donc de TOUS les chiffres de
 * l'écran. Le laisser dans le seul onglet « Rayons » ferait lire un tableau de
 * territoires sans savoir sur quels anneaux il a été calculé — et deux captures
 * d'écran du même territoire, prises avec deux profils, seraient
 * indiscernables.
 *
 * Cliquer une chip ramène à l'atelier qui l'a produite : le résumé n'est pas
 * qu'un affichage, c'est le chemin de retour vers le réglage.
 */
import React from 'react';
import {
  anneauxDuNiveau, LIBELLE_NIVEAU, NIVEAUX, libelleRayon, type ProfilRayons,
} from '@/lib/risques/profil';
import { classesDuProfil, HORS_ZONE } from '@/lib/risques/affectation';
import { fInter, fMono } from '@/lib/design/polices';

interface Props {
  profil: ProfilRayons;
  /** Ramène à l'atelier de réglage. */
  onOuvrirAtelier: () => void;
}

/**
 * Les chips « Seveso seuil haut : 1 · 2 · 5 km ».
 *
 * Un niveau sans anneau n'apparaît pas : une chip vide se lirait « aucun
 * habitant à ce niveau », alors qu'elle signifie « ce niveau n'est pas
 * calculé ». Les deux ne se confondent pas.
 */
export function ResumeProfil({ profil, onOuvrirAtelier }: Props) {
  const lignes = NIVEAUX
    .map((niveau) => ({ niveau, anneaux: anneauxDuNiveau(profil, niveau) }))
    .filter(({ anneaux }) => anneaux.length > 0);

  // Le hors-zone n'est pas un réglage : on ne compte que les classes réglées.
  const nClasses = classesDuProfil(profil).filter((c) => c !== HORS_ZONE).length;

  if (lignes.length === 0) {
    return (
      <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--warning)' }}>
        Aucun anneau réglé : aucune population n’est classée.
      </span>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {lignes.map(({ niveau, anneaux }) => (
        <button
          key={niveau}
          type="button"
          onClick={onOuvrirAtelier}
          title={`Régler les anneaux de ${LIBELLE_NIVEAU[niveau].toLowerCase()}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'var(--bg-level-3)',
            border: '0.5px solid var(--border-default)',
            borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
            fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)',
          }}
        >
          <span>{LIBELLE_NIVEAU[niveau]}</span>
          <span style={{ fontFamily: fMono, color: 'var(--text-primary)' }}>
            {anneaux.map(libelleRayon).join(' · ')}
          </span>
        </button>
      ))}
      {profil.lie && (
        <span
          title="Tous les niveaux partagent les mêmes anneaux."
          style={{ fontFamily: fInter, fontSize: 11, color: 'var(--brand-teal)' }}
        >
          liés
        </span>
      )}
      <span
        title={profil.inclurePPRT
          ? 'Les périmètres PPRT publiés par l’État forment une classe à part, avant toute bande.'
          : 'Les périmètres PPRT ne sont pas distingués : chaque carreau prend sa bande calculée.'}
        style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)' }}
      >
        {profil.inclurePPRT ? 'PPRT à part' : 'PPRT fondus'} · {nClasses} classes
      </span>
    </div>
  );
}
