import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, SectionList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { CategoryIcon } from '@/components/CategoryIcon';
import { formatCurrency, formatDate } from '@/utils/format';
import { MONTH_NAMES } from '@/components/ReportCards';

interface CategoryExpense {
  id: string;
  description: string;
  amount: number;
  date: string;
}

export default function CategoryExpensesScreen() {
  const { categoryId, categoryName, color, month, year } = useLocalSearchParams<{
    categoryId: string; categoryName: string; color: string; month: string; year: string;
  }>();
  const { user } = useAuthStore();
  const [expenses, setExpenses] = useState<CategoryExpense[]>([]);
  const [loading,  setLoading]  = useState(true);

  const m = Number(month);
  const y = Number(year);
  const accentColor = color || colors.primary;
  const isNone = categoryId === 'none';

  const load = useCallback(async () => {
    if (!user?.id || !m || !y) return;
    setLoading(true);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const nm    = m === 12 ? 1 : m + 1;
    const ny    = m === 12 ? y + 1 : y;
    const end   = `${ny}-${String(nm).padStart(2, '0')}-01`;

    let query = supabase
      .from('expenses')
      .select('id, description, amount, date')
      .eq('user_id', user.id)
      .gte('date', start)
      .lt('date', end)
      .is('deleted_at', null)
      .order('date', { ascending: false });

    query = isNone ? query.is('category_id', null) : query.eq('category_id', categoryId);

    const { data } = await query;
    setExpenses((data ?? []) as CategoryExpense[]);
    setLoading(false);
  }, [user?.id, categoryId, m, y]);

  useEffect(() => { load(); }, [load]);

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  const sections = React.useMemo(() => {
    const grouped: Record<string, CategoryExpense[]> = {};
    for (const e of expenses) {
      if (!grouped[e.date]) grouped[e.date] = [];
      grouped[e.date].push(e);
    }
    return Object.entries(grouped)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, items]) => ({ title: date, data: items }));
  }, [expenses]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="labelMd" numberOfLines={1}>{isNone ? 'Sin categoría' : categoryName}</Text>
          <Text variant="caption" color={colors.text.secondary}>
            {MONTH_NAMES[m - 1]} {y}
          </Text>
        </View>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.summary}>
        <CategoryIcon categoryName={isNone ? '' : categoryName} size={48} />
        <View style={{ flex: 1 }}>
          <Text variant="caption" color={colors.text.secondary}>TOTAL</Text>
          <Text variant="h4" color={accentColor}>{formatCurrency(total)}</Text>
        </View>
        <Text variant="caption" color={colors.text.secondary}>
          {expenses.length} gasto{expenses.length === 1 ? '' : 's'}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing[8] }} />
      ) : expenses.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="receipt-outline" size={44} color={colors.text.tertiary} />
          <Text variant="body" color={colors.text.secondary} align="center">
            Sin gastos en esta categoría este mes
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderSectionHeader={({ section }) => (
            <Text variant="label" color={colors.text.tertiary} style={styles.dayHeader}>
              {formatDate(section.title)}
            </Text>
          )}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <CategoryIcon categoryName={isNone ? '' : categoryName} size={36} />
              <Text style={styles.rowDesc} numberOfLines={1}>{item.description || 'Sin descripción'}</Text>
              <Text style={styles.rowAmount}>-{formatCurrency(item.amount)}</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding, paddingVertical: spacing[3],
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  summary: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    paddingHorizontal: layout.screenPadding, paddingVertical: spacing[4],
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[3], paddingHorizontal: spacing[8] },
  list: { paddingHorizontal: layout.screenPadding, paddingBottom: spacing[8], gap: spacing[2] },
  dayHeader: { paddingTop: spacing[3], paddingBottom: spacing[1], backgroundColor: colors.bg.primary },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    backgroundColor: colors.bg.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default,
    paddingVertical: 10, paddingHorizontal: spacing[4],
  },
  rowDesc:   { flex: 1, minWidth: 0, fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: colors.text.primary },
  rowAmount: { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: colors.text.primary, flexShrink: 0 },
});
