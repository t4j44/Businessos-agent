'use client'

import { useEffect } from 'react'
import { RotateCcw, AlertTriangle } from 'lucide-react'

const CLIENT_ID = 'dev-test-client'

export default function DevToolbar({ hasApiKey }: { hasApiKey: boolean }) {
  // Inject widget script once on mount
  useEffect(() => {
    if (document.querySelector('script[data-client-id="dev-test-client"]')) return
    const s = document.createElement('script')
    s.src = '/widget/widget.js'
    s.setAttribute('data-client-id', CLIENT_ID)
    document.body.appendChild(s)
  }, [])

  function resetChat() {
    sessionStorage.removeItem(`bos_sid_${CLIENT_ID}`)
    sessionStorage.removeItem(`bos_conv_${CLIENT_ID}`)
    // Remove widget DOM so it re-initialises on reload
    window.location.reload()
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-slate-950 border-b border-slate-800">
      {/* Main toolbar row */}
      <div className="flex items-center gap-4 px-4 py-2 text-xs font-mono text-slate-300">
        <span className="text-slate-500">🧪</span>
        <span className="font-semibold text-white">Widget Test Mode</span>

        <span className="text-slate-600">|</span>

        <span className="flex items-center gap-1.5">
          <span className="text-slate-500">API</span>
          <span
            className={`w-2 h-2 rounded-full ${hasApiKey ? 'bg-green-400 shadow-[0_0_6px_#4ade80]' : 'bg-red-500'}`}
            title={hasApiKey ? 'ANTHROPIC_API_KEY is set' : 'ANTHROPIC_API_KEY missing'}
          />
          <span className={hasApiKey ? 'text-green-400' : 'text-red-400'}>
            {hasApiKey ? 'live' : 'demo'}
          </span>
        </span>

        <span className="text-slate-600">|</span>

        <span className="text-slate-500">
          Client ID: <span className="text-blue-400">{CLIENT_ID}</span>
        </span>

        <button
          onClick={resetChat}
          className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700"
        >
          <RotateCcw className="w-3 h-3" />
          Reset Chat
        </button>
      </div>

      {/* Demo mode warning */}
      {!hasApiKey && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-500/10 border-t border-amber-500/20 text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          Widget running in <strong className="mx-1">DEMO MODE</strong> — add{' '}
          <code className="mx-1 px-1 py-0.5 rounded bg-amber-500/20 text-amber-200 font-mono">
            ANTHROPIC_API_KEY
          </code>{' '}
          to <code className="ml-1 px-1 py-0.5 rounded bg-amber-500/20 text-amber-200 font-mono">.env.local</code>{' '}
          for real AI responses
        </div>
      )}
    </div>
  )
}
