import { createLogger } from '../utils/logger'

const logger = createLogger('AuthStore')

const STORAGE_KEY = 'psap_auth'

export interface AuthCredentials {
  username: string
  password: string
}

let credentials: AuthCredentials | null = null

function loadFromStorage(): AuthCredentials | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {
    // ignore parse errors
  }
  return null
}

credentials = loadFromStorage()

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      credentials = loadFromStorage()
      window.dispatchEvent(new Event('auth-change'))
    }
  })
}

export function getCredentials(): AuthCredentials | null {
  return credentials
}

export function isAuthenticated(): boolean {
  return credentials !== null
}

export function getBasicAuthHeader(): string | null {
  if (!credentials) return null
  return 'Basic ' + btoa(`${credentials.username}:${credentials.password}`)
}

export function setCredentials(creds: AuthCredentials): void {
  credentials = creds
  localStorage.setItem(STORAGE_KEY, JSON.stringify(creds))
  logger.info('User authenticated:', creds.username)
  window.dispatchEvent(new Event('auth-change'))
}

export function clearCredentials(): void {
  credentials = null
  localStorage.removeItem(STORAGE_KEY)
  logger.info('User logged out')
  window.dispatchEvent(new Event('auth-change'))
}
