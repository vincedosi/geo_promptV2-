'use client';

/**
 * Panel de personnalisation de la carte Pilotage ML.
 *
 * Popover ouvert/fermé via icône ⚙ dans le header de la DualMap.
 * Theme-aware via tokens CSS — pas de hex hardcodé sur le chrome.
 */
import { useEffect, useRef, useState } from 'react';
import { Settings2, RotateCcw, X } from 'lucide-react';
import {
  PALETTES, BUBBLE_SWATCHES, type MapCustomization, type PaletteId,
} from '@/lib/bidding-ml/use-map-customization';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Props {
  config: MapCustomization;
  update: <K extends keyof MapCustomization>(key: K, value: MapCustomization[K]) => void;
  reset: () => void;
}

export function MapCustomizationPanel({ config, update, reset }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
          background: open ? 'var(--bg-level-2)' : 'var(--bg-level-2)',
          color: open ? 'var(--brand-teal)' : 'var(--text-secondary)',
          border: `0.5px solid ${open ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
          borderRadius: 6, cursor: 'pointer',
        }}
        title="Personnaliser l'affichage"
      >
        <Settings2 size={12} strokeWidth={1.8} />
        Personnaliser
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            zIndex: 50, width: 320,
            background: 'var(--bg-level-1)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 8,
            padding: 14,
            fontFamily: fInter,
            color: 'var(--text-primary)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>Personnalisation</span>
            <button
              type="button"
              onClick={() => { reset(); }}
              title="Réinitialiser aux valeurs par défaut"
              style={{
                marginLeft: 'auto',
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 7px', fontSize: 10, fontFamily: fMono,
                background: 'transparent', color: 'var(--text-tertiary)',
                border: '0.5px solid var(--border-subtle)', borderRadius: 4, cursor: 'pointer',
              }}
            >
              <RotateCcw size={10} /> reset
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                marginLeft: 6, padding: 3,
                background: 'transparent', color: 'var(--text-tertiary)',
                border: 'none', borderRadius: 4, cursor: 'pointer',
              }}
            >
              <X size={12} />
            </button>
          </div>

          {/* Section : Fond */}
          <Section title="Fond — taux d'abstention">
            <Row label="Palette">
              <select
                value={config.bgPalette}
                onChange={(e) => update('bgPalette', e.target.value as PaletteId)}
                style={selectStyle}
              >
                {(Object.keys(PALETTES) as PaletteId[]).map(id => (
                  <option key={id} value={id}>{PALETTES[id].label}</option>
                ))}
              </select>
            </Row>
            <Row label="">
              <PaletteGradient stops={PALETTES[config.bgPalette].stops} inverted={config.bgPaletteInverted} />
            </Row>
            <Row label="Inverser">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11 }}>
                <input
                  type="checkbox"
                  checked={config.bgPaletteInverted}
                  onChange={(e) => update('bgPaletteInverted', e.target.checked)}
                />
                <span style={{ color: 'var(--text-secondary)' }}>palette inversée</span>
              </label>
            </Row>
            <Row label={`Opacité ${Math.round(config.bgOpacity * 100)}%`}>
              <input
                type="range" min={0.2} max={1} step={0.05}
                value={config.bgOpacity}
                onChange={(e) => update('bgOpacity', Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--brand-teal)' }}
              />
            </Row>
          </Section>

          {/* Section : Bulles */}
          <Section title="Bulles — impressions">
            <Row label="Granularité">
              <SegmentedControl
                value={config.granularity}
                options={[
                  { value: 'cp',     label: 'CP' },
                  { value: 'dept',   label: 'Dept' },
                  { value: 'region', label: 'Région' },
                ]}
                onChange={(v) => update('granularity', v as MapCustomization['granularity'])}
              />
            </Row>
            <Row label="Sans algo">
              <ColorPicker
                value={config.bubbleColorBefore}
                onChange={(v) => update('bubbleColorBefore', v)}
              />
            </Row>
            <Row label="Avec algo">
              <ColorPicker
                value={config.bubbleColorAfter}
                onChange={(v) => update('bubbleColorAfter', v)}
              />
            </Row>
            <Row label={`Opacité ${Math.round(config.bubbleOpacity * 100)}%`}>
              <input
                type="range" min={0.1} max={1} step={0.05}
                value={config.bubbleOpacity}
                onChange={(e) => update('bubbleOpacity', Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--brand-teal)' }}
              />
            </Row>
            <Row label={`Stroke ${config.bubbleStroke.toFixed(1)}px`}>
              <input
                type="range" min={0} max={3} step={0.25}
                value={config.bubbleStroke}
                onChange={(e) => update('bubbleStroke', Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--brand-teal)' }}
              />
            </Row>
          </Section>

          {/* Section : Mode */}
          <Section title="Mode d'affichage">
            <Row label="Vue">
              <SegmentedControl
                value={config.viewMode}
                options={[
                  { value: 'single',       label: 'Unique + toggle' },
                  { value: 'side_by_side', label: 'Côte à côte' },
                ]}
                onChange={(v) => update('viewMode', v as MapCustomization['viewMode'])}
              />
            </Row>
          </Section>
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  flex: 1, padding: '6px 8px', fontSize: 11, fontFamily: fInter,
  background: 'var(--bg-level-2)',
  color: 'var(--text-primary)',
  border: '0.5px solid var(--border-subtle)',
  borderRadius: 4, cursor: 'pointer',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      paddingTop: 10, marginTop: 10,
      borderTop: '0.5px solid var(--border-subtle)',
    }}>
      <div style={{
        fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 8,
        textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500,
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', minWidth: 84, fontFamily: fMono }}>
        {label}
      </span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function PaletteGradient({ stops, inverted }: { stops: string[]; inverted: boolean }) {
  const ordered = inverted ? [...stops].reverse() : stops;
  return (
    <div
      style={{
        flex: 1, height: 14, borderRadius: 3,
        background: `linear-gradient(to right, ${ordered.join(', ')})`,
        border: '0.5px solid var(--border-subtle)',
      }}
    />
  );
}

function SegmentedControl<T extends string>({
  value, options, onChange,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div style={{
      display: 'inline-flex', flex: 1, padding: 2, gap: 2,
      background: 'var(--bg-level-2)',
      border: '0.5px solid var(--border-subtle)',
      borderRadius: 5,
    }}>
      {options.map(o => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              flex: 1, padding: '4px 6px', fontSize: 10, fontFamily: fInter, fontWeight: 500,
              background: active ? 'var(--brand-teal)' : 'transparent',
              color: active ? 'var(--bg-level-0)' : 'var(--text-secondary)',
              border: 'none', borderRadius: 3, cursor: 'pointer',
              transition: 'all 150ms',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [advanced, setAdvanced] = useState(false);
  const [hexInput, setHexInput] = useState(value);

  useEffect(() => { setHexInput(value); }, [value]);

  const isValidHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {BUBBLE_SWATCHES.map(s => {
          const active = s.value.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => onChange(s.value)}
              title={s.label}
              style={{
                width: 22, height: 22, borderRadius: 4,
                background: s.value,
                border: active ? '2px solid var(--text-primary)' : '0.5px solid var(--border-default)',
                cursor: 'pointer', padding: 0,
                outline: 'none',
                transition: 'transform 120ms',
                transform: active ? 'scale(1.05)' : 'scale(1)',
              }}
            />
          );
        })}
        <button
          type="button"
          onClick={() => setAdvanced(a => !a)}
          title="Saisir une couleur en hexadécimal"
          style={{
            width: 22, height: 22, borderRadius: 4,
            background: 'var(--bg-level-2)',
            color: 'var(--text-tertiary)',
            border: '0.5px solid var(--border-subtle)',
            cursor: 'pointer', fontSize: 10, fontFamily: fMono,
          }}
        >
          #
        </button>
      </div>
      {advanced && (
        <input
          type="text"
          value={hexInput}
          onChange={(e) => {
            const v = e.target.value;
            setHexInput(v);
            if (isValidHex(v)) onChange(v);
          }}
          placeholder="#06d6a0"
          style={{
            padding: '4px 6px', fontSize: 10, fontFamily: fMono,
            background: 'var(--bg-level-2)',
            color: isValidHex(hexInput) ? 'var(--text-primary)' : 'var(--danger)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 4, outline: 'none',
          }}
        />
      )}
    </div>
  );
}
