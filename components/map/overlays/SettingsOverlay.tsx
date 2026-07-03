'use client';

import { useState } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Share2,
  Layers as LayersIcon,
  FileUp,
  Radio as RadioIcon,
  Target,
  Plug,
  Activity,
  Database,
  Users,
  Save as SaveIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { COLORS, FONTS } from './_shared/styles';
import dynamic from 'next/dynamic';
import { useCustomGeoCaptureContext } from '@/lib/custom-geo/CustomGeoCaptureContext';
import { retryImport } from '@/lib/dynamic-with-retry';

const CustomGeoCaptureModal = dynamic(
  retryImport(() => import('@/components/custom-geo/CustomGeoCaptureModal').then((m) => ({ default: m.CustomGeoCaptureModal }))),
  { ssr: false, loading: () => null }
);

export interface SettingsOverlayProps {
  mapStyles: { id: string; label: string; url: string }[];
  currentMapStyleUrl: string;
  onMapStyleChange: (url: string) => void;
  onSaveCurrentView: () => void;
  saveLoading?: boolean;
}

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_LINKS: NavLink[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/clusters', label: 'Clustering', icon: Share2 },
  { href: '/map/custom-geo', label: 'Zones custom', icon: LayersIcon },
  { href: '/admin/import', label: 'Import POI', icon: FileUp },
  { href: '/admin/radio', label: 'Radio FM/DAB+', icon: RadioIcon },
  { href: '/admin/campaigns', label: 'Campagnes DSP', icon: Target },
  { href: '/admin/api', label: 'Connexions API', icon: Plug },
  { href: '/admin/users', label: 'Utilisateurs', icon: Users },
  { href: '/admin/sources', label: 'Sources', icon: Database },
  { href: '/admin/health', label: 'Health check', icon: Activity },
];

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: FONTS.inter,
  fontSize: 11,
  fontWeight: 500,
  color: COLORS.textDim,
  letterSpacing: '0.04em',
  marginBottom: 8,
  marginTop: 0,
};

export function SettingsOverlay({
  mapStyles,
  currentMapStyleUrl,
  onMapStyleChange,
  onSaveCurrentView,
  saveLoading,
}: SettingsOverlayProps) {
  const router = useRouter();
  const { layerCount } = useCustomGeoCaptureContext();
  const [customGeoModalOpen, setCustomGeoModalOpen] = useState(false);
  const customGeoDisabled = layerCount === 0;

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 20, fontFamily: FONTS.inter }}>
      {/* Fond de carte */}
      <section>
        <h4 style={sectionTitleStyle}>Fond de carte</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {mapStyles.map(s => {
            const active = currentMapStyleUrl === s.url;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onMapStyleChange(s.url)}
                aria-pressed={active}
                style={{
                  background: active ? 'rgba(78,205,196,0.1)' : 'transparent',
                  border: `0.5px solid ${active ? 'var(--brand-teal)' : COLORS.borderDefault}`,
                  color: active ? 'var(--brand-teal)' : COLORS.textDim,
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 11,
                  cursor: 'pointer',
                  transition: 'background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover)',
                  fontFamily: FONTS.inter,
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Vues sauvegardées */}
      <section>
        <h4 style={sectionTitleStyle}>Vues sauvegardées</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            onClick={onSaveCurrentView}
            disabled={saveLoading}
            style={{
              width: '100%',
              background: 'transparent',
              border: '0.5px solid var(--brand-teal)',
              color: 'var(--brand-teal)',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 500,
              cursor: saveLoading ? 'wait' : 'pointer',
              opacity: saveLoading ? 0.6 : 1,
              fontFamily: FONTS.inter,
              transition: 'background-color 150ms var(--ease-hover)',
            }}
            onMouseEnter={e => { if (!saveLoading) e.currentTarget.style.background = 'rgba(78,205,196,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            {saveLoading ? 'Sauvegarde…' : 'Sauvegarder la vue actuelle'}
          </button>
          <button
            type="button"
            onClick={() => setCustomGeoModalOpen(true)}
            disabled={customGeoDisabled}
            title={customGeoDisabled ? 'Aucune zone à capturer (active au moins un layer terrain)' : 'Capturer la vue comme zone custom'}
            style={{
              width: '100%',
              background: 'transparent',
              border: `0.5px solid ${customGeoDisabled ? COLORS.borderDefault : 'var(--brand-teal)'}`,
              color: customGeoDisabled ? COLORS.textTertiary : 'var(--brand-teal)',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 500,
              cursor: customGeoDisabled ? 'not-allowed' : 'pointer',
              opacity: customGeoDisabled ? 0.5 : 1,
              fontFamily: FONTS.inter,
              transition: 'background-color 150ms var(--ease-hover)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
            onMouseEnter={e => { if (!customGeoDisabled) e.currentTarget.style.background = 'rgba(78,205,196,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <SaveIcon size={14} strokeWidth={1.5} />
            Capturer zone custom
            {layerCount > 0 && (
              <span style={{
                marginLeft: 'auto',
                minWidth: 18, height: 18, padding: '0 5px',
                borderRadius: 9, background: 'var(--brand-teal)',
                color: '#050505', fontFamily: FONTS.mono,
                fontSize: 10, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{layerCount}</span>
            )}
          </button>
        </div>
      </section>
      {customGeoModalOpen && <CustomGeoCaptureModal onClose={() => setCustomGeoModalOpen(false)} />}

      {/* Apparence */}
      <section>
        <h4 style={sectionTitleStyle}>Apparence</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ThemeToggle />
          <span style={{ fontSize: 12, color: COLORS.textDim }}>Thème clair / sombre</span>
        </div>
      </section>

      {/* Navigation */}
      <section>
        <h4 style={sectionTitleStyle}>Navigation</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV_LINKS.map(link => {
            const Icon = link.icon;
            return (
              <button
                key={link.href}
                type="button"
                onClick={() => router.push(link.href)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: 'transparent',
                  border: 'none',
                  color: COLORS.textDim,
                  fontSize: 12,
                  padding: '8px 6px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: FONTS.inter,
                  transition: 'background-color 120ms var(--ease-hover), color 120ms var(--ease-hover)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = COLORS.bgLevel2;
                  e.currentTarget.style.color = COLORS.text;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = COLORS.textDim;
                }}
              >
                <Icon size={14} strokeWidth={1.5} />
                {link.label}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
