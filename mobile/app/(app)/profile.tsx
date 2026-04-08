import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { colors, spacing, layout } from '@/theme';
import { Text, Card, Button, Input } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';

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
  const [showEditModal, setShowEditModal] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [gmailLoading, setGmailLoading] = useState(false);
  // Detectar deep link de retorno de Gmail OAuth
  useEffect(() => {
    const handleURL = ({ url }: { url: string }) => {
      if (!url.includes('gmail-connected')) return;
      const match = url.match(/email=([^&]+)/);
      const hasError = url.includes('error=');
      if (match) {
        const email = decodeURIComponent(match[1]);
        setGmailEmail(email);
        Alert.alert('Gmail conectado', `Tu cuenta ${email} quedó vinculada. Ahora detectamos gastos automáticamente.`);
      } else if (hasError) {
        Alert.alert('Error', 'No se pudo conectar Gmail. Intentá de nuevo.');
      }
    };

    const sub = Linking.addEventListener('url', handleURL);
    return () => sub.remove();
  }, []);

  // Cargar estado de Gmail al entrar
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('gmail_connections').select('gmail_email').eq('user_id', user.id).single()
      .then(({ data }) => { if (data) setGmailEmail(data.gmail_email); });
  }, [user?.id]);

  const connectGmail = async () => {
    if (!user?.id) return;
    setGmailLoading(true);
    try {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        Alert.alert('Sesión expirada', 'Cerrá sesión y volvé a ingresar.');
        return;
      }

      const res = await fetch(`${supabaseUrl}/functions/v1/gmail-auth?action=url`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        console.error('[connectGmail] Error del servidor:', res.status, JSON.stringify(json));
        if (res.status === 401) {
          Alert.alert('Error de autenticación', 'Tu sesión no es válida. Cerrá sesión y volvé a ingresar.');
        } else {
          Alert.alert('Error', `No se pudo contactar el servidor (${res.status}). Intentá de nuevo.`);
        }
        return;
      }

      if (!json.url) {
        console.error('[connectGmail] Respuesta sin URL:', JSON.stringify(json));
        Alert.alert('Error', 'No se pudo obtener el link de autorización. Intentá de nuevo.');
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(json.url, 'pesossmart://gmail-connected');

      if (result.type === 'success' && result.url) {
        const match    = result.url.match(/email=([^&]+)/);
        const hasError = result.url.includes('error=');
        if (match) {
          const email = decodeURIComponent(match[1]);
          setGmailEmail(email);
          Alert.alert('Gmail conectado', `Tu cuenta ${email} quedó vinculada. Ahora detectamos gastos automáticamente.`);
        } else if (hasError) {
          const errMatch = result.url.match(/error=([^&]+)/);
          const errMsg   = errMatch ? decodeURIComponent(errMatch[1]) : 'Error desconocido';
          console.error('[connectGmail] Error en callback OAuth:', errMsg);
          Alert.alert('Error', `No se pudo conectar Gmail: ${errMsg}. Intentá de nuevo.`);
        }
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        console.log('[connectGmail] Usuario canceló la autorización de Gmail');
      }
    } catch (err) {
      console.error('[connectGmail] Error inesperado:', err);
      Alert.alert('Error', 'No se pudo iniciar la conexión con Gmail. Verificá tu conexión a internet.');
    } finally {
      setGmailLoading(false);
    }
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

        {/* Header */}
        <View style={styles.profileHeader}>
          <TouchableOpacity style={styles.avatar} onPress={openEditModal}>
            <Text variant="h4" color={colors.black}>{initials}</Text>
            <View style={styles.avatarEditBadge}>
              <Ionicons name="pencil" size={10} color={colors.black} />
            </View>
          </TouchableOpacity>
          <View style={{ flex: 1, gap: spacing[1] }}>
            <Text variant="subtitle" color={colors.text.primary}>
              {profile?.full_name ?? 'Sin nombre'}
            </Text>
            <Text variant="bodySmall" color={colors.text.secondary}>
              {profile?.email}
            </Text>
            {profile?.phone ? (
              <Text variant="caption" color={colors.text.tertiary}>
                {profile.phone}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity onPress={openEditModal} style={styles.editBtn}>
            <Ionicons name="pencil-outline" size={18} color={colors.text.secondary} />
          </TouchableOpacity>
        </View>

        {/* Plan */}
        <Card variant={profile?.subscription_plan === 'pro' ? 'neon' : 'default'} style={styles.planCard}>
          <View style={styles.planRow}>
            <View>
              <Text variant="label" color={colors.text.secondary}>PLAN ACTUAL</Text>
              <Text variant="subtitle" color={profile?.subscription_plan === 'pro' ? colors.neon : colors.text.primary}>
                {profile?.subscription_plan === 'pro' ? 'Pro' : 'Gratis'}
              </Text>
            </View>
            {profile?.subscription_plan === 'free' && (
              <Button
                label="MEJORAR"
                variant="neon"
                size="sm"
                onPress={() => Alert.alert('Próximamente', 'El plan Pro va a estar disponible muy pronto.')}
              />
            )}
          </View>
          {profile?.subscription_plan === 'free' && (
            <Text variant="caption" color={colors.text.secondary}>
              Con Pro: asesor IA ilimitado, escaneo de tickets ilimitado y más.
            </Text>
          )}
        </Card>

        {/* Mi cuenta */}
        <View style={styles.section}>
          <Text variant="label" color={colors.text.secondary} style={styles.sectionTitle}>MI CUENTA</Text>
          <Card style={styles.menuCard}>
            <MenuItem
              icon="person-outline"
              label="Editar perfil"
              description="Nombre y teléfono"
              onPress={openEditModal}
            />
            <View style={styles.menuDivider} />
            <MenuItem
              icon="stats-chart-outline"
              label="Actualizar perfil financiero"
              description="Ingresos, gastos, situación"
              onPress={handleReOnboarding}
            />
            <View style={styles.menuDivider} />
            <MenuItem
              icon="heart-outline"
              label="Mis intereses"
              description="Qué querés explorar"
              onPress={() => router.push('/(onboarding)/interests')}
            />
            <View style={styles.menuDivider} />
            <MenuItem
              icon="shield-outline"
              label="Perfil de riesgo"
              description="Tu tolerancia a la volatilidad"
              onPress={() => router.push('/(onboarding)/risk-profile')}
            />
          </Card>
        </View>

        {/* Integraciones */}
        <View style={styles.section}>
          <Text variant="label" color={colors.text.secondary} style={styles.sectionTitle}>INTEGRACIONES</Text>
          <Card style={styles.menuCard}>
            <TouchableOpacity style={styles.menuItem} onPress={gmailEmail ? disconnectGmail : connectGmail} disabled={gmailLoading}>
              <View style={styles.menuIcon}>
                <Ionicons name="mail-outline" size={20} color={gmailEmail ? colors.neon : colors.text.secondary} />
              </View>
              <View style={styles.menuText}>
                <Text variant="bodySmall" color={colors.text.primary}>Gmail</Text>
                <Text variant="caption" color={gmailEmail ? colors.neon : colors.text.secondary}>
                  {gmailLoading ? 'Conectando...' : gmailEmail ? `Conectado: ${gmailEmail}` : 'Detectar gastos desde emails bancarios'}
                </Text>
              </View>
              {gmailEmail
                ? <Ionicons name="checkmark-circle" size={20} color={colors.neon} />
                : <Ionicons name="chevron-forward" size={16} color={colors.text.tertiary} />
              }
            </TouchableOpacity>
          </Card>
        </View>

        {/* La app */}
        <View style={styles.section}>
          <Text variant="label" color={colors.text.secondary} style={styles.sectionTitle}>LA APP</Text>
          <Card style={styles.menuCard}>
            <MenuItem
              icon="notifications-outline"
              label="Notificaciones"
              onPress={() => Alert.alert('Próximamente', 'Gestión de notificaciones en camino.')}
            />
            <View style={styles.menuDivider} />
            <MenuItem
              icon="lock-closed-outline"
              label="Privacidad"
              onPress={() => Alert.alert('Privacidad', 'Tus datos son solo tuyos. No los compartimos ni vendemos.')}
            />
            <View style={styles.menuDivider} />
            <MenuItem
              icon="help-circle-outline"
              label="Ayuda y soporte"
              onPress={() => Alert.alert('Soporte', 'Escribinos a soporte@smartpesos.app')}
            />
          </Card>
        </View>

        {/* Cerrar sesión */}
        <Card style={styles.menuCard}>
          <MenuItem
            icon="log-out-outline"
            label="Cerrar sesión"
            onPress={handleSignOut}
            color={colors.red}
            showArrow={false}
          />
        </Card>

        <Text variant="caption" color={colors.text.tertiary} align="center" style={styles.version}>
          SmartPesos v1.0.0 · Tu plata, inteligente.
        </Text>
      </ScrollView>

      {/* Modal editar perfil */}
      <Modal
        visible={showEditModal}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowEditModal(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <SafeAreaView style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text variant="h4">Editar perfil</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <Ionicons name="close" size={24} color={colors.text.primary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              {/* Avatar preview */}
              <View style={styles.modalAvatarRow}>
                <View style={styles.modalAvatar}>
                  <Text variant="h3" color={colors.black}>{initials}</Text>
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
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
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
    gap: spacing[4],
    paddingVertical: spacing[4],
  },
  avatar: {
    width: 64,
    height: 64,
    backgroundColor: colors.neon,
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
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtn: { padding: spacing[2] },
  planCard: { padding: spacing[5], gap: spacing[3] },
  planRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
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
  menuIcon: { width: 24, alignItems: 'center' },
  menuText: { flex: 1, gap: spacing[1] },
  menuDivider: {
    height: 1,
    backgroundColor: colors.border.subtle,
    marginLeft: spacing[5] + 24 + spacing[4],
  },
  version: { marginTop: spacing[4] },
  modal: { flex: 1, backgroundColor: colors.bg.primary },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
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
    backgroundColor: colors.neon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailField: {},
  emailValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
});
