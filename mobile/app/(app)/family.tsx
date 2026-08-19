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
  bg:       '#F6F7F9',
  white:    '#FFFFFF',
  purple:   '#7B61FF',
  purpleLt: '#F5F0FF',
  green:    '#2E7D32',
  greenLt:  '#EEF7EF',
  text:     '#212121',
  text2:    '#757575',
  muted:    '#9E9E9E',
  border:   '#E0E0E0',
  red:      '#EF4444',
} as const;

const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

// ─── Tipos ────────────────────────────────────────────────────────────────────

type GroupKind  = 'familiar' | 'amigos';
type CreateKind = GroupKind;
type MemberRole = 'Admin' | 'Miembro';

interface Member {
  name:       string;
  initial:    string;
  color:      string;
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
  color:        string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GROUP_COLORS  = ['#7C3AED', '#F59E0B', '#3B82F6', '#10B981', '#EF4444', '#EC4899'];
const AVATAR_COLORS = ['#4361ee', '#e63946', '#2d6a4f', '#f4a261', '#7209b7', '#3a86ff'];

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
        color: AVATAR_COLORS[hashIdx(m.user_id, AVATAR_COLORS.length)],
        monthTotal: totals[m.user_id] ?? 0,
        isMe: m.user_id === userId,
      };
    });

    const totalMonth    = members.reduce((s, m) => s + m.monthTotal, 0);
    const myMonthTotal  = members.find(m => m.isMe)?.monthTotal ?? 0;
    const hasActivity   = groupMembers.some(m => (lastDate[m.user_id] ?? '') >= recentDate);

    return {
      id: g.id, name: g.name,
      kind:         mapKind(g.group_type),
      myRole:       mapRole(myMembership?.role ?? 'child'),
      totalMonth, myMonthTotal, hasActivity, members,
      color: GROUP_COLORS[hashIdx(g.id, GROUP_COLORS.length)],
    };
  });
}

// ─── GroupCard ────────────────────────────────────────────────────────────────

