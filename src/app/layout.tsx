import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

// Exposed as a CSS variable so Tailwind's font-sans stack can reference it.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

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
    <html lang="en" className={inter.variable}>
      <body className={`${inter.className} bg-canvas text-ink antialiased`}>
        {children}
      </body>
    </html>
  )
}
