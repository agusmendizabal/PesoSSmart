import React from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Card } from '@/components/ui';
import { resetFirstVisit } from '@/hooks/useFirstVisit';

interface GuideItem {
  key:         string;
  route:       string;
  label:       string;
  description: string;
  icon:        string;
}

const GUIDE_ITEMS: GuideItem[] = [
  { key: 'home',          route: '/(app)/home',          label: 'Home',            description: 'Resumen del mes, insights y actividad reciente', icon: 'home-outline' },
  { key: 'expenses',      route: '/(app)/expenses',      label: 'Gastos',          description: 'Cargar, clasificar y filtrar tus gastos',          icon: 'wallet-outline' },
  { key: 'reports',       route: '/(app)/reports',       label: 'Reportes',        description: 'Salud financiera, análisis con IA e inflación',    icon: 'bar-chart-outline' },
  { key: 'savings',       route: '/(app)/savings',       label: 'Ahorros',         description: 'Metas, bolsillos y Plan Inteligente',              icon: 'trending-up-outline' },
  { key: 'plans',         route: '/(app)/plans',         label: 'Tu plan',         description: 'Comparar y cambiar de plan',                       icon: 'star-outline' },
];

function GuideRow({ item }: { item: GuideItem }) {
  const handlePress = async () => {
    await resetFirstVisit(item.key);
    router.push(item.route as any);
  };

  return (
    <TouchableOpacity style={styles.row} onPress={handlePress}>
      <View style={styles.rowIcon}>
        <Ionicons name={item.icon as any} size={20} color={colors.text.secondary} />
      </View>
      <View style={styles.rowText}>
        <Text variant="bodySmall" color={colors.text.primary}>{item.label}</Text>
        <Text variant="caption" color={colors.text.secondary}>{item.description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.text.tertiary} />
    </TouchableOpacity>
  );
}

export default function HelpScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <Text variant="h4" style={{ flex: 1, marginLeft: spacing[3] }}>Centro de ayuda</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text variant="bodySmall" color={colors.text.secondary} style={{ lineHeight: 20 }}>
          Tocá cualquier pantalla para volver a ver su explicación, aunque ya la hayas visto antes.
        </Text>

        <Card style={styles.card}>
          {GUIDE_ITEMS.map((item, i) => (
            <React.Fragment key={item.key}>
              <GuideRow item={item} />
              {i < GUIDE_ITEMS.length - 1 && <View style={styles.divider} />}
            </React.Fragment>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical:   spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    backgroundColor:   colors.bg.card,
  },
  scroll: {
    paddingHorizontal: layout.screenPadding,
    paddingTop:        spacing[5],
    paddingBottom:      spacing[8],
    gap:                spacing[4],
  },
  card: { padding: 0, overflow: 'hidden' },
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: spacing[5],
    paddingVertical:   spacing[4],
    gap:               spacing[4],
  },
  rowIcon: { width: 28, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: spacing[1] },
  divider: {
    height:           1,
    backgroundColor:  colors.border.subtle,
    marginLeft:       spacing[5] + 28 + spacing[4],
  },
});
