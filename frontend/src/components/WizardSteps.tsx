import { CheckIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'

// Numbered step indicator shared by the submit-job wizards (dynamic and
// fallback forms) — purely presentational, the parent owns the step state.

export default function WizardSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center">
      {steps.map((label, idx) => {
        const num = idx + 1
        const state = num < current ? 'done' : num === current ? 'active' : 'upcoming'
        return (
          <li key={label} className={clsx('flex items-center', idx < steps.length - 1 && 'flex-1')}>
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  state === 'done' && 'bg-indigo-600 text-white',
                  state === 'active' && 'border-2 border-indigo-600 text-indigo-600 bg-indigo-50',
                  state === 'upcoming' && 'border-2 border-gray-300 text-gray-400'
                )}
              >
                {state === 'done' ? <CheckIcon className="h-4 w-4" /> : num}
              </span>
              <span
                className={clsx(
                  'text-sm font-medium whitespace-nowrap',
                  state === 'upcoming' ? 'text-gray-400' : 'text-gray-900'
                )}
              >
                {label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={clsx('h-px flex-1 mx-3', num < current ? 'bg-indigo-600' : 'bg-gray-200')} />
            )}
          </li>
        )
      })}
    </ol>
  )
}
