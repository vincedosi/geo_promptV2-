import type { Metadata } from 'next'
import './globals.css'
import AppSidebar from '@/components/AppSidebar'

export const metadata: Metadata = {
  title: 'GEOMATIK — Geospatial intelligence',
  description: 'Plateforme de géomarketing OOH — ciblage, scoring et mesure de campagnes d\'affichage extérieur.',
  icons: [{ rel: 'icon', url: '/geomatik-icon.svg', type: 'image/svg+xml' }],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" className="dark">
      <body style={{ background: '#050505', color: '#f0f0f0' }}>
        <AppSidebar />
        <main
          className="md:pl-[240px] min-h-screen"
          style={{ background: '#050505' }}
        >
          <div className="p-8">
            {children}
          </div>
        </main>
      </body>
    </html>
  )
}
