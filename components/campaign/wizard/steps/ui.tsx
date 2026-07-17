'use client';

import type { CSSProperties, ReactNode } from 'react';
import { StepMemo } from '../StepMemo';

// ── Design tokens (DESIGN_SYSTEM.md — jamais de hex en dur) ─────────────────────
// Même pattern que app/campaigns/[id]/page.tsx : const C = {...}, fInter/fMono.
export const C = {
  card: 'var(--bg-surface)',
  elevated: 'var(--bg-level-2)',
  border: 'var(--border-subtle)',
  borderDefault: 'var(--border-default)',
  borderHover: 'var(--border-hover)',
  teal: 'var(--brand-teal)',
  tealDim: 'var(--brand-teal-10)',
  teal30: 'var(--brand-teal-30)',
  teal50: 'var(--brand-teal-50)',
  text: 'var(--text-primary)',
  textSec: 'var(--text-secondary)',
  textDim: 'var(--text-tertiary)',
  bgPrimary: 'var(--bg-primary)',
};
// Fond des lignes d'option sélectionnées : 7% de teal, plus léger que --brand-teal-10 (10%).
// rgba autorisé quand aucun tint précis n'existe (jamais de hex nu).
const TEAL_BG_07 = 'rgba(78,205,196,0.07)';

export const fInter = "'Inter', system-ui, sans-serif";
export const fMono = "'JetBrains Mono', monospace";

export interface StepMemoContent {
  paragraphs: ReactNode[];
  tip: string;
  mini?: number[];
}

/** <strong> mis en avant dans les paragraphes d'intro d'étape. */
export function B({ children }: { children: ReactNode }) {
  return <strong style={{ color: C.text, fontWeight: 500 }}>{children}</strong>;
}

/** Paragraphe d'intro en haut de chaque étape (équivalent `.lead` de la maquette). */
export function Lead({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontFamily: fInter, fontSize: 13, color: C.textSec, margin: '0 0 20px', maxWidth: '60ch', lineHeight: 1.6 }}>
      {children}
    </p>
  );
}

/** Bloc de champ avec label discret au-dessus (équivalent `.field`). */
export function FieldBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontFamily: fInter, fontSize: 11, color: C.textDim, marginBottom: 8, letterSpacing: '0.02em' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function OptsList({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>;
}

/** Ligne d'option radio-like — sélection sur toute la ligne (équivalent `.opt`). */
export function OptionRow({
  selected, title, sub, value, onClick, disabled,
}: {
  selected: boolean; title: string; sub?: string; value?: ReactNode; onClick: () => void; disabled?: boolean;
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
        borderWidth: 0.5, borderStyle: 'solid', borderColor: selected ? C.teal : C.border,
        borderRadius: 8, background: selected ? TEAL_BG_07 : 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        transition: 'border-color 0.15s, background-color 0.15s',
      }}
      onMouseEnter={(e) => { if (!selected && !disabled) { e.currentTarget.style.borderColor = C.borderHover; e.currentTarget.style.background = C.elevated; } }}
      onMouseLeave={(e) => { if (!selected && !disabled) { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = 'transparent'; } }}
    >
      <span
        aria-hidden
        style={{
          width: 15, height: 15, borderRadius: '50%', flexShrink: 0, position: 'relative',
          borderWidth: 1.5, borderStyle: 'solid', borderColor: selected ? C.teal : C.borderDefault,
        }}
      >
        {selected && (
          <span style={{ position: 'absolute', inset: 3, borderRadius: '50%', background: C.teal }} />
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: fInter, fontSize: 13, fontWeight: 500, color: C.text }}>{title}</div>
        {sub && <div style={{ fontFamily: fInter, fontSize: 11.5, color: C.textDim, marginTop: 2 }}>{sub}</div>}
      </span>
      {value != null && (
        <span style={{ fontFamily: fMono, fontSize: 12, color: C.textSec, whiteSpace: 'nowrap' }}>{value}</span>
      )}
    </div>
  );
}

