import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Clipboard,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { useFamilyGroupStore } from '@/store/familyGroupStore';
import { colors, spacing, layout } from '@/theme';
import { Text, Card, Button } from '@/components/ui';
import { formatCurrency } from '@/utils/format';
import type {
  GroupType,
  MemberRole,
  FamilyMember,
  GroupTransfer,
} from '@/types/database';
import {
  MEMBER_ROLE_LABELS,
  MEMBER_ROLE_ICONS,
  ADULT_ROLES,
  MINOR_ROLES,
} from '@/types/database';

// ── Tipos locales ─────────────────────────────────────────────────────────────

type ActiveTab = 'resumen' | 'miembros' | 'movimientos' | 'config';

// ── Helpers visuales ──────────────────────────────────────────────────────────

function getRoleColor(role: MemberRole): string {
  if (ADULT_ROLES.includes(role)) return colors.accent;
  if (MINOR_ROLES.includes(role)) return colors.primary;
  return colors.text.secondary;
}

function getMemberInitials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function formatTransferDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ══════════════════════════════════════════════════════════════════════════════
//  COMPONENTES INTERNOS
// ══════════════════════════════════════════════════════════════════════════════

// ── Avatar de miembro ─────────────────────────────────────────────────────────
function MemberAvatar({ name, role, size = 44 }: { name: string | null; role: MemberRole; size?: number }) {
  const color = getRoleColor(role);
  const bgColor = color + '22';
  return (
    <View style={[styles.memberAvatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: bgColor }]}>
      <Text style={{ fontSize: size * 0.38, fontFamily: 'Montserrat_700Bold', color }}>
        {getMemberInitials(name)}
      </Text>
    </View>
  );
}

// ── Badge de rol ──────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: MemberRole }) {
  const color = getRoleColor(role);
  return (
    <View style={[styles.roleBadge, { backgroundColor: color + '18', borderColor: color + '40' }]}>
      <Text style={[styles.roleBadgeText, { color }]}>{MEMBER_ROLE_LABELS[role]}</Text>
    </View>
  );
}

