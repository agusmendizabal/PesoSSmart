import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type {
  FamilyGroup,
  FamilyMember,
  GroupTransfer,
  GroupType,
  MemberRole,
  ADULT_ROLES,
} from '@/types/database';
import { ADULT_ROLES as ADULT_ROLES_CONST } from '@/types/database';

// ── Tipos de estado ───────────────────────────────────────────────────────────

interface MemberWithExpenses extends FamilyMember {
  monthlyTotal?: number;
}

interface FamilyGroupState {
  group: FamilyGroup | null;
  myMembership: FamilyMember | null;
  members: MemberWithExpenses[];
  transfers: GroupTransfer[];
  isLoading: boolean;
  isCreating: boolean;
  isJoining: boolean;
  error: string | null;
}

interface FamilyGroupActions {
  // Carga
  fetchGroup: (userId: string) => Promise<void>;
  fetchTransfers: (groupId: string, userId: string) => Promise<void>;
  fetchMemberExpenseTotals: (groupId: string, userId: string) => Promise<void>;

  // Creación y unión
  createGroup: (params: {
    name: string;
    groupType: GroupType;
    ownerId: string;
    ownerRole: MemberRole;
  }) => Promise<{ inviteCode: string } | null>;

  joinGroup: (params: {
    inviteCode: string;
    userId: string;
    role: MemberRole;
  }) => Promise<{ group: FamilyGroup } | null>;

  // Transferencias
  createTransfer: (params: {
    groupId: string;
    fromUserId: string;
    toUserId: string;
    amount: number;
    note?: string;
    transferDate?: string;
  }) => Promise<boolean>;

  // Salir del grupo
  leaveGroup: (userId: string) => Promise<boolean>;

  // Helpers
  isAdult: () => boolean;
  isOwner: (userId: string) => boolean;
  canSeeExpensesOf: (targetUserId: string, myUserId: string) => boolean;

  // Reset
  reset: () => void;
  clearError: () => void;
}

type FamilyGroupStore = FamilyGroupState & FamilyGroupActions;

// ── Generador de código único ─────────────────────────────────────────────────

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin O, I, 0, 1 para evitar confusión
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── Store ─────────────────────────────────────────────────────────────────────

const initialState: FamilyGroupState = {
  group: null,
  myMembership: null,
  members: [],
  transfers: [],
  isLoading: false,
  isCreating: false,
  isJoining: false,
  error: null,
};

