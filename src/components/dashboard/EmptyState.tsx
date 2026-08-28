// Shared "nothing here yet" panel.
//
// Most dashboard screens already carry a richer empty state of their own (icon,
// heading and a call to action) — those are deliberately left alone. This is
// the plain fallback for smaller surfaces that only need a line of text.
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-[#71717A] text-sm">{message}</p>
    </div>
  )
}

export default EmptyState
