import { useEffect, useCallback } from 'react'
import { Routes, Route, Navigate, Link } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Clusters from './pages/Clusters'
import ClusterDetail from './pages/ClusterDetail'
import Reservations from './pages/Reservations'
import Calendar from './pages/Calendar'
import Testing from './pages/Testing'
import Results from './pages/Results'
import Settings from './pages/Settings'
import { isAdmin, setSession } from './stores/authStore'
import { authApi } from './services/api'

function NotFound() {
  return (
    <div className="text-center py-12">
      <h1 className="text-4xl font-bold text-gray-900">404</h1>
      <p className="mt-2 text-lg text-gray-600">Page not found</p>
      <Link to="/dashboard" className="mt-4 inline-block text-primary-600 hover:text-primary-700">
        Go to Dashboard
      </Link>
    </div>
  )
}

function App() {
  const syncAuth = useCallback(() => {}, [])

  useEffect(() => {
    window.addEventListener('auth-change', syncAuth)
    return () => window.removeEventListener('auth-change', syncAuth)
  }, [syncAuth])

  useEffect(() => {
    authApi.me()
      .then((session) => {
        setSession(session)
      })
      .catch(() => {
        // No valid session cookie — anonymous viewing is fine
      })
  }, [])

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/clusters" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="clusters" element={<Clusters />} />
        <Route path="clusters/:id" element={<ClusterDetail />} />
        <Route path="reservations" element={<Reservations />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="testing" element={<Testing />} />
        <Route path="results" element={<Results />} />
        <Route path="settings" element={isAdmin() ? <Settings /> : <Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default App
