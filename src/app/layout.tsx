import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Business OS — Your AI Operations Team',
  description: 'Replace $1.4M in annual hiring for $397/month',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className} style={{ backgroundColor: '#0F172A' }}>
        {children}
      </body>
    </html>
  )
}
