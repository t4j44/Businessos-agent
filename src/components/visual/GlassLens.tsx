'use client'

import { useEffect, useRef } from 'react'

// A real refracting lens behind one card, from liquid-glass-js.
//
// HOW THE LIBRARY ACTUALLY WORKS — this matters, because it is not what a
// "glass card" API would look like:
//
//   new LiquidGlass({ background: el, width, height, ... })
//
// It does NOT take the element you want to frost. It takes the element you
// want to REFRACT, clones it into a clipped overlay, and paints its own
// floating lens rectangle on top at a screen coordinate. There is no class
// name and no ref-to-element hook. `moveTo(x, y)` positions it; `draggable`
// defaults to true.
//
// So the composition here is: lens sits behind the card, refracting the shader
// backdrop; the card's own content renders above it at a higher z-index. The
// lens is pinned to the card's box with a ResizeObserver, and dragging is off —
// a sign-in form that slides around when you touch it is a bug, not a feature.
//
// It is genuinely cheap: the displacement map is a canvas → SVG feImage built
// once and rebuilt only when a parameter or the size changes. Nothing
// re-rasterises per frame.

type LensHandle = {
  set(p: Record<string, number | string>): unknown
  moveTo(x: number, y: number): unknown
  destroy(): void
}

export function GlassLens({
  targetRef,
  backgroundSelector = '#glass-scene',
  radius = 24,
}: {
  /** The card the lens should sit behind and match in size. */
  targetRef: React.RefObject<HTMLElement | null>
  /** The element whose pixels get bent. */
  backgroundSelector?: string
  radius?: number
}) {
  const lensRef = useRef<LensHandle | null>(null)

  useEffect(() => {
    const target = targetRef.current
    if (!target) return

    // Refraction is decoration. Anyone who asked for reduced motion gets the
    // CSS frost underneath and nothing else.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let cancelled = false
    let observer: ResizeObserver | null = null

    // Imported at effect time, not module scope: it touches document on load
    // and must never reach the server bundle.
    import('liquid-glass-js')
      .then(({ default: LiquidGlass }) => {
        if (cancelled) return

        const background = document.querySelector(backgroundSelector)
        const rect = target.getBoundingClientRect()

        const lens = new LiquidGlass({
          background,
          width: rect.width,
          height: rect.height,
          radius,
          // Restrained on purpose. The brief asked for the backdrop to warp
          // subtly through the card, not for a fisheye.
          scale: 26,
          depth: 18,
          curvature: 4,     // squircle, matching the card's own corner
          convexity: 1,
          chroma: 0.06,
          blur: 6,
          glow: 0.18,
          edge: 0.35,
          tint: 0.06,
          tintColor: '#7C5CFF',
          draggable: false,
          // Under the card content, above the backdrop.
          zIndex: 1,
          x: rect.left,
          y: rect.top,
        }) as unknown as LensHandle

        lensRef.current = lens

        const sync = () => {
          const r = target.getBoundingClientRect()
          lens.set({ width: r.width, height: r.height, radius })
          lens.moveTo(r.left, r.top)
        }

        sync()

        observer = new ResizeObserver(sync)
        observer.observe(target)
        window.addEventListener('resize', sync)
        window.addEventListener('scroll', sync, true)

        // Stash the listener so cleanup can remove the same reference.
        ;(lens as any).__sync = sync
      })
      .catch((err) => {
        // The CSS frost on the card is the fallback and is always present, so
        // a failure here costs the refraction and nothing else.
        console.error('[GlassLens] liquid-glass-js failed to load:', err)
      })

    return () => {
      cancelled = true
      observer?.disconnect()
      const lens = lensRef.current as any
      if (lens?.__sync) {
        window.removeEventListener('resize', lens.__sync)
        window.removeEventListener('scroll', lens.__sync, true)
      }
      lens?.destroy?.()
      lensRef.current = null
    }
  }, [targetRef, backgroundSelector, radius])

  return null
}

export default GlassLens
