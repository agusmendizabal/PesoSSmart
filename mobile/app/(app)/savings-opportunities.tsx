import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { spacing, layout } from '@/theme';
import { Text } from '@/components/ui/Text';
import { useAuthStore } from '@/store/authStore';
import { fetchBudgetPlan, type BudgetPlan, type CategoryBudget } from '@/lib/budgetPlan';
import { buildCategoryInsight } from '@/lib/budgetInsights';
import { formatCurrency } from '@/utils/format';

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:     '#FAFAF7',
  card:   '#FFFFFF',
  blue:   '#1976D2',
  green:  '#27AE60',
  violet: '#27AE60',
  red:    '#EF4444',
  amber:  '#F59E0B',
  text:   '#1C1C1C',
  sub:    '#6D6A63',
  muted:  '#9B9790',
  border: '#E8E2D9',
  light:  '#F5F1E9',
} as const;

const shadow = layout.cardShadow;

// ─── Category Icon helper ─────────────────────────────────────────────────────

function CategoryIcon({ icon, color, size = 20 }: {
  icon: string | null; color: string; size?: number;
}) {
  if (!icon) return <Ionicons name="pricetag-outline" size={size} color={color} />;
  if (icon.includes('-') || /^[a-z]/.test(icon)) {
    return <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={size} color={color} />;
  }
  return <Text style={{ fontSize: size - 2, lineHeight: size + 12 }}>{icon}</Text>;
}

// ─── Hero Card ────────────────────────────────────────────────────────────────

function HeroCard({ total }: { total: number }) {
  return (
    <View style={hc.card}>
      <View style={hc.left}>
        <Text style={hc.eyebrow}>Podrías ahorrar hasta</Text>
        <Text style={hc.amount}>{formatCurrency(total)}</Text>
        <Text style={hc.sub}>este mes ajustando estos gastos</Text>
      </View>
      <Text style={hc.emoji}>🐷</Text>
    </View>
  );
}

const hc = StyleSheet.create({
  card:   { backgroundColor: C.green, borderRadius: 24, padding: spacing[6], flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  left:   { flex: 1, gap: spacing[1] },
  eyebrow:{ fontFamily: 'Montserrat_500Medium', fontSize: 12, color: '#A8D5C2' },
  amount: { fontFamily: 'Montserrat_800ExtraBold', fontSize: 34, color: '#FFFFFF', lineHeight: 42 },
  sub:    { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: '#6D6A63' },
  emoji:  { fontSize: 52 },
});

// ─── Opportunity Row ──────────────────────────────────────────────────────────

function OpportunityRow({ cat, excess, onPress }: {
  cat: CategoryBudget; excess: number; onPress: () => void;
}) {
  const isAlerta = cat.alertLevel === 'alerta';

  return (
    <TouchableOpacity style={or.row} onPress={onPress} activeOpacity={0.82}>
      <View style={[or.iconBox, { backgroundColor: (isAlerta ? C.red : C.amber) + '14' }]}>
        <CategoryIcon icon={cat.icon} color={isAlerta ? C.red : C.amber} size={20} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={or.name} numberOfLines={1}>{cat.name}</Text>
        <Text style={or.detail}>
          Vas más rápido que tu ritmo habitual — proyectado {formatCurrency(excess)} por encima de tu promedio
        </Text>
      </View>
      <Text style={[or.excess, { color: isAlerta ? C.red : C.amber }]}>
        +{formatCurrency(excess)}
      </Text>
      <Ionicons name="chevron-forward" size={14} color={C.muted} />
    </TouchableOpacity>
  );
}

// ─── Opportunity Row (categorías por debajo de su ritmo — ahorro ya logrado) ──

function SavingsRow({ cat, saved, onPress }: {
  cat: CategoryBudget; saved: number; onPress: () => void;
}) {
  return (
    <TouchableOpacity style={or.row} onPress={onPress} activeOpacity={0.82}>
      <View style={[or.iconBox, { backgroundColor: C.green + '14' }]}>
        <CategoryIcon icon={cat.icon} color={C.green} size={20} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={or.name} numberOfLines={1}>{cat.name}</Text>
        <Text style={or.detail}>
          Vas más lento que tu ritmo habitual — ya ahorraste respecto de tu promedio
        </Text>
      </View>
      <Text style={[or.excess, { color: C.green }]}>
        -{formatCurrency(saved)}
      </Text>
      <Ionicons name="chevron-forward" size={14} color={C.muted} />
    </TouchableOpacity>
  );
}

const or = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center', gap: spacing[3], backgroundColor: C.card, borderRadius: 16, padding: spacing[4], ...shadow },
  iconBox:{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  icon:   { fontSize: 22 },
  name:   { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.text, marginBottom: 3 },
  detail: { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.sub, lineHeight: 16 },
  excess: { fontFamily: 'Montserrat_700Bold', fontSize: 14, flexShrink: 0 },
});

// ─── Tip card ─────────────────────────────────────────────────────────────────

function TipCard({ text }: { text: string }) {
  return (
    <View style={tc.card}>
      <View style={tc.iconBox}>
        <Ionicons name="bulb-outline" size={18} color={C.amber} />
      </View>
      <Text style={tc.text}>{text}</Text>
    </View>
  );
}

