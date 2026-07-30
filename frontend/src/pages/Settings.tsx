import { useState, useEffect, useRef } from 'react'
import {
  EyeIcon,
  EyeSlashIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowUpTrayIcon,
  TrashIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline'
import { useSlackSettings, useUpdateSlackSettings, useTestSlack } from '../hooks/useSettings'
import { useBillingReports, useUploadBillingCsv, useDeleteBillingReport, useCostRefreshStatus } from '../hooks/useBilling'

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
      <BillingCsvCard />
    </div>
  )
}


function BillingCsvCard() {
  const { data, isLoading } = useBillingReports()
  const uploadMutation = useUploadBillingCsv()
  const deleteMutation = useDeleteBillingReport()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const { data: refreshStatus } = useCostRefreshStatus(autoRefresh)

  const reports = data?.reports ?? []

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      uploadMutation.mutate({ file, autoRefresh })
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="card">
      <div className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-600 flex items-center justify-center">
              <DocumentTextIcon className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 font-display">Billing Reports</h2>
              <p className="text-sm text-gray-500">
                Upload IBM Cloud billing CSV exports for cluster cost tracking.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
            {reports.length} report{reports.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <div className="flex items-center gap-4">
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleUpload}
                  className="hidden"
                  id="billing-csv-upload"
                />
                <label
                  htmlFor="billing-csv-upload"
                  className="btn-primary inline-flex items-center cursor-pointer"
                >
                  <ArrowUpTrayIcon className="h-4 w-4 mr-1.5" />
                  {uploadMutation.isPending ? 'Uploading...' : 'Upload CSV'}
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                Auto-refresh cluster costs
              </label>
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              Download the billing CSV from IBM Cloud Console &rarr; Billing &rarr; Usage &rarr; Export &rarr; Instances.
            </p>
          </div>

          {refreshStatus?.in_progress && (
            <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 p-3 rounded-lg">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Refreshing cluster costs... ({refreshStatus.completed}/{refreshStatus.total})
              {refreshStatus.last_cluster && <span className="text-blue-500">— {refreshStatus.last_cluster}</span>}
            </div>
          )}

          {uploadMutation.isError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
              Upload failed: {uploadMutation.error instanceof Error ? uploadMutation.error.message : 'Unknown error'}
            </div>
          )}

          {isLoading ? (
            <div className="text-sm text-gray-400">Loading reports...</div>
          ) : reports.length > 0 ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Clusters</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Uploaded</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {reports.map((r) => (
                    <tr key={r.billing_month}>
                      <td className="px-4 py-2.5 text-sm font-medium text-gray-900">{r.billing_month}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{r.cluster_count}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{formatSize(r.file_size)}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-500">
                        {new Date(r.uploaded_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => deleteMutation.mutate(r.billing_month)}
                          disabled={deleteMutation.isPending}
                          className="text-gray-400 hover:text-red-600 transition-colors"
                          title="Delete report"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-gray-400">No billing reports uploaded yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}
