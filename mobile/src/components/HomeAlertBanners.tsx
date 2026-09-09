import React from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text } from '@/components/ui';
import { useMpConnect } from '@/hooks/useMpConnect';

interface Props {
  userId: string | undefined;
  showExpensesWarning: boolean;
  gmailConnected: boolean;
  mpConnected: boolean;
  onMpConnected: () => void;
}

export function HomeAlertBanners({
  userId,
  showExpensesWarning,
  gmailConnected,
  mpConnected,
  onMpConnected,
}: Props) {
  const { connecting, connect } = useMpConnect(userId);

  const handleConnectMp = async () => {
    const result = await connect();
    if (result.success) {
      onMpConnected();
    } else if (result.error) {
      Alert.alert('Error', result.error);
    }
  };

  if (!showExpensesWarning && gmailConnected && mpConnected) return null;

  return (
    <View style={styles.container}>
      {showExpensesWarning && (
        <TouchableOpacity
          style={[styles.banner, styles.warningBanner]}
          onPress={() => router.push('/(app)/movimientos' as any)}
          activeOpacity={0.82}
        >
          <View style={[styles.iconWrap, styles.warningIconWrap]}>
            <Ionicons name="calendar-outline" size={20} color={colors.yellow} />
          </View>
          <View style={styles.texts}>
            <Text variant="labelMd">Hace más de 3 días sin registrar</Text>
            <Text variant="caption" color={colors.text.secondary}>
              Cargá tus gastos para mantener el análisis al día
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.yellow} />
        </TouchableOpacity>
      )}

      {!mpConnected && (
        <TouchableOpacity
          style={[styles.banner, styles.connectBanner]}
          onPress={handleConnectMp}
          disabled={connecting}
          activeOpacity={0.82}
        >
          <View style={[styles.iconWrap, styles.connectIconWrap]}>
            {connecting
              ? <ActivityIndicator size="small" color={colors.neon} />
              : <Ionicons name="card-outline" size={20} color={colors.neon} />
            }
          </View>
          <View style={styles.texts}>
            <Text variant="labelMd">Conectá Mercado Pago</Text>
            <Text variant="caption" color={colors.text.secondary}>
              Importá tus movimientos automáticamente
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.neon} />
        </TouchableOpacity>
      )}

      {!gmailConnected && (
        <TouchableOpacity
          style={[styles.banner, styles.connectBanner]}
          onPress={() => router.push('/(app)/gmail-connect' as any)}
          activeOpacity={0.82}
        >
          <View style={[styles.iconWrap, styles.connectIconWrap]}>
            <Ionicons name="mail-outline" size={20} color={colors.neon} />
          </View>
          <View style={styles.texts}>
            <Text variant="labelMd">Conectá tu Gmail</Text>
            <Text variant="caption" color={colors.text.secondary}>
              Detectamos tus gastos bancarios automáticamente
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.neon} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing[2] },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },

  warningBanner: {
    backgroundColor: '#FFF8E8',
    borderColor: colors.yellow + '55',
  },
  connectBanner: {
    backgroundColor: colors.neon + '0D',
    borderColor: colors.neon + '40',
  },

  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningIconWrap: { backgroundColor: colors.yellow + '22' },
  connectIconWrap: { backgroundColor: colors.neon + '18' },

  texts: { flex: 1, gap: 2 },
});
