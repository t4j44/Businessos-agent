/*
 * Google OAuth provider setup instructions for Supabase:
 * 1. Go to Google Cloud Console (console.cloud.google.com)
 * 2. Create a new project or select an existing one
 * 3. Navigate to APIs & Services > Credentials
 * 4. Configure OAuth consent screen if not done already
 * 5. Create Credentials > OAuth client ID
 * 6. Application type: Web application
 * 7. Add Authorized Redirect URIs: <YOUR_SUPABASE_URL>/auth/v1/callback
 * 8. Copy Client ID and Client Secret
 * 9. Go to Supabase Dashboard > Authentication > Providers > Google
 * 10. Enable Google, paste Client ID and Secret, and save
 */

'use client';

import { useRef, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { MeshBackdrop } from '@/components/visual/MeshBackdrop';
import { GlassLens } from '@/components/visual/GlassLens';
import { LegalFooter } from '@/components/LegalFooter';

export default function LoginPage() {
  const cardRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<null | 'loading' | 'sent' | 'error'>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Built here rather than imported from @/lib/supabase so the login page never
  // pulls the admin/service-role module into its bundle. Only NEXT_PUBLIC_ vars
  // exist in the browser, and reaching for a server key here is what produced
  // "supabaseKey is required." on page load.
  const [supabase] = useState(() =>
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  );

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setErrorMessage('');
    
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback`
      }
    });

    if (error) {
      setStatus('error');
      setErrorMessage(error.message);
    } else {
      setStatus('sent');
    }
  };

  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`
      }
    });
  };

  return (
    <main className="relative min-h-screen bg-canvas flex items-center justify-center p-4 font-sans text-text">
      {/* The scene the lens refracts. Everything animated lives in here and
          nowhere else — no /dashboard route imports this component. */}
      <div id="glass-scene" className="pointer-events-none fixed inset-0 -z-10">
        <MeshBackdrop />
      </div>

      {/* Real optical refraction, one instance, behind the card only. */}
      <GlassLens targetRef={cardRef} radius={24} />

      <div
        ref={cardRef}
        className="glass glass-text relative z-10 w-full max-w-md overflow-hidden rounded-[24px] p-8"
      >
        {/* Opaque bed under the form copy so blur cannot drop contrast below 4.5:1 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[24px]"
          style={{ background: '#0A0A0B80' }}
        />

        {/* Logo & Tagline */}
        <div className="relative text-center mb-8">
          <h1 className="font-display text-4xl leading-tight text-text mb-2" style={{ letterSpacing: '-0.02em' }}>
            Business OS
          </h1>
          <p className="label-caps">Your AI operations team</p>
        </div>

        <div className="relative">
          {status === 'sent' ? (
            <div className="rounded-lg border border-good/20 bg-good/10 p-5 text-center">
              <p className="font-medium text-good">Check your email for the login link.</p>
            </div>
          ) : (
            <>
              {/* Magic Link Form */}
              <form onSubmit={handleMagicLink} className="space-y-4">
                <div>
                  <label htmlFor="email" className="label-caps mb-1.5 block">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-line bg-raised/70 px-4 py-2.5 text-text placeholder:text-faint focus:outline-none focus-visible:border-accent"
                    placeholder="you@company.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="flex w-full items-center justify-center rounded-lg bg-accent px-4 py-2.5 font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {status === 'loading' ? 'Sending...' : 'Send Magic Link'}
                </button>
              </form>

              {errorMessage && (
                <p className="mt-4 text-center text-sm text-crit">{errorMessage}</p>
              )}

              {/* Divider */}
              <div className="my-6 flex items-center justify-center">
                <div className="h-px w-full bg-line"></div>
                <span className="label-caps px-3">or</span>
                <div className="h-px w-full bg-line"></div>
              </div>

              {/* Google Auth */}
              <button
                onClick={handleGoogleSignIn}
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-line bg-transparent px-4 py-2.5 font-medium text-text hover:border-line-strong hover:bg-raised/60"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              {/* Consent has to be visible before the action it applies to, not
                  buried in a footer below it. */}
              <p className="mt-6 text-center text-xs text-dim">
                By continuing, you agree to our{' '}
                <a href="/terms" className="text-accent hover:underline">Terms</a>
                {' '}and{' '}
                <a href="/privacy" className="text-accent hover:underline">Privacy Policy</a>.
              </p>
            </>
          )}
        </div>

        <LegalFooter />
      </div>
    </main>
  );
}