// ── Fila de miembro ───────────────────────────────────────────────────────────
function MemberRow({
  member,
  isMe,
  isOwner,
  showTotal,
}: {
  member: FamilyMember & { monthlyTotal?: number };
  isMe: boolean;
  isOwner: boolean;
  showTotal: boolean;
}) {
  const name = member.profile?.full_name ?? member.profile?.email ?? 'Miembro';
  return (
    <View style={styles.memberRow}>
      <MemberAvatar name={name} role={member.role} />
      <View style={styles.memberRowInfo}>
        <View style={styles.memberRowTop}>
          <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
            {name}{isMe ? ' (vos)' : ''}
          </Text>
          {isOwner && (
            <View style={styles.ownerBadge}>
              <Ionicons name="star" size={10} color={colors.yellow} />
              <Text style={styles.ownerBadgeText}>Admin</Text>
            </View>
          )}
        </View>
        <RoleBadge role={member.role} />
      </View>
      {showTotal && member.monthlyTotal !== undefined && (
        <View style={styles.memberRowAmount}>
          <Text variant="caption" color={colors.text.tertiary}>Este mes</Text>
          <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'Montserrat_700Bold' }}>
            {formatCurrency(member.monthlyTotal)}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Fila de transferencia ─────────────────────────────────────────────────────
function TransferRow({ transfer, myUserId }: { transfer: GroupTransfer; myUserId: string }) {
  const isSender = transfer.from_user_id === myUserId;
  const otherName = isSender
    ? (transfer.to_profile?.full_name ?? 'Destinatario')
    : (transfer.from_profile?.full_name ?? 'Origen');

  return (
    <View style={styles.transferRow}>
      <View style={[styles.transferIcon, { backgroundColor: isSender ? colors.red + '18' : colors.primary + '18' }]}>
        <Ionicons
          name={isSender ? 'arrow-up' : 'arrow-down'}
          size={18}
          color={isSender ? colors.red : colors.primary}
        />
      </View>
      <View style={styles.transferInfo}>
        <Text variant="bodySmall" color={colors.text.primary}>
          {isSender ? `Le pasaste a ${otherName}` : `Recibiste de ${otherName}`}
        </Text>
        {transfer.note && (
          <Text variant="caption" color={colors.text.tertiary}>{transfer.note}</Text>
        )}
        <Text variant="caption" color={colors.text.tertiary}>
          {formatTransferDate(transfer.transfer_date)}
        </Text>
      </View>
      <Text
        variant="bodySmall"
        style={[styles.transferAmount, { color: isSender ? colors.red : colors.primary }]}
      >
        {isSender ? '-' : '+'}{formatCurrency(transfer.amount)}
      </Text>
    </View>
  );
}

// ── Tab bar interno ───────────────────────────────────────────────────────────
function InternalTabBar({ active, onChange }: { active: ActiveTab; onChange: (t: ActiveTab) => void }) {
  const tabs: { key: ActiveTab; label: string; icon: string }[] = [
    { key: 'resumen', label: 'Resumen', icon: 'grid-outline' },
    { key: 'miembros', label: 'Miembros', icon: 'people-outline' },
    { key: 'movimientos', label: 'Movimientos', icon: 'swap-horizontal-outline' },
    { key: 'config', label: 'Config', icon: 'settings-outline' },
  ];

  return (
    <View style={styles.tabBar}>
      {tabs.map(tab => (
        <TouchableOpacity
          key={tab.key}
          style={[styles.tabItem, active === tab.key && styles.tabItemActive]}
          onPress={() => onChange(tab.key)}
        >
          <Ionicons
            name={tab.icon as any}
            size={18}
            color={active === tab.key ? colors.primary : colors.text.tertiary}
          />
          <Text
            variant="caption"
            style={[styles.tabLabel, active === tab.key && styles.tabLabelActive]}
          >
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  MODALES
// ══════════════════════════════════════════════════════════════════════════════

// ── Modal: Crear grupo ────────────────────────────────────────────────────────
function CreateGroupModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (code: string) => void;
}) {
  const { user } = useAuthStore();
  const { createGroup, isCreating, error, clearError } = useFamilyGroupStore();

  const [groupType, setGroupType] = useState<GroupType>('family');
  const [groupName, setGroupName] = useState('');
  const [ownerRole, setOwnerRole] = useState<MemberRole>('parent');

  const familyOwnerRoles: MemberRole[] = ['parent', 'guardian', 'other_adult'];

  const handleCreate = async () => {
    if (!user?.id) return;
    if (!groupName.trim()) {
      Alert.alert('Falta el nombre', 'Ingresá un nombre para el grupo.');
      return;
    }

    const finalRole: MemberRole = groupType === 'couple' ? 'partner' : ownerRole;
    const result = await createGroup({
      name: groupName.trim(),
      groupType,
      ownerId: user.id,
      ownerRole: finalRole,
    });

    if (result) {
      setGroupName('');
      onCreated(result.inviteCode);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text variant="h4">Crear grupo</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text.primary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {/* Tipo de grupo */}
            <Text variant="label" color={colors.text.secondary}>TIPO DE GRUPO</Text>
            <View style={styles.typeSelector}>
              {(['family', 'couple'] as GroupType[]).map(type => (
                <TouchableOpacity
                  key={type}
                  style={[styles.typeOption, groupType === type && styles.typeOptionActive]}
                  onPress={() => {
                    setGroupType(type);
                    if (type === 'couple') setOwnerRole('partner');
                    else setOwnerRole('parent');
                  }}
                >
                  <Ionicons
                    name={type === 'family' ? 'people' : 'heart'}
                    size={24}
                    color={groupType === type ? colors.primary : colors.text.secondary}
                  />
                  <Text
                    variant="bodySmall"
                    color={groupType === type ? colors.primary : colors.text.secondary}
                    style={{ marginTop: spacing[1], fontFamily: groupType === type ? 'Montserrat_700Bold' : 'Montserrat_400Regular' }}
                  >
                    {type === 'family' ? 'Familia' : 'Pareja'}
                  </Text>
                  <Text variant="caption" color={colors.text.tertiary} align="center" style={{ marginTop: 2 }}>
                    {type === 'family' ? 'Padres, hijos, tutores' : 'Dos personas'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Nombre */}
            <Text variant="label" color={colors.text.secondary} style={{ marginTop: spacing[5] }}>
              NOMBRE DEL GRUPO
            </Text>
            <TextInput
              style={styles.textInput}
              placeholder={groupType === 'family' ? 'Ej: Familia García' : 'Ej: Franco y Agus'}
              placeholderTextColor={colors.text.tertiary}
              value={groupName}
              onChangeText={setGroupName}
              autoCapitalize="words"
              maxLength={40}
            />

            {/* Rol del creador (solo familia) */}
            {groupType === 'family' && (
              <>
                <Text variant="label" color={colors.text.secondary} style={{ marginTop: spacing[5] }}>
                  TU ROL EN EL GRUPO
                </Text>
                <View style={styles.roleGrid}>
                  {familyOwnerRoles.map(role => (
                    <TouchableOpacity
                      key={role}
                      style={[styles.roleOption, ownerRole === role && styles.roleOptionActive]}
                      onPress={() => setOwnerRole(role)}
                    >
                      <Ionicons
                        name={MEMBER_ROLE_ICONS[role] as any}
                        size={20}
                        color={ownerRole === role ? colors.primary : colors.text.secondary}
                      />
                      <Text
                        variant="caption"
                        color={ownerRole === role ? colors.primary : colors.text.secondary}
                        align="center"
                        style={{ marginTop: 4, fontFamily: ownerRole === role ? 'Montserrat_600SemiBold' : 'Montserrat_400Regular' }}
                      >
                        {MEMBER_ROLE_LABELS[role]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {error && (
              <Text variant="caption" color={colors.error} style={{ marginTop: spacing[3] }}>
                {error}
              </Text>
            )}

            <Button
              label={isCreating ? 'Creando...' : 'Crear grupo'}
              variant="neon"
              size="lg"
              fullWidth
              isLoading={isCreating}
              onPress={handleCreate}
              style={{ marginTop: spacing[6] }}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Modal: Unirse a un grupo ──────────────────────────────────────────────────
function JoinGroupModal({
  visible,
  onClose,
  onJoined,
}: {
  visible: boolean;
  onClose: () => void;
  onJoined: () => void;
}) {
  const { user } = useAuthStore();
  const { joinGroup, isJoining, error, clearError } = useFamilyGroupStore();

  const [code, setCode] = useState('');
  const [selectedRole, setSelectedRole] = useState<MemberRole>('child');

  const allRoles: MemberRole[] = ['parent', 'child', 'guardian', 'other_adult'];

  const handleJoin = async () => {
    if (!user?.id) return;
    if (code.trim().length < 4) {
      Alert.alert('Código inválido', 'Ingresá el código de invitación completo.');
      return;
    }

    const result = await joinGroup({ inviteCode: code, userId: user.id, role: selectedRole });
    if (result) {
      setCode('');
      onJoined();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text variant="h4">Unirme a un grupo</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text.primary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text variant="body" color={colors.text.secondary}>
              Pedile el código de invitación al admin del grupo e ingresalo acá.
            </Text>

            <Text variant="label" color={colors.text.secondary} style={{ marginTop: spacing[5] }}>
              CÓDIGO DE INVITACIÓN
            </Text>
            <TextInput
              style={[styles.textInput, styles.codeInput]}
              placeholder="Ej: AB3X9K"
              placeholderTextColor={colors.text.tertiary}
              value={code}
              onChangeText={t => setCode(t.toUpperCase())}
              autoCapitalize="characters"
              maxLength={8}
              autoCorrect={false}
            />

            <Text variant="label" color={colors.text.secondary} style={{ marginTop: spacing[5] }}>
              TU ROL EN EL GRUPO
            </Text>
            <View style={styles.roleGrid}>
              {allRoles.map(role => (
                <TouchableOpacity
                  key={role}
                  style={[styles.roleOption, selectedRole === role && styles.roleOptionActive]}
                  onPress={() => setSelectedRole(role)}
                >
                  <Ionicons
                    name={MEMBER_ROLE_ICONS[role] as any}
                    size={20}
                    color={selectedRole === role ? colors.primary : colors.text.secondary}
                  />
                  <Text
                    variant="caption"
                    color={selectedRole === role ? colors.primary : colors.text.secondary}
                    align="center"
                    style={{ marginTop: 4, fontFamily: selectedRole === role ? 'Montserrat_600SemiBold' : 'Montserrat_400Regular' }}
                  >
                    {MEMBER_ROLE_LABELS[role]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {error && (
              <Text variant="caption" color={colors.error} style={{ marginTop: spacing[3] }}>
                {error}
              </Text>
            )}

            <Button
              label={isJoining ? 'Uniéndome...' : 'Unirme'}
              variant="neon"
              size="lg"
              fullWidth
              isLoading={isJoining}
              onPress={handleJoin}
              style={{ marginTop: spacing[6] }}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Modal: Asignar dinero ─────────────────────────────────────────────────────
function TransferMoneyModal({
  visible,
  onClose,
  onSent,
}: {
  visible: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const { user } = useAuthStore();
  const { group, members, createTransfer } = useFamilyGroupStore();

  const [toUserId, setToUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [isSending, setIsSending] = useState(false);

  const otherMembers = members.filter(m => m.user_id !== user?.id);

  const handleSend = async () => {
    if (!user?.id || !group) return;
    if (!toUserId) { Alert.alert('Falta el destinatario', 'Elegí a quién le querés pasar dinero.'); return; }
    const parsed = parseFloat(amount.replace(/\./g, '').replace(',', '.'));
    if (!parsed || parsed <= 0) { Alert.alert('Monto inválido', 'Ingresá un monto mayor a cero.'); return; }

    setIsSending(true);
    const ok = await createTransfer({
      groupId: group.id,
      fromUserId: user.id,
      toUserId,
      amount: parsed,
      note: note.trim() || undefined,
    });
    setIsSending(false);

    if (ok) {
      setToUserId('');
      setAmount('');
      setNote('');
      onSent();
    } else {
      Alert.alert('Error', 'No se pudo registrar el movimiento. Intentá de nuevo.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text variant="h4">Asignar dinero</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text.primary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text variant="body" color={colors.text.secondary}>
              Registrá cuánto dinero le pasaste a alguien del grupo.
            </Text>

            {/* Selector de destinatario */}
            <Text variant="label" color={colors.text.secondary} style={{ marginTop: spacing[5] }}>
              PARA QUIÉN
            </Text>
            {otherMembers.length === 0 ? (
              <Text variant="bodySmall" color={colors.text.tertiary}>No hay otros miembros en el grupo todavía.</Text>
            ) : (
              <View style={styles.recipientList}>
                {otherMembers.map(m => {
                  const name = m.profile?.full_name ?? m.profile?.email ?? 'Miembro';
                  const selected = toUserId === m.user_id;
                  return (
                    <TouchableOpacity
                      key={m.user_id}
                      style={[styles.recipientOption, selected && styles.recipientOptionActive]}
                      onPress={() => setToUserId(m.user_id)}
                    >
                      <MemberAvatar name={name} role={m.role} size={36} />
                      <View style={{ flex: 1, marginLeft: spacing[3] }}>
                        <Text variant="bodySmall" color={selected ? colors.primary : colors.text.primary}>
                          {name}
                        </Text>
                        <Text variant="caption" color={colors.text.tertiary}>
                          {MEMBER_ROLE_LABELS[m.role]}
                        </Text>
                      </View>
                      {selected && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Monto */}
            <Text variant="label" color={colors.text.secondary} style={{ marginTop: spacing[5] }}>
              MONTO
            </Text>
            <View style={styles.amountInputRow}>
              <Text variant="body" color={colors.text.tertiary} style={{ marginRight: spacing[2] }}>$</Text>
              <TextInput
                style={[styles.textInput, { flex: 1, marginTop: 0 }]}
                placeholder="0"
                placeholderTextColor={colors.text.tertiary}
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
              />
            </View>

            {/* Nota */}
            <Text variant="label" color={colors.text.secondary} style={{ marginTop: spacing[5] }}>
              NOTA (opcional)
            </Text>
            <TextInput
              style={styles.textInput}
              placeholder="Ej: Para el colegio"
              placeholderTextColor={colors.text.tertiary}
              value={note}
              onChangeText={setNote}
              maxLength={80}
            />

            <Button
              label={isSending ? 'Registrando...' : 'Registrar movimiento'}
              variant="neon"
              size="lg"
              fullWidth
              isLoading={isSending}
              onPress={handleSend}
              style={{ marginTop: spacing[6] }}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  VISTAS DE CONTENIDO
// ══════════════════════════════════════════════════════════════════════════════

// ── Vista: Sin grupo ──────────────────────────────────────────────────────────
function NoGroupView({
  onCreatePress,
  onJoinPress,
}: {
  onCreatePress: () => void;
  onJoinPress: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.noGroupContainer} showsVerticalScrollIndicator={false}>
      <View style={styles.noGroupHero}>
        <View style={styles.noGroupIconCircle}>
          <Ionicons name="people" size={48} color={colors.primary} />
        </View>
        <Text variant="h3" align="center" color={colors.text.primary} style={{ marginTop: spacing[4] }}>
          Grupos
        </Text>
        <Text variant="body" align="center" color={colors.text.secondary} style={{ marginTop: spacing[2] }}>
          Organizá las finanzas con tu familia o pareja. Compartí gastos, asigná dinero y llevá un control conjunto.
        </Text>
      </View>

      <View style={styles.noGroupCards}>
        <TouchableOpacity style={styles.noGroupCard} onPress={onCreatePress} activeOpacity={0.7}>
          <View style={[styles.noGroupCardIcon, { backgroundColor: colors.primary + '18' }]}>
            <Ionicons name="add-circle" size={28} color={colors.primary} />
          </View>
          <View style={{ flex: 1, marginLeft: spacing[4] }}>
            <Text variant="subtitle" color={colors.text.primary}>Crear un grupo</Text>
            <Text variant="caption" color={colors.text.secondary} style={{ marginTop: 2 }}>
              Invitá a tu familia o pareja con un código único
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.text.tertiary} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.noGroupCard} onPress={onJoinPress} activeOpacity={0.7}>
          <View style={[styles.noGroupCardIcon, { backgroundColor: colors.accent + '18' }]}>
            <Ionicons name="enter-outline" size={28} color={colors.accent} />
          </View>
          <View style={{ flex: 1, marginLeft: spacing[4] }}>
            <Text variant="subtitle" color={colors.text.primary}>Unirme con código</Text>
            <Text variant="caption" color={colors.text.secondary} style={{ marginTop: 2 }}>
              Alguien ya creó un grupo y te invitó
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.text.tertiary} />
        </TouchableOpacity>
      </View>

      <View style={styles.noGroupInfo}>
        <Text variant="label" color={colors.text.secondary} style={{ marginBottom: spacing[3] }}>
          ¿QUÉ PODÉS HACER?
        </Text>
        {[
          { icon: 'eye-outline', text: 'Ver los gastos de tus hijos o pareja' },
          { icon: 'swap-horizontal-outline', text: 'Registrar dinero que le pasás a alguien del grupo' },
          { icon: 'bar-chart-outline', text: 'Ver un resumen de los gastos del grupo' },
          { icon: 'lock-closed-outline', text: 'Los hijos no ven los gastos de los padres' },
        ].map((item, i) => (
          <View key={i} style={styles.infoRow}>
            <Ionicons name={item.icon as any} size={16} color={colors.primary} />
            <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, marginLeft: spacing[3] }}>
              {item.text}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ── Tab: Resumen ──────────────────────────────────────────────────────────────
function ResumenTab({ myUserId }: { myUserId: string }) {
  const { group, members, transfers, myMembership, isAdult, canSeeExpensesOf } = useFamilyGroupStore();
  if (!group || !myMembership) return null;

  const isCouple = group.group_type === 'couple';
  const amIAdult = isAdult();

  // Totales del mes
  const myTotal = members.find(m => m.user_id === myUserId)?.monthlyTotal ?? 0;
  const otherMembers = members.filter(m => m.user_id !== myUserId);

  // Transferencias recientes (últimas 5)
  const recentTransfers = transfers.slice(0, 5);

  // Calcular total grupal (solo los que puedo ver)
  const groupTotal = members
    .filter(m => canSeeExpensesOf(m.user_id, myUserId))
    .reduce((acc, m) => acc + (m.monthlyTotal ?? 0), 0);

  return (
    <ScrollView
      contentContainerStyle={styles.tabContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Tipo badge */}
      <View style={styles.groupTypeBadge}>
        <Ionicons
          name={isCouple ? 'heart' : 'people'}
          size={14}
          color={isCouple ? colors.red : colors.accent}
        />
        <Text variant="caption" color={isCouple ? colors.red : colors.accent} style={{ marginLeft: 4 }}>
          {isCouple ? 'Modo pareja' : 'Grupo familiar'}
        </Text>
      </View>

      {/* Mi gasto */}
      <Card style={styles.summaryCard}>
        <Text variant="label" color={colors.text.secondary}>MIS GASTOS ESTE MES</Text>
        <Text variant="h2" color={colors.text.primary} style={{ marginTop: spacing[1] }}>
          {formatCurrency(myTotal)}
        </Text>
        <RoleBadge role={myMembership.role} />
      </Card>

      {/* Resumen grupal (adultos o pareja) */}
      {(amIAdult || isCouple) && otherMembers.length > 0 && (
        <Card style={[styles.summaryCard, { marginTop: spacing[3] }]}>
          <Text variant="label" color={colors.text.secondary}>RESUMEN DEL GRUPO</Text>
          <Text variant="h3" color={colors.text.primary} style={{ marginVertical: spacing[2] }}>
            {formatCurrency(groupTotal)}
          </Text>
          <Text variant="caption" color={colors.text.tertiary}>gasto total visible este mes</Text>

          <View style={styles.divider} />

          {members
            .filter(m => canSeeExpensesOf(m.user_id, myUserId))
            .map(m => {
              const name = m.profile?.full_name ?? m.profile?.email ?? 'Miembro';
              const pct = groupTotal > 0 ? ((m.monthlyTotal ?? 0) / groupTotal) * 100 : 0;
              return (
                <View key={m.user_id} style={styles.memberSummaryRow}>
                  <MemberAvatar name={name} role={m.role} size={32} />
                  <View style={{ flex: 1, marginLeft: spacing[3] }}>
                    <View style={styles.memberSummaryTop}>
                      <Text variant="bodySmall" color={colors.text.primary}>
                        {m.user_id === myUserId ? 'Vos' : name}
                      </Text>
                      <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'Montserrat_700Bold' }}>
                        {formatCurrency(m.monthlyTotal ?? 0)}
                      </Text>
                    </View>
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { width: `${Math.min(pct, 100)}%` }]} />
                    </View>
                  </View>
                </View>
              );
            })}
        </Card>
      )}

      {/* Transferencias recientes */}
      {recentTransfers.length > 0 && (
        <View style={{ marginTop: spacing[5] }}>
          <Text variant="label" color={colors.text.secondary} style={{ marginBottom: spacing[3] }}>
            MOVIMIENTOS RECIENTES
          </Text>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {recentTransfers.map((t, i) => (
              <View key={t.id}>
                <TransferRow transfer={t} myUserId={myUserId} />
                {i < recentTransfers.length - 1 && <View style={styles.divider} />}
              </View>
            ))}
          </Card>
        </View>
      )}

      {/* Estado vacío */}
      {myTotal === 0 && recentTransfers.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="analytics-outline" size={40} color={colors.border.default} />
          <Text variant="body" color={colors.text.tertiary} align="center" style={{ marginTop: spacing[3] }}>
            Todavía no hay gastos registrados este mes.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

// ── Tab: Miembros ─────────────────────────────────────────────────────────────
function MiembrosTab({ myUserId, onTransferPress }: { myUserId: string; onTransferPress: () => void }) {
  const { group, members, myMembership, isAdult, canSeeExpensesOf } = useFamilyGroupStore();
  if (!group || !myMembership) return null;

  const amIAdult = isAdult();

  return (
    <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      <View style={styles.sectionHeader}>
        <Text variant="label" color={colors.text.secondary}>{members.length} MIEMBRO{members.length !== 1 ? 'S' : ''}</Text>
      </View>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {members.map((m, i) => {
          const canSee = canSeeExpensesOf(m.user_id, myUserId);
          return (
            <View key={m.user_id}>
              <MemberRow
                member={m}
                isMe={m.user_id === myUserId}
                isOwner={group.owner_id === m.user_id}
                showTotal={canSee && m.user_id !== myUserId}
              />
              {i < members.length - 1 && <View style={styles.divider} />}
            </View>
          );
        })}
      </Card>

      {amIAdult && members.some(m => m.user_id !== myUserId) && (
        <Button
          label="Asignar dinero a un miembro"
          variant="secondary"
          size="md"
          fullWidth
          onPress={onTransferPress}
          style={{ marginTop: spacing[4] }}
        />
      )}

      {/* Nota de privacidad para adultos */}
      {amIAdult && group.group_type === 'family' && (
        <View style={styles.privacyNote}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.text.tertiary} />
          <Text variant="caption" color={colors.text.tertiary} style={{ flex: 1, marginLeft: spacing[2] }}>
            Los hijos pueden ver a los miembros del grupo pero no los gastos de los adultos.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

// ── Tab: Movimientos ──────────────────────────────────────────────────────────
function MovimientosTab({ myUserId, onNewTransfer }: { myUserId: string; onNewTransfer: () => void }) {
  const { transfers, myMembership, isAdult } = useFamilyGroupStore();
  const amIAdult = isAdult();

  return (
    <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      {amIAdult && (
        <Button
          label="Registrar nuevo movimiento"
          variant="neon"
          size="md"
          fullWidth
          onPress={onNewTransfer}
          style={{ marginBottom: spacing[4] }}
        />
      )}

      {transfers.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="swap-horizontal-outline" size={40} color={colors.border.default} />
          <Text variant="body" color={colors.text.tertiary} align="center" style={{ marginTop: spacing[3] }}>
            Todavía no hay movimientos registrados.
          </Text>
          <Text variant="caption" color={colors.text.tertiary} align="center" style={{ marginTop: spacing[2] }}>
            {amIAdult
              ? 'Usá el botón de arriba para registrar dinero que le pasaste a alguien.'
              : 'Acá vas a ver el dinero que te enviaron.'}
          </Text>
        </View>
      ) : (
        <>
          <Text variant="label" color={colors.text.secondary} style={{ marginBottom: spacing[3] }}>
            HISTORIAL
          </Text>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {transfers.map((t, i) => (
              <View key={t.id}>
                <TransferRow transfer={t} myUserId={myUserId} />
                {i < transfers.length - 1 && <View style={styles.divider} />}
              </View>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

// ── Tab: Configuración ────────────────────────────────────────────────────────
function ConfigTab({ myUserId, onLeave }: { myUserId: string; onLeave: () => void }) {
  const { group, myMembership, isOwner } = useFamilyGroupStore();
  if (!group || !myMembership) return null;

  const amOwner = isOwner(myUserId);

  const handleCopyCode = () => {
    Clipboard.setString(group.invite_code);
    Alert.alert('Copiado', `El código ${group.invite_code} fue copiado al portapapeles.`);
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Unite a mi grupo "${group.name}" en PesoSmart. El código es: ${group.invite_code}`,
        title: `Unirte al grupo ${group.name}`,
      });
    } catch {}
  };

  const confirmLeave = () => {
    Alert.alert(
      'Salir del grupo',
      amOwner
        ? 'Sos el admin del grupo. Si salís, el grupo seguirá existiendo pero sin admin. ¿Confirmás?'
        : '¿Querés salir del grupo? Perderás acceso al historial compartido.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Salir', style: 'destructive', onPress: onLeave },
      ]
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      {/* Info del grupo */}
      <Text variant="label" color={colors.text.secondary} style={styles.sectionLabel}>
        INFORMACIÓN DEL GRUPO
      </Text>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <View style={styles.configRow}>
          <Text variant="bodySmall" color={colors.text.secondary}>Nombre</Text>
          <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
            {group.name}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.configRow}>
          <Text variant="bodySmall" color={colors.text.secondary}>Tipo</Text>
          <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
            {group.group_type === 'family' ? 'Grupo familiar' : 'Modo pareja'}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.configRow}>
          <Text variant="bodySmall" color={colors.text.secondary}>Mi rol</Text>
          <RoleBadge role={myMembership.role} />
        </View>
      </Card>

      {/* Código de invitación */}
      <Text variant="label" color={colors.text.secondary} style={[styles.sectionLabel, { marginTop: spacing[5] }]}>
        CÓDIGO DE INVITACIÓN
      </Text>
      <Card>
        <View style={styles.codeDisplay}>
          <Text style={styles.codeText}>{group.invite_code}</Text>
        </View>
        <Text variant="caption" color={colors.text.tertiary} align="center" style={{ marginBottom: spacing[4] }}>
          Compartí este código para que otros se unan al grupo
        </Text>
        <View style={styles.codeActions}>
          <Button label="Copiar" variant="secondary" size="sm" onPress={handleCopyCode} style={{ flex: 1, marginRight: spacing[2] }} />
          <Button label="Compartir" variant="secondary" size="sm" onPress={handleShare} style={{ flex: 1 }} />
        </View>
      </Card>

      {/* Permisos */}
      <Text variant="label" color={colors.text.secondary} style={[styles.sectionLabel, { marginTop: spacing[5] }]}>
        REGLAS DE PRIVACIDAD
      </Text>
      <Card style={{ gap: spacing[3] }}>
        {group.group_type === 'family' ? (
          <>
            <View style={styles.permissionRow}>
              <Ionicons name="eye-outline" size={16} color={colors.primary} />
              <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, marginLeft: spacing[3] }}>
                Los adultos pueden ver los gastos de los hijos/as
              </Text>
            </View>
            <View style={styles.permissionRow}>
              <Ionicons name="eye-off-outline" size={16} color={colors.text.tertiary} />
              <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, marginLeft: spacing[3] }}>
                Los hijos/as no pueden ver los gastos de los adultos
              </Text>
            </View>
            <View style={styles.permissionRow}>
              <Ionicons name="swap-horizontal-outline" size={16} color={colors.accent} />
              <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, marginLeft: spacing[3] }}>
                Los adultos pueden asignar dinero a cualquier miembro
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.permissionRow}>
            <Ionicons name="eye-outline" size={16} color={colors.primary} />
            <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, marginLeft: spacing[3] }}>
              Ambos integrantes pueden ver los gastos del otro
            </Text>
          </View>
        )}
      </Card>

      {/* Salir */}
      <Button
        label="Salir del grupo"
        variant="danger"
        size="md"
        fullWidth
        onPress={confirmLeave}
        style={{ marginTop: spacing[6] }}
      />
    </ScrollView>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  PANTALLA PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════

export default function GrupoFamiliaScreen() {
  const { user } = useAuthStore();
  const { group, myMembership, isLoading, fetchGroup, leaveGroup, clearError } = useFamilyGroupStore();

  const [activeTab, setActiveTab] = useState<ActiveTab>('resumen');
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id) {
      fetchGroup(user.id);
    }
  }, [user?.id]);

  const handleLeave = useCallback(async () => {
    if (!user?.id) return;
    const ok = await leaveGroup(user.id);
    if (!ok) Alert.alert('Error', 'No se pudo salir del grupo. Intentá de nuevo.');
  }, [user?.id]);

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView style={[styles.safe, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  // ── Sin grupo ───────────────────────────────────────────────────────────────
  if (!group) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text variant="h4">Grupos</Text>
        </View>

        <NoGroupView
          onCreatePress={() => { clearError(); setShowCreate(true); }}
          onJoinPress={() => { clearError(); setShowJoin(true); }}
        />

        <CreateGroupModal
          visible={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={code => {
            setShowCreate(false);
            setCreatedCode(code);
          }}
        />

        <JoinGroupModal
          visible={showJoin}
          onClose={() => setShowJoin(false)}
          onJoined={() => setShowJoin(false)}
        />

        {/* Modal de código generado */}
        <Modal
          visible={!!createdCode}
          animationType="fade"
          transparent
          onRequestClose={() => setCreatedCode(null)}
        >
          <View style={styles.codeModalOverlay}>
            <Card style={styles.codeModalCard}>
              <Ionicons name="checkmark-circle" size={48} color={colors.primary} style={{ alignSelf: 'center' }} />
              <Text variant="h4" align="center" style={{ marginTop: spacing[3] }}>
                ¡Grupo creado!
              </Text>
              <Text variant="body" color={colors.text.secondary} align="center" style={{ marginTop: spacing[2] }}>
                Compartí este código para que otros se unan:
              </Text>
              <View style={styles.codeDisplay}>
                <Text style={styles.codeText}>{createdCode}</Text>
              </View>
              <View style={styles.codeActions}>
                <Button
                  label="Copiar código"
                  variant="secondary"
                  size="sm"
                  onPress={() => { Clipboard.setString(createdCode ?? ''); Alert.alert('Copiado', 'Código copiado al portapapeles.'); }}
                  style={{ flex: 1, marginRight: spacing[2] }}
                />
                <Button
                  label="Listo"
                  variant="neon"
                  size="sm"
                  onPress={() => setCreatedCode(null)}
                  style={{ flex: 1 }}
                />
              </View>
            </Card>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // ── Con grupo ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="h4" numberOfLines={1}>{group.name}</Text>
          <Text variant="caption" color={colors.text.tertiary}>
            {group.group_type === 'family' ? 'Grupo familiar' : 'Modo pareja'} · {myMembership ? MEMBER_ROLE_LABELS[myMembership.role] : ''}
          </Text>
        </View>
      </View>

      <InternalTabBar active={activeTab} onChange={setActiveTab} />

      {activeTab === 'resumen' && <ResumenTab myUserId={user?.id ?? ''} />}
      {activeTab === 'miembros' && (
        <MiembrosTab
          myUserId={user?.id ?? ''}
          onTransferPress={() => setShowTransfer(true)}
        />
      )}
      {activeTab === 'movimientos' && (
        <MovimientosTab
          myUserId={user?.id ?? ''}
          onNewTransfer={() => setShowTransfer(true)}
        />
      )}
      {activeTab === 'config' && (
        <ConfigTab
          myUserId={user?.id ?? ''}
          onLeave={handleLeave}
        />
      )}

      <TransferMoneyModal
        visible={showTransfer}
        onClose={() => setShowTransfer(false)}
        onSent={() => {
          setShowTransfer(false);
          setActiveTab('movimientos');
        }}
      />
    </SafeAreaView>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  ESTILOS
// ══════════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  centered: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[3],
  },

  // ── Tab bar ────────────────────────────────────────────────────────────────
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    backgroundColor: colors.bg.primary,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[3],
    gap: 2,
  },
  tabItemActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  tabLabel: {
    fontSize: 9,
    fontFamily: 'Montserrat_500Medium',
    color: colors.text.tertiary,
  },
  tabLabelActive: {
    color: colors.primary,
    fontFamily: 'Montserrat_600SemiBold',
  },

  // ── Tab content ────────────────────────────────────────────────────────────
  tabContent: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[4],
    paddingBottom: layout.tabBarHeight + spacing[6],
  },

  // ── Sin grupo ──────────────────────────────────────────────────────────────
  noGroupContainer: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: layout.tabBarHeight + spacing[6],
    gap: spacing[6],
  },
  noGroupHero: {
    alignItems: 'center',
    paddingTop: spacing[8],
  },
  noGroupIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noGroupCards: { gap: spacing[3] },
  noGroupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.secondary,
    borderRadius: 12,
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  noGroupCardIcon: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noGroupInfo: {
    backgroundColor: colors.bg.secondary,
    borderRadius: 12,
    padding: spacing[4],
    gap: spacing[3],
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
  },

  // ── Miembro ────────────────────────────────────────────────────────────────
  memberAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    gap: spacing[4],
  },
  memberRowInfo: { flex: 1, gap: spacing[1] },
  memberRowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  memberRowAmount: { alignItems: 'flex-end', gap: 2 },

  ownerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.yellow + '20',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  ownerBadgeText: {
    fontSize: 9,
    fontFamily: 'Montserrat_600SemiBold',
    color: colors.yellow,
  },

  roleBadge: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  roleBadgeText: {
    fontSize: 10,
    fontFamily: 'Montserrat_500Medium',
  },

  // ── Transferencia ──────────────────────────────────────────────────────────
  transferRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    gap: spacing[3],
  },
  transferIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transferInfo: { flex: 1, gap: 2 },
  transferAmount: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 14,
  },

  // ── Resumen ────────────────────────────────────────────────────────────────
  summaryCard: { gap: spacing[2] },
  groupTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.bg.secondary,
    borderRadius: 6,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    marginBottom: spacing[3],
    gap: 4,
  },
  memberSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing[3],
  },
  memberSummaryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing[1],
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.border.subtle,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },

  // ── Config ─────────────────────────────────────────────────────────────────
  sectionLabel: { marginBottom: spacing[3] },
  sectionHeader: { marginBottom: spacing[3] },
  configRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },

  codeDisplay: {
    backgroundColor: colors.bg.secondary,
    borderRadius: 12,
    padding: spacing[4],
    alignItems: 'center',
    marginVertical: spacing[3],
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderStyle: 'dashed',
  },
  codeText: {
    fontFamily: 'Montserrat_800ExtraBold',
    fontSize: 28,
    color: colors.text.primary,
    letterSpacing: 8,
  },
  codeActions: {
    flexDirection: 'row',
  },

  // ── Modales ────────────────────────────────────────────────────────────────
  modal: { flex: 1, backgroundColor: colors.bg.primary },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  modalContent: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[5],
    paddingBottom: spacing[12],
    gap: spacing[2],
  },

  // ── Selector de tipo ───────────────────────────────────────────────────────
  typeSelector: {
    flexDirection: 'row',
    gap: spacing[3],
    marginTop: spacing[3],
  },
  typeOption: {
    flex: 1,
    alignItems: 'center',
    padding: spacing[4],
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.secondary,
    gap: 2,
  },
  typeOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '0D',
  },

  // ── Grid de roles ──────────────────────────────────────────────────────────
  roleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    marginTop: spacing[3],
  },
  roleOption: {
    width: '47%',
    alignItems: 'center',
    padding: spacing[3],
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.secondary,
  },
  roleOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '0D',
  },

  // ── Input de código ────────────────────────────────────────────────────────
  codeInput: {
    textAlign: 'center',
    fontSize: 22,
    fontFamily: 'Montserrat_700Bold',
    letterSpacing: 8,
  },
  textInput: {
    backgroundColor: colors.bg.input,
    borderRadius: 10,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    fontFamily: 'Montserrat_400Regular',
    fontSize: 15,
    color: colors.text.primary,
    marginTop: spacing[2],
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },

  // ── Transfer modal ─────────────────────────────────────────────────────────
  recipientList: { gap: spacing[2], marginTop: spacing[2] },
  recipientOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[3],
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.secondary,
  },
  recipientOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '0D',
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[2],
  },

  // ── Código modal overlay ───────────────────────────────────────────────────
  codeModalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: layout.screenPadding,
  },
  codeModalCard: {
    width: '100%',
    gap: spacing[2],
  },

  // ── Utilidades ─────────────────────────────────────────────────────────────
  divider: {
    height: 1,
    backgroundColor: colors.border.subtle,
    marginHorizontal: spacing[5],
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing[10],
    gap: spacing[2],
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.bg.secondary,
    borderRadius: 8,
    padding: spacing[3],
    marginTop: spacing[4],
    gap: spacing[2],
  },
});
