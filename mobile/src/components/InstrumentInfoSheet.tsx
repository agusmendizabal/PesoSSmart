import React from 'react';
import { View, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text } from '@/components/ui';
import type { InstrumentTutorial } from '@/lib/investmentData';

interface Props {
  visible:     boolean;
  name:        string;
  tutorial:    InstrumentTutorial;
  onDismiss:   () => void;
}

export function InstrumentInfoSheet({ visible, name, tutorial, onDismiss }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.dragBar} />

          <View style={styles.heroRow}>
            <View style={styles.heroIcon}>
              <Ionicons name="information-circle-outline" size={26} color={colors.primary} />
            </View>
            <Text variant="h4" color={colors.text.primary} style={{ flex: 1 }}>{name}</Text>
          </View>

          <View style={{ gap: spacing[2] }}>
            <Text variant="label" color={colors.text.tertiary}>QUÉ ES</Text>
            <Text variant="bodySmall" color={colors.text.secondary} style={{ lineHeight: 20 }}>
              {tutorial.whatIsIt}
            </Text>
          </View>

          <View style={{ gap: spacing[2] }}>
            <Text variant="label" color={colors.text.tertiary}>POR QUÉ TE LO MOSTRAMOS</Text>
            <Text variant="bodySmall" color={colors.text.secondary} style={{ lineHeight: 20 }}>
              {tutorial.whyShown}
            </Text>
          </View>

          <TouchableOpacity style={styles.btn} onPress={onDismiss} activeOpacity={0.85}>
            <Text style={styles.btnText}>Entendido</Text>
            <Ionicons name="checkmark" size={16} color={colors.white} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#00000070', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg.primary,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing[5], paddingBottom: spacing[10], gap: spacing[5],
  },
  dragBar: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.border.default,
    alignSelf: 'center', marginBottom: spacing[1],
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  heroIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.primary + '18',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing[2], borderRadius: 14, paddingVertical: spacing[4],
    marginTop: spacing[2], backgroundColor: colors.primary,
  },
  btnText: { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: colors.white },
});
