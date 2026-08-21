import React, { useState, useCallback } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Text, FormSheetModal, FormSheetButton } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';

// ─── Tokens ───────────────────────────────────────────────────────────────────

const C = {
  bg:      '#FAFAF7',   // fondo general
  surface: '#F5F1E9',   // superficies / cards elevadas
  cream:   '#F2E8D5',   // crema secundario
  white:   '#FFFFFF',
  green:   '#27AE60',   // verde principal — CTAs, iconos, énfasis
  accent:  '#D1F7E3',   // acento verde claro — badges, tints
  black:   '#1C1C1C',   // texto principal
  text2:   '#6D6A63',   // texto secundario
  muted:   '#9B9790',   // texto muted
  border:  '#E8E2D9',   // bordes crema
  red:     '#EF4444',
} as const;

const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

// ─── Tipos ────────────────────────────────────────────────────────────────────

type GroupKind  = 'familiar' | 'amigos';
type CreateKind = GroupKind;
type MemberRole = 'Admin' | 'Miembro';

interface Member {
  name:       string;
  initial:    string;
  monthTotal: number;
  isMe:       boolean;
}

interface Group {
  id:           string;
  name:         string;
  kind:         GroupKind;
  myRole:       MemberRole;
  totalMonth:   number;
  myMonthTotal: number;
  hasActivity:  boolean;
  members:      Member[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#27AE60', '#2ECC71', '#1E8449', '#229954', '#58D68D', '#1A7A3D'];

function hashIdx(str: string, len: number): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
  return Math.abs(h) % len;
}

function mapRole(dbRole: string): MemberRole {
  return dbRole === 'parent' || dbRole === 'partner' || dbRole === 'admin' ? 'Admin' : 'Miembro';
}

function mapKind(dbType: string): GroupKind {
  return dbType === 'friends' ? 'amigos' : 'familiar';
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function currentMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function sevenDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split('T')[0];
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchGroups(userId: string): Promise<Group[]> {
  const db = supabase as any;

  const { data: memberships } = await db
    .from('family_members').select('role, group_id').eq('user_id', userId);
  if (!memberships?.length) return [];

  const groupIds: string[] = memberships.map((m: any) => m.group_id);

  const [{ data: groupsRaw }, { data: membersRaw }] = await Promise.all([
    db.from('family_groups').select('id, name, group_type').in('id', groupIds),
    db.from('family_members').select('user_id, role, group_id').in('group_id', groupIds),
  ]);

  const allUserIds: string[] = Array.from(new Set<string>((membersRaw ?? []).map((m: any) => m.user_id as string)));

  const [{ data: profilesRaw }, { data: expensesRaw }] = await Promise.all([
    db.from('profiles').select('id, full_name, email').in('id', allUserIds),
    db.from('expenses').select('user_id, amount, date')
      .in('user_id', allUserIds).gte('date', currentMonthStart()).is('deleted_at', null),
  ]);

  const profileMap: Record<string, { full_name?: string; email?: string }> = {};
  for (const p of profilesRaw ?? []) profileMap[p.id] = p;

  const totals: Record<string, number> = {};
  const lastDate: Record<string, string> = {};
  for (const e of expensesRaw ?? []) {
    totals[e.user_id] = (totals[e.user_id] ?? 0) + Number(e.amount);
    if (!lastDate[e.user_id] || e.date > lastDate[e.user_id]) lastDate[e.user_id] = e.date;
  }

  const recentDate = sevenDaysAgo();

  return (groupsRaw ?? []).map((g: any): Group => {
    const myMembership = memberships.find((m: any) => m.group_id === g.id);
    const groupMembers: any[] = (membersRaw ?? []).filter((m: any) => m.group_id === g.id);

    const members: Member[] = groupMembers.map((m: any) => {
      const p = profileMap[m.user_id];
      const name = p?.full_name || (p?.email ? p.email.split('@')[0] : null) || 'Miembro';
      return {
        name, initial: name.charAt(0).toUpperCase(),
        monthTotal: totals[m.user_id] ?? 0,
        isMe: m.user_id === userId,
      };
    });

    const totalMonth   = members.reduce((s, m) => s + m.monthTotal, 0);
    const myMonthTotal = members.find(m => m.isMe)?.monthTotal ?? 0;
    const hasActivity  = groupMembers.some(m => (lastDate[m.user_id] ?? '') >= recentDate);

    return {
      id: g.id, name: g.name,
      kind:         mapKind(g.group_type),
      myRole:       mapRole(myMembership?.role ?? 'child'),
      totalMonth, myMonthTotal, hasActivity, members,
    };
  });
}

// ─── AvatarStack ──────────────────────────────────────────────────────────────

function AvatarStack({ members }: { members: Member[] }) {
  const visible = members.slice(0, 4);
  const extra   = members.length - 4;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {visible.map((m, i) => (
        <View
          key={i}
          style={[
            av.circle,
            { backgroundColor: AVATAR_COLORS[hashIdx(m.name, AVATAR_COLORS.length)], marginLeft: i === 0 ? 0 : -8 },
            m.isMe && av.isMe,
          ]}
        >
          <Text style={av.initial}>{m.initial}</Text>
        </View>
      ))}
      {extra > 0 && (
        <View style={[av.circle, av.extra, { marginLeft: -8 }]}>
          <Text style={av.extraText}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

const av = StyleSheet.create({
  circle:    { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.white },
  isMe:      { borderColor: C.cream },
  initial:   { fontFamily: 'Montserrat_700Bold', fontSize: 11, color: C.white },
  extra:     { backgroundColor: C.muted },
  extraText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 10, color: C.white },
});

// ─── GroupCard ────────────────────────────────────────────────────────────────

function GroupCard({ group, onPress }: { group: Group; onPress: () => void }) {
  const isFriends = group.kind === 'amigos';

  return (
    <TouchableOpacity style={s.groupCard} onPress={onPress} activeOpacity={0.88}>

      {/* Accent bar izquierda */}
      <View style={s.gcBar} />

      <View style={s.gcInner}>
        {/* Header */}
        <View style={s.gcHeader}>
          <View style={s.gcIconWrap}>
            <Ionicons name={isFriends ? 'people' : 'home-outline'} size={20} color={C.green} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.gcName} numberOfLines={1}>{group.name}</Text>
            <Text style={s.gcMeta}>
              {isFriends ? 'Amigos' : 'Familia'} · {group.myRole}
            </Text>
          </View>
          {group.hasActivity && <View style={s.activityDot} />}
          <Ionicons name="chevron-forward" size={16} color={C.muted} />
        </View>

        {/* Divider */}
        <View style={s.gcDivider} />

        {/* Footer */}
        <View style={s.gcFooter}>
          <AvatarStack members={group.members} />
          <View style={s.gcAmounts}>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.gcAmtLabel}>Grupo este mes</Text>
              <Text style={s.gcAmt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                {formatCurrency(group.totalMonth)}
              </Text>
            </View>
            <View style={s.gcDividerV} />
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.gcAmtLabel}>Mi parte</Text>
              <Text style={[s.gcAmt, { color: C.green }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                {formatCurrency(group.myMonthTotal)}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Modal Crear: tipo selector ───────────────────────────────────────────────

function TypeSelectorStep({ onCreate }: { onCreate: (kind: CreateKind) => void }) {
  return (
    <View style={ts.wrap}>
      <Text style={ts.title}>¿Qué tipo de grupo?</Text>
      <Text style={ts.subtitle}>Elegí cómo querés organizar los gastos</Text>

      <TouchableOpacity style={ts.cardDark} onPress={() => onCreate('familiar')} activeOpacity={0.88}>
        <View style={ts.cardIconDark}>
          <Ionicons name="home-outline" size={28} color={C.white} />
        </View>
        <Text style={ts.cardTitleDark}>Familia</Text>
        <Text style={ts.cardDescDark}>
          El admin ve los gastos de todos. Los miembros solo ven los propios.
        </Text>
        <View style={ts.badgeDark}>
          <Ionicons name="refresh-outline" size={11} color={C.green} />
          <Text style={ts.badgeDarkText}>Gastos automáticos</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={ts.cardMint} onPress={() => onCreate('amigos')} activeOpacity={0.88}>
        <View style={ts.cardIconMint}>
          <Ionicons name="people-outline" size={28} color={C.green} />
        </View>
        <Text style={ts.cardTitleMint}>Amigos</Text>
        <Text style={ts.cardDescMint}>
          Todos ven los gastos compartidos. Vos elegís qué subir al grupo.
        </Text>
        <View style={ts.badgeMint}>
          <Ionicons name="hand-left-outline" size={11} color={C.green} />
          <Text style={ts.badgeMintText}>Gastos manuales</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const ts = StyleSheet.create({
  wrap:     { flex: 1, paddingHorizontal: sp.xl, paddingTop: sp.xxl, gap: sp.lg },
  title:    { fontFamily: 'Montserrat_800ExtraBold', fontSize: 26, color: C.black, letterSpacing: -0.5 },
  subtitle: { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: C.muted, lineHeight: 20, marginTop: -sp.sm },

  cardDark: {
    backgroundColor: C.green, borderRadius: 20, padding: sp.xl, gap: sp.md,
    shadowColor: C.green, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 16, elevation: 6,
  },
  cardIconDark: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start',
  },
  cardTitleDark:  { fontFamily: 'Montserrat_800ExtraBold', fontSize: 22, color: C.white, letterSpacing: -0.3 },
  cardDescDark:   { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: 'rgba(255,255,255,0.78)', lineHeight: 21 },
  badgeDark: {
    flexDirection: 'row', alignItems: 'center', gap: sp.xs,
    backgroundColor: C.cream, borderRadius: 20,
    paddingHorizontal: sp.md, paddingVertical: 5, alignSelf: 'flex-start',
  },
  badgeDarkText: { fontFamily: 'Montserrat_700Bold', fontSize: 11, color: C.green },

  cardMint: {
    backgroundColor: C.surface, borderRadius: 20, padding: sp.xl, gap: sp.md,
    borderWidth: 1.5, borderColor: C.border,
  },
  cardIconMint: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: C.cream,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start',
  },
  cardTitleMint:  { fontFamily: 'Montserrat_800ExtraBold', fontSize: 22, color: C.black, letterSpacing: -0.3 },
  cardDescMint:   { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: C.text2, lineHeight: 21 },
  badgeMint: {
    flexDirection: 'row', alignItems: 'center', gap: sp.xs,
    backgroundColor: C.cream, borderRadius: 20,
    paddingHorizontal: sp.md, paddingVertical: 5, alignSelf: 'flex-start',
  },
  badgeMintText: { fontFamily: 'Montserrat_700Bold', fontSize: 11, color: C.green },
});

// ─── Modal Crear: nombre ──────────────────────────────────────────────────────

function NameInputStep({
  kind, groupName, setGroupName, loading, onCreate, onBack,
}: {
  kind: CreateKind; groupName: string; setGroupName: (v: string) => void;
  loading: boolean; onCreate: () => void; onBack: () => void;
}) {
  const placeholder = kind === 'amigos' ? 'Ej: Viaje a Bariloche' : 'Ej: Familia García';

  return (
    <View style={ni.wrap}>
      <TouchableOpacity onPress={onBack} style={ni.backRow} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="arrow-back" size={18} color={C.muted} />
        <Text style={ni.backText}>Elegir tipo</Text>
      </TouchableOpacity>

      <View style={ni.titleRow}>
        <View style={ni.iconBox}>
          <Ionicons name={kind === 'amigos' ? 'people-outline' : 'home-outline'} size={22} color={C.green} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={ni.title}>{kind === 'amigos' ? 'Grupo de amigos' : 'Grupo familiar'}</Text>
          <Text style={ni.subtitle}>Dale un nombre</Text>
        </View>
      </View>

      <Text style={ni.label}>NOMBRE DEL GRUPO</Text>
      <TextInput
        style={ni.input}
        value={groupName}
        onChangeText={setGroupName}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        autoCapitalize="words"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={onCreate}
      />

      <TouchableOpacity
        style={[ni.btn, (!groupName.trim() || loading) && ni.btnOff]}
        onPress={onCreate}
        disabled={!groupName.trim() || loading}
        activeOpacity={0.85}
      >
        {loading
          ? <ActivityIndicator color={C.white} size="small" />
          : <Text style={ni.btnText}>Crear grupo</Text>}
      </TouchableOpacity>
    </View>
  );
}

const ni = StyleSheet.create({
  wrap:     { flex: 1, paddingHorizontal: sp.xl, paddingTop: sp.xl, gap: sp.lg },
  backRow:  { flexDirection: 'row', alignItems: 'center', gap: sp.sm, alignSelf: 'flex-start' },
  backText: { fontFamily: 'Montserrat_500Medium', fontSize: 14, color: C.muted },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.sm },
  iconBox:  { width: 52, height: 52, borderRadius: 16, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderWidth: 1.5, borderColor: C.cream },
  title:    { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: C.black, letterSpacing: -0.2 },
  subtitle: { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted },
  label:    { fontFamily: 'Montserrat_700Bold', fontSize: 10, color: C.muted, letterSpacing: 0.8 },
  input: {
    fontFamily: 'Montserrat_500Medium', fontSize: 16, color: C.black,
    borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    paddingHorizontal: sp.lg, paddingVertical: sp.md, backgroundColor: C.white,
  },
  btn: {
    backgroundColor: C.green, borderRadius: 14,
    paddingVertical: sp.md + 2, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.green, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  btnOff:  { opacity: 0.45 },
  btnText: { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: C.white },
});

// ─── Pantalla ─────────────────────────────────────────────────────────────────

export default function FamilyScreen() {
  const { user } = useAuthStore();

  const [groups,     setGroups]     = useState<Group[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showJoin,    setShowJoin]    = useState(false);
  const [joinCode,    setJoinCode]    = useState('');
  const [joinError,   setJoinError]   = useState<string | null>(null);
  const [joiningLoad, setJoiningLoad] = useState(false);

  const [showCreate,   setShowCreate]   = useState(false);
  const [createStep,   setCreateStep]   = useState<0 | 1>(0);
  const [createKind,   setCreateKind]   = useState<CreateKind>('familiar');
  const [groupName,    setGroupName]    = useState('');
  const [creatingLoad, setCreatingLoad] = useState(false);

  const loadGroups = useCallback(async () => {
    if (!user?.id) return;
    const data = await fetchGroups(user.id);
    setGroups(data);
    setLoading(false);
    setRefreshing(false);
  }, [user?.id]);

  useFocusEffect(useCallback(() => { loadGroups(); }, [loadGroups]));

  const openCreate = () => {
    setCreateStep(0);
    setGroupName('');
    setShowCreate(true);
  };

  const handleTypeSelected = (kind: CreateKind) => {
    setCreateKind(kind);
    setCreateStep(1);
    setGroupName('');
  };

  const handleJoin = async () => {
    if (joinCode.length < 6 || !user?.id) return;
    setJoiningLoad(true);
    setJoinError(null);
    try {
      const db = supabase as any;
      const { data: rows } = await db.rpc('find_group_by_invite_code', { p_code: joinCode.toUpperCase() });
      const group = rows?.[0] ?? null;
      if (!group) { setJoinError('Código inválido. Verificalo e intentá de nuevo.'); return; }
      const { error } = await db
        .from('family_members').insert({ group_id: group.id, user_id: user.id, role: 'member' });
      if (error?.code === '23505') { setJoinError('Ya sos miembro de ese grupo.'); return; }
      if (error) { setJoinError(`No pudimos unirte al grupo. ${error.message ?? 'Revisá el código.'}`); return; }
      setShowJoin(false);
      setJoinCode('');
      await loadGroups();
      Alert.alert('¡Listo!', `Te uniste a "${group.name}".`);
    } catch (err: any) {
      setJoinError(err?.message ?? 'No pudimos unirte al grupo.');
    } finally {
      setJoiningLoad(false);
    }
  };

  const handleCreate = async () => {
    if (!groupName.trim() || !user?.id) return;
    setCreatingLoad(true);
    try {
      const code   = generateCode();
      const db     = supabase as any;
      const dbType = createKind === 'amigos' ? 'friends' : 'family';
      const { data, error } = await db.rpc('create_group_with_admin', {
        p_name: groupName.trim(), p_group_type: dbType, p_invite_code: code,
      });
      if (error) throw error;
      setShowCreate(false);
      setGroupName('');
      await loadGroups();
      Alert.alert('Grupo creado 🎉', `Tu código de invitación: ${code}\n\nCompartilo para que otros se unan.`);
    } catch {
      Alert.alert('No pudimos crear el grupo', 'Intentá nuevamente.');
    } finally {
      setCreatingLoad(false);
    }
  };

  const hasGroups = groups.length > 0;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>

      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerLabel}>NOMI</Text>
          <Text style={s.headerTitle}>Grupos</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={openCreate} activeOpacity={0.85}>
          <Ionicons name="add" size={22} color={C.white} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadGroups(); }}
            tintColor={C.green}
          />
        }
      >
        {/* Estado vacío */}
        {!loading && !hasGroups && (
          <View style={s.emptyWrap}>
            <View style={s.emptyIconCircle}>
              <Ionicons name="people-outline" size={36} color={C.green} />
            </View>
            <Text style={s.emptyTitle}>Sin grupos todavía</Text>
            <Text style={s.emptySub}>
              Organizá gastos compartidos con tu familia o amigos. Cada uno registra los propios y todos ven el resumen.
            </Text>
            <TouchableOpacity style={s.emptyBtnPrimary} onPress={openCreate} activeOpacity={0.85}>
              <Ionicons name="add" size={18} color={C.white} />
              <Text style={s.emptyBtnPrimaryText}>Crear grupo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.emptyBtnSecondary}
              onPress={() => { setJoinCode(''); setJoinError(null); setShowJoin(true); }}
              activeOpacity={0.8}
            >
              <Ionicons name="enter-outline" size={18} color={C.green} />
              <Text style={s.emptyBtnSecondaryText}>Unirme con código</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Loading */}
        {loading && (
          <ActivityIndicator color={C.green} style={{ marginVertical: 40 }} />
        )}

        {/* Lista de grupos */}
        {hasGroups && (
          <>
            <Text style={s.sectionLabel}>MIS GRUPOS</Text>
            {groups.map(g => (
              <GroupCard
                key={g.id}
                group={g}
                onPress={() => router.push({ pathname: '/(app)/group-detail', params: { id: g.id } } as any)}
              />
            ))}

            {/* Acciones secundarias */}
            <View style={s.actionsRow}>
              <TouchableOpacity
                style={s.actionBtn}
                onPress={() => { setJoinCode(''); setJoinError(null); setShowJoin(true); }}
                activeOpacity={0.8}
              >
                <Ionicons name="enter-outline" size={16} color={C.green} />
                <Text style={s.actionBtnText}>Unirme con código</Text>
              </TouchableOpacity>

              <View style={s.actionDividerV} />

              <TouchableOpacity style={s.actionBtn} onPress={openCreate} activeOpacity={0.8}>
                <Ionicons name="add-circle-outline" size={16} color={C.green} />
                <Text style={s.actionBtnText}>Nuevo grupo</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>

      {/* MODAL: Unirme ──────────────────────────────────────────────────────── */}
      <FormSheetModal
        visible={showJoin}
        title="Unirme a un grupo"
        onClose={() => setShowJoin(false)}
        presentationStyle="formSheet"
      >
        <Text style={s.modalSub}>
          Ingresá el código de 6 caracteres que te compartió el admin del grupo.
        </Text>

        <View style={s.codeBoxRow}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View
              key={i}
              style={[
                s.codeBox,
                joinCode.length > i && { borderColor: C.green, backgroundColor: C.accent },
              ]}
            >
              <Text style={s.codeChar}>{joinCode[i] ?? ''}</Text>
            </View>
          ))}
        </View>

        <TextInput
          style={s.hiddenInput}
          value={joinCode}
          onChangeText={t => {
            setJoinError(null);
            setJoinCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          maxLength={6}
        />

        {joinError && (
          <View style={s.errorBox}>
            <Ionicons name="alert-circle-outline" size={14} color={C.red} />
            <Text style={s.errorText}>{joinError}</Text>
          </View>
        )}

        <FormSheetButton
          label="Confirmar"
          color={C.green}
          loading={joiningLoad}
          disabled={joinCode.length < 6}
          onPress={handleJoin}
        />
      </FormSheetModal>

      {/* MODAL: Crear ───────────────────────────────────────────────────────── */}
      <FormSheetModal
        visible={showCreate}
        title={createStep === 0 ? '' : 'Nombre del grupo'}
        onClose={() => setShowCreate(false)}
        presentationStyle="pageSheet"
        scrollable={false}
      >
        {createStep === 0 ? (
          <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
            <TypeSelectorStep onCreate={handleTypeSelected} />
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
            <NameInputStep
              kind={createKind}
              groupName={groupName}
              setGroupName={setGroupName}
              loading={creatingLoad}
              onCreate={handleCreate}
              onBack={() => setCreateStep(0)}
            />
          </ScrollView>
        )}
      </FormSheetModal>

    </SafeAreaView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: sp.xl, paddingTop: sp.lg, paddingBottom: sp.lg,
  },
  headerLabel: { fontFamily: 'Montserrat_700Bold', fontSize: 10, color: C.green, letterSpacing: 1.5 },
  headerTitle: { fontFamily: 'Montserrat_800ExtraBold', fontSize: 32, color: C.black, letterSpacing: -0.5, lineHeight: 38 },
  addBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: C.green,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.green, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 8, elevation: 4,
  },

  scroll: { paddingHorizontal: sp.xl, paddingBottom: 120, paddingTop: sp.sm, gap: sp.md, flexGrow: 1 },

  // Sección
  sectionLabel: { fontFamily: 'Montserrat_700Bold', fontSize: 10, color: C.muted, letterSpacing: 1.2, marginBottom: sp.xs },

  // Group Card
  groupCard: {
    backgroundColor: C.surface, borderRadius: 20, overflow: 'hidden',
    flexDirection: 'row',
    shadowColor: '#27AE60', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },
  gcBar:    { width: 4, backgroundColor: C.green },
  gcInner:  { flex: 1, padding: sp.lg, gap: sp.md },
  gcHeader: { flexDirection: 'row', alignItems: 'center', gap: sp.md },
  gcIconWrap: {
    width: 44, height: 44, borderRadius: 13,
    backgroundColor: C.cream, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border, flexShrink: 0,
  },
  gcName:    { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: C.black, letterSpacing: -0.2 },
  gcMeta:    { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted },
  gcDivider: { height: 1, backgroundColor: C.border },
  gcFooter:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gcAmounts: { flexDirection: 'row', alignItems: 'center', gap: sp.md },
  gcDividerV:{ width: 1, height: 32, backgroundColor: C.border },
  gcAmtLabel:{ fontFamily: 'Montserrat_400Regular', fontSize: 10, color: C.muted },
  gcAmt:     { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: C.black, letterSpacing: -0.3, marginTop: 1 },
  activityDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.green },

