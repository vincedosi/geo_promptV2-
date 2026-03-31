"use client";

import { useSession } from "@/lib/auth-client";
import Link from "next/link";
import {
  MapPin, Layers, FileUp, Monitor, Database, Users,
  Hexagon, Clock, Mail, Shield,
} from 'lucide-react';

export default function DashboardPage() {
  const { session, isLoading } = useSession();

  // ── Loading state — skeleton shimmer ────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div className="geo-skeleton" style={{ width: 180, height: 22, marginBottom: 8 }} />
        <div className="geo-skeleton" style={{ width: 120, height: 14, marginBottom: 32 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} className="geo-skeleton" style={{ height: 88, borderRadius: 6 }} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="geo-skeleton" style={{ height: 72, borderRadius: 6 }} />
          ))}
        </div>
      </div>
    );
  }

  // ── Not authenticated ───────────────────────────────────────────────────────
  if (!session) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '50vh', gap: 16,
      }}>
        <Hexagon size={48} strokeWidth={1} style={{ color: '#333333' }} />
        <p style={{ fontSize: 13, color: '#666666' }}>Session expirée</p>
        <Link
          href="/login"
          style={{
            fontSize: 13, color: '#050505', background: '#f0f0f0',
            padding: '10px 24px', borderRadius: 6, textDecoration: 'none',
            fontWeight: 500, transition: 'background 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#d4d4d4'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#f0f0f0'; }}
        >
          Se connecter
        </Link>
      </div>
    );
  }

  const displayName = session.user.name || session.user.email?.split('@')[0] || '—';

  // ── Stat cards data ─────────────────────────────────────────────────────────
  const stats = [
    {
      icon: MapPin,
      value: 'geo.prompt',
      label: 'Copilote IA',
      href: '/map',
    },
    {
      icon: Mail,
      value: displayName,
      label: session.user.email ?? '',
      href: null,
    },
    {
      icon: Shield,
      value: session.user.role ?? 'user',
      label: session.user.emailVerified ? 'Compte vérifié' : 'Non vérifié',
      href: null,
    },
    {
      icon: Clock,
      value: new Date(session.expiresAt).toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit',
      }),
      label: 'Expiration session',
      href: null,
    },
  ];

  // ── Navigation cards ────────────────────────────────────────────────────────
  const navCards = [
    { href: '/map',                    icon: MapPin,   label: 'geo.prompt',       sub: 'Carte + IA' },
    { href: '/admin/ooh-import',       icon: Monitor,  label: 'Import OOH',       sub: 'Panneaux ArcGIS' },
    { href: '/admin/import',           icon: FileUp,   label: 'Import POI',       sub: 'CSV / XLSX' },
    { href: '/admin/sources',          icon: Database,  label: 'Sources',          sub: 'Data lake' },
    { href: '/admin/organizations',    icon: Users,    label: 'Organisations',    sub: 'Multi-tenant' },
    { href: '/dashboard/iris-crawler', icon: Layers,   label: 'IRIS Crawler',     sub: 'Données INSEE' },
  ];

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          fontWeight: 500, fontSize: 18, color: '#f0f0f0',
          letterSpacing: '-0.02em', margin: '0 0 4px',
        }}>
          Dashboard
        </h1>
        <p style={{ fontSize: 13, color: '#666666', margin: 0 }}>
          Bienvenue, {displayName}
        </p>
      </div>

      {/* ── Stat cards row ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
        {stats.map((s, i) => {
          const inner = (
            <div
              key={i}
              style={{
                background: '#0a0a0a',
                border: '0.5px solid #1a1a1a',
                borderRadius: 6,
                padding: '16px 18px',
                transition: 'border-color 0.15s, transform 0.2s',
                cursor: s.href ? 'pointer' : 'default',
                animation: `slideUp 0.3s ease ${i * 60}ms both`,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#262626';
                if (s.href) e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#1a1a1a';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <s.icon size={20} strokeWidth={1.5} style={{ color: '#4ecdc4', marginBottom: 12 }} />
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 500, fontSize: 15, color: '#f0f0f0',
                marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {s.value}
              </div>
              <div style={{
                fontSize: 12, color: '#666666',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {s.label}
              </div>
            </div>
          );

          return s.href ? (
            <Link key={i} href={s.href} style={{ textDecoration: 'none' }}>{inner}</Link>
          ) : (
            <div key={i}>{inner}</div>
          );
        })}
      </div>

      {/* ── Section header ─────────────────────────────────────────────────── */}
      <div className="geo-section-header" style={{ borderRadius: '6px 6px 0 0', marginBottom: 0 }}>
        <span>Navigation rapide</span>
      </div>

      {/* ── Navigation cards grid ──────────────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0,
        border: '0.5px solid #1a1a1a', borderTop: 'none', borderRadius: '0 0 6px 6px',
        overflow: 'hidden',
      }}>
        {navCards.map(({ href, icon: Icon, label, sub }, i) => (
          <Link key={href} href={href} style={{ textDecoration: 'none' }}>
            <div
              style={{
                background: '#0a0a0a',
                padding: '16px 18px',
                borderRight: (i % 3 !== 2) ? '0.5px solid #1a1a1a' : 'none',
                borderBottom: i < 3 ? '0.5px solid #1a1a1a' : 'none',
                transition: 'background 0.15s',
                cursor: 'pointer',
                display: 'flex', alignItems: 'flex-start', gap: 12,
                animation: `slideUp 0.3s ease ${200 + i * 50}ms both`,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#111111'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#0a0a0a'; }}
            >
              <Icon size={16} strokeWidth={1.5} style={{ color: '#666666', marginTop: 2, flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 500, fontSize: 13, color: '#f0f0f0', marginBottom: 2 }}>
                  {label}
                </div>
                <div style={{ fontSize: 12, color: '#666666' }}>
                  {sub}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
