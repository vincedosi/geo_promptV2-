import type { Metadata } from 'next'
import './globals.css'
import AppSidebar from '@/components/AppSidebar'
import { SessionBadge } from '@/components/SessionBadge'
import { ToastProvider } from '@/components/ui/geo-toast'
import { SplashScreen } from '@/components/ui/SplashScreen'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'
import { ThemeToggle } from '@/components/ThemeToggle'

export const metadata: Metadata = {
  title: 'GEOMATIK — Geospatial intelligence',
  description: 'Plateforme de géomarketing OOH — ciblage, scoring et mesure de campagnes d\'affichage extérieur.',
  icons: [{ rel: 'icon', url: '/geomatik-icon.svg', type: 'image/svg+xml' }],
}

// Blocking script: runs before React hydrates, so the correct `dark`/`light`
// class is already on <html> when the first frame paints. Prevents flash.
const themeInitScript = `
(function() {
  try {
    var saved = localStorage.getItem('geomatik-theme');
    var theme = (saved === 'light' || saved === 'dark') ? saved : 'dark';
    var root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <ThemeProvider>
          <SplashScreen minDuration={2000} />
          <ToastProvider>
            <AppSidebar />
            <div
              style={{
                position: 'fixed',
                top: 0,
                right: 0,
                zIndex: 200,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
              }}
            >
              <ThemeToggle />
              <SessionBadge />
            </div>
            <main
              className="md:pl-[240px] min-h-screen"
              style={{ background: 'var(--bg-primary)' }}
            >
              <div className="p-8">
                {children}
              </div>
            </main>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
