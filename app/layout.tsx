import type { Metadata } from 'next'
import './globals.css'
import AppSidebar from '@/components/AppSidebar'

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
