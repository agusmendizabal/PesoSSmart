import { useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';
import { supabase } from '@/lib/supabase';

interface MpConnectResult {
  success: boolean;
  email?:  string;
  error?:  string;
}

/**
 * Flujo OAuth de conexión con Mercado Pago, compartido entre Profile y
 * el aviso de conexión en Home.
 */
export function useMpConnect(userId: string | undefined) {
  const [connecting, setConnecting] = useState(false);

  const connect = async (): Promise<MpConnectResult> => {
    if (!userId) return { success: false };
    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        return { success: false, error: 'Sesión expirada. Cerrá sesión y volvé a ingresar.' };
      }
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;

      // URL de retorno adaptada al entorno (exp:// en dev, nomi:// en producción)
      const redirectUrl = ExpoLinking.createURL('mp-connected');

      const res = await fetch(
        `${supabaseUrl}/functions/v1/mp-auth?action=url&redirect_url=${encodeURIComponent(redirectUrl)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (!res.ok) throw new Error('No se pudo obtener la URL de Mercado Pago');
      const { url } = await res.json();

      // openAuthSessionAsync intercepta automáticamente cuando el browser navega a redirectUrl
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl);

      if (result.type === 'success') {
        const deepLink = result.url;
        const match    = deepLink.match(/email=([^&]+)/);
        const hasError = deepLink.includes('error=');
        if (match) {
          return { success: true, email: decodeURIComponent(match[1]) };
        }
        if (hasError) {
          const errMatch = deepLink.match(/error=([^&]+)/);
          return { success: false, error: errMatch ? decodeURIComponent(errMatch[1]) : 'No se pudo conectar.' };
        }
      }
      return { success: false };
    } catch {
      return { success: false, error: 'No se pudo conectar con Mercado Pago.' };
    } finally {
      setConnecting(false);
    }
  };

  return { connecting, connect };
}
