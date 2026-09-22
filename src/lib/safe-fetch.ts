import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113))
  }
  if (isIP(address) === 6) {
    // Only global unicast, excluding documentation and transition mechanisms.
    const a = address.toLowerCase()
    return /^[23][0-9a-f]{3}:/.test(a) && !a.startsWith('2001:') && !a.startsWith('2002:') && !a.startsWith('3fff:')
  }
  return false
}

export function parsePublicUrl(value: string): URL {
  const url = new URL(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || (url.port && !['80', '443'].includes(url.port))
    || hostname === 'localhost' || !hostname.includes('.') && !isIP(hostname)
    || /\.(local|localhost|internal|lan|test|invalid)$/.test(hostname)
    || (isIP(hostname) && !isPublicAddress(hostname))) {
    throw new Error('Only public HTTP or HTTPS website URLs are allowed.')
  }
  url.hash = ''
  return url
}

export async function resolvePublicUrl(value: string) {
  const url = parsePublicUrl(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true })
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Website resolves to a private or reserved network address.')
  }
  return { url, address: addresses[0] }
}

/** DNS is resolved once and pinned to the socket. Redirect destinations are
 * independently validated; private addresses cannot be reached by rebinding. */
export async function fetchPublicText(value: string, options: { timeoutMs?: number; maxBytes?: number } = {}, redirects = 0): Promise<string> {
  if (redirects > 4) throw new Error('Too many website redirects.')
  const { url, address } = await resolvePublicUrl(value)
  const maxBytes = options.maxBytes ?? 600_000
  return new Promise<string>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = transport(url, {
      method: 'GET',
      headers: { 'User-Agent': 'BusinessOS-BrandScout/1.0', Accept: 'text/html,text/css,text/plain', 'Accept-Encoding': 'identity' },
      lookup: (_host, opts, callback) => {
        if ((opts as { all?: boolean }).all) callback(null, [address] as any)
        else callback(null, address.address, address.family)
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
        res.destroy()
        if (!res.headers.location) { reject(new Error('Invalid website redirect.')); return }
        resolve(fetchPublicText(new URL(res.headers.location, url).href, options, redirects + 1))
        return
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.destroy(); reject(new Error(`Website returned HTTP ${res.statusCode}.`)); return
      }
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
        res.destroy(); reject(new Error('Compressed website response is unsupported.')); return
      }
      const chunks: Buffer[] = []
      let bytes = 0
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > maxBytes) { res.destroy(); reject(new Error('Website response exceeds the size limit.')); return }
        chunks.push(chunk)
      })
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', reject)
    })
    const timer = setTimeout(() => req.destroy(new Error('Website request timed out.')), options.timeoutMs ?? 15000)
    req.on('close', () => clearTimeout(timer))
    req.on('error', reject)
    req.end()
  })
}
