import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Share,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Card } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'parent' | 'child' | 'partner';

interface GroupInfo {
  id:          string;
  name:        string;
  invite_code: string;
  group_type:  'family' | 'couple';
}

interface Member {
  id:            string;
  user_id:       string;
  role:          Role;
  full_name:     string;
  monthly_total: number;
  joined_at:     string;
}

function currentMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: Role }) {
  const config: Record<Role, { label: string; color: string }> = {
    parent:  { label: 'Admin', color: colors.neon },
    partner: { label: 'Pareja', color: colors.primary },
    child:   { label: 'Hijo/a', color: colors.yellow },
  };
  const c = config[role];
  return (
    <View style={[badgeStyles.root, { backgroundColor: c.color + '22', borderColor: c.color + '55' }]}>
      <Text style={[badgeStyles.text, { color: c.color }]}>{c.label}</Text>
    </View>
  );
}
const badgeStyles = StyleSheet.create({
  root: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  text: { fontSize: 9, fontFamily: 'Montserrat_700Bold' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function GrupoFamiliaScreen() {
  const { user } = useAuthStore();

  const [group,     setGroup]     = useState<GroupInfo | null>(null);
  const [members,   setMembers]   = useState<Member[]>([]);
  const [myRole,    setMyRole]    = useState<Role | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);

  const isAdmin = myRole === 'parent' || myRole === 'partner';

  // ── Carga ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!user?.id) return;

    const { data: myMembership } = await (supabase as any)
      .from('family_members')
      .select('group_id, role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!myMembership) { setLoading(false); return; }

    setMyRole(myMembership.role as Role);

    const [groupRes, membersRes] = await Promise.all([
      (supabase as any)
        .from('family_groups')
        .select('id, name, invite_code, group_type')
        .eq('id', myMembership.group_id)
        .single(),
      (supabase as any)
        .from('family_members')
        .select('id, user_id, role, joined_at, profiles:user_id(full_name)')
        .eq('group_id', myMembership.group_id),
    ]);

    if (groupRes.data) setGroup(groupRes.data as GroupInfo);

    if (membersRes.data) {
      const monthStart = currentMonthStart();
      const memberList: Member[] = await Promise.all(
        membersRes.data.map(async (m: any) => {
          const { data: expData } = await (supabase as any)
            .from('expenses')
            .select('amount')
            .eq('user_id', m.user_id)
            .gte('date', monthStart)
            .is('deleted_at', null);

          const monthly_total = (expData ?? []).reduce((s: number, e: any) => s + e.amount, 0);

          return {
            id:            m.id,
            user_id:       m.user_id,
            role:          m.role as Role,
            full_name:     m.profiles?.full_name ?? 'Usuario',
            monthly_total,
            joined_at:     m.joined_at,
          };
        }),
      );
      setMembers(memberList);
    }

    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // ── Acciones ──────────────────────────────────────────────────────────────

  const shareInvite = async () => {
    if (!group) return;
    await Share.share({
      message: `Unite a mi grupo "${group.name}" en PesoSSmart con el código: ${group.invite_code}\n\nDescargá la app en pesossmart.com.ar`,
    });
  };

  const removeMember = (member: Member) => {
    if (!isAdmin) return;
    if (member.user_id === user?.id) return;

    Alert.alert(
      'Eliminar miembro',
      `¿Querés eliminar a ${member.full_name} del grupo?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            await (supabase as any)
              .from('family_members')
              .delete()
              .eq('id', member.id);
            setMembers(prev => prev.filter(m => m.id !== member.id));
          },
        },
      ],
    );
  };

  const dissolveGroup = () => {
    if (!isAdmin || !group) return;
    Alert.alert(
      'Disolver grupo',
      'Esta acción eliminará el grupo para todos los miembros. No se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Disolver',
          style: 'destructive',
          onPress: async () => {
            await (supabase as any).from('family_groups').delete().eq('id', group.id);
            router.replace('/(app)/family');
          },
        },
      ],
    );
  };

  const leaveGroup = () => {
    Alert.alert(
      'Salir del grupo',
      '¿Querés salir del grupo familiar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir',
          style: 'destructive',
          onPress: async () => {
            await (supabase as any)
              .from('family_members')
              .delete()
              .eq('user_id', user?.id);
            router.replace('/(app)/family');
          },
        },
      ],
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
          </TouchableOpacity>
          <Text variant="h4">Gestionar grupo</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
          </TouchableOpacity>
          <Text variant="h4">Gestionar grupo</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.centered}>
          <Ionicons name="people-outline" size={48} color={colors.border.default} />
          <Text variant="body" color={colors.text.secondary} align="center">
            No pertenecés a ningún grupo.
          </Text>
          <TouchableOpacity
            style={styles.backToFamilyBtn}
            onPress={() => router.replace('/(app)/family')}
          >
            <Text variant="label" color={colors.primary}>Crear o unirme a un grupo</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const groupTotal     = members.reduce((s, m) => s + m.monthly_total, 0);
  const membersSorted  = [...members].sort((a, b) => b.monthly_total - a.monthly_total);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <Text variant="h4">Gestionar grupo</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >

        {/* ── Info del grupo ─────────────────────────────────────────────── */}
        <Card style={styles.groupCard}>
          <View style={styles.groupHeader}>
            <View style={styles.groupAvatar}>
              <Text style={{ fontSize: 24 }}>
                {group.group_type === 'couple' ? '💑' : '👨‍👩‍👧‍👦'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="subtitle">{group.name}</Text>
              <Text variant="caption" color={colors.text.tertiary}>
                {group.group_type === 'couple' ? 'Modo pareja' : 'Modo familia'} · {members.length} miembro{members.length !== 1 ? 's' : ''}
              </Text>
            </View>
          </View>

          {/* Código de invitación */}
          <View style={styles.inviteSection}>
            <Text variant="caption" color={colors.text.secondary}>CÓDIGO DE INVITACIÓN</Text>
            <View style={styles.inviteRow}>
              <Text style={styles.inviteCode}>{group.invite_code}</Text>
              <TouchableOpacity style={styles.shareBtn} onPress={shareInvite}>
                <Ionicons name="share-outline" size={18} color={colors.primary} />
                <Text variant="caption" color={colors.primary}>Compartir</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Card>

        {/* ── Gastos del mes ────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text variant="label" color={colors.text.secondary}>GASTOS DEL MES</Text>
          <Text variant="label" color={colors.neon}>{formatCurrency(groupTotal)}</Text>
        </View>

        <Card style={styles.membersCard}>
          {membersSorted.map((member, idx) => {
            const pct     = groupTotal > 0 ? (member.monthly_total / groupTotal) * 100 : 0;
            const isMe    = member.user_id === user?.id;
            const canKick = isAdmin && !isMe;

            return (
              <View
                key={member.id}
                style={[styles.memberRow, idx < membersSorted.length - 1 && styles.memberRowBorder]}
              >
                {/* Avatar */}
                <View style={[styles.memberAvatar, { backgroundColor: colors.primary + '22' }]}>
                  <Text style={{ fontSize: 16 }}>
                    {member.role === 'parent' ? '👤' : member.role === 'partner' ? '👤' : '🧒'}
                  </Text>
                </View>

                {/* Info */}
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.memberNameRow}>
                    <Text variant="bodySmall" style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                      {member.full_name}{isMe ? ' (vos)' : ''}
                    </Text>
                    <RoleBadge role={member.role} />
                  </View>

                  {/* Barra de progreso */}
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, {
                      width:           `${pct}%`,
                      backgroundColor: member.role === 'child' ? colors.yellow : colors.primary,
                    }]} />
                  </View>

                  <View style={styles.memberAmountRow}>
                    <Text variant="caption" color={colors.text.tertiary}>
                      {pct.toFixed(0)}% del total
                    </Text>
                    <Text variant="caption" color={colors.text.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                      {formatCurrency(member.monthly_total)}
                    </Text>
                  </View>
                </View>

                {/* Acción de eliminar (solo admin, no a sí mismo) */}
                {canKick && (
                  <TouchableOpacity
                    onPress={() => removeMember(member)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ paddingLeft: spacing[2] }}
                  >
                    <Ionicons name="person-remove-outline" size={18} color={colors.text.tertiary} />
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </Card>

        {/* ── Acciones del grupo ────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text variant="label" color={colors.text.secondary}>ACCIONES</Text>
        </View>

        <Card style={styles.actionsCard}>

          {/* Compartir invitación */}
          <TouchableOpacity style={styles.actionRow} onPress={shareInvite}>
            <Ionicons name="person-add-outline" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text variant="bodySmall" style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                Invitar a alguien
              </Text>
              <Text variant="caption" color={colors.text.tertiary}>
                Compartir código {group.invite_code}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.text.tertiary} />
          </TouchableOpacity>

          <View style={styles.actionDivider} />

          {/* Ver gastos del grupo completo (navegar a family) */}
          <TouchableOpacity style={styles.actionRow} onPress={() => router.push('/(app)/family')}>
            <Ionicons name="bar-chart-outline" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text variant="bodySmall" style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                Ver panel completo
              </Text>
              <Text variant="caption" color={colors.text.tertiary}>
                Gastos detallados por miembro
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.text.tertiary} />
          </TouchableOpacity>

          <View style={styles.actionDivider} />

          {/* Salir / Disolver */}
          {isAdmin ? (
            <TouchableOpacity style={styles.actionRow} onPress={dissolveGroup}>
              <Ionicons name="trash-outline" size={20} color={colors.red} />
              <View style={{ flex: 1 }}>
                <Text variant="bodySmall" color={colors.red} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                  Disolver grupo
                </Text>
                <Text variant="caption" color={colors.text.tertiary}>
                  Elimina el grupo para todos los miembros
                </Text>
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.actionRow} onPress={leaveGroup}>
              <Ionicons name="exit-outline" size={20} color={colors.red} />
              <View style={{ flex: 1 }}>
                <Text variant="bodySmall" color={colors.red} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                  Salir del grupo
                </Text>
                <Text variant="caption" color={colors.text.tertiary}>
                  No podrás ver los gastos compartidos
                </Text>
              </View>
            </TouchableOpacity>
          )}
        </Card>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding, paddingVertical: spacing[4],
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: spacing[4], paddingHorizontal: layout.screenPadding,
  },
  scroll: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[5], paddingBottom: spacing[12],
    gap: spacing[4],
  },

  // Grupo card
  groupCard:   { padding: spacing[5], gap: spacing[4] },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  groupAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.bg.elevated,
    alignItems: 'center', justifyContent: 'center',
  },
  inviteSection: { gap: spacing[2] },
  inviteRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg.elevated,
    borderRadius: 8, padding: spacing[3],
  },
  inviteCode: {
    fontFamily: 'Montserrat_700Bold', fontSize: 22,
    color: colors.text.primary, letterSpacing: 4,
  },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },

  // Sección
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },

  // Members card
  membersCard: { padding: 0, overflow: 'hidden' },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    paddingHorizontal: spacing[4], paddingVertical: spacing[4],
  },
  memberRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  memberAvatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  memberNameRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  memberAmountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barTrack: { height: 4, backgroundColor: colors.border.subtle, borderRadius: 2, overflow: 'hidden' },
  barFill:  { height: '100%', borderRadius: 2 },

  // Actions
  actionsCard:  { padding: 0, overflow: 'hidden' },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    paddingHorizontal: spacing[4], paddingVertical: spacing[4],
  },
  actionDivider: { height: 1, backgroundColor: colors.border.subtle },

  // Back to family btn
  backToFamilyBtn: {
    paddingVertical: spacing[3], paddingHorizontal: spacing[5],
    borderWidth: 1, borderColor: colors.primary, borderRadius: 8,
  },
});
