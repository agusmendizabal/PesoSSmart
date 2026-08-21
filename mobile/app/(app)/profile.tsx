import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import * as LocalAuth from 'expo-local-authentication';
import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { colors, spacing, layout } from '@/theme';
import { Text, Card, Button, Input, FormSheetModal } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { usePlanStore } from '@/store/planStore';
import { useRoundUpStore } from '@/store/roundUpStore';
import type { RoundTo, RoundDest } from '@/store/roundUpStore';
import { PLANS } from '@/lib/plans';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BIOMETRIC_KEY = '@nomi/biometric_enabled';

const editSchema = z.object({
  full_name: z.string().min(1, 'Ingresá tu nombre.').max(80),
  phone: z.string().max(20).optional(),
});

type EditFormData = z.infer<typeof editSchema>;

interface MenuItemProps {
  icon: string;
  label: string;
  description?: string;
  onPress: () => void;
  color?: string;
  showArrow?: boolean;
}

function MenuItem({ icon, label, description, onPress, color = colors.text.secondary, showArrow = true }: MenuItemProps) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress}>
      <View style={styles.menuIcon}>
        <Ionicons name={icon as any} size={20} color={color} />
      </View>
      <View style={styles.menuText}>
        <Text variant="bodySmall" color={color === colors.red ? colors.red : colors.text.primary}>
          {label}
        </Text>
        {description && (
          <Text variant="caption" color={colors.text.secondary}>{description}</Text>
        )}
      </View>
      {showArrow && <Ionicons name="chevron-forward" size={16} color={colors.text.tertiary} />}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const { profile, user, signOut, updateProfile, isLoading } = useAuthStore();
  const {
    effectivePlan,
    msgCount,
    msgLimit,
    isTrialActive,
    daysLeftInTrial,
    planExpiresAt,
    load: loadPlan,
  } = usePlanStore();

  const roundUp = useRoundUpStore();

  useEffect(() => {
    if (user?.id) loadPlan(user.id);
  }, [user?.id]);

  useEffect(() => {
    roundUp.load();
    roundUp.checkReset();
  }, []);

  const trialActive   = isTrialActive();
  const daysLeft      = daysLeftInTrial();
  const plan          = PLANS[effectivePlan];
  const renewalDate   = !trialActive && planExpiresAt
    ? new Date(planExpiresAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const [showEditModal,    setShowEditModal]    = useState(false);
  const [showRoundUpModal, setShowRoundUpModal] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [gmailEmail,    setGmailEmail]    = useState<string | null>(null);
  const [mpEmail,       setMpEmail]       = useState<string | null>(null);
  const [mpConnecting,  setMpConnecting]  = useState(false);
  const [mpSyncing,     setMpSyncing]     = useState(false);
  const [mpLastSync,    setMpLastSync]    = useState<Date | null>(null);
  const [mpSyncCount,   setMpSyncCount]   = useState(0);
  const [mpSyncStatus,  setMpSyncStatus]  = useState<'ok' | 'token_expired' | 'never' | 'error'>('never');

  const loadMpStatus = async () => {
    if (!user?.id) return;
    const { data } = await (supabase as any)
      .from('mp_connections')
      .select('mp_email, mp_user_id, last_checked_at, last_sync_count, last_sync_status')
      .eq('user_id', user.id)
      .maybeSingle();
    if (data) {
      setMpEmail(data.mp_email ?? data.mp_user_id);
      setMpLastSync(data.last_checked_at ? new Date(data.last_checked_at) : null);
      setMpSyncCount(data.last_sync_count ?? 0);
      setMpSyncStatus(data.last_sync_status ?? 'never');
    }
  };

  // Cargar estado de Gmail y MP al entrar
  useEffect(() => {
    if (!user?.id) return;
    (supabase as any)
      .from('gmail_connections')
      .select('gmail_email')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }: { data: { gmail_email: string } | null }) => {
        if (data) setGmailEmail(data.gmail_email);
      });
    loadMpStatus();
  }, [user?.id]);

  // ── Biometría ──────────────────────────────────────────────────────────────
  useEffect(() => {
    LocalAuth.hasHardwareAsync().then(has => {
      if (!has) return;
      LocalAuth.isEnrolledAsync().then(enrolled => {
        setBiometricAvailable(enrolled);
      });
    });
    AsyncStorage.getItem(BIOMETRIC_KEY).then(v => setBiometricEnabled(v === 'true'));
  }, []);

  const toggleBiometric = useCallback(async (value: boolean) => {
    if (value) {
      const result = await LocalAuth.authenticateAsync({
        promptMessage: 'Confirmá tu identidad para activar la seguridad biométrica',
        fallbackLabel:  'Usar contraseña',
      });
      if (!result.success) return;
    }
    setBiometricEnabled(value);
    await AsyncStorage.setItem(BIOMETRIC_KEY, String(value));
  }, []);

  // ── Eliminar cuenta ────────────────────────────────────────────────────────
  const handleDeleteAccount = () => {
    Alert.alert(
      'Eliminar cuenta',
      'Esta acción eliminará permanentemente tu cuenta y todos tus datos. No se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              '¿Estás seguro?',
              'Se borrarán todos tus gastos, metas, inversiones y datos personales.',
              [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Sí, eliminar todo',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await (supabase as any).rpc('delete_user_account', { p_user_id: user?.id });
                      await supabase.auth.signOut();
                      router.replace('/(auth)/login');
                    } catch (err) {
                      Alert.alert('Error', 'No se pudo eliminar la cuenta. Contactá a soporte@nomi.app');
                    }
                  },
                },
              ],
            ),
        },
      ],
    );
  };

  const disconnectGmail = () => {
    Alert.alert('Desconectar Gmail', '¿Querés dejar de detectar gastos desde tu email?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desconectar',
        style: 'destructive',
        onPress: async () => {
          await supabase.functions.invoke('gmail-auth', { method: 'DELETE' } as any);
          setGmailEmail(null);
        },
      },
    ]);
  };

  const connectMp = async () => {
    if (!user?.id) return;
    setMpConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        Alert.alert('Sesión expirada', 'Cerrá sesión y volvé a ingresar.');
        return;
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
          setMpEmail(decodeURIComponent(match[1]));
          Alert.alert('Mercado Pago conectado', 'Ahora detectamos tus gastos directamente desde MP.');
        } else if (hasError) {
          const errMatch = deepLink.match(/error=([^&]+)/);
          Alert.alert('Error', errMatch ? decodeURIComponent(errMatch[1]) : 'No se pudo conectar.');
        }
      }
    } catch (err) {
      Alert.alert('Error', 'No se pudo conectar con Mercado Pago.');
    } finally {
      setMpConnecting(false);
    }
  };

  const disconnectMp = () => {
    Alert.alert('Desconectar Mercado Pago', '¿Querés dejar de detectar gastos desde MP?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desconectar',
        style: 'destructive',
        onPress: async () => {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/mp-auth`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${session.access_token}` },
            });
          }
          setMpEmail(null);
        },
      },
    ]);
  };

  const syncMpNow = async () => {
    setMpSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;

      // Resetear al inicio del mes para capturar todos los movimientos del mes
      await (supabase as any)
        .from('mp_connections')
        .update({ last_checked_at: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString() })
        .eq('user_id', user!.id);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000); // 45s timeout
      let data: any;
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/mp-poll`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ force_sync: true }),
          signal: controller.signal,
        });
        data = await res.json();
      } finally {
        clearTimeout(timer);
      }

      if (data.code === 'MP_TOKEN_EXPIRED') {
        setMpSyncStatus('token_expired');
        Alert.alert('Token vencido', 'Desconectá y volvé a conectar tu cuenta de Mercado Pago.');
        return;
      }

      const found = data.new_found ?? 0;
      const total = data.total_api ?? 0;

      await loadMpStatus();

      Alert.alert(
        'Sincronización completa',
        found > 0
          ? `Se agregaron ${found} gasto${found !== 1 ? 's' : ''} nuevos de Mercado Pago.`
          : total > 0
            ? `Se encontraron ${total} movimientos en MP, pero ya estaban registrados.`
            : 'No se encontraron movimientos en Mercado Pago para este mes.\n\nAsegurate de haber reconectado después del último cambio.',
      );
    } catch {
      Alert.alert('Error', 'No se pudo sincronizar. Intentá de nuevo.');
    } finally {
      setMpSyncing(false);
    }
  };

  const { control, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<EditFormData>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      full_name: profile?.full_name ?? '',
      phone: profile?.phone ?? '',
    },
  });

  const openEditModal = () => {
    reset({ full_name: profile?.full_name ?? '', phone: profile?.phone ?? '' });
    setShowEditModal(true);
  };

  const onSave = async (data: EditFormData) => {
    try {
      await updateProfile({
        full_name: data.full_name.trim(),
        phone: data.phone?.trim() || null,
      });
      setShowEditModal(false);
    } catch {
      Alert.alert('Error', 'No se pudo guardar. Intentá de nuevo.');
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Cerrar sesión',
      '¿Estás seguro que querés salir?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar sesión',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  const handleReOnboarding = () => {
    Alert.alert(
      'Actualizar perfil financiero',
      '¿Querés responder de nuevo las preguntas de onboarding?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sí, actualizar', onPress: () => router.push('/(onboarding)/financial-profile') },
      ]
    );
  };

  const initials = profile?.full_name
    ?.split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() ?? '?';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <View style={styles.profileHeader}>
          <Text variant="h4">Perfil</Text>
          <TouchableOpacity onPress={openEditModal} style={styles.editBtn}>
            <Ionicons name="settings-outline" size={22} color={colors.text.secondary} />
          </TouchableOpacity>
        </View>

        {/* ── Seguridad y acceso ──────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text variant="label" color={colors.text.tertiary} style={styles.sectionTitle}>SEGURIDAD Y ACCESO</Text>
          <Text variant="caption" color={colors.text.tertiary} style={{ marginBottom: spacing[3] }}>
            Protegé tu cuenta y tus datos
          </Text>
          <Card style={styles.menuCard}>
            <View style={styles.menuItem}>
              <View style={[styles.menuIcon, { backgroundColor: biometricEnabled ? colors.primary + '15' : colors.bg.elevated }]}>
                <Ionicons
                  name="finger-print-outline"
                  size={20}
                  color={biometricEnabled ? colors.primary : colors.text.secondary}
                />
              </View>
              <View style={styles.menuText}>
                <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                  Seguridad biométrica
                </Text>
                <Text variant="caption" color={colors.text.secondary}>
                  Usá tu huella para ingresar
                </Text>
              </View>
              <Switch
                value={biometricEnabled}
                onValueChange={biometricAvailable ? toggleBiometric : undefined}
                trackColor={{ false: colors.border.default, true: colors.primary + '80' }}
                thumbColor={biometricEnabled ? colors.primary : colors.text.tertiary}
                disabled={!biometricAvailable}
              />
            </View>
          </Card>
        </View>

        {/* ── Mi cuenta ───────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text variant="label" color={colors.text.tertiary} style={styles.sectionTitle}>MI CUENTA</Text>
          <Card style={styles.menuCard}>
            <MenuItem icon="person-outline" label="Datos personales" onPress={openEditModal} />
            <View style={styles.menuDivider} />
            <MenuItem icon="wallet-outline" label="Perfil financiero" description="Ingreso, ahorro y deuda declarados" onPress={handleReOnboarding} />
            <View style={styles.menuDivider} />
            <MenuItem icon="mail-outline" label="Correo y contraseña" onPress={() => Alert.alert('Correo', profile?.email ?? '')} />
            <View style={styles.menuDivider} />
            <MenuItem icon="notifications-outline" label="Notificaciones" onPress={() => Alert.alert('Próximamente', 'Gestión de notificaciones en camino.')} />
            <View style={styles.menuDivider} />

            {/* Plan row */}
            <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/(app)/plans')}>
              <View style={[styles.menuIcon, { backgroundColor: colors.primary + '12' }]}>
                <Ionicons name="star-outline" size={20} color={colors.primary} />
              </View>
              <View style={styles.menuText}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                  <Text variant="bodySmall" color={colors.text.primary}>
                    {trialActive ? 'Prueba Premium' : plan.name}
                  </Text>
                  {trialActive && (
                    <View style={styles.trialBadge}>
                      <Text style={styles.trialBadgeText}>
                        Activo hasta {planExpiresAt ? new Date(planExpiresAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.text.tertiary} />
            </TouchableOpacity>

            <View style={styles.menuDivider} />
            <MenuItem icon="help-circle-outline" label="Centro de ayuda" description="Repasá cómo funciona cada pantalla" onPress={() => router.push('/(app)/help')} />
            <View style={styles.menuDivider} />
            <MenuItem icon="mail-outline" label="Contactar soporte" onPress={() => Alert.alert('Soporte', 'Escribinos a soporte@nomi.app')} />
            <View style={styles.menuDivider} />
            <MenuItem icon="information-circle-outline" label="Sobre Nomi" onPress={() => Alert.alert('Nomi', 'v1.0 — Tu asistente financiero argentino.')} />
          </Card>
        </View>

        {/* ── Conectar Gmail ──────────────────────────────────────────── */}
        {gmailEmail ? (
          <View style={styles.section}>
            <Text variant="label" color={colors.text.tertiary} style={styles.sectionTitle}>GMAIL</Text>
            <Card style={styles.menuCard}>
              <TouchableOpacity style={styles.menuItem} onPress={disconnectGmail}>
                <View style={[styles.menuIcon, { width: 36, height: 36, borderRadius: 18, backgroundColor: '#D1F7E3', alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="mail-outline" size={20} color={colors.primary} />
                </View>
                <View style={styles.menuText}>
                  <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>Gmail conectado</Text>
                  <Text variant="caption" color={colors.primary}>{gmailEmail}</Text>
                </View>
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
              </TouchableOpacity>
            </Card>
          </View>
        ) : (
          <View style={styles.section}>
            <Text variant="label" color={colors.text.tertiary} style={styles.sectionTitle}>GMAIL</Text>
            <Card style={styles.menuCard}>
              <MenuItem
                icon="mail-outline"
                label="Conectar Gmail"
                description="Detectá gastos automáticamente desde tu email"
                onPress={() => router.push('/(app)/gmail-connect' as any)}
              />
            </Card>
          </View>
        )}

        {/* ── Mercado Pago ───────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text variant="label" color={colors.text.tertiary} style={styles.sectionTitle}>MERCADO PAGO</Text>
          <Card style={styles.menuCard}>
            {mpEmail ? (
              <>
                {/* Estado de conexión */}
                <TouchableOpacity style={styles.menuItem} onPress={disconnectMp}>
                  <View style={[styles.menuIcon, { width: 36, height: 36, borderRadius: 18,
                    backgroundColor: mpSyncStatus === 'token_expired' ? '#FFFBEB' : '#D1F7E3',
                    alignItems: 'center', justifyContent: 'center' }]}>
                    <Ionicons
                      name={mpSyncStatus === 'token_expired' ? 'warning-outline' : 'wallet-outline'}
                      size={20}
                      color={mpSyncStatus === 'token_expired' ? '#F59E0B' : '#27AE60'}
                    />
                  </View>
                  <View style={styles.menuText}>
                    <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                      {mpSyncStatus === 'token_expired' ? 'Reconectar Mercado Pago' : 'Mercado Pago conectado'}
                    </Text>
                    <Text variant="caption" color={mpSyncStatus === 'token_expired' ? '#F59E0B' : '#27AE60'}>
                      {mpSyncStatus === 'token_expired'
                        ? 'Token vencido — tocá para desconectar y volver a conectar'
                        : mpEmail}
                    </Text>
                  </View>
                  <Ionicons
                    name={mpSyncStatus === 'token_expired' ? 'chevron-forward' : 'checkmark-circle'}
                    size={20}
                    color={mpSyncStatus === 'token_expired' ? colors.text.tertiary : '#27AE60'}
                  />
                </TouchableOpacity>

                <View style={{ height: 1, backgroundColor: colors.border.subtle }} />

                {/* Última sincronización */}
                {mpLastSync && (
                  <>
                    <View style={[styles.menuItem, { paddingVertical: 10 }]}>
                      <View style={[styles.menuIcon, { width: 36, height: 36, borderRadius: 18,
                        backgroundColor: colors.bg.elevated, alignItems: 'center', justifyContent: 'center' }]}>
                        <Ionicons name="time-outline" size={18} color={colors.text.secondary} />
                      </View>
                      <View style={styles.menuText}>
                        <Text variant="caption" color={colors.text.secondary}>Última sincronización</Text>
                        <Text variant="bodySmall" color={colors.text.primary}>
                          {mpLastSync.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                          {' · '}
                          {mpLastSync.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                          {mpSyncCount > 0 ? ` · ${mpSyncCount} nuevo${mpSyncCount !== 1 ? 's' : ''}` : ''}
                        </Text>
                      </View>
                    </View>
                    <View style={{ height: 1, backgroundColor: colors.border.subtle }} />
                  </>
                )}

                {/* Botón sincronizar */}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={syncMpNow}
                  disabled={mpSyncing}
                >
                  <View style={[styles.menuIcon, { width: 36, height: 36, borderRadius: 18,
                    backgroundColor: '#D1F7E3', alignItems: 'center', justifyContent: 'center' }]}>
                    {mpSyncing
                      ? <ActivityIndicator size="small" color="#27AE60" />
                      : <Ionicons name="sync-outline" size={20} color="#27AE60" />}
                  </View>
                  <View style={styles.menuText}>
                    <Text variant="bodySmall" color={colors.text.primary}>
                      {mpSyncing ? 'Sincronizando…' : 'Sincronizar este mes'}
                    </Text>
                    <Text variant="caption" color={colors.text.secondary}>
                      Importar todos los gastos de {new Date().toLocaleString('es-AR', { month: 'long' })}
                    </Text>
                  </View>
                  {!mpSyncing && <Ionicons name="chevron-forward" size={16} color={colors.text.tertiary} />}
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.menuItem} onPress={connectMp} disabled={mpConnecting}>
                <View style={[styles.menuIcon, { width: 36, height: 36, borderRadius: 18,
                  backgroundColor: '#F5F1E9', alignItems: 'center', justifyContent: 'center' }]}>
                  {mpConnecting
                    ? <ActivityIndicator size="small" color={colors.text.tertiary} />
                    : <Ionicons name="wallet-outline" size={20} color={colors.text.secondary} />}
                </View>
                <View style={styles.menuText}>
                  <Text variant="bodySmall" color={colors.text.primary}>Conectar Mercado Pago</Text>
                  <Text variant="caption" color={colors.text.secondary}>
                    {mpConnecting ? 'Abriendo autorización…' : 'Detectá gastos QR y en-app directamente'}
                  </Text>
                </View>
                {!mpConnecting && <Ionicons name="chevron-forward" size={16} color={colors.text.tertiary} />}
              </TouchableOpacity>
            )}
          </Card>
        </View>

        {/* Cerrar sesión + Eliminar cuenta */}
        <Card style={styles.menuCard}>
          <MenuItem
            icon="log-out-outline"
            label="Cerrar sesión"
            onPress={handleSignOut}
            color={colors.red}
            showArrow={false}
          />
          <View style={styles.menuDivider} />
          <MenuItem
            icon="trash-outline"
            label="Eliminar mi cuenta y datos"
            description="Acción permanente, no reversible"
            onPress={handleDeleteAccount}
            color={colors.red}
            showArrow={false}
          />
        </Card>

        <Text variant="caption" color={colors.text.tertiary} align="center" style={styles.version}>
          Nomi v1.0.0 · Tu plata, inteligente.
        </Text>
      </ScrollView>

      {/* Modal redondeo automático */}
      <FormSheetModal
        visible={showRoundUpModal}
        title="Redondeo automático"
        onClose={() => setShowRoundUpModal(false)}
        contentContainerStyle={styles.modalScroll}
      >
            {/* Enable toggle */}
            <View style={ruStyles.row}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="bodySmall" color={colors.text.primary}>Activar redondeo</Text>
                <Text variant="caption" color={colors.text.secondary}>
                  Cada gasto se redondea y la diferencia se acumula automáticamente.
                </Text>
              </View>
              <Switch
                value={roundUp.enabled}
                onValueChange={(v) => roundUp.configure({ enabled: v })}
                trackColor={{ false: colors.border.default, true: colors.primary + '80' }}
                thumbColor={roundUp.enabled ? colors.primary : colors.text.tertiary}
              />
            </View>

            {roundUp.enabled && (
              <>
                {/* Redondear a */}
                <View style={ruStyles.section}>
                  <Text variant="label" color={colors.text.secondary}>REDONDEAR AL SIGUIENTE</Text>
                  <View style={ruStyles.optRow}>
                    {([500, 1000] as RoundTo[]).map((v) => (
                      <TouchableOpacity
                        key={v}
                        style={[ruStyles.opt, roundUp.roundTo === v && { borderColor: colors.primary, backgroundColor: colors.primary + '15' }]}
                        onPress={() => roundUp.configure({ roundTo: v })}
                      >
                        <Text variant="bodySmall" color={roundUp.roundTo === v ? colors.primary : colors.text.secondary}>
                          ${v.toLocaleString('es-AR')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Destino */}
                <View style={ruStyles.section}>
                  <Text variant="label" color={colors.text.secondary}>DESTINO DEL REDONDEO</Text>
                  <View style={ruStyles.destCol}>
                    {([
                      { key: 'fci' as RoundDest,     label: 'FCI Money Market',   icon: 'trending-up-outline', desc: 'Rinde ~3% mensual, disponible siempre' },
                      { key: 'savings' as RoundDest, label: 'Ahorro en efectivo',  icon: 'wallet-outline',      desc: 'Separado del gasto, sin inversión' },
                    ]).map(({ key, label, icon, desc }) => (
                      <TouchableOpacity
                        key={key}
                        style={[ruStyles.destOpt, roundUp.destination === key && { borderColor: colors.primary, backgroundColor: colors.primary + '10' }]}
                        onPress={() => roundUp.configure({ destination: key })}
                      >
                        <Ionicons name={icon as any} size={18} color={roundUp.destination === key ? colors.primary : colors.text.tertiary} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text variant="bodySmall" color={roundUp.destination === key ? colors.primary : colors.text.primary}>{label}</Text>
                          <Text variant="caption" color={colors.text.tertiary}>{desc}</Text>
                        </View>
                        {roundUp.destination === key && (
                          <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Resumen acumulado */}
                {roundUp.totalAllTime > 0 && (
                  <View style={ruStyles.summary}>
                    <Ionicons name="sparkles-outline" size={14} color={colors.yellow} />
                    <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, lineHeight: 17 }}>
                      Acumulaste{' '}
                      <Text variant="caption" color={colors.yellow} style={{ fontFamily: 'Montserrat_700Bold' }}>
                        ${roundUp.totalAllTime.toLocaleString('es-AR')}
                      </Text>{' '}
                      en total solo con redondeos.
                    </Text>
                  </View>
                )}
              </>
            )}

            <Button
              label="LISTO"
              variant="neon"
              size="lg"
              fullWidth
              onPress={() => setShowRoundUpModal(false)}
              style={{ marginTop: spacing[4] }}
            />
      </FormSheetModal>

      {/* Modal editar perfil */}
      <FormSheetModal
        visible={showEditModal}
        title="Editar perfil"
        onClose={() => setShowEditModal(false)}
        contentContainerStyle={styles.modalScroll}
      >
              {/* Avatar preview */}
              <View style={styles.modalAvatarRow}>
                <View style={styles.modalAvatar}>
                  <Text variant="h3" color={colors.white}>{initials}</Text>
                </View>
              </View>

              {/* Email (solo lectura) */}
              <View style={styles.emailField}>
                <Text variant="label" color={colors.text.secondary} style={{ marginBottom: spacing[2] }}>
                  EMAIL
                </Text>
                <View style={styles.emailValue}>
                  <Ionicons name="lock-closed-outline" size={14} color={colors.text.tertiary} />
                  <Text variant="bodySmall" color={colors.text.tertiary}>
                    {profile?.email}
                  </Text>
                </View>
              </View>

              <Controller
                control={control}
                name="full_name"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="NOMBRE COMPLETO"
                    placeholder="Tu nombre"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.full_name?.message}
                    autoCapitalize="words"
                    autoFocus
                  />
                )}
              />

              <Controller
                control={control}
                name="phone"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="TELÉFONO (opcional)"
                    placeholder="+54 11 1234-5678"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    keyboardType="phone-pad"
                  />
                )}
              />

              <Button
                label="GUARDAR CAMBIOS"
                variant="neon"
                size="lg"
                fullWidth
                isLoading={isSubmitting}
                onPress={handleSubmit(onSave)}
                style={{ marginTop: spacing[4] }}
              />
      </FormSheetModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  scroll: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[4],
    paddingBottom: layout.tabBarHeight + spacing[4],
    gap: spacing[4],
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[4],
  },
  avatar: {
    width: 64,
    height: 64,
    backgroundColor: colors.primary,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    backgroundColor: colors.bg.elevated,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtn: { padding: spacing[2] },
  planCard: { padding: spacing[5], gap: spacing[3] },
  planRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trialBadge: {
    backgroundColor: colors.primary + '18', borderRadius: 6,
    paddingHorizontal: spacing[2], paddingVertical: 2,
  },
  trialBadgeText: {
    fontFamily: 'Montserrat_600SemiBold', fontSize: 10, color: colors.primary,
  },
  trialBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    backgroundColor: colors.neon, borderRadius: 8,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
  },
  planBtn: {
    backgroundColor: colors.primary, borderRadius: 6,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
  },
  planBtnUpgrade: {
    backgroundColor: colors.neon,
  },
  planUsage: { gap: spacing[2] },
  planUsageInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planTrack: { height: 6, backgroundColor: colors.border.subtle, borderRadius: 3, overflow: 'hidden' },
  planFill:  { height: '100%', borderRadius: 3 },
  section: { gap: spacing[3] },
  sectionTitle: {},
  menuCard: { padding: 0, overflow: 'hidden' },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    gap: spacing[4],
  },
  menuIcon: { width: 28, alignItems: 'center', justifyContent: 'center' },
  menuText: { flex: 1, gap: spacing[1] },
  menuDivider: {
    height: 1,
    backgroundColor: colors.border.subtle,
    marginLeft: spacing[5] + 24 + spacing[4],
  },
  version: { marginTop: spacing[4] },
  modalScroll: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[6],
    gap: spacing[5],
    paddingBottom: spacing[12],
  },
  modalAvatarRow: {
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  modalAvatar: {
    width: 80,
    height: 80,
    backgroundColor: colors.primary,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reconnectBanner: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing[3],
    paddingHorizontal: spacing[5],
    paddingVertical:   spacing[3],
    backgroundColor:   colors.yellow + '12',
  },
  gmailTrustCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3],
    paddingHorizontal: spacing[5], paddingVertical: spacing[3],
    backgroundColor: colors.primary + '08',
  },
  biometricCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 16, padding: spacing[4],
  },
  biometricLeft:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  biometricIcon:  { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  emailField: {},
  emailValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.bg.elevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
});


const ruStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[4],
    backgroundColor: colors.bg.elevated, borderRadius: 12, padding: spacing[4],
  },
  section: { gap: spacing[3] },
  optRow:  { flexDirection: 'row', gap: spacing[3] },
  opt: {
    flex: 1, alignItems: 'center', paddingVertical: spacing[3],
    borderRadius: 10, borderWidth: 1, borderColor: colors.border.default,
    backgroundColor: colors.bg.elevated,
  },
  destCol:  { gap: spacing[2] },
  destOpt: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    borderWidth: 1, borderColor: colors.border.default,
    backgroundColor: colors.bg.elevated,
    borderRadius: 12, padding: spacing[4],
  },
  summary: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2],
    backgroundColor: colors.yellow + '0C', borderRadius: 8, padding: spacing[3],
  },
});
