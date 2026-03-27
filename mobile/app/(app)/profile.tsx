import React from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Card, Button } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';

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
  const { profile, signOut, isLoading } = useAuthStore();

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
        {
          text: 'Sí, actualizar',
          onPress: () => router.push('/(onboarding)/financial-profile'),
        },
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
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Header del perfil */}
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text variant="h4" color={colors.black}>{initials}</Text>
          </View>
          <View>
            <Text variant="subtitle" color={colors.text.primary}>
              {profile?.full_name ?? 'Sin nombre'}
            </Text>
            <Text variant="bodySmall" color={colors.text.secondary}>
              {profile?.email}
            </Text>
          </View>
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

        {/* Sección Cuenta */}
        <View style={styles.section}>
          <Text variant="label" color={colors.text.secondary} style={styles.sectionTitle}>
            MI CUENTA
          </Text>
          <Card style={styles.menuCard}>
            <MenuItem
              icon="person-outline"
              label="Editar perfil"
              description="Nombre, foto"
              onPress={() => Alert.alert('Próximamente', 'Edición de perfil en camino.')}
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

        {/* Sección App */}
        <View style={styles.section}>
          <Text variant="label" color={colors.text.secondary} style={styles.sectionTitle}>
            LA APP
          </Text>
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
              onPress={() => Alert.alert('Soporte', 'Escribinos a soporte@pesossmart.com')}
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
});
