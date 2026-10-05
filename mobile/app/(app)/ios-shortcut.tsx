import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  Share,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text } from '@/components/ui/Text';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';

const SHORTCUT_URL = process.env.EXPO_PUBLIC_IOS_SHORTCUT_URL;
const ENDPOINT = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/ios-shortcut-ingest`;

const USES = [
  {
    icon: 'share-outline',
    title: 'Compartir',
    body: 'Desde cualquier app, compartí una captura del banco, un ticket o un texto y elegí "PesoSSmart".',
  },
  {
    icon: 'chatbubble-ellipses-outline',
    title: 'SMS del banco, automático',
    body: 'En Atajos → Automatización → Mensaje, elegí el número de tu banco, activá "Ejecutar inmediatamente" y como acción "PesoSSmart" con el contenido del mensaje.',
  },
  {
    icon: 'mic-outline',
    title: 'Siri',
    body: 'Decí "Oye Siri, PesoSSmart" y dictá el gasto: "gasté 5.000 en la verdulería".',
  },
];

type TokenInfo = { created_at: string; last_used_at: string | null };

export default function IosShortcutScreen() {
  const { user } = useAuthStore();
  const [info,       setInfo]       = useState<TokenInfo | null>(null);
  const [newToken,   setNewToken]   = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);

  const loadInfo = async () => {
    if (!user?.id) return;
    const { data } = await (supabase as any)
      .from('shortcut_tokens')
      .select('created_at, last_used_at')
      .eq('user_id', user.id)
      .maybeSingle();
    setInfo(data ?? null);
    setLoading(false);
  };

  useEffect(() => { loadInfo(); }, [user?.id]);

  const generate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await (supabase as any).rpc('create_shortcut_token');
      if (error || !data) throw error;
      setNewToken(data);
      await loadInfo();
    } catch {
      Alert.alert('Error', 'No se pudo generar el token. Intentá de nuevo.');
    } finally {
      setGenerating(false);
    }
  };

  const confirmGenerate = () => {
    if (!info) return generate();
    Alert.alert(
      'Generar nuevo token',
      'El token anterior va a dejar de funcionar y vas a tener que actualizarlo en el atajo.',
      [{ text: 'Cancelar', style: 'cancel' }, { text: 'Generar', onPress: generate }],
    );
  };

  const disable = () => {
    Alert.alert('Desactivar atajo', 'El atajo va a dejar de registrar gastos.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desactivar',
        style: 'destructive',
        onPress: async () => {
          const { error } = await (supabase as any).from('shortcut_tokens').delete().eq('user_id', user?.id);
          if (error) return Alert.alert('Error', 'No se pudo desactivar. Intentá de nuevo.');
          setInfo(null);
          setNewToken(null);
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <Text variant="h4">Atajos de iOS</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text variant="h3">Registrá gastos sin abrir la app</Text>
        <Text variant="bodySmall" color={colors.text.secondary}>
          Con un atajo de iPhone podés mandar capturas, tickets, SMS del banco o un dictado a PesoSSmart.
          Los gastos aparecen en tus pendientes para que los revises.
        </Text>

        {/* ── Paso 1: token ─────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text variant="label" color={colors.text.tertiary}>1 · TU TOKEN PERSONAL</Text>

          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : newToken ? (
            <>
              <Text variant="caption" color={colors.text.secondary}>
                Copialo ahora: por seguridad no lo vamos a volver a mostrar.
              </Text>
              <View style={styles.tokenBox}>
                <Text variant="caption" selectable style={styles.mono}>{newToken}</Text>
              </View>
              <TouchableOpacity style={styles.btn} onPress={() => Share.share({ message: newToken })} activeOpacity={0.85}>
                <Ionicons name="copy-outline" size={16} color={colors.text.inverse} />
                <Text variant="button" color={colors.text.inverse}>Copiar token</Text>
              </TouchableOpacity>
            </>
          ) : info ? (
            <Text variant="bodySmall" color={colors.text.secondary}>
              Token activo desde el {new Date(info.created_at).toLocaleDateString('es-AR')}.
              {info.last_used_at
                ? ` Último uso: ${new Date(info.last_used_at).toLocaleString('es-AR')}.`
                : ' Todavía no se usó.'}
            </Text>
          ) : (
            <Text variant="bodySmall" color={colors.text.secondary}>
              El atajo usa este token para saber que los gastos son tuyos.
            </Text>
          )}

          {!loading && (
            <TouchableOpacity
              style={[newToken ? styles.btnOutline : styles.btn, generating && { opacity: 0.6 }]}
              onPress={confirmGenerate}
              disabled={generating}
              activeOpacity={0.85}
            >
              {generating
                ? <ActivityIndicator size="small" color={newToken ? colors.primary : colors.text.inverse} />
                : <Ionicons name="key-outline" size={16} color={newToken ? colors.primary : colors.text.inverse} />}
              <Text variant="button" color={newToken ? colors.primary : colors.text.inverse}>
                {info ? 'Generar nuevo token' : 'Generar token'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Paso 2: instalar ──────────────────────────────────────── */}
        <View style={styles.card}>
          <Text variant="label" color={colors.text.tertiary}>2 · INSTALÁ EL ATAJO</Text>
          {SHORTCUT_URL ? (
            <>
              <Text variant="bodySmall" color={colors.text.secondary}>
                Al instalarlo, Atajos te va a pedir el token: pegá el que copiaste.
              </Text>
              <TouchableOpacity style={styles.btn} onPress={() => Linking.openURL(SHORTCUT_URL)} activeOpacity={0.85}>
                <Ionicons name="download-outline" size={16} color={colors.text.inverse} />
                <Text variant="button" color={colors.text.inverse}>Instalar atajo "PesoSSmart"</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text variant="bodySmall" color={colors.text.secondary}>
                Creá un atajo llamado "PesoSSmart" que reciba texto e imágenes y haga un POST con
                "Obtener contenido de URL" a esta dirección, con el encabezado
                Authorization: Bearer {'<tu token>'} y el cuerpo JSON {'{ "text": … }'} o {'{ "image": <base64> }'}.
              </Text>
              <View style={styles.tokenBox}>
                <Text variant="caption" selectable style={styles.mono}>{ENDPOINT}</Text>
              </View>
            </>
          )}
        </View>

        {/* ── Paso 3: usos ──────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text variant="label" color={colors.text.tertiary}>3 · USALO</Text>
          {USES.map(u => (
            <View key={u.title} style={styles.useRow}>
              <Ionicons name={u.icon as any} size={20} color={colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodySmall" style={{ fontFamily: 'Montserrat_600SemiBold' }}>{u.title}</Text>
                <Text variant="caption" color={colors.text.secondary}>{u.body}</Text>
              </View>
            </View>
          ))}
        </View>

        {info && (
          <TouchableOpacity onPress={disable} activeOpacity={0.7}>
            <Text variant="bodySmall" color={colors.red}>Desactivar atajo</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingVertical:   spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },

  scroll: {
    paddingHorizontal: layout.screenPadding,
    paddingTop:        spacing[6],
    paddingBottom:     spacing[10],
    gap:               spacing[5],
  },

  card: {
    backgroundColor: colors.bg.card,
    borderWidth:     1,
    borderColor:     colors.border.default,
    borderRadius:    12,
    padding:         spacing[4],
    gap:             spacing[3],
  },

  tokenBox: {
    backgroundColor: colors.bg.input,
    borderRadius:    8,
    padding:         spacing[3],
  },
  mono: { fontFamily: 'Montserrat_500Medium', letterSpacing: 0.3 },

  btn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             spacing[2],
    height:          44,
    borderRadius:    10,
    backgroundColor: colors.primary,
  },
  btnOutline: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            spacing[2],
    height:         44,
    borderRadius:   10,
    borderWidth:    1,
    borderColor:    colors.primary,
  },

  useRow: { flexDirection: 'row', gap: spacing[3], alignItems: 'flex-start' },
});
