import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Cookie-based storage so sessions are shared across all *.clover.tools subdomains.
// localStorage is per-origin and can't be shared. Cookies with domain=.clover.tools can.
const COOKIE_KEY = 'clover-auth-token'
const COOKIE_DOMAIN = (() => {
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  if (host === 'localhost' || host === '127.0.0.1') return undefined
  if (host.endsWith('clover.tools')) return '.clover.tools'
  return undefined
})()

function getCookie(name) {
  if (typeof document === 'undefined') return null
  const match = document.cookie
    .split('; ')
    .find(row => row.startsWith(name + '='))
  if (!match) return null
  try {
    return decodeURIComponent(match.split('=').slice(1).join('='))
  } catch {
    return null
  }
}

function setCookie(name, value) {
  if (typeof document === 'undefined') return
  const domainPart = COOKIE_DOMAIN ? `; domain=${COOKIE_DOMAIN}` : ''
  const maxAge = 60 * 60 * 24 * 365
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/${domainPart}; max-age=${maxAge}; SameSite=Lax`
}

function removeCookie(name) {
  if (typeof document === 'undefined') return
  const domainPart = COOKIE_DOMAIN ? `; domain=${COOKIE_DOMAIN}` : ''
  document.cookie = `${name}=; path=/${domainPart}; max-age=0`
}

const cookieStorage = {
  getItem: (key) => getCookie(key),
  setItem: (key, value) => setCookie(key, value),
  removeItem: (key) => removeCookie(key),
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: cookieStorage,
        storageKey: COOKIE_KEY,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null
