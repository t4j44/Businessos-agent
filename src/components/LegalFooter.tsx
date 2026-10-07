import Link from 'next/link'

// The legal footer, shared so a new page cannot quietly ship without these
// links. Rendered on /pricing, /login and dashboard settings.
//
// A server component with no state: it is a row of links, so it does not need
// to be part of any client bundle.
export function LegalFooter({ className = '' }: { className?: string }) {
  return (
    <footer className={`mt-12 border-t border-line pt-6 ${className}`}>
      <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-dim">
        <Link href="/privacy" className="hover:text-text hover:underline">Privacy Policy</Link>
        <Link href="/terms" className="hover:text-text hover:underline">Terms of Service</Link>
        <Link href="/support" className="hover:text-text hover:underline">Support</Link>
      </nav>
    </footer>
  )
}
