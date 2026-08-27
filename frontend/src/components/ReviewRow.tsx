import clsx from 'clsx'

// Shared "review step" building blocks used by both the fallback submit form
// and DynamicSubmitForm — a bordered box with an optional header, containing
// label/value rows. Grouping rows into one of these per logical section
// (Basics, Infrastructure, Model & Workload, ...) instead of one long flat
// list is what makes the review step scannable.

export function ReviewSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      {title && (
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {title}
        </div>
      )}
      <dl className="divide-y divide-gray-100">{children}</dl>
    </div>
  )
}

export default function ReviewRow({
  label,
  value,
  missing = false,
  mono = false,
}: {
  label: string
  value?: string | null
  missing?: boolean
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd
        className={clsx(
          'text-sm text-right max-w-xs truncate',
          missing ? 'text-orange-500 italic' : 'text-gray-900 font-medium',
          mono && !missing && 'font-mono'
        )}
        title={mono ? value || undefined : undefined}
      >
        {missing ? 'Missing' : value}
      </dd>
    </div>
  )
}
