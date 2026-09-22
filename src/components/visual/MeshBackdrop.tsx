'use client'

import React, { Suspense, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

// Animated shader backdrop for the marketing and auth surfaces.
//
// HARD BOUNDARY: this never renders on a /dashboard route. A shader burning
// GPU behind a table someone reads every day is a battery complaint, not a
// design. It is imported by the sign-in page and nothing else.
//
// The shader is Paper Shaders' GrainGradient — zero-dependency canvas, not a
// 3D engine. `noise` is the grain; `speed` is a real time multiplier, so 0.18
// is genuinely a slow drift rather than a slowed-down animation curve.

// Canvas cannot server-render, and pulling WebGL into the server bundle throws.
const GrainGradient = dynamic(
  () => import('@paper-design/shaders-react').then((m) => m.GrainGradient),
  { ssr: false },
)

// Three near-blacks with a violet undertone. Dark enough that white text reads
// over them unaided; the scrim below is belt-and-braces.
const COLORS = ['#0A0A0B', '#0D0A1A', '#110820']
const BACK = '#0A0A0B'

/**
 * The fallback ground, used three ways: while the shader chunk loads, when it
 * fails outright, and as the permanent render under prefers-reduced-motion.
 * It is a real gradient rather than flat black so the page never looks broken.
 */
function StaticGround() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10"
      style={{
        background:
          `radial-gradient(120% 80% at 20% 0%, ${COLORS[1]} 0%, transparent 60%), ` +
          `radial-gradient(100% 70% at 85% 20%, ${COLORS[2]} 0%, transparent 55%), ` +
          BACK,
      }}
    />
  )
}

function ShaderSuspenseFallback() {
  return <div className="fixed inset-0 bg-[#0A0A0B]" aria-hidden="true" />
}

export function MeshBackdrop() {
  // `null` until the media query has been read on the client — rendering the
  // shader first and swapping it out would animate once for exactly the people
  // who asked for no animation.
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null)
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(query.matches)

    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    // A shader running in a background tab is spend with no viewer.
    const onVisibility = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  if (reducedMotion === null || reducedMotion || failed) {
    return <StaticGround />
  }

  return (
    <>
      {/* The gradient stays mounted underneath: if the canvas fails to acquire
          a WebGL context the page still has a ground rather than pure black. */}
      <StaticGround />

      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
        <Suspense fallback={<ShaderSuspenseFallback />}>
          <ShaderErrorBoundary onError={() => setFailed(true)}>
            <GrainGradient
              colors={COLORS}
              colorBack={BACK}
              // Very slow drift (0.15–0.25×). Zero when the tab is hidden,
              // which freezes the frame rather than unmounting.
              speed={visible ? 0.18 : 0}
              noise={0.35}
              softness={0.85}
              intensity={0.35}
              style={{ width: '100%', height: '100%' }}
            />
          </ShaderErrorBoundary>
        </Suspense>
      </div>

      {/* Text safety. The palette is already dark enough, but a page is read on
          hardware we cannot see — this guarantees the contrast floor. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 h-1/3"
        style={{ background: `linear-gradient(to top, ${BACK} 0%, transparent 100%)` }}
      />
    </>
  )
}

// A render error inside the canvas would otherwise take the sign-in form down
// with it. Losing the background is acceptable; losing the login is not.
class ShaderErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: () => void },
  { crashed: boolean }
> {
  state = { crashed: false }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[MeshBackdrop] shader failed, falling back to gradient:', error)
    this.props.onError()
  }

  render() {
    return this.state.crashed ? null : this.props.children
  }
}

export default MeshBackdrop
