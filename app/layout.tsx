import type { Metadata } from 'next'
import './globals.css'
import AppSidebar from '@/components/AppSidebar'
import { ToastProvider } from '@/components/ui/geo-toast'
import { SplashScreen } from '@/components/ui/SplashScreen'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'
import { MainPadding } from '@/components/layout/MainPadding'
import { TopRightChrome } from '@/components/layout/TopRightChrome'
import { AgentProvider, AgentPanel, AgentTrigger } from '@/app/_components/agent'
import { MagelianOverlayProvider } from '@/components/magelian/MagelianOverlayContext'
import { MagelianOverlay } from '@/components/magelian/MagelianOverlay'
import { MagelianDeepLink } from '@/components/magelian/MagelianDeepLink'

export const metadata: Metadata = {
  title: 'MAGELIAN — Geospatial intelligence',
  description: 'Plateforme de géomarketing OOH — ciblage, scoring et mesure de campagnes d\'affichage extérieur.',
  icons: [{ rel: 'icon', url: '/magelian-icon.svg', type: 'image/svg+xml' }],
}

// Blocking script: runs before React hydrates, so the correct `dark`/`light`
// class is already on <html> when the first frame paints. Prevents flash.
const themeInitScript = `
(function() {
  try {
    var saved = localStorage.getItem('magelian-theme');
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
      <body>
        <ThemeProvider>
          <SplashScreen minDuration={2000} />
          <ToastProvider>
            <AgentProvider>
              <MagelianOverlayProvider>
                <AppSidebar />
                <TopRightChrome />
                <MainPadding>{children}</MainPadding>
                <AgentTrigger />
                <AgentPanel />
                <MagelianOverlay />
                <MagelianDeepLink />
              </MagelianOverlayProvider>
            </AgentProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
