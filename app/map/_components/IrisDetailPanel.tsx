'use client';

import { IRIS_DB_COLUMNS } from '@/lib/iris-crawler/db-columns';
import { SkeletonText } from '@/components/ui/GeoSkeleton';

// ─── Tokens design system (GEOMATIK) ──────────────────────────────────────────
const C = {
  bg:      '#0a0a0a',
  bgPanel: '#111111',
  border:  '#1a1a1a',
  accent:  '#4ecdc4',
  green:   '#3dffa0',
  text:    '#f0f0f0',
  dim:     '#666666',
  red:     '#ff5757',
  yellow:  '#f7b731',
};
const fMono = "'JetBrains Mono',monospace";
const fLabel = "'Inter',system-ui,sans-serif";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IrisDetailData {
  code_iris:    string;
  nom_iris:     string | null;
  code_commune: string | null;
  code_dept:    string | null;
  is_true_iris: boolean | null;
  [key: string]: unknown;
}

interface Props {
  data:    IrisDetailData;
  loading: boolean;
  onClose: () => void;
}

// ─── Groupes à afficher (ordre souhaité) ──────────────────────────────────────
const GROUP_ORDER = ['Population', 'Âge', 'Revenus', 'Emploi', 'Diplômes', 'CSP', 'Logement', 'Familles', 'Mobilité'] as const;

// ─── Formatage ────────────────────────────────────────────────────────────────

function fmtValue(col: typeof IRIS_DB_COLUMNS[number], raw: unknown): string {
  if (raw === null || raw === undefined) return '—';
  const v = Number(raw);
  if (isNaN(v)) return String(raw);

  if (col.type === 'boolean') return v ? 'Oui' : 'Non';
  if (col.type === 'integer') return v.toLocaleString('fr-FR');

  // float — détecter l'unité via le label
  const lbl = col.label.toLowerCase();
  if (lbl.includes('(%)') || lbl.includes('%')) return `${v.toFixed(1)} %`;
  if (lbl.includes('(€)') || lbl.includes('€'))  return `${Math.round(v).toLocaleString('fr-FR')} €`;
  return v.toFixed(2);
}

/** Barre horizontale pour les colonnes en % (type float dont label contient %) */
function isPercent(col: typeof IRIS_DB_COLUMNS[number]): boolean {
  if (col.type !== 'float') return false;
  const lbl = col.label.toLowerCase();
  return lbl.includes('(%)') || lbl.includes('%');
}

function BarRow({ col, raw }: { col: typeof IRIS_DB_COLUMNS[number]; raw: unknown }) {
  const formatted = fmtValue(col, raw);
  const pct = raw !== null && raw !== undefined ? Math.min(100, Math.max(0, Number(raw))) : null;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontFamily: fLabel, fontSize: 9, color: C.dim, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {col.label}
        </span>
        <span style={{ fontFamily: fMono, fontSize: 11, color: pct !== null ? C.text : C.dim }}>
          {formatted}
        </span>
      </div>
      {pct !== null && (
        <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: pct > 60 ? C.accent : pct > 30 ? C.green : '#4ecdc4',
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }} />
        </div>
      )}
    </div>
  );
}

function StatRow({ col, raw }: { col: typeof IRIS_DB_COLUMNS[number]; raw: unknown }) {
  const formatted = fmtValue(col, raw);
  const hasValue = raw !== null && raw !== undefined;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
      <span style={{ fontFamily: fLabel, fontSize: 9, color: C.dim, letterSpacing: '0.06em', textTransform: 'uppercase', flex: 1, paddingRight: 8 }}>
        {col.label}
      </span>
      <span style={{ fontFamily: fMono, fontSize: 12, color: hasValue ? C.text : C.dim, flexShrink: 0 }}>
        {formatted}
      </span>
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

function Section({ title, cols, data }: {
  title: string;
  cols: typeof IRIS_DB_COLUMNS;
  data: IrisDetailData;
}) {
  const hasAny = cols.some(c => data[c.name] !== null && data[c.name] !== undefined);
  if (!hasAny) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontFamily: fLabel, fontSize: 9, color: C.accent,
        letterSpacing: '0.1em', textTransform: 'uppercase',
        marginBottom: 10, paddingBottom: 5,
        borderBottom: `0.5px solid ${C.border}`,
      }}>
        {title}
      </div>
      {cols.map(col => {
        const raw = data[col.name];
        if (isPercent(col)) return <BarRow key={col.name} col={col} raw={raw} />;
        return <StatRow key={col.name} col={col} raw={raw} />;
      })}
    </div>
  );
}

// ─── Panel principal ──────────────────────────────────────────────────────────

export function IrisDetailPanel({ data, loading, onClose }: Props) {
  const groupedCols = GROUP_ORDER.reduce<Record<string, typeof IRIS_DB_COLUMNS>>((acc, g) => {
    acc[g] = IRIS_DB_COLUMNS.filter(c => c.group === g && c.name !== 'is_true_iris');
    return acc;
  }, {});

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      background: C.bgPanel,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{
        padding: '12px 14px 10px',
        borderBottom: `0.5px solid ${C.border}`,
        flexShrink: 0,
        background: C.bg,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: fLabel, fontSize: 9, color: C.accent, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
              IRIS
            </div>
            <div style={{ fontFamily: fMono, fontSize: 13, color: C.text, fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-word' }}>
              {data.nom_iris ?? data.code_iris}
            </div>
            <div style={{ fontFamily: fMono, fontSize: 10, color: C.dim, marginTop: 3 }}>
              {data.code_iris}
              {data.code_commune && <span style={{ marginLeft: 8 }}>Commune {data.code_commune}</span>}
              {data.code_dept    && <span style={{ marginLeft: 8 }}>Dép. {data.code_dept}</span>}
            </div>
            {data.is_true_iris === false && (
              <div style={{ marginTop: 6, fontFamily: fLabel, fontSize: 8, color: C.yellow, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Zone communale (non IRIS)
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: `0.5px solid ${C.border}`,
              color: C.dim, cursor: 'pointer',
              fontFamily: fMono, fontSize: 12,
              width: 24, height: 24, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 2, marginLeft: 8,
              transition: 'color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = C.text; (e.currentTarget as HTMLButtonElement).style.borderColor = C.dim; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = C.dim;  (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      {loading ? (
        <div style={{ flex: 1, padding: '14px 14px 24px' }}>
          {/* Skeleton loading */}
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} style={{ marginBottom: 20 }}>
              <div className="geo-skeleton" style={{ width: 80, height: 10, borderRadius: 3, marginBottom: 12 }} />
              <SkeletonText lines={3} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px' }}>
          {GROUP_ORDER.map(group => (
            <Section
              key={group}
              title={group}
              cols={groupedCols[group] ?? []}
              data={data}
            />
          ))}
        </div>
      )}
    </div>
  );
}
