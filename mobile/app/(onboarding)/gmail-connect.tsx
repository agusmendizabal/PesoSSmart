import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Button, Card } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';

const FEATURES = [
  { icon: 'mail-outline',       text: 'Detectamos pagos y compras automáticamente desde tu email' },
  { icon: 'shield-checkmark-outline', text: 'Solo lectura — nunca enviamos ni modificamos nada' },
  { icon: 'lock-closed-outline', text: 'Podés desconectarlo cuando quieras desde tu perfil' },
];

export default function GmailConnectScreen() {
  const { user } = useAuthStore();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connected,    setConnected]    = useState(false);
  const [gmailEmail,   setGmailEmail]   = useState<string | null>(null);

  // Escuchar deep link de retorno
  useEffect(() => {
    const handleURL = ({ url }: { url: string }) => {
      if (!url.includes('gmail-connected')) return;
      const match    = url.match(/email=([^&]+)/);
      const hasError = url.includes('error=');
      if (match) {
        setGmailEmail(decodeURIComponent(match[1]));
        setConnected(true);
      } else if (hasError) {
        Alert.alert('Error', 'No se pudo conectar Gmail. Podés intentarlo de nuevo o saltear este paso.');
      }
      setIsConnecting(false);
    };

    const sub = Linking.addEventListener('url', handleURL);
    return () => sub.remove();
  }, []);

  const handleConnect = async () => {
    if (!user?.id) return;
    setIsConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sesión no disponible');

      const res  = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/gmail-auth?action=url`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        console.error('[handleConnect] Error del servidor:', res.status, JSON.stringify(json));
        if (res.status === 401) {
          Alert.alert('Error', 'Tu sesión no es válida. Cerrá sesión y volvé a ingresar.');
        } else {
          Alert.alert('Error', `Error del servidor (${res.status}). Podés saltear este paso e intentarlo desde tu perfil.`);
        }
        return;
      }

      if (!json.url) {
        console.error('[handleConnect] Respuesta sin URL:', JSON.stringify(json));
        Alert.alert('Error', 'No se pudo obtener el link de autorización. Podés saltear este paso.');
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(json.url, 'pesossmart://gmail-connected');

      if (result.type === 'success' && result.url) {
        const match    = result.url.match(/email=([^&]+)/);
        const hasError = result.url.includes('error=');
        if (match) {
          setGmailEmail(decodeURIComponent(match[1]));
          setConnected(true);
        } else if (hasError) {
          const errMatch = result.url.match(/error=([^&]+)/);
          const errMsg   = errMatch ? decodeURIComponent(errMatch[1]) : '';
          console.error('[handleConnect] Error en callback:', errMsg);
          Alert.alert('Error', 'No se pudo conectar Gmail. Podés intentarlo de nuevo o saltear este paso.');
        }
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        console.log('[handleConnect] Usuario canceló la autorización de Gmail');
      }
    } catch (err) {
      console.error('[handleConnect] Error inesperado:', err);
      Alert.alert('Error', 'No se pudo iniciar la conexión. Verificá tu conexión a internet.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleContinue = () => router.replace('/(app)/home');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Barra de progreso — último paso */}
      <View style={styles.progressBar}>
        <View style={styles.progressFill} />
      </View>

      <View style={styles.container}>
        {/* Icono */}
        <View style={styles.iconWrap}>
          {connected
            ? <Ionicons name="checkmark-circle" size={56} color={colors.neon} />
            : <Ionicons name="mail" size={56} color={colors.neon} />
          }
        </View>

        {/* Copy */}
        <View style={styles.copy}>
          {connected ? (
            <>
              <Text variant="h3" color={colors.text.primary} align="center">
                Gmail conectado
              </Text>
              <Text variant="body" color={colors.neon} align="center">
                {gmailEmail}
              </Text>
              <Text variant="body" color={colors.text.secondary} align="center" style={styles.subtitle}>
                Vamos a detectar tus gastos automáticamente. Podés revisar y confirmar cada uno antes de registrarlo.
              </Text>
            </>
          ) : (
            <>
              <Text variant="h3" color={colors.text.primary} align="center">
                Detectá tus gastos{'\n'}automáticamente
              </Text>
              <Text variant="body" color={colors.text.secondary} align="center" style={styles.subtitle}>
                Conectá tu Gmail y encontramos tus compras, pagos y transferencias sin que tengas que cargar nada.
              </Text>
            </>
          )}
        </View>

        {/* Features */}
        {!connected && (
          <Card style={styles.featuresCard}>
            {FEATURES.map((f, i) => (
              <View key={i} style={[styles.featureRow, i < FEATURES.length - 1 && styles.featureBorder]}>
                <Ionicons name={f.icon as any} size={18} color={colors.neon} />
                <Text variant="caption" color={colors.text.secondary} style={{ flex: 1 }}>
                  {f.text}
                </Text>
              </View>
            ))}
          </Card>
        )}

        {/* Paso indicador */}
        <Text variant="caption" color={colors.text.tertiary} align="center">
          ÚLTIMO PASO
        </Text>

        {/* Acciones */}
        <View style={styles.actions}>
          {connected ? (
            <Button
              label="IR A MI DASHBOARD"
              variant="neon"
              size="lg"
              fullWidth
              onPress={handleContinue}
            />
          ) : (
            <>
              <Button
                label="CONECTAR GMAIL"
                variant="neon"
                size="lg"
                fullWidth
                isLoading={isConnecting}
                leftIcon={<Ionicons name="mail-outline" size={18} color={colors.black} />}
                onPress={handleConnect}
              />
              <Button
                label="Saltear este paso"
                variant="ghost"
                size="md"
                fullWidth
                onPress={handleContinue}
              />
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },

  progressBar: {
    height:          3,
    backgroundColor: colors.border.default,
  },
  progressFill: {
    height:          3,
    width:           '100%',
    backgroundColor: colors.neon,
  },

  container: {
    flex:              1,
    paddingHorizontal: layout.screenPadding,
    paddingTop:        spacing[10],
    paddingBottom:     spacing[6],
    alignItems:        'center',
    justifyContent:    'space-between',
  },

  iconWrap: {
    width:           96,
    height:          96,
    backgroundColor: colors.neon + '15',
    borderWidth:     1,
    borderColor:     colors.neon + '40',
    alignItems:      'center',
    justifyContent:  'center',
  },

  copy: {
    alignItems: 'center',
    gap:        spacing[3],
    width:      '100%',
  },
  subtitle: {
    lineHeight: 22,
    marginTop:  spacing[1],
  },

  featuresCard: {
    width:   '100%',
    padding: 0,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           spacing[3],
    padding:       spacing[4],
  },
  featureBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },

  actions: {
    width: '100%',
    gap:   spacing[3],
  },
});
