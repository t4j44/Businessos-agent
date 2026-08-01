import DevToolbar from './DevToolbar'
import { Zap, BarChart3, Shield, Check, Code2, Terminal } from 'lucide-react'

export default function WidgetTestPage() {
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY

  return (
    // Extra top padding for the fixed dev toolbar (toolbar is ~36px or ~60px with warning)
    <div className={`${hasApiKey ? 'pt-10' : 'pt-[60px]'} bg-[#050A14] min-h-screen font-sans`}>

      <DevToolbar hasApiKey={hasApiKey} />

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 bg-[#050A14]/95 backdrop-blur border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-8">
          {/* Logo */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <Code2 className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-white text-lg tracking-tight">DevStack</span>
          </div>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-6 text-sm text-gray-400">
            {['Home', 'Product', 'Pricing', 'Docs', 'Contact'].map(item => (
              <a key={item} href="#" className="hover:text-white transition-colors">
                {item}
              </a>
            ))}
          </nav>

          {/* CTA */}
          <div className="ml-auto flex items-center gap-3">
            <a href="#" className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5">
              Sign In
            </a>
            <a
              href="#"
              className="text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Get Started
            </a>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden py-24 px-6">
        {/* Gradient glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            v3.0 released — REST, GraphQL & gRPC in one platform
          </div>

          <h1 className="text-5xl md:text-6xl font-bold text-white mb-5 tracking-tight leading-tight">
            Ship APIs
            <span className="text-blue-400"> 10x faster</span>
          </h1>

          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            The developer platform trusted by{' '}
            <strong className="text-gray-200">2,000+ engineering teams</strong>{' '}
            to design, test, and ship APIs without the chaos.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <a
              href="#"
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors text-sm"
            >
              Start Free Trial
            </a>
            <a
              href="#"
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 border border-white/15 hover:border-white/30 text-white font-medium rounded-xl transition-colors text-sm"
            >
              View Demo
            </a>
          </div>

          {/* Fake dashboard */}
          <div className="rounded-2xl border border-white/8 overflow-hidden shadow-2xl shadow-black/50 bg-[#0D1117] text-left">
            {/* Window chrome */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-[#161B25]">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
              </div>
              <div className="flex-1 flex justify-center">
                <div className="px-3 py-0.5 rounded bg-[#0D1117] border border-white/5 text-xs text-gray-500 font-mono">
                  app.devstack.io/builder
                </div>
              </div>
              <Terminal className="w-4 h-4 text-gray-600" />
            </div>

            {/* Fake code content */}
            <div className="p-5 font-mono text-xs leading-relaxed overflow-hidden max-h-64">
              <div className="flex gap-6">
                {/* Left: endpoint list */}
                <div className="w-44 flex-shrink-0 space-y-1.5 text-gray-500 border-r border-white/5 pr-4">
                  <div className="text-gray-400 text-[10px] uppercase tracking-wider mb-2">Endpoints</div>
                  {[
                    { method: 'GET',    path: '/users'         },
                    { method: 'POST',   path: '/users/create'  },
                    { method: 'GET',    path: '/products'      },
                    { method: 'PUT',    path: '/orders/{id}'   },
                    { method: 'DELETE', path: '/sessions'      },
                  ].map(({ method, path }) => (
                    <div key={path} className="flex items-center gap-2">
                      <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
                        method === 'GET'    ? 'bg-green-500/15 text-green-400' :
                        method === 'POST'   ? 'bg-blue-500/15 text-blue-400'  :
                        method === 'PUT'    ? 'bg-amber-500/15 text-amber-400' :
                                             'bg-red-500/15 text-red-400'
                      }`}>{method}</span>
                      <span className="text-gray-500 truncate">{path}</span>
                    </div>
                  ))}
                </div>

                {/* Right: response preview */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] uppercase tracking-wider text-gray-600">Response</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">200 OK</span>
                    <span className="text-[10px] text-gray-600 ml-auto">42ms</span>
                  </div>
                  <pre className="text-gray-400">
{`{
  "users": [
    {
      "id": "usr_01hw2x",
      "name": "Alicia Keys",
      "email": "ali@corp.io",
      "plan": "pro",
      "created": "2024-12-01"
    }
  ],
  "total": 2847,
  "page": 1
}`}
                  </pre>
                </div>
              </div>
            </div>
          </div>

          {/* Social proof */}
          <div className="flex items-center justify-center gap-6 mt-8 text-xs text-gray-600">
            <span>✓ No credit card required</span>
            <span>✓ Free tier available</span>
            <span>✓ Setup in 5 minutes</span>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-20 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-sm font-medium text-blue-400 uppercase tracking-widest mb-3">
            Why DevStack
          </p>
          <h2 className="text-center text-3xl font-bold text-white mb-16">
            Everything you need to ship faster
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon:  Zap,
                color: 'text-yellow-400',
                bg:    'bg-yellow-400/10',
                title: 'Fast Integration',
                desc:  'Connect any REST, GraphQL, or gRPC API in minutes. Auto-generated SDKs for 12 languages out of the box.',
              },
              {
                icon:  BarChart3,
                color: 'text-blue-400',
                bg:    'bg-blue-400/10',
                title: 'Real-time Analytics',
                desc:  'Monitor latency, error rates, and usage across all your endpoints. P95/P99 breakdowns included by default.',
              },
              {
                icon:  Shield,
                color: 'text-green-400',
                bg:    'bg-green-400/10',
                title: 'Enterprise Security',
                desc:  'SOC 2 Type II, OAuth 2.0, IP allowlisting, and audit logs. SSO with Okta, Azure AD, and Google Workspace.',
              },
            ].map(({ icon: Icon, color, bg, title, desc }) => (
              <div key={title} className="p-6 rounded-2xl bg-[#0D1117] border border-white/6 hover:border-white/10 transition-colors">
                <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-4`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <h3 className="font-semibold text-white mb-2">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="py-20 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-sm font-medium text-blue-400 uppercase tracking-widest mb-3">
            Pricing
          </p>
          <h2 className="text-center text-3xl font-bold text-white mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-center text-gray-500 mb-14 text-sm">
            Start free. Upgrade when you&apos;re ready.
          </p>

          <div className="grid md:grid-cols-3 gap-6 items-start">
            {/* Starter */}
            <div className="p-6 rounded-2xl bg-[#0D1117] border border-white/6">
              <div className="mb-5">
                <h3 className="text-white font-semibold mb-1">Starter</h3>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-white">$49</span>
                  <span className="text-gray-500 text-sm">/month</span>
                </div>
                <p className="text-xs text-gray-600 mt-1">For individuals & small teams</p>
              </div>
              <ul className="space-y-2.5 mb-6">
                {['5 projects', 'Basic analytics', '10K API calls/day', 'Email support', 'REST & GraphQL'].map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-gray-400">
                    <Check className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <a href="#" className="block text-center py-2.5 px-4 rounded-xl border border-white/10 hover:border-white/20 text-sm font-medium text-white transition-colors">
                Start Free Trial
              </a>
            </div>

            {/* Pro — highlighted */}
            <div className="p-6 rounded-2xl bg-blue-600/10 border border-blue-500/30 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-blue-600 rounded-full text-xs font-semibold text-white">
                Most Popular
              </div>
              <div className="mb-5">
                <h3 className="text-white font-semibold mb-1">Pro</h3>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-white">$149</span>
                  <span className="text-gray-400 text-sm">/month</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">For growing engineering teams</p>
              </div>
              <ul className="space-y-2.5 mb-6">
                {[
                  'Unlimited projects',
                  'Real-time analytics',
                  '500K API calls/day',
                  'Priority support',
                  'Team collaboration',
                  'REST, GraphQL & gRPC',
                ].map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-gray-300">
                    <Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <a href="#" className="block text-center py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors">
                Start Free Trial
              </a>
            </div>

            {/* Enterprise */}
            <div className="p-6 rounded-2xl bg-[#0D1117] border border-white/6">
              <div className="mb-5">
                <h3 className="text-white font-semibold mb-1">Enterprise</h3>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-white">Custom</span>
                </div>
                <p className="text-xs text-gray-600 mt-1">For large-scale organisations</p>
              </div>
              <ul className="space-y-2.5 mb-6">
                {[
                  'Everything in Pro',
                  'SSO (Okta, Azure AD)',
                  'Unlimited API calls',
                  'Dedicated SLA',
                  'Custom integrations',
                  'Audit logs & SIEM',
                ].map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-gray-400">
                    <Check className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <a href="#" className="block text-center py-2.5 px-4 rounded-xl border border-white/10 hover:border-white/20 text-sm font-medium text-white transition-colors">
                Contact Sales
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-blue-600 flex items-center justify-center">
              <Code2 className="w-3 h-3 text-white" />
            </div>
            <span>© 2025 DevStack, Inc. All rights reserved.</span>
          </div>
          <div className="flex gap-5">
            {['Privacy', 'Terms', 'Docs', 'Status'].map(l => (
              <a key={l} href="#" className="hover:text-gray-400 transition-colors">{l}</a>
            ))}
          </div>
        </div>
      </footer>

    </div>
  )
}
