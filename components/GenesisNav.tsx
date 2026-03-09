'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APP_NAME, APP_VERSION } from '@/lib/version';

const navItems = [
    {
        section: 'APP',
        items: [
            {
                href: '/map',
                label: 'Carte',
                icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                    </svg>
                ),
                badge: null,
                badgeClass: '',
            },
            {
                href: '/copilote',
                label: 'Copilote IA',
                icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="9" cy="10" r="1.5" fill="currentColor" stroke="none" />
                        <circle cx="15" cy="10" r="1.5" fill="currentColor" stroke="none" />
                        <path d="M9 15c0 0 1 1.5 3 1.5s3-1.5 3-1.5" />
                        <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2z" />
                    </svg>
                ),
                badge: 'BETA',
                badgeClass: 'badge-api',
            },
        ],
    },
    {
        section: 'ADMIN',
        items: [
            {
                href: '/integration-panneaux',
                label: 'Intégration',
                icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                        <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                    </svg>
                ),
                badge: 'CSV',
                badgeClass: 'badge-api',
            },
            {
                href: '/admin/carreaux-import',
                label: 'Import Shapefile',
                icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                ),
                badge: 'ADMIN',
                badgeClass: 'badge-admin',
            },
            {
                href: '/admin/import',
                label: 'Import Universel',
                icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="12" y1="18" x2="12" y2="12" />
                        <polyline points="9 15 12 12 15 15" />
                    </svg>
                ),
                badge: 'ADMIN',
                badgeClass: 'badge-admin',
            },
            {
                href: '/admin/ooh-import',
                label: 'Import OOH',
                icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="2" y="3" width="20" height="14" rx="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                ),
                badge: 'ADMIN',
                badgeClass: 'badge-admin',
            },
        ],
    },
    {
        section: 'SYSTEM',
        items: [
            {
                href: '/admin/sources',
                label: 'Sources',
                icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <ellipse cx="12" cy="5" rx="9" ry="3" />
                        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                    </svg>
                ),
                badge: null,
                badgeClass: '',
            },
            {
                href: '/admin/organizations',
                label: 'Organisations',
                icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                ),
                badge: null,
                badgeClass: '',
            },
            {
                href: '/login',
                label: 'Connexion',
                icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                ),
                badge: null,
                badgeClass: '',
            },
            {
                href: '/admin/network-cache',
                label: 'Cache Réseau',
                icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                ),
                badge: 'ORS',
                badgeClass: 'badge-api',
            },
            {
                href: '/admin/health',
                label: 'Health Check',
                icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                ),
                badge: 'SYS',
                badgeClass: 'badge-api',
            },
            {
                href: '/debug-coverage',
                label: 'Debug Coverage',
                icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                        <path d="M12 8v4M12 16h.01" />
                    </svg>
                ),
                badge: 'DBG',
                badgeClass: 'badge-admin',
            },
        ],
    },
];

export default function GeoPromptNav() {
    const pathname = usePathname();
    const [time, setTime] = useState('');

    useEffect(() => {
        const updateTime = () => {
            const now = new Date();
            setTime(now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        };
        updateTime();
        const interval = setInterval(updateTime, 1000);
        return () => clearInterval(interval);
    }, []);

    return (
        <aside className="genesis-sidebar">

            {/* Logo */}
            <div className="sidebar-logo">
                <div className="sidebar-logo-title">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                    {APP_NAME}
                    <span className="sidebar-logo-badge">v{APP_VERSION}</span>
                </div>
                <div className="sidebar-logo-sub">AI Media Planning</div>
            </div>

            {/* Navigation */}
            <nav className="sidebar-nav">
                {navItems.map((section) => (
                    <div key={section.section} className="sidebar-section">
                        <div className="sidebar-section-label">{section.section}</div>
                        {section.items.map((item) => {
                            const isActive =
                                pathname === item.href ||
                                (item.href !== '/' && pathname.startsWith(item.href));
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`sidebar-link${isActive ? ' active' : ''}`}
                                >
                                    <span className="sidebar-link-icon">{item.icon}</span>
                                    {item.label}
                                    {item.badge && (
                                        <span className={`sidebar-link-badge ${item.badgeClass}`}>
                                            {item.badge}
                                        </span>
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                ))}
            </nav>

            {/* Footer */}
            <div className="sidebar-footer">
                <div className="sidebar-status">
                    <span className="relative flex" style={{ width: 6, height: 6 }}>
                        <span className="status-dot" style={{ position: 'absolute', inset: 0, borderRadius: '50%', opacity: 0.7, animation: 'pulse-dot 2s ease-in-out infinite' }} />
                        <span className="status-dot" style={{ position: 'relative' }} />
                    </span>
                    <div>
                        <div className="status-text" style={{ color: 'var(--green)', fontWeight: 400, letterSpacing: '0.08em' }}>
                            System_Online
                        </div>
                        <div className="status-text" style={{ fontSize: 9, marginTop: 1, fontFamily: 'JetBrains Mono, monospace' }}>{time}</div>
                    </div>
                </div>
            </div>

        </aside>
    );
}
