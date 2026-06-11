import { useState } from 'react'
import {
  ServerStackIcon,
  CpuChipIcon,
  CalendarDaysIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { authApi } from '../services/api'
import { setCredentials } from '../stores/authStore'

const features = [
  {
    icon: ServerStackIcon,
    title: 'Cluster Management',
    description: 'Register, monitor, and manage OpenShift GPU clusters from a single pane.',
  },
  {
    icon: CpuChipIcon,
    title: 'GPU Reservations',
    description: 'Reserve full clusters or specific GPU counts with real-time availability tracking.',
  },
  {
    icon: CalendarDaysIcon,
    title: 'Scheduling & Calendar',
    description: 'Visualize reservation timelines and coordinate GPU access across teams.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'DRA Integration',
    description: 'Dynamic Resource Allocation support for accurate GPU type detection and allocation.',
  },
]

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return

    setLoading(true)
    try {
      await authApi.check(username, password)
      setCredentials({ username, password })
      toast.success('Welcome back, ' + username)
    } catch {
      toast.error('Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel - branding & features */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary-700 via-primary-600 to-primary-800 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 h-64 w-64 rounded-full bg-white/20 blur-3xl" />
          <div className="absolute bottom-32 right-20 h-48 w-48 rounded-full bg-white/20 blur-3xl" />
          <div className="absolute top-1/2 left-1/3 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        </div>

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg">
                <span className="text-white font-bold text-2xl">P</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">PSAP Control Center</h1>
                <p className="text-primary-200 text-sm">Performance & Scale for AI Platforms</p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h2 className="text-3xl font-bold text-white leading-tight">
              Manage your GPU<br />infrastructure with confidence
            </h2>
            <p className="text-primary-200 text-lg max-w-md">
              A centralized platform for managing OpenShift GPU clusters, scheduling reservations, and tracking resource utilization.
            </p>

            <div className="grid grid-cols-2 gap-4 pt-4">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-xl bg-white/10 backdrop-blur-sm p-4 border border-white/10"
                >
                  <feature.icon className="h-6 w-6 text-primary-200 mb-2" />
                  <h3 className="text-sm font-semibold text-white">{feature.title}</h3>
                  <p className="text-xs text-primary-200 mt-1 leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-primary-300 text-xs">
            &copy; {new Date().getFullYear()} Red Hat &middot; OpenShift PSAP Team
          </p>
        </div>
      </div>

      {/* Right panel - login form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-gray-50">
        <div className="w-full max-w-sm">
          {/* Mobile branding */}
          <div className="lg:hidden flex flex-col items-center mb-8">
            <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-primary-600 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-500/20 mb-4">
              <span className="text-white font-bold text-2xl">P</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">PSAP Control Center</h1>
            <p className="text-sm text-gray-500 mt-1">Performance & Scale for AI Platforms</p>
          </div>

          <div className="text-center lg:text-left mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
            <p className="mt-2 text-sm text-gray-600">
              Sign in to access cluster management and GPU reservations.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="login-username" className="block text-sm font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 transition-colors"
                placeholder="Enter your username"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 transition-colors"
                placeholder="Enter your password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 transition-all duration-200"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-gray-400">
            Contact your administrator if you need access.
          </p>
        </div>
      </div>
    </div>
  )
}
