import React from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text } from '@/components/ui';
import { useMpConnect } from '@/hooks/useMpConnect';

/**
 * Aviso para conectar Gmail o Mercado Pago — se muestra en Home mientras
 * el usuario no haya conectado ninguna de las dos integraciones.
 */
export function ConnectIntegrationsBanner({
  userId,
  onConnected,
}: {
  userId: string | undefined;
  onConnected: () => void;
}) {
  const { connecting, connect } = useMpConnect(userId);

  const handleConnectMp = async () => {
    const result = await connect();
    if (result.success) {
      onConnected();
    } else if (result.error) {
      Alert.alert('Error', result.error);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="flash-outline" size={18} color={colors.neon} />
        <Text variant="labelMd">Detectá tus gastos automáticamente</Text>
      </View>
      <Text variant="caption" color={colors.text.secondary}>
        Conectá tu Gmail o Mercado Pago y dejá de cargar todo a mano.
      </Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.ctaBtn}
          onPress={() => router.push('/(app)/gmail-connect')}
          activeOpacity={0.85}
        >
          <Ionicons name="mail-outline" size={16} color={colors.text.primary} />
          <Text variant="label">Conectar Gmail</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.ctaBtn}
          onPress={handleConnectMp}
          disabled={connecting}
          activeOpacity={0.85}
        >
          {connecting
            ? <ActivityIndicator size="small" color={colors.text.primary} />
            : <Ionicons name="wallet-outline" size={16} color={colors.text.primary} />
          }
          <Text variant="label">Mercado Pago</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing[4],
    gap: spacing[2],
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  row:    { flexDirection: 'row', gap: spacing[2], marginTop: spacing[1] },
  ctaBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing[3],
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.secondary,
  },
});
