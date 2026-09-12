'use client';

/**
 * @file components/map/overlays/SettingsOverlay.tsx — panneau « Réglages »
 *
 * La capture de zone custom (« Capturer zone custom ») a déménagé dans
 * `PanneauZones` (entrée « Zones » du rail, Tâche 7, 2026-09-12) : elle
 * fabrique une zone, ce n'est pas un réglage. Voir `app/map/_components/panneaux/PanneauZones.tsx`.
 *
 * Le choix du modèle IA (Gemini/Mistral) et l'état de la clé restent pour
 * l'instant dans l'Assistant (`app/copilote/_components/ChatPanel.tsx`) — la
 * spec de cette tâche demande de les reclasser ici, mais ce fichier est hors
 * du périmètre que cette tâche a le droit de toucher (frontière de fichiers
 * du prompt de tâche). Voir le rapport de tâche 7 pour le signalement complet.
 */
import { ThemeToggle } from '@/components/ThemeToggle';
import { useRouter } from 'next/navigation';
import {
  FileUp,
  Radio as RadioIcon,
  Plug,
  Activity,
  Database,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { COLORS, FONTS } from './_shared/styles';

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

/**
 * Back office (admin) — vision 09/07 : le mediaplanner travaille dans les overlays
 * de la carte ; l'admin gère workspaces, données et connexions depuis cet onglet.
 * Droits par rôle (user / admin / super admin) à venir.
 */
const BACK_OFFICE_LINKS: NavLink[] = [
  { href: '/admin/organizations', label: 'Organisations (workspaces)', icon: Users },
  { href: '/admin/users', label: 'Utilisateurs', icon: Users },
  { href: '/admin/import', label: 'Import POI', icon: FileUp },
  { href: '/admin/carreaux-import', label: 'Import Shapefile', icon: FileUp },
  { href: '/admin/ooh-import', label: 'Import OOH', icon: FileUp },
  { href: '/dashboard/iris-crawler', label: 'IRIS crawler', icon: Database },
  { href: '/admin/radio', label: 'Radio FM/DAB+', icon: RadioIcon },
  { href: '/admin/api', label: 'Connexions API', icon: Plug },
  { href: '/admin/sources', label: 'Sources', icon: Database },
  { href: '/admin/imports', label: 'Historique imports', icon: FileUp },
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
        </div>
      </section>

      {/* Apparence */}
      <section>
        <h4 style={sectionTitleStyle}>Apparence</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ThemeToggle />
          <span style={{ fontSize: 12, color: COLORS.textDim }}>Thème clair / sombre</span>
        </div>
      </section>

      {/* Back office */}
      <section>
        <h4 style={sectionTitleStyle}>Back office</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {BACK_OFFICE_LINKS.map(link => {
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