  // Acciones secundarias (cuando hay grupos)
  actionsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
    overflow: 'hidden', marginTop: sp.sm,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: sp.sm, paddingVertical: sp.lg,
  },
  actionBtnText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: C.green },
  actionDividerV: { width: 1, height: 36, backgroundColor: C.border },

  // Estado vacío
  emptyWrap: { flex: 1, alignItems: 'center', paddingTop: 48, gap: sp.lg },
  emptyIconCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: C.cream, borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: sp.sm,
  },
  emptyTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 20, color: C.black, letterSpacing: -0.3 },
  emptySub:   {
    fontFamily: 'Montserrat_400Regular', fontSize: 14, color: C.muted,
    lineHeight: 22, textAlign: 'center', paddingHorizontal: sp.xl, marginTop: -sp.sm,
  },
  emptyBtnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: sp.sm,
    backgroundColor: C.green, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: sp.xxl,
    shadowColor: C.green, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  emptyBtnPrimaryText: { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: C.white },
  emptyBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: sp.sm,
    borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    paddingVertical: 13, paddingHorizontal: sp.xxl,
    backgroundColor: C.surface,
  },
  emptyBtnSecondaryText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 15, color: C.green },

  // Modal join
  modalSub: { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: C.text2, lineHeight: 20, marginBottom: sp.sm },
  codeBoxRow: { flexDirection: 'row', gap: sp.sm, justifyContent: 'center', marginVertical: sp.md },
  codeBox: {
    width: 46, height: 56, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  codeChar:    { fontFamily: 'Montserrat_700Bold', fontSize: 22, color: C.black },
  hiddenInput: { position: 'absolute', opacity: 0, height: 0, width: 0 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: sp.sm,
    backgroundColor: '#ef44441a', borderRadius: 10,
    paddingHorizontal: sp.md, paddingVertical: sp.sm,
    borderWidth: 1, borderColor: '#ef444430',
  },
  errorText: { fontFamily: 'Montserrat_500Medium', fontSize: 13, color: C.red, flex: 1 },
});
