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
    <html lang="fr">
      <body>
        <div className="genesis-layout">
          <GenesisNav />
          <main className="genesis-main">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
