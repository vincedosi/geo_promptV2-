'use client';

/**
 * Fil d'étapes de l'import shapefile — Fichiers, Mapping, Import.
 *
 * Une étape déjà franchie est cliquable pour revenir en arrière ; une étape
 * non atteinte reste désactivée.
 *
 * JSX repris tel quel de page.tsx (2026-09-07).
 */

import React from 'react';
import { C, fontInter, fontMono, type WizardStep } from './shared';

export interface StepperProps {
  step: WizardStep;
  setStep: (n: WizardStep) => void;
}

export function Stepper({ step, setStep }: StepperProps) {
  return (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
    {([
      { n: 1 as WizardStep, label: 'Fichiers' },
      { n: 2 as WizardStep, label: 'Mapping' },
      { n: 3 as WizardStep, label: 'Import' },
    ]).map(({ n, label }) => (
      <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {n > 1 && (
          <div style={{
            width: 48,
            height: 1,
            background: step >= n ? C.green : C.border,
          }} />
        )}
        <button
          onClick={() => n < step && setStep(n)}
          disabled={n > step}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 2,
            fontFamily: fontInter,
            fontSize: 12,
            fontWeight: step === n ? 600 : 400,
            cursor: n > step ? 'not-allowed' : n < step ? 'pointer' : 'default',
            background: step === n ? C.greenDim : step > n ? C.bgElevated : C.bgElevated,
            border: `1px solid ${step === n ? 'rgba(61,255,160,0.3)' : step > n ? C.border : C.border}`,
            color: step === n ? C.green : step > n ? C.textDim : C.muted,
            transition: 'all 0.15s',
            outline: 'none',
          }}
        >
          <span style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
            background: step > n ? C.green : step === n ? C.greenDim : C.bgSurface,
            color: step > n ? '#000' : step === n ? C.green : C.muted,
            fontFamily: fontMono,
          }}>
            {step > n ? '✓' : n}
          </span>
          {label}
        </button>
      </div>
    ))}
  </div>
  );
}
