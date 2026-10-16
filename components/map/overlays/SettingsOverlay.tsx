'use client';

/**
 * @file components/map/overlays/SettingsOverlay.tsx — panneau « Réglages »
 *
 * La capture de zone custom (« Capturer zone custom ») a déménagé dans
 * `PanneauZones` (entrée « Zones » du rail, Tâche 7, 2026-09-12) : elle
 * fabrique une zone, ce n'est pas un réglage. Voir `app/map/_components/panneaux/PanneauZones.tsx`.
 *
 * Les sections « Modèle IA » (Gemini/Mistral) et « Vues sauvegardées » sont
 * retirées le 2026-10-12 (chantier « suppression de toute l'IA », lot 5) : le
 * premier choisissait le modèle du chat, retiré ; le second ouvrait l'écran de
 * sauvegarde qui ne vivait QUE dans le chat. AIDA, le shell dentsu, porte l'IA.
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
import { lienPageAcces } from '@/lib/espaces/lien-page-acces';

export interface SettingsOverlayProps {
  mapStyles: { id: string; label: string; url: string }[];
  currentMapStyleUrl: string;
  onMapStyleChange: (url: string) => void;
}

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Adresse de l'application Angular, qui tourne à part : navigation
   *  complète du navigateur, pas `router.push`. */
  externe?: boolean;
}

// Page Angular « Accès » (10/10) : remplace « Organisations (workspaces) » et
// « Utilisateurs », dont les pages React sont supprimées. Sans
// NEXT_PUBLIC_URL_ANGULAR, l'entrée n'est pas rendue — pas de lien mort.
const URL_ACCES = lienPageAcces();

/**
 * Back office (admin) — vision 09/07 : le mediaplanner travaille dans les overlays
 * de la carte ; l'admin gère workspaces, données et connexions depuis cet onglet.
 * Droits par rôle (user / admin / super admin) à venir.
 */
const BACK_OFFICE_LINKS: NavLink[] = [
  ...(URL_ACCES ? [{ href: URL_ACCES, label: 'Accès', icon: Users, externe: true }] : []),
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
                onClick={() => (link.externe ? window.location.assign(link.href) : router.push(link.href))}
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
