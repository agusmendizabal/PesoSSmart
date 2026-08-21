import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Faltan variables de entorno. Revisá el archivo .env en mobile/');
}

// ── Callbacks para cuando la sesión muere definitivamente ─────────────────
type SessionExpiredCallback = () => void;
const _sessionExpiredListeners: SessionExpiredCallback[] = [];

export function onSessionExpired(cb: SessionExpiredCallback) {
  _sessionExpiredListeners.push(cb);
  return () => {
    const idx = _sessionExpiredListeners.indexOf(cb);
    if (idx !== -1) _sessionExpiredListeners.splice(idx, 1);
  };
}

function notifySessionExpired() {
  _sessionExpiredListeners.forEach((cb) => cb());
}

// ── Fetch wrapper con interceptor de 401 ─────────────────────────────────
let _isRefreshing = false;

const fetchWithAuthRetry: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);

  // Solo interceptar 401 de las Edge Functions de Supabase
  if (
    res.status === 401 &&
    typeof input === 'string' &&
    input.includes('/functions/v1/')
  ) {
    if (_isRefreshing) {
      // Ya hay un refresh en curso — devolver el 401 original
      return res;
    }

    _isRefreshing = true;
    console.log('[Auth] 401 detectado, refrescando sesión...');

    try {
      const { data, error } = await supabase.auth.refreshSession();

      if (error || !data.session) {
        console.warn('[Auth] refreshSession falló — sesión expirada definitivamente');
        notifySessionExpired();
        return res;
      }

      console.log('[Auth] Sesión refrescada OK, reintentando request...');

      // Reintentar con el token nuevo
      const newInit: RequestInit = {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${data.session.access_token}`,
        },
      };
      return fetch(input, newInit);
    } finally {
      _isRefreshing = false;
    }
  }

  return res;
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: fetchWithAuthRetry,
    headers: {
      'x-app-name': 'nomi-mobile',
      'x-app-version': '1.0.0',
    },
  },
});

// Helper para manejar errores de Supabase de forma limpia
export function handleSupabaseError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message: string }).message;
    // Traducir errores comunes al español
    if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.';
    if (msg.includes('Email not confirmed')) return 'Tenés que confirmar tu email antes de entrar.';
    if (msg.includes('User already registered')) return 'Ya existe una cuenta con ese email.';
    if (msg.includes('Password should be at least')) return 'La contraseña debe tener al menos 6 caracteres.';
    if (msg.includes('Unable to validate email address')) return 'El email no es válido.';
    if (msg.includes('network')) return 'Sin conexión. Revisá tu internet.';
    return msg;
  }
  return 'Algo salió mal. Intentá de nuevo.';
}
