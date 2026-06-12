import { useState, useEffect } from 'react'
import {
  EyeIcon,
  EyeSlashIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { useSlackSettings, useUpdateSlackSettings, useTestSlack } from '../hooks/useSettings'

export default function Settings() {
  const { data: slackSettings, isLoading, isError, error } = useSlackSettings()
  const updateSlack = useUpdateSlackSettings()
  const testSlack = useTestSlack()

  const [webhookUrl, setWebhookUrl] = useState('')
  const [showUrl, setShowUrl] = useState(false)

  useEffect(() => {
    if (slackSettings?.webhook_url_masked) {
      setWebhookUrl('')
    }
  }, [slackSettings])

  const handleSave = () => {
    const url = webhookUrl.trim() || null
    updateSlack.mutate(url)
  }

  const handleDisconnect = () => {
    setWebhookUrl('')
    updateSlack.mutate(null)
  }

  const hasChanges = webhookUrl.trim().length > 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 font-display">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage integrations and system configuration.</p>
      </div>

      <div className="card">
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-[#4A154B] flex items-center justify-center">
                <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.52A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.528 2.528 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z"/>
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 font-display">Slack Integration</h2>
                <p className="text-sm text-gray-500">
                  Get notified when new reservations are submitted.
                </p>
              </div>
            </div>
            {!isLoading && (
              <div className="flex items-center gap-2">
                {isError ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800">
                    <XCircleIcon className="h-3.5 w-3.5" />
                    Load failed
                  </span>
                ) : slackSettings?.enabled ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                    <CheckCircleIcon className="h-3.5 w-3.5" />
                    Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                    <XCircleIcon className="h-3.5 w-3.5" />
                    Not configured
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 space-y-4">
            {isError && (
              <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 text-sm text-orange-800">
                Failed to load Slack settings{error instanceof Error ? `: ${error.message}` : ''}. Please try refreshing the page.
              </div>
            )}
            {slackSettings?.enabled && slackSettings.webhook_url_masked && (
              <div className="text-sm text-gray-600">
                Current webhook: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">{slackSettings.webhook_url_masked}</code>
              </div>
            )}
            <div>
              <label htmlFor="webhook-url" className="block text-sm font-medium text-gray-700 mb-1">
                {slackSettings?.enabled ? 'Replace Webhook URL' : 'Webhook URL'}
              </label>
              <div className="relative">
                <input
                  id="webhook-url"
                  type={showUrl ? 'text' : 'password'}
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 pr-10 text-sm shadow-sm placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowUrl(!showUrl)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                >
                  {showUrl ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-gray-500">
                Create an <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noopener noreferrer" className="text-[#73BCF7] hover:underline">Incoming Webhook</a> in your Slack workspace and paste the URL here.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={!hasChanges || updateSlack.isPending}
                className="btn-primary disabled:opacity-50"
              >
                {updateSlack.isPending ? 'Saving...' : 'Save'}
              </button>

              {slackSettings?.enabled && (
                <>
                  <button
                    onClick={() => testSlack.mutate()}
                    disabled={testSlack.isPending || hasChanges}
                    className="btn-secondary disabled:opacity-50"
                    title={hasChanges ? 'Save changes before testing' : 'Send a test message'}
                  >
                    <PaperAirplaneIcon className="h-4 w-4 mr-1.5" />
                    {testSlack.isPending ? 'Sending...' : 'Send Test Message'}
                  </button>

                  <button
                    onClick={handleDisconnect}
                    disabled={updateSlack.isPending}
                    className="btn-secondary text-orange-600 hover:text-orange-700 disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
