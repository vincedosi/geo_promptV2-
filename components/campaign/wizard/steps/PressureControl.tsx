'use client';

/**
 * PressureControl — le réglage « Pression sur la cible », quantifié et
 * bidirectionnel. Partagé entre l'étape Pression du wizard et AdjustPanel.
 *
 * Trois façons synchronisées de piloter la même valeur (le multiplicateur
 * d'enchère max M, borné ×1 → ×3) :
 *  - le slider ;
 *  - le CPM max (zones cibles)  = CPM de référence × M ;
 *  - le CPM min (hors cible)    = CPM de référence ÷ M.
 * Saisir un CPM recale le slider (M = CPM/base ou base/CPM, clampé).
 * Les champs € sont inactifs tant que le CPM de référence n'est pas connu.
 */
import { useState } from 'react';
import { clampPressure, fmtMult, PRESSURE_MAX, PRESSURE_MIN, PRESSURE_STEP } from './types';
import { C, FieldBlock, NumberField, Row2, fInter, fMono } from './ui';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Champ € dérivé de la pression : buffer local pendant la saisie (sinon chaque
 * frappe re-dériverait la valeur et écraserait le texte en cours), commit au
 * blur / Entrée.
 */
function DerivedCpmField({ label, derived, disabled, onCommit }: {
  label: string;
  derived: number | null;
  disabled: boolean;
  onCommit: (v: number) => void;
}) {
  const [buffer, setBuffer] = useState<string | null>(null);
  const shown = buffer ?? (derived != null ? String(derived) : '');

  const commit = () => {
    if (buffer != null) {
      const v = Number(buffer.replace(',', '.'));
      if (Number.isFinite(v) && v > 0) onCommit(v);
    }
    setBuffer(null);
  };

  return (
    <div>
      <label style={{ display: 'block', fontFamily: fInter, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: C.textDim, marginBottom: 6 }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type="number"
          step={0.01}
          min={0}
          disabled={disabled}
          value={shown}
          placeholder="—"
          onFocus={(e) => { setBuffer(shown); e.currentTarget.style.borderColor = C.teal50; }}
          onChange={(e) => setBuffer(e.target.value)}
          onBlur={(e) => { commit(); e.currentTarget.style.borderColor = C.border; }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); } }}
          style={{
            width: '100%', background: C.elevated,
            borderWidth: 0.5, borderStyle: 'solid', borderColor: C.border, borderRadius: 6,
            padding: '10px 32px 10px 12px', fontFamily: fMono, fontSize: 15, color: C.text,
            boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.15s',
            opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'text',
          }}
        />
        <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: fMono, fontSize: 12, color: C.textDim, pointerEvents: 'none' }}>
          €
        </span>
      </div>
    </div>
  );
}

export function PressureControl({ pressure, onPressureChange, cpm, onCpmChange }: {
  pressure: number;
  onPressureChange: (p: number) => void;
  /** CPM de référence (forecast_cpm). Null = champs € désactivés. */
  cpm: number | null;
  /** Si fourni, le champ CPM de référence est éditable ici (étape Pression). */
  onCpmChange?: (v: number | null) => void;
}) {
  const p = clampPressure(pressure);
  const base = cpm != null && cpm > 0 ? cpm : null;
  const cpmMax = base != null ? round2(base * p) : null;
  const cpmMin = base != null ? round2(base / p) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {onCpmChange && (
        <FieldBlock label="CPM de référence">
          <Row2>
            <NumberField
              label="CPM moyen visé"
              value={cpm}
              onChange={onCpmChange}
              suffix="€"
              placeholder="ex. 6.20"
              step={0.1}
              min={0}
            />
            <div />
          </Row2>
        </FieldBlock>
      )}

      <FieldBlock label="Pression sur la cible">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ fontFamily: fMono, fontSize: 12, color: C.textDim, whiteSpace: 'nowrap' }}>×1,0</span>
          <input
            type="range"
            min={PRESSURE_MIN}
            max={PRESSURE_MAX}
            step={PRESSURE_STEP}
            value={p}
            onChange={(e) => onPressureChange(clampPressure(Number(e.target.value)))}
            aria-label="Pression sur la cible (multiplicateur d'enchère)"
            style={{ flex: 1, accentColor: C.teal }}
          />
          <span style={{ fontFamily: fMono, fontSize: 12, color: C.textDim, whiteSpace: 'nowrap' }}>×3,0</span>
          <span style={{ fontFamily: fMono, fontSize: 16, color: C.teal, minWidth: 52, textAlign: 'right' }}>{fmtMult(p)}</span>
        </div>

        <div style={{
          border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '12px 14px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontFamily: fInter, fontSize: 12, color: C.textSec }}>Enchère sur les zones cibles</span>
            <span style={{ fontFamily: fMono, fontSize: 14, color: C.text }}>
              jusqu&apos;à {fmtMult(p)}{cpmMax != null ? ` · ${cpmMax.toLocaleString('fr-FR')} €` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontFamily: fInter, fontSize: 12, color: C.textSec }}>Enchère hors cible</span>
            <span style={{ fontFamily: fMono, fontSize: 14, color: C.text }}>
              {fmtMult(round2(1 / p))}{cpmMin != null ? ` · ${cpmMin.toLocaleString('fr-FR')} €` : ''}
            </span>
          </div>
        </div>

        <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginTop: 8, lineHeight: 1.5 }}>
          ×1,0 = pression uniforme partout · ×3,0 = concentration maximale sur la cible
        </div>
      </FieldBlock>

      <FieldBlock label="Ou fixe directement les CPM (le slider se recale)">
        <Row2>
          <DerivedCpmField
            label="CPM max (zones cibles)"
            derived={cpmMax}
            disabled={base == null}
            onCommit={(v) => { if (base != null) onPressureChange(clampPressure(v / base)); }}
          />
          <DerivedCpmField
            label="CPM min (hors cible)"
            derived={cpmMin}
            disabled={base == null}
            onCommit={(v) => { if (base != null) onPressureChange(clampPressure(base / v)); }}
          />
        </Row2>
        {base == null && (
          <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginTop: 8 }}>
            Renseigne d&apos;abord le CPM de référence pour piloter la pression en euros.
          </div>
        )}
      </FieldBlock>
    </div>
  );
}
