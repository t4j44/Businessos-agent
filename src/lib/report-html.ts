import sanitizeHtml from 'sanitize-html'

/** AI text and retrieved sources are not trusted HTML. Strip active content,
 * remote images, forms, inline styles and arbitrary attributes in every view. */
export function sanitizeReportHtml(value: unknown): string {
  if (typeof value !== 'string') return ''
  return sanitizeHtml(value.slice(0, 200000), {
    allowedTags: ['h1','h2','h3','h4','p','br','hr','strong','b','em','i','ul','ol','li','blockquote','table','thead','tbody','tr','th','td','span','div','a'],
    allowedAttributes: { a: ['href', 'rel'], th: ['colspan'], td: ['colspan'] },
    allowedSchemes: ['https', 'http'],
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) },
  })
}