export function Row2({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>;
}

const inputBase: CSSProperties = {
  width: '100%', background: C.elevated, borderWidth: 0.5, borderStyle: 'solid', borderColor: C.border,
  borderRadius: 6, padding: '10px 12px', fontFamily: fInter, fontSize: 13, color: C.text,
  boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.15s',
};

function withFocusHandlers(el: HTMLElement) {
  return {
    onFocus: () => { el.style.borderColor = C.teal50; },
    onBlur: () => { el.style.borderColor = C.border; },
  };
}

/** Champ numérique (budget, CPM) — style Input du DESIGN_SYSTEM, focus teal. */
export function NumberField({
  label, value, onChange, suffix, placeholder, step = 1, min,
}: {
  label: string; value: number | null; onChange: (v: number | null) => void;
  suffix?: string; placeholder?: string; step?: number; min?: number;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontFamily: fInter, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: C.textDim, marginBottom: 6 }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type="number"
          step={step}
          min={min}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          onFocus={(e) => { e.currentTarget.style.borderColor = C.teal50; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = C.border; }}
          style={{ ...inputBase, fontFamily: fMono, fontSize: 15, paddingRight: suffix ? 32 : 12 }}
        />
        {suffix && (
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: fMono, fontSize: 12, color: C.textDim, pointerEvents: 'none' }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

/** Champ date — même look que NumberField. Un clic n'importe où dans le champ
 *  ouvre le calendrier natif (showPicker) : pas de saisie segment par segment. */
export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ display: 'block', fontFamily: fInter, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: C.textDim, marginBottom: 6 }}>
        {label}
      </label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* navigateur sans showPicker : saisie clavier */ } }}
        onFocus={(e) => { e.currentTarget.style.borderColor = C.teal50; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = C.border; }}
        style={{ ...inputBase, fontFamily: fMono, fontSize: 13, colorScheme: 'dark', cursor: 'pointer' }}
      />
    </div>
  );
}

// ── Chrome commun : panel (header + corps + pied de page nav) + mémo ────────────
export function StepShell({
  title, stepNumber, totalSteps, children, memo, footer,
}: {
  title: string; stepNumber: number; totalSteps: number;
  children: ReactNode; memo: StepMemoContent; footer: ReactNode;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 18, alignItems: 'start' }}>
      <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: C.elevated, borderBottom: `0.5px solid ${C.border}`, padding: '13px 20px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal, flexShrink: 0 }} />
          <h2 style={{ fontFamily: fInter, fontSize: 14, fontWeight: 500, color: C.text, margin: 0 }}>{title}</h2>
          <span style={{ fontFamily: fMono, fontSize: 11, color: C.textDim, marginLeft: 'auto' }}>
            étape {stepNumber} / {totalSteps}
          </span>
        </div>
        <div style={{ padding: '22px 20px', minHeight: 230, flex: 1 }}>
          {children}
        </div>
        <div style={{ borderTop: `0.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          {footer}
        </div>
      </div>
      <StepMemo paragraphs={memo.paragraphs} tip={memo.tip} mini={memo.mini} />
    </div>
  );
}

function baseBtn(): CSSProperties {
  return {
    fontFamily: fInter, fontSize: 12.5, fontWeight: 500, borderRadius: 7, padding: '9px 16px',
    cursor: 'pointer', borderWidth: 0.5, borderStyle: 'solid', borderColor: 'transparent',
    display: 'inline-flex', alignItems: 'center', gap: 7, transition: 'all 0.15s',
  };
}

export function GhostButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ ...baseBtn(), background: 'transparent', borderColor: C.borderDefault, color: C.textSec, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.borderColor = C.borderHover; e.currentTarget.style.color = C.text; e.currentTarget.style.background = C.elevated; } }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderDefault; e.currentTarget.style.color = C.textSec; e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
    </button>
  );
}

export function TealButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ ...baseBtn(), background: 'transparent', borderColor: C.teal, color: C.teal, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = TEAL_BG_07; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
    </button>
  );
}

export function PrimaryButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ ...baseBtn(), background: disabled ? C.elevated : C.text, color: disabled ? C.textDim : C.bgPrimary, opacity: disabled ? 0.6 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.opacity = '0.85'; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.opacity = '1'; }}
    >
      {label}
    </button>
  );
}

/** Pied de page standard : Précédent (ghost) + action principale (teal ou primary). */
export function StandardFooter({
  onPrev, isFirst, nextLabel, onNext, nextVariant = 'teal', nextDisabled, hint,
}: {
  onPrev: () => void; isFirst?: boolean;
  nextLabel: string; onNext: () => void; nextVariant?: 'teal' | 'primary'; nextDisabled?: boolean;
  hint?: string;
}) {
  return (
    <>
      <GhostButton label="← Retour" onClick={onPrev} disabled={isFirst} />
      {nextVariant === 'primary' ? (
        <PrimaryButton label={nextLabel} onClick={onNext} disabled={nextDisabled} />
      ) : (
        <TealButton label={nextLabel} onClick={onNext} disabled={nextDisabled} />
      )}
      {hint && (
        <span style={{ marginLeft: 'auto', fontFamily: fMono, fontSize: 11, color: C.textDim }}>{hint}</span>
      )}
    </>
  );
}