function GroupCard({ group, onPress }: { group: Group; onPress: () => void }) {
  const isFriends = group.kind === 'amigos';
  const accentColor = isFriends ? C.purple : C.green;
  const bgColor     = isFriends ? C.purpleLt : C.greenLt;

  return (
    <TouchableOpacity style={s.groupCard} onPress={onPress} activeOpacity={0.88}>
      <View style={s.gcHeader}>
        <View style={[s.gcIcon, { backgroundColor: bgColor }]}>
          <Ionicons name={isFriends ? 'people' : 'home'} size={22} color={accentColor} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.gcName} numberOfLines={1}>{group.name}</Text>
          <Text style={s.gcMeta}>
            {group.members.length} miembro{group.members.length !== 1 ? 's' : ''} · {isFriends ? 'Grupo de amigos' : 'Grupo familiar'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.muted} />
      </View>

      <View style={s.gcDivider} />

      <View style={s.gcFooter}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={s.gcAmtLabel}>Total del mes</Text>
          <Text style={[s.gcAmt, { color: accentColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatCurrency(group.totalMonth)}</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={s.gcAmtLabel}>Mi parte</Text>
          <Text style={s.gcAmt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatCurrency(group.myMonthTotal)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Modal Crear: tipo selector (paso 0) ─────────────────────────────────────

function TypeSelectorStep({
  onCreate,
}: {
  onCreate: (kind: CreateKind) => void;
}) {
  return (
    <View style={ts.wrap}>
      <Text style={ts.title}>Crear grupo</Text>
      <Text style={ts.subtitle}>Elegí el tipo de grupo que querés crear</Text>

      {/* Card Familia */}
      <TouchableOpacity style={[ts.card, { backgroundColor: C.greenLt }]} onPress={() => onCreate('familiar')} activeOpacity={0.88}>
        <View style={[ts.cardIcon, { backgroundColor: '#ffffff80' }]}>
          <Ionicons name="home" size={32} color={C.green} />
        </View>
        <Text style={[ts.cardTitle, { color: C.green }]}>Familia</Text>
        <Text style={ts.cardDesc}>
          El admin puede ver los gastos de los miembros. Los miembros ven solo su información.
        </Text>
        <View style={[ts.badge, { backgroundColor: C.green + '18' }]}>
          <Ionicons name="refresh-outline" size={12} color={C.green} />
          <Text style={[ts.badgeText, { color: C.green }]}>Gastos automáticos</Text>
        </View>
      </TouchableOpacity>

      {/* Card Amigos */}
      <TouchableOpacity style={[ts.card, { backgroundColor: C.purpleLt }]} onPress={() => onCreate('amigos')} activeOpacity={0.88}>
        <View style={[ts.cardIcon, { backgroundColor: '#ffffff80' }]}>
          <Ionicons name="people" size={32} color={C.purple} />
        </View>
        <Text style={[ts.cardTitle, { color: C.purple }]}>Amigos</Text>
        <Text style={ts.cardDesc}>
          Todos son miembros. Solo se suben los gastos que vos elegís compartir.
        </Text>
        <View style={[ts.badge, { backgroundColor: C.purple + '18' }]}>
          <Ionicons name="hand-left-outline" size={12} color={C.purple} />
          <Text style={[ts.badgeText, { color: C.purple }]}>Gastos manuales</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const ts = StyleSheet.create({
  wrap:      { flex: 1, paddingHorizontal: sp.xl, paddingTop: sp.xxl, gap: sp.xl },
  title:     { fontFamily: 'Montserrat_800ExtraBold', fontSize: 28, color: C.text, letterSpacing: -0.5 },
  subtitle:  { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: C.muted, lineHeight: 20, marginTop: -sp.sm },
  card: {
    borderRadius: 22, padding: sp.xl, gap: sp.md,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
  },
  cardIcon: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  cardTitle: { fontFamily: 'Montserrat_800ExtraBold', fontSize: 22, letterSpacing: -0.3 },
  cardDesc:  { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: C.text2, lineHeight: 21 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: sp.xs,
    borderRadius: 20, paddingHorizontal: sp.md, paddingVertical: sp.xs,
    alignSelf: 'flex-start',
  },
  badgeText: { fontFamily: 'Montserrat_700Bold', fontSize: 12 },
});

// ─── Modal Crear: nombre (paso 1) ─────────────────────────────────────────────

function NameInputStep({
  kind,
  groupName,
  setGroupName,
  loading,
  onCreate,
  onBack,
}: {
  kind:         CreateKind;
  groupName:    string;
  setGroupName: (v: string) => void;
  loading:      boolean;
  onCreate:     () => void;
  onBack:       () => void;
}) {
  const accentColor = kind === 'amigos' ? C.purple : C.green;
  const placeholder = kind === 'amigos' ? 'Ej: Viaje a Bariloche' : 'Ej: Familia García';

  return (
    <View style={ni.wrap}>
      <TouchableOpacity onPress={onBack} style={ni.backRow} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="arrow-back" size={18} color={C.text2} />
        <Text style={ni.backText}>Elegir tipo</Text>
      </TouchableOpacity>

      <View style={ni.titleRow}>
        <View style={[ni.iconBox, { backgroundColor: kind === 'amigos' ? C.purpleLt : C.greenLt }]}>
          <Ionicons name={kind === 'amigos' ? 'people' : 'home'} size={24} color={accentColor} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={ni.title}>{kind === 'amigos' ? 'Grupo de amigos' : 'Grupo familiar'}</Text>
          <Text style={ni.subtitle}>Dale un nombre a tu grupo</Text>
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
        style={[ni.btn, { backgroundColor: accentColor }, (!groupName.trim() || loading) && ni.btnOff]}
        onPress={onCreate}
        disabled={!groupName.trim() || loading}
        activeOpacity={0.85}
      >
        {loading
          ? <ActivityIndicator color={C.white} size="small" />
          : <Text style={ni.btnText}>Crear grupo</Text>
        }
      </TouchableOpacity>
    </View>
  );
}

const ni = StyleSheet.create({
  wrap:     { flex: 1, paddingHorizontal: sp.xl, paddingTop: sp.xl, gap: sp.lg },
  backRow:  { flexDirection: 'row', alignItems: 'center', gap: sp.sm, alignSelf: 'flex-start' },
  backText: { fontFamily: 'Montserrat_500Medium', fontSize: 14, color: C.text2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.sm },
  iconBox:  { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title:    { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: C.text, letterSpacing: -0.2 },
  subtitle: { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted },
  label:    { fontFamily: 'Montserrat_700Bold', fontSize: 10, color: C.muted, letterSpacing: 0.8 },
  input: {
    fontFamily: 'Montserrat_500Medium', fontSize: 16, color: C.text,
    borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    paddingHorizontal: sp.lg, paddingVertical: sp.md, backgroundColor: C.bg,
  },
  btn: {
    borderRadius: 14, paddingVertical: sp.md + 2,
    alignItems: 'center', justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
    shadowColor: C.purple,
  },
  btnOff:  { opacity: 0.4 },
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
      if (error) {
        setJoinError(`No pudimos unirte al grupo. ${error.message ?? 'Revisá el código.'}`);
        return;
      }
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
        p_name:        groupName.trim(),
        p_group_type:  dbType,
        p_invite_code: code,
      });

      if (error) {
        console.error('[handleCreate] rpc error', {
          code: error.code, message: error.message,
          details: error.details, hint: error.hint,
          p_name: groupName.trim(), p_group_type: dbType, userId: user.id,
        });
        throw error;
      }

      setShowCreate(false);
      setGroupName('');
      await loadGroups();
      Alert.alert('Grupo creado 🎉', `Tu código de invitación: ${code}\n\nCompartilo para que otros se unan.`);
    } catch (err: any) {
      Alert.alert('No pudimos crear el grupo', 'Intentá nuevamente.');
    } finally {
      setCreatingLoad(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>

      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Grupos</Text>
        <TouchableOpacity style={s.addBtn} onPress={openCreate} activeOpacity={0.85}>
          <Ionicons name="add" size={24} color={C.white} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadGroups(); }}
            tintColor={C.purple}
          />
        }
      >
        {/* Promo card */}
        {groups.length === 0 && !loading && (
          <View style={s.promoCard}>
            <View style={s.promoIconWrap}>
              <Ionicons name="people" size={28} color={C.green} />
            </View>
            <Text style={s.promoTitle}>Organizá tus gastos en grupo</Text>
            <Text style={s.promoSub}>
              Creá un grupo para compartir gastos, ver resúmenes y mantener todo claro.
            </Text>
            <TouchableOpacity style={s.promoBtn} onPress={openCreate} activeOpacity={0.85}>
              <Text style={s.promoBtnText}>Crear grupo</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Mis grupos */}
        {(loading || groups.length > 0) && (
          <Text style={s.sectionLabel}>Mis grupos</Text>
        )}

        {loading ? (
          <ActivityIndicator color={C.purple} style={{ marginVertical: 20 }} />
        ) : (
          groups.map(g => (
            <GroupCard
              key={g.id}
              group={g}
              onPress={() =>
                router.push({ pathname: '/(app)/group-detail', params: { id: g.id } } as any)
              }
            />
          ))
        )}

        {/* Botones secundarios */}
        <TouchableOpacity
          style={s.joinDashed}
          onPress={() => { setJoinCode(''); setJoinError(null); setShowJoin(true); }}
          activeOpacity={0.8}
        >
          <Ionicons name="enter-outline" size={18} color={C.purple} />
          <Text style={s.joinDashedText}>Unirme con código</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.createDashed} onPress={openCreate} activeOpacity={0.8}>
          <Ionicons name="add" size={20} color={C.muted} />
          <Text style={s.createDashedText}>Crear nuevo grupo</Text>
        </TouchableOpacity>

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
                joinCode.length > i && { borderColor: C.purple, backgroundColor: C.purpleLt },
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
          color={C.purple}
          loading={joiningLoad}
          disabled={joinCode.length < 6}
          onPress={handleJoin}
        />
      </FormSheetModal>

      {/* MODAL: Crear ───────────────────────────────────────────────────────── */}
      <FormSheetModal
        visible={showCreate}
        title={createStep === 0 ? 'Elegir tipo' : 'Nombre del grupo'}
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

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: sp.xl, paddingTop: sp.xl, paddingBottom: sp.lg,
  },
  headerTitle: { fontFamily: 'Montserrat_800ExtraBold', fontSize: 34, color: C.text, letterSpacing: -0.5, lineHeight: 42 },
  addBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: C.green,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.green, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },

  scroll: { paddingHorizontal: sp.xl, paddingBottom: 130, paddingTop: sp.sm, gap: sp.lg, flexGrow: 1 },

  promoCard: { backgroundColor: C.greenLt, borderRadius: 20, padding: sp.xl, gap: sp.md },
  promoIconWrap: {
    width: 56, height: 56, borderRadius: 20, backgroundColor: '#ffffff70',
    alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start',
  },
  promoTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 17, color: C.text },
  promoSub:   { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.text2, lineHeight: 20 },
  promoBtn: {
    backgroundColor: C.green, borderRadius: 999,
    paddingVertical: 14, paddingHorizontal: sp.xxl,
    alignItems: 'center', alignSelf: 'flex-start',
  },
  promoBtnText: { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.white },

  sectionLabel: { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: C.text, marginTop: sp.sm },

  // Group card
  groupCard: {
    backgroundColor: C.white, borderRadius: 20, padding: sp.xl, gap: sp.md,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  gcHeader: { flexDirection: 'row', alignItems: 'center', gap: sp.md },
  gcIcon:   { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  gcName:   { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: C.text, letterSpacing: -0.2 },
  gcMeta:   { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted },
  gcDivider:{ height: 1, backgroundColor: C.border },
  gcFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  gcAmtLabel:{ fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted },
  gcAmt:     { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: C.text, letterSpacing: -0.4, marginTop: 2 },

  // Dashed
  joinDashed: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm,
    borderRadius: 18, borderWidth: 1.5, borderColor: C.purple + '60', borderStyle: 'dashed',
    padding: sp.lg, backgroundColor: C.purpleLt + '80',
  },
  joinDashedText: { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: C.purple },
  createDashed: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm,
    borderRadius: 18, borderWidth: 1.5, borderColor: C.border, borderStyle: 'dashed',
    padding: sp.lg, backgroundColor: C.white,
  },
  createDashedText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 15, color: C.muted },

  // Modal
  modalSub:   { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: C.text2, lineHeight: 20 },

  codeBoxRow: { flexDirection: 'row', gap: sp.sm, justifyContent: 'center' },
  codeBox: {
    width: 46, height: 56, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  codeChar:    { fontFamily: 'Montserrat_700Bold', fontSize: 22, color: C.text },
  hiddenInput: { position: 'absolute', opacity: 0, height: 0, width: 0 },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: sp.sm,
    backgroundColor: '#ef44441a', borderRadius: 10,
    paddingHorizontal: sp.md, paddingVertical: sp.sm,
    borderWidth: 1, borderColor: '#ef444430',
  },
  errorText: { fontFamily: 'Montserrat_500Medium', fontSize: 13, color: C.red, flex: 1 },
});
