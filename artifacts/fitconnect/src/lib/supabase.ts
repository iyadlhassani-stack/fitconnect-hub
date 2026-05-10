import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

const isValidUrl = (url: string) => {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

const resolvedUrl = isValidUrl(supabaseUrl)
  ? supabaseUrl
  : supabaseUrl
    ? `https://${supabaseUrl}.supabase.co`
    : 'https://placeholder.supabase.co'

export const supabase = createClient(resolvedUrl, supabaseAnonKey || 'placeholder')
