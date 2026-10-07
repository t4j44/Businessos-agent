import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'
import { readLegalDocument } from '@/lib/legal'

const document = readLegalDocument('privacy')

// noindex while the placeholder is in place: an unpublished policy must not be
// indexed as if it were the real one. Resolved at build time, which is also
// when the document is read.
export const metadata: Metadata = {
  title: 'Privacy Policy',
  robots: document.isPlaceholder ? { index: false, follow: false } : undefined,
}

export default function PrivacyPage() {
  return <LegalPage title="Privacy Policy" document={document} />
}
