import React, { useState, useEffect, useCallback } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';

// ─── Tokens ───────────────────────────────────────────────────────────────────

const C = {
  bg:       '#F6F7F9',
  white:    '#FFFFFF',
  green:    '#2E7D32',
  greenLt:  '#EEF7EF',
  purple:   '#7B61FF',
  purpleLt: '#F5F0FF',
  text:     '#212121',
  text2:    '#757575',
  muted:    '#9E9E9E',
  border:   '#E0E0E0',
} as const;

const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

const AVATAR_COLORS = ['#4361ee', '#e63946', '#2d6a4f', '#f4a261', '#7209b7', '#3a86ff'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashIdx(str: string, len: number): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
  return Math.abs(h) % len;
}

function mapRole(dbRole: string): string {
  return ['parent', 'partner', 'admin'].includes(dbRole) ? 'Admin' : 'Miembro';
}

function currentMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthLabel(): string {
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const d = new Date();
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function dateLabel(dateStr: string): string {
  const today     = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  if (dateStr === today)     return 'Hoy';
  if (dateStr === yesterday) return 'Ayer';
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${d.getDate()} ${months[d.getMonth()]}.`;
}

function expenseIcon(desc: string): { icon: string; iconBg: string; iconColor: string } {
  const d = (desc ?? '').toLowerCase();
  if (d.includes('super') || d.includes('mercado') || d.includes('carrefour') || d.includes('coto'))
    return { icon: 'cart-outline',        iconBg: '#DCFCE7', iconColor: '#16A34A' };
  if (d.includes('restau') || d.includes('cena') || d.includes('comida') || d.includes('pizza'))
    return { icon: 'restaurant-outline',  iconBg: '#FEF3C7', iconColor: '#D97706' };
  if (d.includes('internet') || d.includes('wifi'))
    return { icon: 'wifi-outline',        iconBg: '#DBEAFE', iconColor: '#2563EB' };
  if (d.includes('luz') || d.includes('electric'))
    return { icon: 'flash-outline',       iconBg: '#FEF9C3', iconColor: '#CA8A04' };
  if (d.includes('nafta') || d.includes('combustible'))
    return { icon: 'car-outline',         iconBg: '#FCE7F3', iconColor: '#9D174D' };
  if (d.includes('viaje') || d.includes('vuelo') || d.includes('hotel'))
    return { icon: 'airplane-outline',    iconBg: '#E0F2FE', iconColor: '#0369A1' };
  return { icon: 'cash-outline', iconBg: '#F3F4F6', iconColor: '#6B7280' };
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface MemberExpense {
  id:            string;
  amount:        number;
  date:          string;
  description:   string;
  categoryName:  string;
  categoryIcon:  string | null;
  categoryColor: string | null;
  isPending:     boolean;
}

interface MemberInfo {
  name:  string;
  email: string;
  role:  string;
  color: string;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, color, size = 44 }: { name: string; color: string; size?: number }) {
  return (
    <View style={[s.avatarBase, { width: size, height: size, borderRadius: size / 2, backgroundColor: color + '22' }]}>
      <Text style={[s.avatarInitial, { color, fontSize: size * 0.38 }]}>{name.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

// ─── Pantalla ─────────────────────────────────────────────────────────────────

export default function MemberDetailScreen() {
  const { userId = '', groupId = '', memberName: paramName = '' } = useLocalSearchParams<{
    userId: string; groupId: string; memberName: string;
  }>();
  const { user } = useAuthStore();

  const [info,      setInfo]      = useState<MemberInfo | null>(null);
  const [expenses,  setExpenses]  = useState<MemberExpense[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [permitted, setPermitted] = useState(true);
  const [filter,    setFilter]    = useState<string | null>(null);

  const handleBack = useCallback(() => {
    router.replace({ pathname: '/(app)/group-detail', params: { id: groupId } } as any);
  }, [groupId]);

  const load = useCallback(async () => {
    if (!userId || !groupId || !user?.id) return;
    const db = supabase as any;

    // Verificar que el usuario actual es admin del grupo
    const { data: myMembership } = await db
      .from('family_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .single();

    const myRole  = myMembership?.role ?? '';
    const isAdmin = ['admin', 'parent', 'partner'].includes(myRole);

    if (!isAdmin && userId !== user.id) {
      setPermitted(false);
      setLoading(false);
      return;
    }

    // Perfil del miembro
    const [membershipRes, profileRes] = await Promise.all([
      db.from('family_members').select('role').eq('group_id', groupId).eq('user_id', userId).single(),
      db.from('profiles').select('full_name, email').eq('id', userId).single(),
    ]);

    const fullName = profileRes.data?.full_name?.trim() || '';
    const email    = profileRes.data?.email ?? '';
    const name     = fullName || email.split('@')[0] || 'Miembro';
    const role     = membershipRes.data?.role ?? 'member';

    setInfo({
      name, email, role,
      color: AVATAR_COLORS[hashIdx(userId, AVATAR_COLORS.length)],
    });

    // La política RLS "family_admin_read_member_expenses" permite al admin
    // leer gastos de cualquier miembro de su grupo familiar.
    const { data: expData } = await supabase
      .from('expenses')
      .select('id, amount, date, description, category_id, category:expense_categories(name_es, icon, color)')
      .eq('user_id', userId)
      .gte('date', currentMonthStart())
      .is('deleted_at', null)
      .order('date', { ascending: false });

    setExpenses((expData ?? []).map((e: any) => ({
      id:            e.id,
      amount:        Number(e.amount),
      date:          e.date,
      description:   e.description || 'Sin descripción',
      categoryName:  (e.category as any)?.name_es ?? 'Sin categoría',
      categoryIcon:  (e.category as any)?.icon ?? null,
      categoryColor: (e.category as any)?.color ?? null,
      isPending:     !e.category_id,
    })));

    setLoading(false);
  }, [userId, groupId, user?.id]);

  useEffect(() => { load(); }, [load]);

  // ─── Derived stats ───────────────────────────────────────────────────────────

  const FILTER_UNCLASSIFIED = '__sin_clasificar__';

  const total     = expenses.reduce((s, e) => s + e.amount, 0);
  const maxExpAmt = expenses.reduce((mx, e) => Math.max(mx, e.amount), 0);

  const catMap: Record<string, { name: string; total: number }> = {};
  for (const e of expenses) {
    if (e.isPending) continue;
    if (!catMap[e.categoryName]) catMap[e.categoryName] = { name: e.categoryName, total: 0 };
    catMap[e.categoryName].total += e.amount;
  }
  const topCat         = Object.values(catMap).sort((a, b) => b.total - a.total)[0];
  const unclassified   = expenses.filter(e => e.isPending);
  const categories     = [...new Set(expenses.filter(e => !e.isPending).map(e => e.categoryName))];
  const filtered       = filter === FILTER_UNCLASSIFIED
    ? unclassified
    : filter
      ? expenses.filter(e => e.categoryName === filter)
      : expenses;

  const displayName = info?.name || (paramName as string) || 'Miembro';

  // ─── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.centered}><ActivityIndicator color={C.green} size="large" /></View>
      </SafeAreaView>
    );
  }

  // ─── Sin permiso ─────────────────────────────────────────────────────────────

  if (!permitted) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={handleBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={20} color={C.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Sin permiso</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.centered}>
          <Ionicons name="lock-closed-outline" size={48} color={C.muted} />
          <Text style={s.emptyTitle}>Sin permiso</Text>
          <Text style={s.emptySub}>No tenés permiso para ver estos gastos.</Text>
          <TouchableOpacity onPress={handleBack} style={{ marginTop: sp.lg }}>
            <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.green }}>Volver</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Pantalla principal ───────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.safe} edges={['top']}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={handleBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>Gastos de {displayName}</Text>
          <Text style={s.headerSub}>{monthLabel()}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* Card resumen del miembro */}
        <View style={s.summaryCard}>
          <View style={s.memberHeader}>
            <Avatar name={displayName} color={info?.color ?? C.green} size={52} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.memberName} numberOfLines={1}>{displayName}</Text>
              {info?.email ? <Text style={s.memberEmail} numberOfLines={1}>{info.email}</Text> : null}
              <View style={s.roleBadge}>
                <Text style={s.roleBadgeText}>{mapRole(info?.role ?? 'member')}</Text>
              </View>
            </View>
          </View>

          <View style={s.divider} />

          <View style={s.statsRow}>
            <View style={s.statCol}>
              <Text style={s.statLabel}>Total del mes</Text>
              <Text style={s.statAmt}>{formatCurrency(total)}</Text>
            </View>
            <View style={s.statCol}>
              <Text style={s.statLabel}>Gastos</Text>
              <Text style={s.statAmt}>{expenses.length}</Text>
            </View>
          </View>

          {(topCat || maxExpAmt > 0) && (
            <>
              <View style={s.divider} />
              <View style={s.detailRow}>
                {topCat && (
                  <View style={s.detailCol}>
                    <Text style={s.statLabel}>Categoría principal</Text>
                    <Text style={s.detailVal} numberOfLines={1}>{topCat.name}</Text>
                  </View>
                )}
                {maxExpAmt > 0 && (
                  <View style={[s.detailCol, { alignItems: 'flex-end' }]}>
                    <Text style={s.statLabel}>Gasto más alto</Text>
                    <Text style={s.detailVal}>{formatCurrency(maxExpAmt)}</Text>
                  </View>
                )}
              </View>
            </>
          )}
        </View>

        {/* Filtros por categoría */}
        {(categories.length > 0 || unclassified.length > 0) && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: sp.sm, paddingVertical: sp.xs }}
          >
            <TouchableOpacity
              style={[s.chip, !filter && s.chipActive]}
              onPress={() => setFilter(null)}
            >
              <Text style={[s.chipText, !filter && s.chipTextActive]}>Todos</Text>
            </TouchableOpacity>
            {categories.map(cat => (
              <TouchableOpacity
                key={cat}
                style={[s.chip, filter === cat && s.chipActive]}
                onPress={() => setFilter(prev => prev === cat ? null : cat)}
              >
                <Text style={[s.chipText, filter === cat && s.chipTextActive]}>{cat}</Text>
              </TouchableOpacity>
            ))}
            {unclassified.length > 0 && (
              <TouchableOpacity
                style={[s.chip, filter === FILTER_UNCLASSIFIED && s.chipPending]}
                onPress={() => setFilter(prev => prev === FILTER_UNCLASSIFIED ? null : FILTER_UNCLASSIFIED)}
              >
                <Text style={[s.chipText, filter === FILTER_UNCLASSIFIED && s.chipTextPending]}>
                  Sin clasificar ({unclassified.length})
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {/* Lista de gastos */}
        <Text style={s.sectionTitle}>
          {filter === FILTER_UNCLASSIFIED ? 'Sin clasificar' : filter ? `Gastos en ${filter}` : 'Todos los gastos'}
        </Text>

        {filtered.length === 0 ? (
          <View style={s.emptyBox}>
            <Ionicons name="receipt-outline" size={36} color={C.border} />
            <Text style={s.emptyTitle}>
              {expenses.length === 0
                ? 'Este miembro no tiene gastos este mes'
                : filter === FILTER_UNCLASSIFIED
                  ? 'No hay gastos sin clasificar'
                  : `Sin gastos en ${filter}`}
            </Text>
          </View>
        ) : (
          <View style={s.expCard}>
            {filtered.map((e, i) => {
              const ic = expenseIcon(e.description);
              const iconName  = e.categoryIcon  ?? ic.icon;
              const iconColor = e.categoryColor ? '#FFFFFF' : ic.iconColor;
              const iconBg    = e.categoryColor ?? ic.iconBg;
              return (
                <View key={e.id}>
                  {i > 0 && <View style={s.divider} />}
                  <View style={s.expRow}>
                    <View style={[s.expIcon, { backgroundColor: iconBg }]}>
                      <Ionicons name={iconName as any} size={18} color={iconColor} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.expName} numberOfLines={1}>{e.description}</Text>
                      <Text style={s.expMeta}>{dateLabel(e.date)} · {e.categoryName}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Text style={s.expAmount}>{formatCurrency(e.amount)}</Text>
                      {e.isPending && (
                        <View style={s.pendingBadge}>
                          <Text style={s.pendingText}>Sin clasificar</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: C.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: sp.xl, gap: sp.md },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: sp.md,
    paddingHorizontal: sp.xl, paddingVertical: sp.md,
    backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.bg,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  headerTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 17, color: C.text, letterSpacing: -0.2 },
  headerSub:   { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted, marginTop: 2 },

  content: { paddingHorizontal: sp.xl, paddingTop: sp.xl, paddingBottom: 100, gap: sp.lg },

  // Summary card
  summaryCard: {
    backgroundColor: C.white, borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  memberHeader: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg },
  memberName:   { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: C.text, letterSpacing: -0.2 },
  memberEmail:  { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted },
  roleBadge:    { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: sp.sm, paddingVertical: 2, backgroundColor: C.greenLt },
  roleBadgeText:{ fontFamily: 'Montserrat_700Bold', fontSize: 10, color: C.green },

  statsRow: { flexDirection: 'row', paddingHorizontal: sp.lg, paddingVertical: sp.md, gap: sp.xl },
  statCol:  { gap: 4 },
  statLabel:{ fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted },
  statAmt:  { fontFamily: 'Montserrat_700Bold', fontSize: 22, color: C.text, letterSpacing: -0.5 },

  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: sp.lg, paddingVertical: sp.md },
  detailCol: { gap: 4 },
  detailVal: { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.text },

  divider: { height: 1, backgroundColor: C.border },

  sectionTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: C.text },

  // Filter chips
  chip:            { borderRadius: 20, borderWidth: 1.5, borderColor: C.border, paddingHorizontal: sp.md, paddingVertical: sp.xs, backgroundColor: C.white },
  chipActive:      { borderColor: C.green, backgroundColor: C.greenLt },
  chipPending:     { borderColor: '#D97706', backgroundColor: '#FEF3C7' },
  chipText:        { fontFamily: 'Montserrat_500Medium', fontSize: 13, color: C.muted },
  chipTextActive:  { fontFamily: 'Montserrat_700Bold', fontSize: 13, color: C.green },
  chipTextPending: { fontFamily: 'Montserrat_700Bold', fontSize: 13, color: '#D97706' },

  // Expense list
  expCard:   {
    backgroundColor: C.white, borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  expRow:    { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg },
  expIcon:   { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  expName:   { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.text },
  expMeta:   { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted },
  expAmount: { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.text },

  pendingBadge: { borderRadius: 4, backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2 },
  pendingText:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 10, color: '#D97706' },

  emptyBox:   { alignItems: 'center', gap: sp.md, paddingVertical: sp.xxl },
  emptyTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: C.text },
  emptySub:   { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.muted, textAlign: 'center' },

  avatarBase:    { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarInitial: { fontFamily: 'Montserrat_700Bold' },
});
