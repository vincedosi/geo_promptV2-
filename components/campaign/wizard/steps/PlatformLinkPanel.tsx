'use client';

/**
 * Liaison plateforme en saisie manuelle — pendant démo de la cascade API
 * (Dv360LinkPanel). Utilisé pour tout canal sélectionné dont l'org n'a pas
 * de connexion listable : un couple Nom + ID par niveau du registre
 * (`dsp_channel_registry.link_levels`). Écrit `${key}_name` / `${key}_id`
 * dans `draft.channelLinks[code]` — même structure que la cascade API,
 * aucune migration quand la connexion arrive.
 */
import { linksComplete, type LinkLevel, type PlatformLinks } from '@/lib/campaigns/platform-links';
import { C, fInter, fMono } from './ui';

interface Props {
  channelLabel: string;
  levels: LinkLevel[];
  links: PlatformLinks | undefined;
  onChange: (links: PlatformLinks) => void;
}

function LevelInput({
  value, placeholder, ariaLabel, mono, onChange,
}: {
  value: string; placeholder: string; ariaLabel: string; mono?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => { e.currentTarget.style.borderColor = C.teal50; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = C.border; }}
      style={{
        width: '100%', boxSizing: 'border-box', background: C.elevated,
        borderWidth: 0.5, borderStyle: 'solid', borderColor: C.border, borderRadius: 6,
        padding: '8px 10px', fontFamily: mono ? fMono : fInter, fontSize: mono ? 12 : 13,
        color: C.text, outline: 'none', transition: 'border-color 0.15s',
      }}
    />
  );
}

export function PlatformLinkPanel({ channelLabel, levels, links, onChange }: Props) {
  const complete = linksComplete(links, levels);

  const setField = (field: string, v: string) => {
    const next: PlatformLinks = { ...(links ?? {}) };
    if (v.trim() === '') delete next[field]; else next[field] = v;
    onChange(next);
  };

  return (
    <div style={{
      border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: C.text }}>
          Liaison {channelLabel}
        </span>
        <span style={{ fontFamily: fInter, fontSize: 11, color: complete ? 'var(--success)' : C.textDim }}>
          {complete ? '✓ renseignée' : 'saisie manuelle — reporte les IDs depuis la plateforme'}
        </span>
      </div>

      {levels.map((level) => (
        <div key={level.key}>
          <label style={{
            display: 'block', fontFamily: fInter, fontSize: 10, textTransform: 'uppercase',
            letterSpacing: '0.05em', color: C.textDim, marginBottom: 6,
          }}>
            {level.label}
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 170px', gap: 8 }}>
            <LevelInput
              value={links?.[`${level.key}_name`] ?? ''}
              placeholder="Nom (facultatif)"
              ariaLabel={`${level.label} — nom`}
              onChange={(v) => setField(`${level.key}_name`, v)}
            />
            <LevelInput
              value={links?.[`${level.key}_id`] ?? ''}
              placeholder="ID"
              ariaLabel={`${level.label} — ID`}
              mono
              onChange={(v) => setField(`${level.key}_id`, v)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
