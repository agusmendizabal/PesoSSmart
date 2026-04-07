import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Card, Button, Input } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/utils/format';

// ── Types ────────────────────────────────────────────────────────────────────

type FamilyRole = 'parent' | 'child' | 'partner';
type ViewState  = 'loading' | 'empty' | 'parent' | 'child' | 'couple';

type GroupData = {
  id:          string;
  name:        string;
  invite_code: string;
  group_type:  'family' | 'couple';
};

type MemberData = {
  id:            string;
  user_id:       string;
  role:          FamilyRole;
  full_name:     string;
  monthly_total: number; // 0 for parents / self when child
};

type ChildExpense = {
  id:                string;
  amount:            number;
  description:       string;
  date:              string;
  classification:    string;
  expense_categories: { name_es: string } | null;
};

type CoupleExpense = {
  id:                string;
  amount:            number;
  description:       string;
  date:              string;
  classification:    string | null;
  user_id:           string;
  is_shared:         boolean;
  expense_categories: { name_es: string } | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateInviteCode(): string {
  // Excluye caracteres confusos (0/O, 1/I, etc.)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(
    { length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join('');
}

function currentMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function MemberRow({
  member,
  isCurrentUser,
  showAmount,
  onPress,
}: {
  member:        MemberData;
  isCurrentUser: boolean;
  showAmount:    boolean;
  onPress?:      () => void;
}) {
  const isParent = member.role === 'parent';
  const accentColor = isParent ? colors.neon : colors.info;

  return (
    <TouchableOpacity
      style={styles.memberRow}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      {/* Avatar */}
      <View style={[styles.memberAvatar, { borderColor: accentColor }]}>
        <Ionicons
          name={isParent ? 'shield-checkmark' : 'person'}
          size={16}
          color={accentColor}
        />
      </View>

      {/* Info */}
      <View style={styles.memberInfo}>
        <View style={styles.memberNameRow}>
          <Text variant="bodySmall" color={colors.text.primary}>
            {isCurrentUser ? 'Vos' : member.full_name}
          </Text>
          {isCurrentUser && (
            <View style={styles.youBadge}>
              <Text style={styles.youBadgeText}>TÚ</Text>
            </View>
          )}
        </View>
        <Text variant="caption" color={accentColor}>
          {isParent ? 'PADRE / MADRE' : 'HIJO / HIJA'}
        </Text>
      </View>

      {/* Right */}
      <View style={styles.memberRight}>
        {showAmount && (
          <Text variant="labelMd" color={colors.text.primary}>
            {formatCurrency(member.monthly_total)}
          </Text>
        )}
        {onPress && (
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.text.tertiary}
            style={{ marginLeft: spacing[2] }}
          />
        )}
      </View>
    </TouchableOpacity>
  );
}

function InviteCodeCard({ code }: { code: string }) {
  const handleShare = () => {
    Share.share({
      message: `Unite a mi grupo familiar en SmartPesos con el código: ${code}`,
      title: 'Código de invitación familiar',
    });
  };

  return (
    <Card variant="neon" style={styles.codeCard}>
      <Text variant="label" color={colors.text.secondary}>
        CÓDIGO DE INVITACIÓN
      </Text>

      <View style={styles.codeRow}>
        {/* Letters */}
        <View style={styles.codeLetters}>
          {code.split('').map((char, i) => (
            <View key={i} style={styles.codeLetter}>
              <Text variant="h4" color={colors.neon} style={{ letterSpacing: 0 }}>
                {char}
              </Text>
            </View>
          ))}
        </View>

        {/* Share */}
        <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
          <Ionicons name="share-social-outline" size={18} color={colors.text.secondary} />
          <Text variant="caption" color={colors.text.secondary} style={{ marginTop: 2 }}>
            COMPARTIR
          </Text>
        </TouchableOpacity>
      </View>

      <Text variant="caption" color={colors.text.secondary} style={{ marginTop: spacing[3] }}>
        Compartí este código para que tu familia se una al grupo
      </Text>
    </Card>
  );
}

function ChildExpenseList({
  expenses,
  loading,
}: {
  expenses: ChildExpense[];
  loading:  boolean;
}) {
  if (loading) {
    return (
      <View style={styles.listPlaceholder}>
        <ActivityIndicator color={colors.neon} size="small" />
      </View>
    );
  }

  if (expenses.length === 0) {
    return (
      <View style={styles.listPlaceholder}>
        <Text variant="caption" color={colors.text.tertiary} align="center">
          Sin gastos este mes
        </Text>
      </View>
    );
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <View>
      {/* Monthly total */}
      <View style={styles.childTotal}>
        <Text variant="label" color={colors.text.secondary}>TOTAL DEL MES</Text>
        <Text variant="labelMd" color={colors.text.primary}>{formatCurrency(total)}</Text>
      </View>

      {/* List */}
      {expenses.map((exp) => (
        <View key={exp.id} style={styles.expRow}>
          <View style={{ flex: 1 }}>
            <Text variant="bodySmall" color={colors.text.primary} numberOfLines={1}>
              {exp.description}
            </Text>
            <Text variant="caption" color={colors.text.secondary}>
              {formatDate(exp.date)}
              {exp.expense_categories ? ` · ${exp.expense_categories.name_es}` : ''}
            </Text>
          </View>
          <Text
            variant="labelMd"
            color={
              exp.classification === 'investable' ? colors.neon :
              exp.classification === 'disposable' ? colors.red :
              colors.text.primary
            }
          >
            {formatCurrency(exp.amount)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function CoupleExpenseRow({
  expense,
  isMe,
  memberName,
}: {
  expense:    CoupleExpense;
  isMe:       boolean;
  memberName: string;
}) {
  const accentColor =
    expense.classification === 'investable' ? colors.neon :
    expense.classification === 'disposable' ? colors.red :
    colors.text.primary;

  return (
    <View style={styles.expRow}>
      {/* Indicador de quién gastó */}
      <View style={[styles.coupleAvatar, { borderColor: isMe ? colors.neon : colors.info }]}>
        <Text style={{ fontSize: 10, color: isMe ? colors.neon : colors.info, fontFamily: 'DMSans_600SemiBold' }}>
          {isMe ? 'VOS' : memberName.split(' ')[0].slice(0, 3).toUpperCase()}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
          <Text variant="bodySmall" color={colors.text.primary} numberOfLines={1} style={{ flex: 1 }}>
            {expense.description}
          </Text>
          {expense.is_shared && (
            <View style={styles.sharedBadge}>
              <Text style={{ fontSize: 9, color: colors.yellow, fontFamily: 'DMSans_600SemiBold' }}>
                COMPARTIDO
              </Text>
            </View>
          )}
        </View>
        <Text variant="caption" color={colors.text.secondary}>
          {formatDate(expense.date)}
          {expense.expense_categories ? ` · ${expense.expense_categories.name_es}` : ''}
        </Text>
      </View>

      <Text variant="labelMd" color={accentColor}>
        {formatCurrency(expense.amount)}
      </Text>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function FamilyScreen() {
  const { user } = useAuthStore();

  const [viewState,    setViewState]    = useState<ViewState>('loading');
  const [group,        setGroup]        = useState<GroupData | null>(null);
  const [myRole,       setMyRole]       = useState<FamilyRole | null>(null);
  const [members,      setMembers]      = useState<MemberData[]>([]);

  const [showCreateModal,      setShowCreateModal]      = useState(false);
  const [showJoinModal,        setShowJoinModal]        = useState(false);
  const [creatingCoupleMode,   setCreatingCoupleMode]   = useState(false);
  const [groupName,            setGroupName]            = useState('');
  const [joinCode,             setJoinCode]             = useState('');
  const [isSubmitting,         setIsSubmitting]         = useState(false);

  const [selectedChildId,      setSelectedChildId]      = useState<string | null>(null);
  const [childExpenses,        setChildExpenses]        = useState<ChildExpense[]>([]);
  const [childExpensesLoading, setChildExpensesLoading] = useState(false);

  const [coupleExpenses,       setCoupleExpenses]       = useState<CoupleExpense[]>([]);

  // ── Data loading ────────────────────────────────────────────────────────

  const loadFamilyData = useCallback(async () => {
    if (!user?.id) {
      setViewState('empty');
      return;
    }
    setViewState('loading');

    // ¿El usuario tiene membresía?
    const { data: membership } = await supabase
      .from('family_members')
      .select('role, group_id')
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      setViewState('empty');
      return;
    }

    setMyRole(membership.role as FamilyRole);

    // Info del grupo
    const { data: groupData } = await supabase
      .from('family_groups')
      .select('id, name, invite_code, group_type')
      .eq('id', membership.group_id)
      .single();

    if (!groupData) {
      setViewState('empty');
      return;
    }

    setGroup(groupData);

    // Miembros con perfil
    const { data: membersRaw } = await supabase
      .from('family_members')
      .select('id, user_id, role, profiles:user_id(full_name)')
      .eq('group_id', membership.group_id)
      .order('role', { ascending: true }); // parents first

    const formatted: MemberData[] = (membersRaw ?? []).map((m: any) => ({
      id:            m.id,
      user_id:       m.user_id,
      role:          m.role as FamilyRole,
      full_name:     m.profiles?.full_name ?? 'Sin nombre',
      monthly_total: 0,
    }));

    // Si es pareja → cargar gastos combinados de ambos
    if (groupData.group_type === 'couple') {
      const partnerIds = formatted.map((m) => m.user_id);
      const { data: expData } = await supabase
        .from('expenses')
        .select('id, amount, description, date, classification, user_id, is_shared, expense_categories:category_id(name_es)')
        .in('user_id', partnerIds)
        .gte('date', currentMonthStart())
        .is('deleted_at', null)
        .order('date', { ascending: false });

      setCoupleExpenses((expData ?? []) as CoupleExpense[]);
      setViewState('couple');
      setMembers(formatted);
      return;
    }

    // Si es padre → obtener totales mensuales de los hijos
    if (membership.role === 'parent') {
      const childIds = formatted
        .filter((m) => m.role === 'child')
        .map((m) => m.user_id);

      if (childIds.length > 0) {
        const { data: expData } = await supabase
          .from('expenses')
          .select('user_id, amount')
          .in('user_id', childIds)
          .gte('date', currentMonthStart());

        const totals: Record<string, number> = {};
        expData?.forEach((e: any) => {
          totals[e.user_id] = (totals[e.user_id] ?? 0) + Number(e.amount);
        });

        formatted.forEach((m) => {
          if (m.role === 'child') m.monthly_total = totals[m.user_id] ?? 0;
        });
      }

      setViewState('parent');
    } else {
      setViewState('child');
    }

    setMembers(formatted);
  }, [user?.id]);

  useEffect(() => {
    loadFamilyData();
  }, [loadFamilyData]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleCreateGroup = async (groupType: 'family' | 'couple' = 'family') => {
    if (!user?.id || !groupName.trim()) return;
    setIsSubmitting(true);
    try {
      const code = generateInviteCode();
      const role = groupType === 'couple' ? 'partner' : 'parent';

      const { data: newGroup, error: groupErr } = await supabase
        .from('family_groups')
        .insert({ name: groupName.trim(), invite_code: code, group_type: groupType })
        .select()
        .single();

      if (groupErr) {
        console.error('[Family] INSERT family_groups falló:', groupErr.code, groupErr.message);
        throw groupErr;
      }

      console.log('[Family] Grupo creado OK:', newGroup.id, '| Insertando membresía...');

      const { error: memberErr } = await supabase
        .from('family_members')
        .insert({ group_id: newGroup.id, user_id: user.id, role });

      if (memberErr) {
        console.error('[Family] INSERT family_members falló:', memberErr.code, memberErr.message);
        throw memberErr;
      }

      console.log('[Family] Membresía creada OK — recargando...');
      setShowCreateModal(false);
      setGroupName('');
      await loadFamilyData();
    } catch (err: any) {
      const msg = err?.message ?? 'No se pudo crear el grupo.';
      console.error('[Family] handleCreateGroup ERROR:', err);
      // Traducir errores técnicos a mensajes entendibles
      if (msg.includes('does not exist')) {
        Alert.alert('Error de configuración', 'Las tablas de grupo familiar no están creadas en la base de datos. Contactá al soporte.');
      } else if (msg.includes('duplicate') || err?.code === '23505') {
        Alert.alert('Código repetido', 'Ocurrió un conflicto al generar el código. Intentá de nuevo.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoinGroup = async () => {
    console.log('[Family] handleJoinGroup START | code:', joinCode);
    if (!user?.id || joinCode.trim().length < 6) return;
    setIsSubmitting(true);
    try {
      const { data: targetGroup, error: findErr } = await supabase
        .from('family_groups')
        .select('id, name, group_type')
        .eq('invite_code', joinCode.trim().toUpperCase())
        .single();

      if (findErr) {
        console.error('[Family] SELECT family_groups falló:', findErr.code, findErr.message);
        if (findErr.message.includes('does not exist')) {
          Alert.alert('Error de configuración', 'Las tablas de grupo familiar no están creadas. Contactá al soporte.');
          return;
        }
      }

      if (!targetGroup) {
        Alert.alert(
          'Código inválido',
          'No encontramos ningún grupo con ese código. Verificalo e intentá de nuevo.',
        );
        return;
      }

      const joinRole = targetGroup.group_type === 'couple' ? 'partner' : 'child';
      const { error: joinErr } = await supabase
        .from('family_members')
        .insert({ group_id: targetGroup.id, user_id: user.id, role: joinRole });

      if (joinErr) {
        if (joinErr.code === '23505') {
          Alert.alert(
            'Ya estás en un grupo',
            'Salí de tu grupo actual antes de unirte a uno nuevo.',
          );
        } else {
          throw joinErr;
        }
        return;
      }

      setShowJoinModal(false);
      setJoinCode('');
      Alert.alert('¡Listo!', `Te uniste al grupo "${targetGroup.name}".`);
      await loadFamilyData();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'No se pudo unir al grupo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLeave = () => {
    const isParent  = myRole === 'parent';
    const isPartner = myRole === 'partner';
    const isAdmin   = isParent || isPartner;
    Alert.alert(
      isAdmin ? 'Disolver grupo' : 'Salir del grupo',
      isAdmin
        ? 'Si salís, el grupo se disuelve y todos los miembros quedan sin grupo. ¿Estás seguro?'
        : '¿Seguro que querés salir del grupo familiar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: isParent ? 'Disolver' : 'Salir',
          style: 'destructive',
          onPress: async () => {
            if (!user?.id || !group?.id) return;
            if (isAdmin) {
              // Elimina el grupo → CASCADE borra todos los miembros
              await supabase.from('family_groups').delete().eq('id', group.id);
            } else {
              await supabase
                .from('family_members')
                .delete()
                .eq('user_id', user.id)
                .eq('group_id', group.id);
            }
            setGroup(null);
            setMembers([]);
            setMyRole(null);
            setSelectedChildId(null);
            setChildExpenses([]);
            setViewState('empty');
          },
        },
      ],
    );
  };

  const handleSelectChild = async (childUserId: string) => {
    // Toggle: si ya estaba seleccionado, colapsar
    if (selectedChildId === childUserId) {
      setSelectedChildId(null);
      setChildExpenses([]);
      return;
    }
    setSelectedChildId(childUserId);
    setChildExpensesLoading(true);
    try {
      const { data } = await supabase
        .from('expenses')
        .select('id, amount, description, date, classification, expense_categories:category_id(name_es)')
        .eq('user_id', childUserId)
        .gte('date', currentMonthStart())
        .order('date', { ascending: false });

      setChildExpenses((data ?? []) as ChildExpense[]);
    } finally {
      setChildExpensesLoading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (viewState === 'loading') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.neon} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const children     = members.filter((m) => m.role === 'child');
  const selectedChild = members.find((m) => m.user_id === selectedChildId);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text variant="h4">Grupo Familiar</Text>
        {group && (
          <TouchableOpacity
            onPress={handleLeave}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.text.secondary} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >

        {/* ════════════════════════════════════════════════════════════════
            EMPTY STATE — sin grupo
        ════════════════════════════════════════════════════════════════ */}
        {viewState === 'empty' && (
          <>
            {/* Hero */}
            <View style={styles.emptyHero}>
              <View style={styles.emptyIcon}>
                <Ionicons name="people" size={44} color={colors.neon} />
              </View>
              <Text variant="h4" align="center" style={{ marginTop: spacing[5] }}>
                Grupo Familiar
              </Text>
              <Text
                variant="body"
                color={colors.text.secondary}
                align="center"
                style={{ marginTop: spacing[2], lineHeight: 22 }}
              >
                Gestioná los gastos de toda tu familia desde un solo lugar
              </Text>
            </View>

            {/* Acciones */}
            <View style={styles.emptyActions}>
              <Button
                label="MODO PAREJA"
                variant="neon"
                size="lg"
                fullWidth
                leftIcon={<Ionicons name="heart-outline" size={18} color={colors.black} />}
                onPress={() => { setCreatingCoupleMode(true); setShowCreateModal(true); }}
              />

              <Button
                label="GRUPO FAMILIAR"
                variant="ghost"
                size="lg"
                fullWidth
                leftIcon={<Ionicons name="people-outline" size={18} color={colors.text.primary} />}
                onPress={() => { setCreatingCoupleMode(false); setShowCreateModal(true); }}
              />

              <View style={styles.orDivider}>
                <View style={styles.orLine} />
                <Text variant="caption" color={colors.text.tertiary} style={{ marginHorizontal: spacing[3] }}>
                  O
                </Text>
                <View style={styles.orLine} />
              </View>

              <Button
                label="UNIRME CON CÓDIGO"
                variant="ghost"
                size="lg"
                fullWidth
                leftIcon={<Ionicons name="enter-outline" size={18} color={colors.text.primary} />}
                onPress={() => setShowJoinModal(true)}
              />
            </View>

            {/* Feature list */}
            <View style={styles.featureList}>
              {[
                { icon: 'eye-outline',         text: 'Papá/mamá ve los gastos de todos los hijos' },
                { icon: 'lock-closed-outline',  text: 'Los hijos solo ven sus propios gastos' },
                { icon: 'bar-chart-outline',    text: 'Identificá cuánto gasta cada hijo por mes' },
                { icon: 'person-add-outline',   text: 'Invitá con un código de 6 letras' },
              ].map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <Ionicons name={f.icon as any} size={16} color={colors.neon} />
                  <Text variant="caption" color={colors.text.secondary} style={{ flex: 1 }}>
                    {f.text}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════
            PARENT VIEW — padre / madre
        ════════════════════════════════════════════════════════════════ */}
        {viewState === 'parent' && group && (
          <>
            {/* Group header */}
            <Card variant="neon" style={styles.groupCard}>
              <View style={styles.groupCardRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="label" color={colors.text.secondary}>TU GRUPO</Text>
                  <Text variant="h4" style={{ marginTop: spacing[1] }}>{group.name}</Text>
                  <Text variant="caption" color={colors.neon} style={{ marginTop: spacing[1] }}>
                    {members.length} MIEMBRO{members.length !== 1 ? 'S' : ''} · PADRE / MADRE
                  </Text>
                </View>
                <View style={styles.parentIcon}>
                  <Ionicons name="shield-checkmark" size={26} color={colors.neon} />
                </View>
              </View>
            </Card>

            {/* Código de invitación */}
            <InviteCodeCard code={group.invite_code} />

            {/* Miembros */}
            <View style={styles.section}>
              <Text variant="label" color={colors.text.secondary}>MIEMBROS</Text>
              <Card style={{ padding: 0 }}>
                {members.map((m, idx) => (
                  <View key={m.id}>
                    <MemberRow
                      member={m}
                      isCurrentUser={m.user_id === user?.id}
                      showAmount={m.role === 'child'}
                      onPress={m.role === 'child' ? () => handleSelectChild(m.user_id) : undefined}
                    />
                    {idx < members.length - 1 && <View style={styles.rowDivider} />}
                  </View>
                ))}

                {children.length === 0 && (
                  <View style={styles.emptyMembersNote}>
                    <Ionicons name="people-outline" size={20} color={colors.text.tertiary} />
                    <Text variant="caption" color={colors.text.tertiary} align="center">
                      Todavía no hay hijos en el grupo.{'\n'}Compartí el código de invitación.
                    </Text>
                  </View>
                )}
              </Card>
            </View>

            {/* Gastos del hijo seleccionado */}
            {selectedChild && (
              <View style={styles.section}>
                <View style={styles.sectionTitleRow}>
                  <Text variant="label" color={colors.text.secondary}>
                    GASTOS DE {selectedChild.full_name.toUpperCase()} — ESTE MES
                  </Text>
                  <TouchableOpacity
                    onPress={() => { setSelectedChildId(null); setChildExpenses([]); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={18} color={colors.text.tertiary} />
                  </TouchableOpacity>
                </View>
                <Card style={{ padding: 0 }}>
                  <ChildExpenseList expenses={childExpenses} loading={childExpensesLoading} />
                </Card>
              </View>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════
            COUPLE VIEW — modo pareja
        ════════════════════════════════════════════════════════════════ */}
        {viewState === 'couple' && group && (() => {
          const me      = members.find((m) => m.user_id === user?.id);
          const partner = members.find((m) => m.user_id !== user?.id);
          const myTotal      = coupleExpenses.filter(e => e.user_id === user?.id).reduce((s, e) => s + e.amount, 0);
          const partnerTotal = coupleExpenses.filter(e => e.user_id !== user?.id).reduce((s, e) => s + e.amount, 0);
          const combined     = myTotal + partnerTotal;
          const myPct        = combined > 0 ? myTotal / combined : 0.5;

          return (
            <>
              {/* Header */}
              <Card variant="neon" style={styles.groupCard}>
                <View style={styles.groupCardRow}>
                  <View style={{ flex: 1 }}>
                    <Text variant="label" color={colors.text.secondary}>MODO PAREJA</Text>
                    <Text variant="h4" style={{ marginTop: spacing[1] }}>{group.name}</Text>
                    <Text variant="caption" color={colors.neon} style={{ marginTop: spacing[1] }}>
                      {members.length === 2 ? '2 PERSONAS CONECTADAS' : 'ESPERANDO A TU PAREJA'}
                    </Text>
                  </View>
                  <View style={styles.parentIcon}>
                    <Ionicons name="heart" size={26} color={colors.neon} />
                  </View>
                </View>
              </Card>

              {/* Total combinado */}
              <Card style={styles.combinedCard}>
                <Text variant="label" color={colors.text.secondary}>TOTAL COMBINADO DEL MES</Text>
                <Text variant="number" color={colors.text.primary} style={{ marginTop: spacing[1] }}>
                  {formatCurrency(combined)}
                </Text>

                {/* Barra de proporción */}
                {combined > 0 && (
                  <View style={styles.proportionBar}>
                    <View style={[styles.proportionFill, { flex: myPct, backgroundColor: colors.neon }]} />
                    <View style={[styles.proportionFill, { flex: 1 - myPct, backgroundColor: colors.info }]} />
                  </View>
                )}

                {/* Breakdown por persona */}
                <View style={styles.partnerBreakdown}>
                  <View style={styles.partnerBreakdownItem}>
                    <View style={[styles.partnerDot, { backgroundColor: colors.neon }]} />
                    <Text variant="caption" color={colors.text.secondary}>Vos</Text>
                    <Text variant="labelMd" color={colors.text.primary}>{formatCurrency(myTotal)}</Text>
                  </View>
                  {partner && (
                    <View style={styles.partnerBreakdownItem}>
                      <View style={[styles.partnerDot, { backgroundColor: colors.info }]} />
                      <Text variant="caption" color={colors.text.secondary}>
                        {partner.full_name.split(' ')[0]}
                      </Text>
                      <Text variant="labelMd" color={colors.text.primary}>{formatCurrency(partnerTotal)}</Text>
                    </View>
                  )}
                </View>
              </Card>

              {/* Código de invitación si la pareja aún no se unió */}
              {members.length < 2 && (
                <View style={styles.section}>
                  <Text variant="label" color={colors.text.secondary}>INVITÁ A TU PAREJA</Text>
                  <InviteCodeCard code={group.invite_code} />
                </View>
              )}

              {/* Lista de gastos combinados */}
              <View style={styles.section}>
                <Text variant="label" color={colors.text.secondary}>GASTOS DEL MES</Text>
                {coupleExpenses.length === 0 ? (
                  <Card>
                    <Text variant="caption" color={colors.text.tertiary} align="center">
                      Sin gastos este mes
                    </Text>
                  </Card>
                ) : (
                  <Card style={{ padding: 0 }}>
                    {coupleExpenses.map((exp, idx) => (
                      <View key={exp.id}>
                        <CoupleExpenseRow
                          expense={exp}
                          isMe={exp.user_id === user?.id}
                          memberName={partner?.full_name ?? ''}
                        />
                        {idx < coupleExpenses.length - 1 && <View style={styles.rowDivider} />}
                      </View>
                    ))}
                  </Card>
                )}
              </View>

              {/* Salir */}
              <Button
                label="DISOLVER MODO PAREJA"
                variant="ghost"
                size="md"
                fullWidth
                leftIcon={<Ionicons name="exit-outline" size={18} color={colors.red} />}
                onPress={handleLeave}
                style={{ borderColor: colors.red + '66' }}
              />
            </>
          );
        })()}

        {/* ════════════════════════════════════════════════════════════════
            CHILD VIEW — hijo / hija
        ════════════════════════════════════════════════════════════════ */}
        {viewState === 'child' && group && (
          <>
            {/* Group card */}
            <Card style={styles.groupCard}>
              <View style={styles.groupCardRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="label" color={colors.text.secondary}>TU GRUPO</Text>
                  <Text variant="h4" style={{ marginTop: spacing[1] }}>{group.name}</Text>
                  <Text variant="caption" color={colors.info} style={{ marginTop: spacing[1] }}>
                    SOS HIJO / HIJA DE ESTE GRUPO
                  </Text>
                </View>
                <Ionicons name="people" size={26} color={colors.text.tertiary} />
              </View>
            </Card>

            {/* Miembros — sin montos */}
            <View style={styles.section}>
              <Text variant="label" color={colors.text.secondary}>MIEMBROS</Text>
              <Card style={{ padding: 0 }}>
                {members.map((m, idx) => (
                  <View key={m.id}>
                    <MemberRow
                      member={m}
                      isCurrentUser={m.user_id === user?.id}
                      showAmount={false}
                    />
                    {idx < members.length - 1 && <View style={styles.rowDivider} />}
                  </View>
                ))}
              </Card>
            </View>

            {/* Aviso de privacidad */}
            <Card variant="neon" style={styles.privacyCard}>
              <View style={styles.privacyRow}>
                <Ionicons name="lock-closed" size={18} color={colors.neon} />
                <View style={{ flex: 1, marginLeft: spacing[3] }}>
                  <Text variant="label" color={colors.neon}>PRIVACIDAD</Text>
                  <Text variant="caption" color={colors.text.secondary} style={{ marginTop: spacing[1] }}>
                    Solo podés ver tus propios gastos. Los gastos del resto del grupo son privados y no están disponibles para vos.
                  </Text>
                </View>
              </View>
            </Card>

            {/* Salir */}
            <Button
              label="SALIR DEL GRUPO"
              variant="ghost"
              size="md"
              fullWidth
              leftIcon={<Ionicons name="exit-outline" size={18} color={colors.red} />}
              onPress={handleLeave}
              style={{ borderColor: colors.red + '66' }}
            />
          </>
        )}
      </ScrollView>

      {/* ── MODAL: Crear grupo ────────────────────────────────────────────── */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <SafeAreaView style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text variant="h4">{creatingCoupleMode ? 'Modo pareja' : 'Grupo familiar'}</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={24} color={colors.text.primary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalBody}
              keyboardShouldPersistTaps="handled"
            >
              <Text variant="body" color={colors.text.secondary}>
                {creatingCoupleMode
                  ? 'Ven los gastos de los dos en un solo lugar. Compartí el código con tu pareja para conectarse.'
                  : 'Elegí un nombre para tu grupo. Vas a ser el administrador y podrás ver los gastos de tus hijos.'}
              </Text>

              <Input
                label="NOMBRE DEL GRUPO"
                placeholder={creatingCoupleMode ? 'Ej: Agus y Franco' : 'Ej: Familia García'}
                value={groupName}
                onChangeText={setGroupName}
                autoCapitalize="words"
                autoFocus
              />

              <View style={styles.modalHints}>
                {(creatingCoupleMode ? [
                  'Se genera un código único de invitación',
                  'Ambos ven los gastos del otro',
                  'Podés marcar gastos como compartidos',
                  'Cualquiera puede disolver el grupo',
                ] : [
                  'Se genera un código único de invitación',
                  'Invitá a tu familia con ese código',
                  'Podés ver los gastos de tus hijos',
                  'Los hijos no ven los gastos ajenos',
                ]).map((t, i) => (
                  <View key={i} style={styles.featureRow}>
                    <Ionicons name="checkmark" size={14} color={colors.neon} />
                    <Text variant="caption" color={colors.text.secondary} style={{ flex: 1 }}>{t}</Text>
                  </View>
                ))}
              </View>

              <Button
                label={creatingCoupleMode ? 'CREAR MODO PAREJA' : 'CREAR GRUPO'}
                variant="neon"
                size="lg"
                fullWidth
                isLoading={isSubmitting}
                disabled={!groupName.trim()}
                onPress={() => handleCreateGroup(creatingCoupleMode ? 'couple' : 'family')}
              />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── MODAL: Unirse con código ──────────────────────────────────────── */}
      <Modal
        visible={showJoinModal}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowJoinModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <SafeAreaView style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text variant="h4">Unirse a grupo</Text>
              <TouchableOpacity onPress={() => setShowJoinModal(false)}>
                <Ionicons name="close" size={24} color={colors.text.primary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalBody}
              keyboardShouldPersistTaps="handled"
            >
              <Text variant="body" color={colors.text.secondary}>
                Pedile el código de invitación a tu padre o madre e ingresalo acá.
              </Text>

              <Input
                label="CÓDIGO DE INVITACIÓN"
                placeholder="Ej: GF4K2X"
                value={joinCode}
                onChangeText={(t) =>
                  setJoinCode(
                    t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
                  )
                }
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                maxLength={6}
              />

              {joinCode.length > 0 && joinCode.length < 6 && (
                <Text variant="caption" color={colors.text.tertiary}>
                  El código tiene 6 caracteres ({6 - joinCode.length} restantes)
                </Text>
              )}

              <Button
                label="UNIRME AL GRUPO"
                variant="neon"
                size="lg"
                fullWidth
                isLoading={isSubmitting}
                disabled={joinCode.length < 6}
                onPress={handleJoinGroup}
              />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection:    'row',
    justifyContent:   'space-between',
    alignItems:       'center',
    paddingHorizontal: layout.screenPadding,
    paddingTop:       spacing[4],
    paddingBottom:    spacing[3],
  },

  scroll: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom:    layout.tabBarHeight + spacing[8],
    gap:              spacing[5],
  },

  // ── Empty ──────────────────────────────────────────────────────────────
  emptyHero: {
    alignItems:   'center',
    paddingTop:   spacing[10],
    paddingBottom: spacing[6],
  },
  emptyIcon: {
    width:           80,
    height:          80,
    backgroundColor: colors.neon + '15',
    borderWidth:     1,
    borderColor:     colors.neon + '40',
    alignItems:      'center',
    justifyContent:  'center',
  },
  emptyActions: {
    gap: spacing[3],
  },
  orDivider: {
    flexDirection: 'row',
    alignItems:    'center',
    marginVertical: spacing[1],
  },
  orLine: {
    flex:             1,
    height:           1,
    backgroundColor:  colors.border.subtle,
  },
  featureList: {
    gap:              spacing[4],
    paddingTop:       spacing[5],
    borderTopWidth:   1,
    borderTopColor:   colors.border.subtle,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           spacing[3],
  },

  // ── Group card ─────────────────────────────────────────────────────────
  groupCard: {
    padding: spacing[5],
  },
  groupCardRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  parentIcon: {
    width:           52,
    height:          52,
    backgroundColor: colors.neon + '15',
    borderWidth:     1,
    borderColor:     colors.neon + '40',
    alignItems:      'center',
    justifyContent:  'center',
  },

  // ── Invite code ────────────────────────────────────────────────────────
  codeCard: {
    padding: spacing[5],
    gap:     spacing[3],
  },
  codeRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  codeLetters: {
    flexDirection: 'row',
    gap:           spacing[2],
  },
  codeLetter: {
    width:           34,
    height:          42,
    backgroundColor: colors.neon + '15',
    borderWidth:     1,
    borderColor:     colors.neon + '40',
    alignItems:      'center',
    justifyContent:  'center',
  },
  shareBtn: {
    alignItems:      'center',
    gap:             spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth:     1,
    borderColor:     colors.border.default,
  },

  // ── Section ────────────────────────────────────────────────────────────
  section: {
    gap: spacing[3],
  },
  sectionTitleRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },

  // ── Members ────────────────────────────────────────────────────────────
  memberRow: {
    flexDirection:    'row',
    alignItems:       'center',
    paddingHorizontal: spacing[5],
    paddingVertical:  spacing[4],
    gap:              spacing[4],
  },
  memberAvatar: {
    width:           36,
    height:          36,
    borderWidth:     1,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: colors.bg.elevated,
  },
  memberInfo:    { flex: 1, gap: spacing[1] },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  memberRight:   { flexDirection: 'row', alignItems: 'center' },
  youBadge: {
    backgroundColor:  colors.neon,
    paddingHorizontal: spacing[2],
    paddingVertical:  1,
  },
  youBadgeText: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize:   9,
    color:      colors.black,
    letterSpacing: 0.5,
  },
  rowDivider: {
    height:          1,
    backgroundColor: colors.border.subtle,
    marginLeft:      spacing[5] + 36 + spacing[4], // indent to content start
  },
  emptyMembersNote: {
    alignItems:    'center',
    gap:           spacing[3],
    paddingVertical: spacing[6],
    paddingHorizontal: spacing[5],
  },

  // ── Child expenses ─────────────────────────────────────────────────────
  listPlaceholder: {
    alignItems:    'center',
    justifyContent: 'center',
    paddingVertical: spacing[6],
  },
  childTotal: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    backgroundColor: colors.bg.elevated,
  },
  expRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    gap: spacing[3],
  },

  // ── Privacy ────────────────────────────────────────────────────────────
  privacyCard: {
    padding: spacing[5],
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
  },

  // ── Modals ─────────────────────────────────────────────────────────────
  modal: {
    flex:            1,
    backgroundColor: colors.bg.primary,
  },
  modalHeader: {
    flexDirection:    'row',
    justifyContent:   'space-between',
    alignItems:       'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical:  spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  modalBody: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical:   spacing[6],
    paddingBottom:     spacing[12],
    gap:               spacing[5],
  },
  modalHints: {
    gap:             spacing[3],
    padding:         spacing[4],
    backgroundColor: colors.bg.elevated,
    borderWidth:     1,
    borderColor:     colors.border.default,
  },

  // ── Couple ─────────────────────────────────────────────────────────────
  combinedCard: {
    padding: spacing[5],
    gap:     spacing[4],
  },
  proportionBar: {
    flexDirection:   'row',
    height:          6,
    overflow:        'hidden',
    gap:             2,
  },
  proportionFill: {
    height: 6,
  },
  partnerBreakdown: {
    flexDirection:  'row',
    justifyContent: 'space-between',
  },
  partnerBreakdownItem: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },
  partnerDot: {
    width:  8,
    height: 8,
  },
  coupleAvatar: {
    width:           36,
    height:          36,
    borderWidth:     1,
    alignItems:      'center',
    justifyContent:  'center',
    marginRight:     spacing[3],
  },
  sharedBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       colors.yellow + '60',
    backgroundColor:   colors.yellow + '15',
  },
});
