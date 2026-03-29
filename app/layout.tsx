import type { Metadata } from 'next'
import './globals.css'
import GenesisNav from '@/components/GenesisNav'

export const metadata: Metadata = {
  title: 'GENESIS — AI Media Planning',
  description: 'Parse French prompts into structured outdoor advertising filters using Mistral AI',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" className="dark">
      <body>
        <div className="genesis-layout">
          {/* Ta barre de navigation latérale */}
          <GenesisNav />
          
          {/* La zone principale à droite */}
          <main className="genesis-main">
            {/* Le conteneur qui applique les marges intérieures de ton Design System */}
            <div className="genesis-content">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  )
}