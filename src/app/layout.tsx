import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

// Both faces are bundled locally and served from our own origin. Building
// and rendering do not require a Google Fonts request.

// The UI face. Archivo is a grotesque with slightly narrow, even widths, which
// holds up in a dense table far better than a humanist face does.
const archivo = localFont({
  src: '../../public/fonts/archivo-latin.woff2',
  weight: '400 600',
  display: 'swap',
  variable: '--font-archivo',
})

// The display face. Used ONLY for large metric figures and page-level
// headings — never body text, never UI chrome. A serif at 14px in a button
// reads as a mistake, not as taste.
const instrumentSerif = localFont({
  src: '../../public/fonts/instrument-serif-latin.woff2',
  weight: '400',
  display: 'swap',
  variable: '--font-instrument-serif',
})

export const metadata: Metadata = {
  title: 'Business OS — Your AI Operations Team',
  description: 'Business knowledge, customer conversations, appointments, and operations in one workspace.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${archivo.variable} ${instrumentSerif.variable}`}>
      <body className="font-sans bg-canvas text-text antialiased">
        {children}
      </body>
    </html>
  )
}
