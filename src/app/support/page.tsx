import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'
import { readLegalDocument, supportEmail } from '@/lib/legal'

const document = readLegalDocument('support')

export const metadata: Metadata = {
  title: 'Support',
  robots: document.isPlaceholder ? { index: false, follow: false } : undefined,
}

export default function SupportPage() {
  const email = supportEmail()

  return (
    <LegalPage title="Support" document={document}>
      {/* Shown whether or not the support document itself is written: a
          customer looking for help needs the address even if the longer page is
          still a placeholder. */}
      <section className="mt-6 rounded-lg border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-text">Contact us</h2>
        {email ? (
          <>
            <p className="mt-2 text-sm text-muted">
              Email{' '}
              <a href={`mailto:${email}`} className="text-accent hover:underline">
                {email}
              </a>{' '}
              and we will come back to you.
            </p>
            <p className="mt-3 text-sm text-muted">
              To request <strong>account deletion or a copy of your data</strong>, email that
              address with your business name. You can also use the button in{' '}
              <a href="/dashboard/settings" className="text-accent hover:underline">
                Settings
              </a>
              , which fills the message in for you.
            </p>
          </>
        ) : (
          // Say so rather than rendering a dead mailto: link.
          <p className="mt-2 text-sm text-dim">
            A support address has not been configured for this deployment yet
            (<code>SUPPORT_EMAIL</code>).
          </p>
        )}
      </section>
    </LegalPage>
  )
}
