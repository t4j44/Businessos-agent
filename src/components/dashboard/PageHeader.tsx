// Standard page header: display-face title, muted subtitle, optional action.
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-page font-normal text-text">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm leading-5 text-dim">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex flex-shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}
