// Standard page header: 32px title, muted subtitle beneath, action right-aligned.
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
        <h1 className="text-[32px] font-semibold leading-10 tracking-tight text-[#F4F4F5]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm leading-5 text-[#71717A]">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex flex-shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}
