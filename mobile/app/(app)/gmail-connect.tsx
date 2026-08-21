import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text } from '@/components/ui/Text';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';

const WORKS_WITH = [
  'Gmail',
  'Correos de facturas y recibos',
  'Confirmaciones de pago',
  'Extractos bancarios',
];

export default function GmailConnectAppScreen() {
  const { user } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const handleURL = ({ url }: { url: string }) => {
      if (!url.includes('gmail-connected')) return;
      const match    = url.match(/email=([^&]+)/);
      const hasError = url.includes('error=');
      if (match) {
        const email = decodeURIComponent(match[1]);
        Alert.alert(
          'Gmail conectado',
          `Tu cuenta ${email} quedó vinculada. Ahora detectamos gastos automáticamente.`,
          [{ text: 'Listo', onPress: () => router.back() }],
        );
      } else if (hasError) {
        Alert.alert('Error', 'No se pudo conectar Gmail. Intentá de nuevo.');
      }
      setIsLoading(false);
    };
    const sub = Linking.addEventListener('url', handleURL);
    return () => sub.remove();
  }, []);

  const handleConnect = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        Alert.alert('Sesión expirada', 'Cerrá sesión y volvé a ingresar.');
        return;
      }

      const res  = await fetch(`${supabaseUrl}/functions/v1/gmail-auth?action=url`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          Alert.alert('Error de autenticación', 'Tu sesión no es válida. Cerrá sesión y volvé a ingresar.');
        } else {
          Alert.alert('Error', `No se pudo contactar el servidor (${res.status}). Intentá de nuevo.`);
        }
        return;
      }
      if (!json.url) {
        Alert.alert('Error', 'No se pudo obtener el link de autorización. Intentá de nuevo.');
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(json.url, 'nomi://gmail-connected');

      if (result.type === 'success' && result.url) {
        const match    = result.url.match(/email=([^&]+)/);
        const hasError = result.url.includes('error=');
        if (match) {
          const email = decodeURIComponent(match[1]);
          Alert.alert(
            'Gmail conectado',
            `Tu cuenta ${email} quedó vinculada. Ahora detectamos gastos automáticamente.`,
            [{ text: 'Listo', onPress: () => router.back() }],
          );
        } else if (hasError) {
          const errMatch = result.url.match(/error=([^&]+)/);
          const errMsg   = errMatch ? decodeURIComponent(errMatch[1]) : 'Error desconocido';
          Alert.alert('Error', `No se pudo conectar Gmail: ${errMsg}. Intentá de nuevo.`);
        }
      }
    } catch {
      Alert.alert('Error', 'No se pudo iniciar la conexión con Gmail. Verificá tu conexión a internet.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <Text variant="h4">Conexión Gmail</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Gmail icon */}
        <View style={styles.iconWrap}>
          <Ionicons name="mail" size={36} color="#EA4335" />
        </View>

        {/* Title & subtitle */}
        <Text style={styles.title}>Conectá tu Gmail</Text>
        <Text style={styles.subtitle}>
          Detectamos automáticamente tus gastos a partir de los emails de tu banco o tarjeta.
        </Text>

        {/* Connect button */}
        <TouchableOpacity
          style={[styles.connectBtn, isLoading && { opacity: 0.6 }]}
          onPress={handleConnect}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="mail-outline" size={18} color="#FFFFFF" />
          )}
          <Text style={styles.connectBtnText}>
            {isLoading ? 'Conectando...' : 'Conectar con Google'}
          </Text>
        </TouchableOpacity>

        {/* Privacy card */}
        <View style={styles.privacyCard}>
          <View style={styles.privacyHeader}>
            <Ionicons name="lock-closed-outline" size={14} color="#1565C0" />
            <Text style={styles.privacyTitle}>Funciona con:</Text>
          </View>
          {WORKS_WITH.map((item, i) => (
            <View key={i} style={styles.privacyRow}>
              <Ionicons name="checkmark-circle-outline" size={14} color="#1565C0" />
              <Text style={styles.privacyItem}>{item}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },

  header: {
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingVertical:  spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },

  scroll: {
    paddingHorizontal: layout.screenPadding,
    paddingTop:        spacing[10],
    paddingBottom:     spacing[10],
    alignItems:        'center',
    gap:               spacing[6],
  },

  iconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#FEE2E2',
    alignItems: 'center', justifyContent: 'center',
  },

  title: {
    fontFamily: 'Montserrat_700Bold',
    fontSize:   22,
    color:      '#1C1C1C',
    textAlign:  'center',
  },
  subtitle: {
    fontFamily: 'Montserrat_400Regular',
    fontSize:   14,
    color:      '#6D6A63',
    textAlign:  'center',
    lineHeight: 22,
  },

  connectBtn: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            spacing[2],
    width:          '100%',
    height:         48,
    backgroundColor: '#27AE60',
    borderRadius:   12,
  },
  connectBtnText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize:   15,
    color:      '#FFFFFF',
  },

  privacyCard: {
    width:           '100%',
    backgroundColor: '#D1F7E3',
    borderRadius:    12,
    padding:         spacing[4],
    gap:             spacing[2],
  },
  privacyHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    marginBottom:  spacing[1],
  },
  privacyTitle: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize:   13,
    color:      '#27AE60',
  },
  privacyRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
  },
  privacyItem: {
    fontFamily: 'Montserrat_400Regular',
    fontSize:   13,
    color:      '#27AE60',
    flex:       1,
  },
});