export const useFamilyGroupStore = create<FamilyGroupStore>((set, get) => ({
  ...initialState,

  // ── Fetch grupo y miembros del usuario ──────────────────────────────────────
  fetchGroup: async (userId: string) => {
    set({ isLoading: true, error: null });
    try {
      // 1. Ver si el usuario pertenece a algún grupo
      const { data: membership, error: memErr } = await supabase
        .from('family_members')
        .select('*, profile:profiles(id, full_name, email, avatar_url)')
        .eq('user_id', userId)
        .single();

      if (memErr || !membership) {
        set({ group: null, myMembership: null, members: [], isLoading: false });
        return;
      }

      // 2. Cargar el grupo
      const { data: group, error: groupErr } = await supabase
        .from('family_groups')
        .select('*')
        .eq('id', membership.group_id)
        .single();

      if (groupErr || !group) {
        set({ group: null, myMembership: null, members: [], isLoading: false });
        return;
      }

      // 3. Cargar todos los miembros con sus perfiles
      const { data: allMembers } = await supabase
        .from('family_members')
        .select('*, profile:profiles(id, full_name, email, avatar_url)')
        .eq('group_id', group.id)
        .order('joined_at', { ascending: true });

      const myMembership: FamilyMember = {
        ...membership,
        profile: membership.profile,
      };

      set({
        group,
        myMembership,
        members: allMembers ?? [],
        isLoading: false,
      });

      // 4. Cargar transferencias y totales en background
      get().fetchTransfers(group.id, userId);
      get().fetchMemberExpenseTotals(group.id, userId);
    } catch (err) {
      console.error('[familyGroupStore] fetchGroup error:', err);
      set({ isLoading: false, error: 'No se pudo cargar el grupo' });
    }
  },

  // ── Transferencias internas del grupo ───────────────────────────────────────
  fetchTransfers: async (groupId: string, userId: string) => {
    try {
      const { data, error } = await supabase
        .from('group_transfers')
        .select(`
          *,
          from_profile:profiles!group_transfers_from_user_id_fkey(id, full_name),
          to_profile:profiles!group_transfers_to_user_id_fkey(id, full_name)
        `)
        .eq('group_id', groupId)
        .order('transfer_date', { ascending: false })
        .limit(50);

      if (!error && data) {
        set({ transfers: data });
      }
    } catch (err) {
      console.error('[familyGroupStore] fetchTransfers error:', err);
    }
  },

  // ── Totales mensuales por miembro (solo visibles para adultos) ──────────────
  fetchMemberExpenseTotals: async (groupId: string, userId: string) => {
    const { myMembership, members } = get();
    if (!myMembership) return;

    const isAdult = ADULT_ROLES_CONST.includes(myMembership.role as any);
    if (!isAdult && members.length === 0) return;

    try {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

      // Qué usuarios puede ver este miembro
      const visibleUserIds = get().canSeeExpensesOf
        ? members
            .filter(m => get().canSeeExpensesOf(m.user_id, userId))
            .map(m => m.user_id)
        : [userId];

      if (visibleUserIds.length === 0) {
        set({ members: members.map(m => ({ ...m, monthlyTotal: undefined })) });
        return;
      }

      const { data } = await supabase
        .from('expenses')
        .select('user_id, amount')
        .in('user_id', visibleUserIds)
        .gte('date', monthStart)
        .is('deleted_at', null);

      if (data) {
        const totals: Record<string, number> = {};
        data.forEach(e => {
          totals[e.user_id] = (totals[e.user_id] ?? 0) + Number(e.amount);
        });

        set({
          members: members.map(m => ({
            ...m,
            monthlyTotal: totals[m.user_id],
          })),
        });
      }
    } catch (err) {
      console.error('[familyGroupStore] fetchMemberExpenseTotals error:', err);
    }
  },

  // ── Crear grupo ─────────────────────────────────────────────────────────────
  createGroup: async ({ name, groupType, ownerId, ownerRole }) => {
    set({ isCreating: true, error: null });
    try {
      // Generar código único (reintenta si hay colisión)
      let inviteCode = '';
      let attempts = 0;
      while (attempts < 5) {
        const candidate = generateInviteCode();
        const { data: existing } = await supabase
          .from('family_groups')
          .select('id')
          .eq('invite_code', candidate)
          .single();
        if (!existing) {
          inviteCode = candidate;
          break;
        }
        attempts++;
      }

      if (!inviteCode) {
        set({ isCreating: false, error: 'No se pudo generar un código único' });
        return null;
      }

      // Insertar grupo
      const { data: group, error: groupErr } = await supabase
        .from('family_groups')
        .insert({ name, invite_code: inviteCode, group_type: groupType, owner_id: ownerId })
        .select()
        .single();

      if (groupErr || !group) {
        console.error('[familyGroupStore] createGroup insert error:', groupErr);
        set({ isCreating: false, error: 'No se pudo crear el grupo' });
        return null;
      }

      // Insertar membresía del creador
      const { error: memErr } = await supabase
        .from('family_members')
        .insert({ group_id: group.id, user_id: ownerId, role: ownerRole });

      if (memErr) {
        console.error('[familyGroupStore] createGroup membership error:', memErr);
        // Limpiar el grupo creado para no dejar huérfano
        await supabase.from('family_groups').delete().eq('id', group.id);
        set({ isCreating: false, error: 'No se pudo registrar tu membresía' });
        return null;
      }

      set({ isCreating: false });
      await get().fetchGroup(ownerId);
      return { inviteCode };
    } catch (err) {
      console.error('[familyGroupStore] createGroup error:', err);
      set({ isCreating: false, error: 'Error inesperado al crear el grupo' });
      return null;
    }
  },

  // ── Unirse a un grupo ────────────────────────────────────────────────────────
  joinGroup: async ({ inviteCode, userId, role }) => {
    set({ isJoining: true, error: null });
    try {
      const code = inviteCode.trim().toUpperCase();

      // Buscar el grupo por código
      const { data: group, error: groupErr } = await supabase
        .from('family_groups')
        .select('*')
        .eq('invite_code', code)
        .single();

      if (groupErr || !group) {
        set({ isJoining: false, error: 'Código inválido. Verificá que esté bien escrito.' });
        return null;
      }

      // Verificar que el usuario no sea ya miembro
      const { data: existing } = await supabase
        .from('family_members')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (existing) {
        set({ isJoining: false, error: 'Ya pertenecés a un grupo. Salí del actual para unirte a otro.' });
        return null;
      }

      // Validar rol según tipo de grupo
      if (group.group_type === 'couple' && role !== 'partner') {
        set({ isJoining: false, error: 'En modo pareja el rol debe ser "Pareja".' });
        return null;
      }

      // Insertar membresía
      const { error: memErr } = await supabase
        .from('family_members')
        .insert({ group_id: group.id, user_id: userId, role });

      if (memErr) {
        console.error('[familyGroupStore] joinGroup membership error:', memErr);
        set({ isJoining: false, error: 'No se pudo unir al grupo. Intentá de nuevo.' });
        return null;
      }

      set({ isJoining: false });
      await get().fetchGroup(userId);
      return { group };
    } catch (err) {
      console.error('[familyGroupStore] joinGroup error:', err);
      set({ isJoining: false, error: 'Error inesperado al unirse al grupo' });
      return null;
    }
  },

  // ── Crear transferencia interna ──────────────────────────────────────────────
  createTransfer: async ({ groupId, fromUserId, toUserId, amount, note, transferDate }) => {
    try {
      const { error } = await supabase.from('group_transfers').insert({
        group_id: groupId,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        amount,
        currency: 'ARS',
        note: note ?? null,
        transfer_date: transferDate ?? new Date().toISOString().split('T')[0],
      });

      if (error) {
        console.error('[familyGroupStore] createTransfer error:', error);
        return false;
      }

      await get().fetchTransfers(groupId, fromUserId);
      return true;
    } catch (err) {
      console.error('[familyGroupStore] createTransfer exception:', err);
      return false;
    }
  },

  // ── Salir del grupo ──────────────────────────────────────────────────────────
  leaveGroup: async (userId: string) => {
    try {
      const { myMembership } = get();
      if (!myMembership) return false;

      const { error } = await supabase
        .from('family_members')
        .delete()
        .eq('user_id', userId);

      if (error) {
        console.error('[familyGroupStore] leaveGroup error:', error);
        return false;
      }

      get().reset();
      return true;
    } catch (err) {
      console.error('[familyGroupStore] leaveGroup exception:', err);
      return false;
    }
  },

  // ── Helpers de permisos ──────────────────────────────────────────────────────

  isAdult: () => {
    const { myMembership } = get();
    if (!myMembership) return false;
    return ADULT_ROLES_CONST.includes(myMembership.role as any);
  },

  isOwner: (userId: string) => {
    const { group } = get();
    return group?.owner_id === userId;
  },

  /**
   * Determina si el usuario `myUserId` puede ver los gastos de `targetUserId`.
   * Reglas:
   * - Siempre puede verse a sí mismo.
   * - Adultos (parent, guardian, other_adult) pueden ver hijos.
   * - En modo pareja, ambos partners se ven entre sí.
   * - Hijos NO ven gastos de adultos.
   */
  canSeeExpensesOf: (targetUserId: string, myUserId: string) => {
    if (targetUserId === myUserId) return true;

    const { group, myMembership, members } = get();
    if (!group || !myMembership) return false;

    const myRole = myMembership.role;
    const targetMember = members.find(m => m.user_id === targetUserId);
    if (!targetMember) return false;

    const targetRole = targetMember.role;

    // Pareja: visibilidad mutua
    if (group.group_type === 'couple') {
      return myRole === 'partner' && targetRole === 'partner';
    }

    // Familia: adultos ven hijos, hijos no ven adultos
    const iAmAdult = ADULT_ROLES_CONST.includes(myRole as any);
    const theyAreChild = targetRole === 'child';
    return iAmAdult && theyAreChild;
  },

  // ── Reset ────────────────────────────────────────────────────────────────────
  reset: () => set(initialState),
  clearError: () => set({ error: null }),
}));
