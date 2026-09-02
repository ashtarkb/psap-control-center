import { useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'

export default function YamlPreview({
  yaml,
  title = 'FournosJob YAML Preview',
  defaultOpen = true,
}: {
  yaml: string
  title?: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!yaml.trim()) return null

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-100"
      >
        <span>{title}</span>
        {open ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto bg-gray-900 text-gray-100 whitespace-pre">
          {yaml}
        </pre>
      )}
    </div>
  )
}