const tc = StyleSheet.create({
  card:   { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], backgroundColor: C.amber + '0D', borderWidth: 1, borderColor: C.amber + '30', borderRadius: 16, padding: spacing[4] },
  iconBox:{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.amber + '18', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  text:   { flex: 1, fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.text, lineHeight: 20 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SavingsOpportunitiesScreen() {
  const { user } = useAuthStore();
  const [plan,        setPlan]         = useState<BudgetPlan | null>(null);
  const [loading,     setLoading]      = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const data = await fetchBudgetPlan(user.id);
    setPlan(data);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const handleCategoryPress = (cat: CategoryBudget) => {
    router.push({
      pathname: '/(app)/category-detail' as any,
      params: { categoryJson: JSON.stringify(cat) },
    });
  };

  // Los montos salen de `buildCategoryInsight` — el mismo cálculo que usa el
  // resto de la app (tarjetas de categoría, notificaciones) — para que esta
  // pantalla nunca muestre un número distinto para la misma categoría.
  const overCats = plan
    ? plan.categories
        .filter(c => c.alertLevel === 'alerta' || c.alertLevel === 'atencion')
        .map(c => ({ cat: c, excess: buildCategoryInsight(c, plan).amount ?? 0 }))
        .filter(({ excess }) => excess > 0)
        .sort((a, b) => b.excess - a.excess)
    : [];

  // Categorías donde el usuario ya está gastando menos de lo esperado a esta altura del mes
  const opportunityCats = plan
    ? plan.categories
        .filter(c => c.alertLevel === 'oportunidad')
        .map(c => ({ cat: c, saved: buildCategoryInsight(c, plan).amount ?? 0 }))
        .filter(({ saved }) => saved > 0)
        .sort((a, b) => b.saved - a.saved)
    : [];

  const totalSavings = overCats.reduce((s, { excess }) => s + excess, 0)
    + opportunityCats.reduce((s, { saved }) => s + saved, 0);

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity style={st.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Oportunidades de ahorro</Text>
        <TouchableOpacity style={st.backBtn}>
          <Ionicons name="information-circle-outline" size={20} color={C.sub} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={st.centered}>
          <ActivityIndicator size="large" color={C.green} />
        </View>
      ) : !plan || (overCats.length === 0 && opportunityCats.length === 0) ? (
        <View style={st.centered}>
          <Text style={{ fontSize: 52 }}>🎉</Text>
          <Text style={st.emptyTitle}>¡Sin excesos este mes!</Text>
          <Text style={st.emptySub}>Todas tus categorías están dentro del promedio. Seguí así.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={st.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={C.green} />}
        >
          <HeroCard total={totalSavings} />

          <TipCard
            text="Si reducís estos gastos al nivel de tu promedio histórico, podés ahorrar significativamente sin cambiar mucho tu estilo de vida."
          />

          {overCats.length > 0 && (
            <>
              <View style={st.sectionRow}>
                <Text style={st.sectionTitle}>Categorías a ajustar</Text>
                <Text style={st.sectionCount}>{overCats.length} categorías</Text>
              </View>

              {overCats.map(({ cat, excess }) => (
                <OpportunityRow
                  key={cat.categoryId}
                  cat={cat}
                  excess={excess}
                  onPress={() => handleCategoryPress(cat)}
                />
              ))}
            </>
          )}

          {opportunityCats.length > 0 && (
            <>
              <View style={st.sectionRow}>
                <Text style={st.sectionTitle}>Ya estás ahorrando</Text>
                <Text style={st.sectionCount}>{opportunityCats.length} categorías</Text>
              </View>

              {opportunityCats.map(({ cat, saved }) => (
                <SavingsRow
                  key={cat.categoryId}
                  cat={cat}
                  saved={saved}
                  onPress={() => handleCategoryPress(cat)}
                />
              ))}
            </>
          )}

          <View style={st.divider} />

          {/* Meta sugerida CTA */}
          <TouchableOpacity
            style={st.goalCta}
            onPress={() => router.push('/(app)/savings-goal' as any)}
            activeOpacity={0.85}
          >
            <View style={st.goalCtaLeft}>
              <Text style={st.goalCtaTitle}>Ver meta sugerida</Text>
              <Text style={st.goalCtaSub}>
                Creamos un objetivo basado en tus oportunidades
              </Text>
            </View>
            <View style={st.goalCtaArrow}>
              <Ionicons name="arrow-forward" size={16} color="#FFF" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={st.allCatsBtn}
            onPress={() => router.push('/(app)/savings-plan' as any)}
            activeOpacity={0.8}
          >
            <Text style={st.allCatsText}>Ver todas las categorías</Text>
            <Ionicons name="chevron-forward" size={14} color={C.blue} />
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.bg },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.screenPadding, paddingTop: spacing[2], paddingBottom: spacing[4] },
  headerTitle:  { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: C.text },
  backBtn:      { width: 38, height: 38, borderRadius: 19, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', ...shadow },
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[3], paddingHorizontal: layout.screenPadding },
  emptyTitle:   { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: C.text, textAlign: 'center' },
  emptySub:     { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: C.sub, textAlign: 'center', lineHeight: 22 },
  scroll:       { paddingHorizontal: layout.screenPadding, paddingBottom: layout.tabBarHeight + spacing[6], gap: spacing[4] },
  sectionRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: C.text },
  sectionCount: { fontFamily: 'Montserrat_500Medium', fontSize: 13, color: C.muted },
  divider:      { height: 1, backgroundColor: C.border },
  goalCta:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.blue, borderRadius: 18, padding: spacing[5], gap: spacing[3] },
  goalCtaLeft:  { flex: 1, gap: 3 },
  goalCtaTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: '#FFF' },
  goalCtaSub:   { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#6D6A63' },
  goalCtaArrow: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF25', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  allCatsBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], borderWidth: 1, borderColor: C.blue + '35', borderRadius: 14, padding: spacing[4] },
  allCatsText:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: C.blue },
});
