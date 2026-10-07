import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'
import { readLegalDocument } from '@/lib/legal'

const document = readLegalDocument('terms')

export const metadata: Metadata = {
  title: 'Terms of Service',
  robots: document.isPlaceholder ? { index: false, follow: false } : undefined,
}

export default function TermsPage() {
  return <LegalPage title="Terms of Service" document={document} />
}
