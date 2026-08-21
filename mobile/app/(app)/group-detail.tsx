import React, { useState, useEffect, useCallback } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Modal, TextInput,
  KeyboardAvoidingView, Platform, Linking, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text, FormSheetModal, FormSheetButton } from '@/components/ui';
import { CategoryIcon } from '@/components/CategoryIcon';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';
import { hapticLight, hapticMedium, hapticSuccess } from '@/lib/haptics';
import { matchDebt } from '@/lib/debtMatcher';

const { width: SW } = Dimensions.get('window');

// ─── Tokens ───────────────────────────────────────────────────────────────────

const C = {
  bg:       '#FAFAF7',
  surface:  '#F5F1E9',
  cream:    '#F2E8D5',
  white:    '#FFFFFF',
  green:    '#27AE60',
  accent:   '#D1F7E3',
  text:     '#1C1C1C',
  text2:    '#6D6A63',
  muted:    '#9B9790',
  border:   '#E8E2D9',
  red:      '#EF4444',
  redLt:    '#FEE2E2',
  orange:   '#F59E0B',
  orangeLt: '#FFFBEB',
  card:     '#FFFFFF',
} as const;

const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

const GROUP_COLORS  = ['#27AE60', '#F59E0B', '#10B981', '#2E7D32', '#EF4444', '#EC4899'];
const AVATAR_COLORS = ['#27AE60', '#e63946', '#2d6a4f', '#f4a261', '#F59E0B', '#10B981'];

function hashIdx(str: string, len: number): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
  return Math.abs(h) % len;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

type FriendsTab = 'inicio' | 'gastos' | 'resumen' | 'ranking';
type FamilyTab  = 'resumen' | 'gastos';
type Tab        = FriendsTab | FamilyTab;
type MemberRole = 'Admin' | 'Miembro';
type GroupKind  = 'familiar' | 'amigos';

interface MemberPermissions {
  can_view_expenses: boolean;
  can_add_expenses:  boolean;
  can_view_members:  boolean;
  can_invite:        boolean;
  can_manage_roles:  boolean;
}

const DEFAULT_PERMS: MemberPermissions = {
  can_view_expenses: true,
  can_add_expenses:  true,
  can_view_members:  true,
  can_invite:        false,
  can_manage_roles:  false,
};

interface MemberDetail {
  userId:       string;
  name:         string;
  email:        string;
  initial:      string;
  color:        string;
  role:         MemberRole;
  monthTotal:   number;
  isMe:         boolean;
  permissions:  MemberPermissions;
  expenseCount:  number;
  pendingCount:  number;
  topCategory:   string;
}

interface GroupExpense {
  id:             string;
  amount:         number;
  date:           string;
  description:    string;
  paidByName:     string;
  paidById:       string;
  icon:           string;
  iconBg:         string;
  iconColor:      string;
  participantCount: number;
  splitType:      string;
}

interface PersonalExpense {
  id:            string;
  amount:        number;
  date:          string;
  description:   string;
  categoryName:  string;
  categoryIcon:  string | null;
  categoryColor: string | null;
}

interface DebtEntry {
  fromUserId:   string;
  fromName:     string;
  fromInitial:  string;
  fromColor:    string;
  toUserId:     string;
  toName:       string;
  amount:       number;
  isMe:         boolean;
  iOweThem:     boolean;
}

interface GroupDetail {
  id:           string;
  name:         string;
  kind:         GroupKind;
  inviteCode:   string;
  groupColor:   string;
  myRole:       MemberRole;
  members:      MemberDetail[];
  totalMonth:   number;
  myMonthTotal: number;
  expenses:     GroupExpense[];
  debts:        DebtEntry[];
}

interface FetchResult extends GroupDetail {
  rawExpenses: { id: string; paid_by: string }[];
  rawSplits:   { group_expense_id: string; user_id: string; amount: number; settled: boolean; settle_requested_at: string | null }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapRole(dbRole: string): MemberRole {
  return dbRole === 'parent' || dbRole === 'partner' || dbRole === 'admin' ? 'Admin' : 'Miembro';
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

function shortMonthLabel(): string {
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const d = new Date();
  return months[d.getMonth()];
}

function dateLabel(dateStr: string): string {
  const today     = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  if (dateStr === today)     return 'Hoy';
  if (dateStr === yesterday) return 'Ayer';
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function daysAgo(dateStr: string): number {
  const today = new Date().toISOString().split('T')[0];
  return Math.max(0, Math.floor(
    (new Date(today + 'T00:00:00').getTime() - new Date(dateStr + 'T00:00:00').getTime()) / 86400000
  ));
}

function daysAgoLabel(days: number): string {
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  return `Hace ${days} días`;
}

function expenseIcon(desc: string): { icon: string; iconBg: string; iconColor: string } {
  const d = (desc ?? '').toLowerCase();
  if (d.includes('super') || d.includes('mercado') || d.includes('carrefour') || d.includes('coto'))
    return { icon: 'cart-outline',       iconBg: '#D1F7E3', iconColor: '#16A34A' };
  if (d.includes('restau') || d.includes('cena') || d.includes('comida') || d.includes('pizza') || d.includes('sushi'))
    return { icon: 'restaurant-outline', iconBg: '#FEF3C7', iconColor: '#D97706' };
  if (d.includes('internet') || d.includes('wifi'))
    return { icon: 'wifi-outline',       iconBg: '#DBEAFE', iconColor: '#2563EB' };
  if (d.includes('luz') || d.includes('electric'))
    return { icon: 'flash-outline',      iconBg: '#FEF9C3', iconColor: '#CA8A04' };
  if (d.includes('nafta') || d.includes('combustible') || d.includes('uber') || d.includes('taxi'))
    return { icon: 'car-outline',        iconBg: '#FCE7F3', iconColor: '#9D174D' };
  if (d.includes('viaje') || d.includes('vuelo') || d.includes('hotel'))
    return { icon: 'airplane-outline',   iconBg: '#E0F2FE', iconColor: '#0369A1' };
  if (d.includes('boliche') || d.includes('bar') || d.includes('birra') || d.includes('trago'))
    return { icon: 'beer-outline',       iconBg: '#FDE8D8', iconColor: '#C2410C' };
  return { icon: 'cash-outline', iconBg: '#F3F4F6', iconColor: '#6B7280' };
}

function expenseEmoji(desc: string): string {
  const d = (desc ?? '').toLowerCase();
  if (d.includes('comida') || d.includes('cena') || d.includes('almuerzo') || d.includes('restau') || d.includes('pizza') || d.includes('sushi')) return '🍔';
  if (d.includes('boliche') || d.includes('bar') || d.includes('birra') || d.includes('trago') || d.includes('salida')) return '🍻';
  if (d.includes('uber') || d.includes('taxi') || d.includes('nafta') || d.includes('transport')) return '🚕';
  if (d.includes('super') || d.includes('mercado') || d.includes('compra') || d.includes('carrefour')) return '🛒';
  if (d.includes('alquiler') || d.includes('hotel') || d.includes('airbnb') || d.includes('depto')) return '🏠';
  if (d.includes('viaje') || d.includes('vuelo') || d.includes('pasaje')) return '✈️';
  if (d.includes('cine') || d.includes('teatro') || d.includes('show')) return '🎬';
  if (d.includes('gym') || d.includes('deporte')) return '🏋️';
  if (d.includes('salud') || d.includes('farmacia') || d.includes('médico')) return '🩺';
  return '💸';
}

function guessCategory(desc: string): { name: string; emoji: string } {
  const d = (desc ?? '').toLowerCase();
  if (d.includes('comida') || d.includes('cena') || d.includes('restau') || d.includes('pizza') || d.includes('sushi') || d.includes('almuerzo')) return { name: 'Comida', emoji: '🍔' };
  if (d.includes('boliche') || d.includes('bar') || d.includes('birra') || d.includes('trago') || d.includes('salida') || d.includes('after')) return { name: 'Salidas', emoji: '🍻' };
  if (d.includes('uber') || d.includes('taxi') || d.includes('remis') || d.includes('nafta') || d.includes('transport') || d.includes('subte')) return { name: 'Transporte', emoji: '🚕' };
  if (d.includes('super') || d.includes('mercado') || d.includes('compra') || d.includes('carrefour') || d.includes('coto')) return { name: 'Compras', emoji: '🛍️' };
  if (d.includes('alquiler') || d.includes('hotel') || d.includes('airbnb')) return { name: 'Alojamiento', emoji: '🏠' };
  if (d.includes('viaje') || d.includes('vuelo') || d.includes('pasaje')) return { name: 'Viaje', emoji: '✈️' };
  return { name: 'Otros', emoji: '📦' };
}

function buildMemberName(full_name: string, email: string): string {
  const name = full_name?.trim();
  if (name) return name;
  if (email) return email.split('@')[0];
  return 'Usuario';
}

function oldestDebtDate(
  rawSplits: FetchResult['rawSplits'],
  rawExpenses: { id: string; paid_by: string }[],
  expenses: GroupExpense[],
  fromUserId: string,
  toUserId: string,
): string | null {
  const paidByMap: Record<string, string> = {};
  for (const e of rawExpenses) paidByMap[e.id] = e.paid_by;
  const expDateMap: Record<string, string> = {};
  for (const e of expenses) expDateMap[e.id] = e.date;
  let oldest: string | null = null;
  for (const split of rawSplits) {
    if (split.settled) continue;
    if (split.user_id !== fromUserId) continue;
    if (paidByMap[split.group_expense_id] !== toUserId) continue;
    const date = expDateMap[split.group_expense_id];
    if (date && (!oldest || date < oldest)) oldest = date;
  }
  return oldest;
}

type RankingEntry = { member: MemberDetail; settledCount: number; points: number };

function computeRanking(
  rawSplits: FetchResult['rawSplits'],
  rawExpenses: { id: string; paid_by: string }[],
  members: MemberDetail[],
): RankingEntry[] {
  const paidByMap: Record<string, string> = {};
  for (const e of rawExpenses) paidByMap[e.id] = e.paid_by;
  const settled: Record<string, number> = {};
  for (const m of members) settled[m.userId] = 0;
  for (const split of rawSplits) {
    const payer = paidByMap[split.group_expense_id];
    if (split.settled && split.user_id !== payer) {
      settled[split.user_id] = (settled[split.user_id] ?? 0) + 1;
    }
  }
  return members
    .map(m => ({ member: m, settledCount: settled[m.userId] ?? 0, points: (settled[m.userId] ?? 0) * 10 }))
    .sort((a, b) => b.points - a.points || b.settledCount - a.settledCount);
}

type ActivityEvent = {
  id: string;
  type: 'paid_debt' | 'created_expense' | 'unpaid';
  userId: string;
  userName: string;
  userColor: string;
  expenseDesc: string;
  amount: number;
  date: string;
  isMe: boolean;
};

function buildActivity(
  expenses: GroupExpense[],
  rawSplits: FetchResult['rawSplits'],
  rawExpenses: { id: string; paid_by: string }[],
  members: MemberDetail[],
  myUserId: string,
): ActivityEvent[] {
  const paidByMap: Record<string, string> = {};
  for (const e of rawExpenses) paidByMap[e.id] = e.paid_by;
  const today = new Date().toISOString().split('T')[0];
  const events: ActivityEvent[] = [];

  for (const expense of expenses) {
    const creator = members.find(m => m.userId === expense.paidById);
    if (creator) {
      events.push({
        id: `created-${expense.id}`,
        type: 'created_expense',
        userId: creator.userId,
        userName: creator.isMe ? 'Vos' : creator.name,
        userColor: creator.color,
        expenseDesc: expense.description,
        amount: expense.amount,
        date: expense.date,
        isMe: creator.userId === myUserId,
      });
    }
    const expSplits = rawSplits.filter(s => s.group_expense_id === expense.id);
    for (const split of expSplits) {
      if (split.settled && split.user_id !== expense.paidById) {
        const m = members.find(m => m.userId === split.user_id);
        if (m) {
          events.push({
            id: `settled-${expense.id}-${split.user_id}`,
            type: 'paid_debt',
            userId: m.userId,
            userName: m.isMe ? 'Vos' : m.name,
            userColor: m.color,
            expenseDesc: expense.description,
            amount: split.amount,
            date: expense.date,
            isMe: m.userId === myUserId,
          });
        }
      }
      if (!split.settled && split.user_id !== expense.paidById) {
        const days = daysAgo(expense.date);
        if (days >= 3) {
          const m = members.find(m => m.userId === split.user_id);
          if (m) {
            events.push({
              id: `unpaid-${expense.id}-${split.user_id}`,
              type: 'unpaid',
              userId: m.userId,
              userName: m.isMe ? 'Vos' : m.name,
              userColor: m.color,
              expenseDesc: expense.description,
              amount: split.amount,
              date: expense.date,
              isMe: m.userId === myUserId,
            });
          }
        }
      }
    }
  }
  return events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
}

// ─── Debt calculation ─────────────────────────────────────────────────────────

function computeDebts(
  splits: { group_expense_id: string; user_id: string; amount: number; settled: boolean }[],
  expenses: { id: string; paid_by: string }[],
  members: MemberDetail[],
  userId: string,
): DebtEntry[] {
  const net: Record<string, number> = {};
  for (const m of members) net[m.userId] = 0;
  const paidByMap: Record<string, string> = {};
  for (const e of expenses) paidByMap[e.id] = e.paid_by;
  for (const split of splits) {
    if (split.settled) continue;
    const payer = paidByMap[split.group_expense_id];
    if (!payer || payer === split.user_id) continue;
    net[payer]         = (net[payer] ?? 0) + split.amount;
    net[split.user_id] = (net[split.user_id] ?? 0) - split.amount;
  }
  const creditors = members.filter(m => (net[m.userId] ?? 0) > 0.01).sort((a, b) => net[b.userId] - net[a.userId]);
  const debtors   = members.filter(m => (net[m.userId] ?? 0) < -0.01).sort((a, b) => net[a.userId] - net[b.userId]);
  const debts: DebtEntry[] = [];
  const cred = creditors.map(m => ({ ...m, bal: net[m.userId] }));
  const debt = debtors.map(m => ({ ...m, bal: -net[m.userId] }));
  let ci = 0, di = 0;
  while (ci < cred.length && di < debt.length) {
    const amount = Math.min(cred[ci].bal, debt[di].bal);
    if (amount > 0.01) {
      debts.push({
        fromUserId:  debt[di].userId,
        fromName:    debt[di].isMe ? 'Vos' : debt[di].name,
        fromInitial: debt[di].initial,
        fromColor:   debt[di].color,
        toUserId:    cred[ci].userId,
        toName:      cred[ci].isMe ? 'vos' : cred[ci].name,
        amount,
        isMe: debt[di].userId === userId,
        iOweThem: debt[di].userId === userId,
      });
    }
    cred[ci].bal -= amount;
    debt[di].bal -= amount;
    if (cred[ci].bal < 0.01) ci++;
    if (debt[di].bal < 0.01) di++;
  }
  return debts;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchGroupDetail(groupId: string, userId: string): Promise<FetchResult | null> {
  const db = supabase as any;
  const { data: group, error: gErr } = await db
    .from('family_groups').select('id, name, group_type, invite_code').eq('id', groupId).single();
  if (gErr || !group) return null;

  const { data: membersRaw, error: mErr } = await db
    .from('family_members').select('user_id, role').eq('group_id', groupId);
  if (mErr || !membersRaw?.length) return null;

  const myMembership = membersRaw.find((m: any) => m.user_id === userId);
  if (!myMembership) return null;

  const myRole    = mapRole(myMembership.role);
  const isAdmin   = myRole === 'Admin';
  const isFriends = group.group_type === 'friends';

  const adminRoles   = ['parent', 'partner', 'admin'];
  const nonAdminIds: string[] = !isFriends
    ? membersRaw.filter((m: any) => !adminRoles.includes(m.role)).map((m: any) => m.user_id as string)
    : [];

  const [membersInfoResult, expResult, groupExpResult] = await Promise.all([
    db.rpc('get_group_members', { p_group_id: groupId }),
    !isFriends
      ? nonAdminIds.length > 0
        ? supabase.from('expenses')
            .select('id, user_id, amount, date, description, category_id, category:expense_categories(name_es, icon, color)')
            .in('user_id', isAdmin ? nonAdminIds : [userId])
            .gte('date', currentMonthStart())
            .is('deleted_at', null)
            .order('date', { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [] })
      : Promise.resolve({ data: [] }),
    isFriends
      ? db.from('group_expenses')
          .select('id, paid_by, description, amount, date, split_type')
          .eq('group_id', groupId)
          .order('date', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] }),
  ]);

  const membersInfoMap: Record<string, any> = {};
  for (const m of membersInfoResult.data ?? []) membersInfoMap[m.user_id] = m;

  const totals:    Record<string, number> = {};
  const expByUser: Record<string, any[]>  = {};
  if (!isFriends) {
    for (const e of (expResult.data as any[]) ?? []) {
      totals[e.user_id] = (totals[e.user_id] ?? 0) + Number(e.amount);
      if (!expByUser[e.user_id]) expByUser[e.user_id] = [];
      expByUser[e.user_id].push(e);
    }
  }

  const members: MemberDetail[] = membersRaw.map((m: any) => {
    const info        = membersInfoMap[m.user_id] ?? {};
    const name        = buildMemberName(info.full_name ?? '', info.email ?? '');
    const rawPerms    = info.permissions;
    const permissions: MemberPermissions =
      rawPerms && typeof rawPerms === 'object' ? { ...DEFAULT_PERMS, ...rawPerms } : DEFAULT_PERMS;
    const userExps     = expByUser[m.user_id] ?? [];
    const expenseCount = !isFriends ? userExps.length : 0;
    const pendingCount = !isFriends ? userExps.filter((e: any) => !e.category_id).length : 0;
    const catMap: Record<string, { name: string; total: number }> = {};
    for (const e of userExps) {
      if (!e.category_id) continue;
      const catId = e.category_id;
      const catName = (e.category as any)?.name_es ?? 'Sin categoría';
      if (!catMap[catId]) catMap[catId] = { name: catName, total: 0 };
      catMap[catId].total += Number(e.amount);
    }
    const topCat = Object.values(catMap).sort((a, b) => b.total - a.total)[0];
    return {
      userId:      m.user_id,
      name, email: info.email ?? '',
      initial:     name.charAt(0).toUpperCase(),
      color:       AVATAR_COLORS[hashIdx(m.user_id, AVATAR_COLORS.length)],
      role:        mapRole(m.role),
      monthTotal:  totals[m.user_id] ?? 0,
      isMe:        m.user_id === userId,
      permissions,
      expenseCount,
      pendingCount,
      topCategory: topCat?.name ?? '',
    };
  });

  const groupColor  = GROUP_COLORS[hashIdx(groupId, GROUP_COLORS.length)];
  const kind: GroupKind = isFriends ? 'amigos' : 'familiar';

  let rawExpenses: { id: string; paid_by: string }[] = [];
  let rawSplits:   { group_expense_id: string; user_id: string; amount: number; settled: boolean }[] = [];
  let debts: DebtEntry[] = [];
  let expenses: GroupExpense[] = [];

  if (isFriends) {
    rawExpenses = (groupExpResult.data ?? []).map((e: any) => ({ id: e.id, paid_by: e.paid_by }));
    const groupExpIds = rawExpenses.map(e => e.id);
    if (groupExpIds.length > 0) {
      const { data: splitsRaw } = await db
        .from('group_expense_splits').select('group_expense_id, user_id, amount, settled, settle_requested_at')
        .in('group_expense_id', groupExpIds);
      rawSplits = splitsRaw ?? [];
    }
    for (const e of groupExpResult.data ?? []) {
      totals[e.paid_by] = (totals[e.paid_by] ?? 0) + Number(e.amount);
    }
    for (const m of members) m.monthTotal = totals[m.userId] ?? 0;
    debts = computeDebts(rawSplits, rawExpenses, members, userId);
    const participantCountMap: Record<string, number> = {};
    for (const split of rawSplits) {
      participantCountMap[split.group_expense_id] = (participantCountMap[split.group_expense_id] ?? 0) + 1;
    }
    expenses = (groupExpResult.data ?? []).map((e: any) => {
      const payer = members.find(m => m.userId === e.paid_by);
      return {
        id: e.id, amount: Number(e.amount), date: e.date,
        description: e.description || 'Sin descripción',
        paidByName: payer?.isMe ? 'Vos' : (payer?.name ?? 'Miembro'),
        paidById: e.paid_by,
        participantCount: participantCountMap[e.id] ?? 0,
        splitType: e.split_type ?? 'equal',
        ...expenseIcon(e.description ?? ''),
      };
    });
  } else {
    expenses = (expResult.data ?? []).map((e: any) => {
      const payer = members.find(m => m.userId === e.user_id);
      return {
        id: e.id, amount: Number(e.amount), date: e.date,
        description: e.description || 'Sin descripción',
        paidByName: payer?.isMe ? 'Vos' : (payer?.name ?? 'Miembro'),
        paidById: e.user_id,
        participantCount: 0, splitType: 'equal',
        ...expenseIcon(e.description ?? ''),
      };
    });
  }

  const totalMonth   = members.reduce((s, m) => s + m.monthTotal, 0);
  const myMonthTotal = members.find(m => m.isMe)?.monthTotal ?? 0;

  return {
    id: group.id, name: group.name, kind, inviteCode: group.invite_code,
    groupColor, myRole, members, totalMonth, myMonthTotal, expenses, debts,
    rawExpenses, rawSplits,
  };
}

// ─── Debt matching ────────────────────────────────────────────────────────────

async function runDebtMatchingFor(
  data: FetchResult,
  userId: string,
  groupId: string,
): Promise<void> {
  const db = supabase as any;

  const { data: incomingTxs } = await db
    .from('pending_transactions')
    .select('id, amount, sender_name')
    .eq('user_id', userId)
    .eq('direction', 'incoming')
    .eq('status', 'pending');

  if (!incomingTxs?.length) return;

  const myExpenseIds = data.rawExpenses.filter(e => e.paid_by === userId).map(e => e.id);
  if (!myExpenseIds.length) return;

  const { data: splits } = await db
    .from('group_expense_splits')
    .select('id, user_id, amount')
    .in('group_expense_id', myExpenseIds)
    .eq('settled', false)
    .neq('user_id', userId);

  if (!splits?.length) return;

  const members    = data.members.map(m => ({ userId: m.userId, fullName: m.name }));
  const splitsMapped = splits.map((s: any) => ({
    id: s.id, amount: Number(s.amount), debtorUserId: s.user_id,
  }));

  for (const tx of incomingTxs) {
    const matches    = matchDebt(Number(tx.amount), tx.sender_name ?? null, members, splitsMapped);
    const isAmbiguous = matches.length > 1;
    for (const match of matches) {
      await db.from('debt_match_suggestions').upsert({
        user_id: userId, group_id: groupId,
        debtor_user_id: match.debtorUserId,
        split_ids: match.splitIds,
        debt_amount: match.debtAmount,
        matched_amount: match.matchedAmount,
        match_type: match.matchType,
        pending_tx_id: tx.id,
        is_ambiguous: isAmbiguous,
      }, { onConflict: 'pending_tx_id,group_id,debtor_user_id', ignoreDuplicates: true });
    }
  }
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, color, size = 44 }: { name: string; color: string; size?: number }) {
  return (
    <View style={[s.avatarBase, { width: size, height: size, borderRadius: size / 2, backgroundColor: color + '22' }]}>
      <Text style={[s.avatarInitial, { color, fontSize: size * 0.38 }]}>{name.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

type BadgeVariant = 'pending' | 'paid' | 'overdue' | 'owes';

function StatusBadge({ variant, label }: { variant: BadgeVariant; label?: string }) {
  const config: Record<BadgeVariant, { bg: string; color: string; text: string }> = {
    paid:    { bg: '#D1F7E3', color: '#027A48', text: 'Pagado'    },
    pending: { bg: '#FFFAEB', color: '#B54708', text: 'Pendiente' },
    overdue: { bg: '#FEF3F2', color: '#B42318', text: 'Atrasado'  },
    owes:    { bg: '#F0F2F5', color: '#1C1C1C', text: 'Debe'      },
  };
  const c = config[variant];
  return (
    <View style={[s.badge, { backgroundColor: c.bg }]}>
      <Text style={[s.badgeText, { color: c.color }]}>{label ?? c.text}</Text>
    </View>
  );
}

// ─── Modal: Editar miembro ────────────────────────────────────────────────────

const PERM_LABELS: { key: keyof MemberPermissions; label: string }[] = [
  { key: 'can_add_expenses',  label: 'Puede cargar gastos'     },
  { key: 'can_view_members',  label: 'Ver resumen de miembros' },
  { key: 'can_invite',        label: 'Invitar personas'        },
  { key: 'can_manage_roles',  label: 'Administrar roles'       },
];

function MemberEditModal({
  visible, member, groupId, allMembers, onClose, onSaved,
}: {
  visible: boolean; member: MemberDetail | null; groupId: string;
  allMembers: MemberDetail[]; onClose: () => void; onSaved: () => void;
}) {
  const [selectedRole, setSelectedRole] = useState<MemberRole>('Miembro');
  const [perms,        setPerms]        = useState<MemberPermissions>(DEFAULT_PERMS);
  const [saving,       setSaving]       = useState(false);

  useEffect(() => {
    if (member) { setSelectedRole(member.role); setPerms({ ...DEFAULT_PERMS, ...member.permissions }); }
  }, [member]);

  const handleSave = async () => {
    if (!member) return;
    if (selectedRole === 'Miembro' && member.role === 'Admin') {
      const otherAdmins = allMembers.filter(m => m.role === 'Admin' && m.userId !== member.userId);
      if (otherAdmins.length === 0) {
        Alert.alert('El grupo debe tener al menos un Admin');
        return;
      }
    }
    setSaving(true);
    try {
      const db = supabase as any;
      const dbRole = selectedRole === 'Admin' ? 'admin' : 'member';
      if (selectedRole !== member.role) {
        const { error: e1 } = await db.rpc('update_member_role', {
          p_group_id: groupId, p_user_id: member.userId, p_role: dbRole,
        });
        if (e1) throw e1;
      }
      const { error: e2 } = await db.rpc('update_member_permissions', {
        p_group_id: groupId, p_user_id: member.userId, p_permissions: perms,
      });
      if (e2) throw e2;
      onClose(); onSaved();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'No se pudo guardar.');
    } finally { setSaving(false); }
  };

  if (!member) return null;

  return (
    <FormSheetModal visible={visible} title="Editar miembro" onClose={onClose} presentationStyle="formSheet">
      <View style={{ alignItems: 'center', gap: sp.sm }}>
        <Avatar name={member.name} color={member.color} size={72} />
        <Text style={s.editName}>{member.name}</Text>
        {member.email ? <Text style={s.editEmail}>{member.email}</Text> : null}
      </View>
      <View style={{ gap: sp.md }}>
        <Text style={s.sectionLabel}>ROL EN EL GRUPO</Text>
        {([
          { role: 'Miembro' as MemberRole, desc: 'Puede ver su información y los gastos que el admin permita.' },
          { role: 'Admin'   as MemberRole, desc: 'Puede ver los gastos de todos los miembros y administrar el grupo.' },
        ]).map(({ role, desc }) => (
          <TouchableOpacity
            key={role}
            style={[s.radioRow, selectedRole === role && { borderColor: C.green + '80', backgroundColor: C.accent }]}
            onPress={() => setSelectedRole(role)} activeOpacity={0.8}
          >
            <View style={[s.radioCircle, selectedRole === role && { borderColor: C.green }]}>
              {selectedRole === role && <View style={[s.radioDot, { backgroundColor: C.green }]} />}
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[s.radioTitle, selectedRole === role && { color: C.green }]}>{role}</Text>
              <Text style={s.radioDesc}>{desc}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ gap: sp.md }}>
        <Text style={s.sectionLabel}>PERMISOS ADICIONALES</Text>
        <View style={s.card}>
          {PERM_LABELS.map((p, i) => (
            <View key={p.key}>
              {i > 0 && <View style={s.divider} />}
              <TouchableOpacity style={s.checkRow} onPress={() => setPerms(prev => ({ ...prev, [p.key]: !prev[p.key] }))} activeOpacity={0.8}>
                <View style={[s.checkbox, perms[p.key] && { backgroundColor: C.green, borderColor: C.green }]}>
                  {perms[p.key] && <Ionicons name="checkmark" size={13} color={C.white} />}
                </View>
                <Text style={s.checkLabel}>{p.label}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </View>
      <FormSheetButton label="Guardar cambios" color={C.green} loading={saving} onPress={handleSave} />
    </FormSheetModal>
  );
}

// ─── Modal: Agregar gasto compartido ─────────────────────────────────────────

type AddExpenseStep = 'source' | 'pick' | 'form' | 'details' | 'confirm';
type SplitMode      = 'equal' | 'custom';

function AddExpenseModal({
  visible, onClose, members, groupId, userId, onSaved,
}: {
  visible: boolean; onClose: () => void; members: MemberDetail[];
  groupId: string; userId: string; onSaved: () => void;
}) {
  const [step,             setStep]           = useState<AddExpenseStep>('source');
  const [source,           setSource]         = useState<'manual' | 'existing'>('manual');
  const [personalExpenses, setPersonalExpenses] = useState<PersonalExpense[]>([]);
  const [loadingExp,       setLoadingExp]     = useState(false);
  const [expSearch,        setExpSearch]      = useState('');
  const [selectedExpId,    setSelectedExpId]  = useState<string | null>(null);
  const [description,      setDescription]   = useState('');
  const [amountStr,        setAmountStr]      = useState('');
  const [dateStr,          setDateStr]        = useState(new Date().toISOString().split('T')[0]);
  const [paidById,         setPaidById]       = useState(userId);
  const [splitMode,        setSplitMode]      = useState<SplitMode>('equal');
  const [included,         setIncluded]       = useState<Set<string>>(new Set(members.map(m => m.userId)));
  const [customAmounts,    setCustomAmounts]  = useState<Record<string, string>>({});
  const [saving,           setSaving]         = useState(false);
  const [savedExpense,     setSavedExpense]   = useState<{ description: string; amount: number; paidByName: string; count: number } | null>(null);

  const reset = useCallback(() => {
    setStep('source'); setSource('manual'); setPersonalExpenses([]); setExpSearch('');
    setSelectedExpId(null); setDescription(''); setAmountStr('');
    setDateStr(new Date().toISOString().split('T')[0]);
    setPaidById(userId); setSplitMode('equal'); setCustomAmounts({});
    setIncluded(new Set(members.map(m => m.userId)));
    setSaving(false); setSavedExpense(null);
  }, [userId, members]);

  useEffect(() => { if (!visible) reset(); }, [visible, reset]);

  const loadPersonalExpenses = async () => {
    setLoadingExp(true);
    try {
      const since = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
      const { data } = await (supabase as any)
        .from('expenses')
        .select('id, amount, date, description, category_id, category:expense_categories(name_es, icon, color)')
        .eq('user_id', userId).gte('date', since).is('deleted_at', null)
        .order('date', { ascending: false }).limit(100);
      setPersonalExpenses((data ?? []).map((e: any) => ({
        id: e.id, amount: Number(e.amount), date: e.date,
        description: e.description || 'Sin descripción',
        categoryName: (e.category as any)?.name_es ?? 'Sin clasificar',
        categoryIcon: (e.category as any)?.icon ?? null,
        categoryColor: (e.category as any)?.color ?? null,
      })));
    } finally { setLoadingExp(false); }
  };

  const handleContinueSource = () => {
    if (source === 'existing') { setStep('pick'); loadPersonalExpenses(); }
    else setStep('form');
  };

  const handleSelectExpense = (exp: PersonalExpense) => {
    setSelectedExpId(exp.id); setDescription(exp.description);
    setAmountStr(String(exp.amount)); setDateStr(exp.date);
  };

  const handleContinuePick = () => {
    if (!selectedExpId) { Alert.alert('Seleccioná un gasto para continuar.'); return; }
    setStep('details');
  };

  const handleContinueForm = () => {
    const amt = parseFloat(amountStr.replace(',', '.'));
    if (!description.trim() || isNaN(amt) || amt <= 0) {
      Alert.alert('Completá la descripción y el monto.'); return;
    }
    setStep('details');
  };

  const handleSave = async () => {
    const amount = parseFloat(amountStr.replace(',', '.'));
    const participantes = members.filter(m => included.has(m.userId));
    if (participantes.length === 0) { Alert.alert('Seleccioná al menos un participante.'); return; }
    if (splitMode === 'custom') {
      const ct = participantes.reduce(
        (s, m) => s + (parseFloat((customAmounts[m.userId] || '0').replace(',', '.')) || 0), 0
      );
      if (Math.abs(ct - amount) >= 0.5) {
        Alert.alert('Los montos no cuadran', `Asignado: ${formatCurrency(ct)} / Total: ${formatCurrency(amount)}`);
        return;
      }
    }
    setSaving(true);
    try {
      const db = supabase as any;
      if (source === 'existing' && selectedExpId) {
        const { data: existing } = await db.from('group_expenses').select('id')
          .eq('group_id', groupId).eq('source_expense_id', selectedExpId).maybeSingle();
        if (existing) { Alert.alert('Gasto ya compartido', 'Este gasto ya fue compartido en este grupo.'); setSaving(false); return; }
      }
      const insertData: any = {
        group_id: groupId, paid_by: paidById, description: description.trim(),
        amount, date: dateStr, split_type: splitMode, created_by: userId,
      };
      if (source === 'existing' && selectedExpId) insertData.source_expense_id = selectedExpId;
      const { data: expense, error: e1 } = await db.from('group_expenses').insert(insertData).select().single();
      if (e1) throw e1;
      const splits = participantes.map(m => {
        const amt = splitMode === 'custom'
          ? parseFloat((customAmounts[m.userId] || '0').replace(',', '.')) || 0
          : parseFloat((amount / participantes.length).toFixed(2));
        return { group_expense_id: expense.id, user_id: m.userId, amount: amt, settled: m.userId === paidById };
      });
      const { error: e2 } = await db.from('group_expense_splits').insert(splits);
      if (e2) throw e2;
      const payer = members.find(m => m.userId === paidById);
      setSavedExpense({
        description: description.trim(), amount,
        paidByName: payer?.isMe ? 'Vos' : (payer?.name ?? 'Miembro'),
        count: participantes.length,
      });
      setStep('confirm');
      onSaved();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'No se pudo guardar el gasto.');
    } finally { setSaving(false); }
  };

  const handleBack = () => {
    if (step === 'pick' || step === 'form') setStep('source');
    else if (step === 'details') setStep(source === 'existing' ? 'pick' : 'form');
  };

  const filteredExpenses = expSearch.trim()
    ? personalExpenses.filter(e =>
        e.description.toLowerCase().includes(expSearch.toLowerCase()) ||
        e.categoryName.toLowerCase().includes(expSearch.toLowerCase())
      )
    : personalExpenses;

  const totalAmt        = parseFloat(amountStr.replace(',', '.')) || 0;
  const includedMembers = members.filter(m => included.has(m.userId));
  const customTotal     = includedMembers.reduce(
    (s, m) => s + (parseFloat((customAmounts[m.userId] || '0').replace(',', '.')) || 0), 0
  );
  const isCustomValid   = splitMode === 'equal' || Math.abs(customTotal - totalAmt) < 0.5;

  const stepTitle: Record<AddExpenseStep, string> = {
    source: 'Agregar gasto compartido', pick: 'Elegir de mis gastos',
    form: 'Crear gasto manual', details: 'Detalles del gasto', confirm: 'Gasto compartido',
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet"
      onRequestClose={step === 'confirm' ? () => { reset(); onClose(); } : onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <SafeAreaView style={s.modal} edges={['top', 'bottom']}>
          <View style={s.modalHeader}>
            {step === 'confirm' ? <View style={{ width: 22 }} /> : (
              <TouchableOpacity onPress={step === 'source' ? onClose : handleBack}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name={step === 'source' ? 'close' : 'arrow-back'} size={22} color={C.muted} />
              </TouchableOpacity>
            )}
            <Text style={s.modalTitle}>{stepTitle[step]}</Text>
            <View style={{ width: 22 }} />
          </View>

          {step === 'source' && (
            <ScrollView contentContainerStyle={[s.modalBody, { gap: sp.xl }]} keyboardShouldPersistTaps="handled">
              <Text style={s.sectionLabel}>¿QUÉ GASTO QUERÉS COMPARTIR?</Text>
              {([
                { val: 'existing' as const, title: 'Elegir de mis gastos', sub: 'Seleccioná un gasto existente y compartilo con el grupo.', icon: 'receipt-outline' },
                { val: 'manual'   as const, title: 'Crear gasto manual',   sub: 'Ingresá un gasto nuevo para compartir.',                  icon: 'create-outline'  },
              ]).map(opt => (
                <TouchableOpacity key={opt.val}
                  style={[s.sourceCard, source === opt.val && { borderColor: C.green, backgroundColor: C.accent }]}
                  onPress={() => setSource(opt.val)} activeOpacity={0.8}>
                  <View style={[s.sourceIcon, { backgroundColor: source === opt.val ? C.green + '18' : C.bg }]}>
                    <Ionicons name={opt.icon as any} size={22} color={source === opt.val ? C.green : C.muted} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={[s.radioTitle, source === opt.val && { color: C.green }]}>{opt.title}</Text>
                    <Text style={s.radioDesc}>{opt.sub}</Text>
                  </View>
                  <View style={[s.radioCircle, source === opt.val && { borderColor: C.green }]}>
                    {source === opt.val && <View style={[s.radioDot, { backgroundColor: C.green }]} />}
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={s.purpleBtn} onPress={handleContinueSource} activeOpacity={0.85}>
                <Text style={s.purpleBtnText}>Continuar</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {step === 'pick' && (
            <>
              <View style={{ paddingHorizontal: sp.xl, paddingTop: sp.md, paddingBottom: sp.sm }}>
                <View style={s.searchBox}>
                  <Ionicons name="search-outline" size={16} color={C.muted} />
                  <TextInput style={s.searchInput} value={expSearch} onChangeText={setExpSearch}
                    placeholder="Buscar gasto..." placeholderTextColor={C.muted} />
                  {expSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setExpSearch('')}>
                      <Ionicons name="close-circle" size={16} color={C.muted} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              {loadingExp ? (
                <View style={s.centered}><ActivityIndicator color={C.green} /></View>
              ) : (
                <ScrollView contentContainerStyle={{ paddingHorizontal: sp.xl, paddingBottom: 120, gap: sp.sm }} keyboardShouldPersistTaps="handled">
                  {filteredExpenses.length === 0 ? (
                    <View style={[s.emptyBox, { marginTop: sp.xxl }]}>
                      <Ionicons name="receipt-outline" size={36} color={C.border} />
                      <Text style={s.emptyTitle}>{expSearch ? 'Sin resultados' : 'Sin gastos recientes'}</Text>
                    </View>
                  ) : filteredExpenses.map(exp => {
                    const isSelected = selectedExpId === exp.id;
                    const ic = expenseIcon(exp.description);
                    return (
                      <TouchableOpacity key={exp.id}
                        style={[s.pickExpRow, isSelected && { borderColor: C.green, backgroundColor: C.accent }]}
                        onPress={() => handleSelectExpense(exp)} activeOpacity={0.8}>
                        <View style={[s.expIconSm, { backgroundColor: exp.categoryColor ? exp.categoryColor + '20' : ic.iconBg }]}>
                          <Ionicons name={(exp.categoryIcon ?? ic.icon) as any} size={18} color={exp.categoryColor ?? ic.iconColor} />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={s.expName} numberOfLines={1}>{exp.description}</Text>
                          <Text style={s.expMeta}>{dateLabel(exp.date)} · {exp.categoryName}</Text>
                        </View>
                        <Text style={[s.expAmt, isSelected && { color: C.green }]}>{formatCurrency(exp.amount)}</Text>
                        <View style={[s.radioCircle, { marginLeft: sp.sm }, isSelected && { borderColor: C.green }]}>
                          {isSelected && <View style={[s.radioDot, { backgroundColor: C.green }]} />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity style={s.createManualRow}
                    onPress={() => { setSource('manual'); setStep('form'); }} activeOpacity={0.8}>
                    <Ionicons name="create-outline" size={17} color={C.green} />
                    <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.green, flex: 1 }}>Crear gasto manual</Text>
                    <Ionicons name="chevron-forward" size={15} color={C.green} />
                  </TouchableOpacity>
                </ScrollView>
              )}
              <View style={{ padding: sp.xl, paddingTop: sp.md }}>
                <TouchableOpacity style={[s.purpleBtn, !selectedExpId && { opacity: 0.4 }]}
                  onPress={handleContinuePick} disabled={!selectedExpId} activeOpacity={0.85}>
                  <Text style={s.purpleBtnText}>Continuar</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === 'form' && (
            <ScrollView contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">
              {[
                { label: 'DESCRIPCIÓN', value: description, setter: setDescription, placeholder: 'Ej: Cena en el restorán', keyboard: 'default' as const, autoFocus: true },
                { label: 'MONTO TOTAL (ARS)', value: amountStr, setter: setAmountStr, placeholder: '$ 0', keyboard: 'decimal-pad' as const, autoFocus: false },
                { label: 'FECHA', value: dateStr, setter: setDateStr, placeholder: 'YYYY-MM-DD', keyboard: 'numbers-and-punctuation' as const, autoFocus: false },
              ].map(f => (
                <View key={f.label} style={{ gap: sp.sm }}>
                  <Text style={s.sectionLabel}>{f.label}</Text>
                  <TextInput style={s.textInput} value={f.value} onChangeText={f.setter}
                    placeholder={f.placeholder} placeholderTextColor={C.muted}
                    keyboardType={f.keyboard} autoFocus={f.autoFocus} autoCapitalize="sentences" />
                </View>
              ))}
              <TouchableOpacity style={[s.purpleBtn, (!description.trim() || !amountStr) && { opacity: 0.4 }]}
                onPress={handleContinueForm} disabled={!description.trim() || !amountStr} activeOpacity={0.85}>
                <Text style={s.purpleBtnText}>Continuar</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {step === 'details' && (
            <ScrollView contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">
              <View style={s.miniExpCard}>
                <Text style={{ fontSize: 28 }}>{expenseEmoji(description)}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.expName} numberOfLines={1}>{description || 'Sin descripción'}</Text>
                  <Text style={s.expMeta}>{dateStr}</Text>
                </View>
                <Text style={s.expAmt}>{formatCurrency(parseFloat(amountStr.replace(',', '.')) || 0)}</Text>
              </View>
              <View style={{ gap: sp.md }}>
                <Text style={s.sectionLabel}>¿QUIÉN PAGÓ?</Text>
                <View style={s.card}>
                  {members.map((m, i) => (
                    <View key={m.userId}>
                      {i > 0 && <View style={s.divider} />}
                      <TouchableOpacity style={s.payerRow} onPress={() => setPaidById(m.userId)} activeOpacity={0.8}>
                        <Avatar name={m.name} color={m.color} size={36} />
                        <Text style={s.payerName}>{m.isMe ? `${m.name} (vos)` : m.name}</Text>
                        {paidById === m.userId && <Ionicons name="checkmark-circle" size={22} color={C.green} />}
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
              <View style={{ gap: sp.md }}>
                <Text style={s.sectionLabel}>¿ENTRE QUIÉNES SE DIVIDE?</Text>
                <View style={s.avatarRow}>
                  {members.map(m => {
                    const isIn = included.has(m.userId);
                    return (
                      <TouchableOpacity key={m.userId}
                        onPress={() => setIncluded(prev => {
                          const next = new Set(prev);
                          if (next.has(m.userId)) next.delete(m.userId); else next.add(m.userId);
                          return next;
                        })}
                        activeOpacity={0.8} style={{ alignItems: 'center', gap: sp.xs }}>
                        <View style={[
                          s.avatarBase,
                          { width: 52, height: 52, borderRadius: 26, backgroundColor: m.color + '22' },
                          isIn && { borderWidth: 2.5, borderColor: C.green },
                          !isIn && { opacity: 0.35 },
                        ]}>
                          {isIn && (
                            <View style={{ position: 'absolute', bottom: -3, right: -3, backgroundColor: C.green, borderRadius: 9, width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.white }}>
                              <Ionicons name="checkmark" size={11} color={C.white} />
                            </View>
                          )}
                          <Text style={[s.avatarInitial, { color: m.color, fontSize: 20 }]}>{m.initial}</Text>
                        </View>
                        <Text style={{ fontFamily: 'Montserrat_500Medium', fontSize: 10, color: isIn ? C.text : C.muted }}>
                          {m.isMe ? 'Vos' : m.name.split(' ')[0]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <View style={{ gap: sp.md }}>
                <Text style={s.sectionLabel}>¿CÓMO SE DIVIDE?</Text>
                {([
                  { val: 'equal' as SplitMode, label: 'Partes iguales', desc: `${formatCurrency(totalAmt / Math.max(included.size, 1))} c/u` },
                  { val: 'custom' as SplitMode, label: 'Personalizado', desc: 'Definir montos diferentes por persona' },
                ]).map(opt => (
                  <TouchableOpacity key={opt.val}
                    style={[s.radioRow, splitMode === opt.val && { borderColor: C.green + '80', backgroundColor: C.accent }]}
                    onPress={() => setSplitMode(opt.val)} activeOpacity={0.8}>
                    <View style={[s.radioCircle, splitMode === opt.val && { borderColor: C.green }]}>
                      {splitMode === opt.val && <View style={[s.radioDot, { backgroundColor: C.green }]} />}
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[s.radioTitle, splitMode === opt.val && { color: C.green }]}>{opt.label}</Text>
                      <Text style={s.radioDesc}>{opt.desc}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
              {splitMode === 'custom' && (
                <View style={{ gap: sp.md }}>
                  <Text style={s.sectionLabel}>MONTOS POR PERSONA</Text>
                  {includedMembers.map(m => (
                    <View key={m.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                      <Avatar name={m.name} color={m.color} size={34} />
                      <Text style={[s.payerName, { flex: 1 }]}>{m.isMe ? 'Vos' : m.name.split(' ')[0]}</Text>
                      <TextInput
                        style={[s.textInput, { width: 130, textAlign: 'right', paddingVertical: sp.sm }]}
                        value={customAmounts[m.userId] ?? ''}
                        onChangeText={v => setCustomAmounts(prev => ({ ...prev, [m.userId]: v }))}
                        placeholder="$ 0" placeholderTextColor={C.muted} keyboardType="decimal-pad"
                      />
                    </View>
                  ))}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: sp.xs }}>
                    {isCustomValid
                      ? <><Ionicons name="checkmark-circle" size={15} color={C.green} /><Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: C.green }}>Montos completos</Text></>
                      : totalAmt - customTotal > 0
                        ? <Text style={{ fontFamily: 'Montserrat_500Medium', fontSize: 12, color: C.orange }}>Faltan {formatCurrency(totalAmt - customTotal)}</Text>
                        : <Text style={{ fontFamily: 'Montserrat_500Medium', fontSize: 12, color: C.red }}>Te pasaste por {formatCurrency(customTotal - totalAmt)}</Text>
                    }
                  </View>
                </View>
              )}
              <TouchableOpacity
                style={[s.purpleBtn, (saving || included.size === 0 || !isCustomValid) && { opacity: 0.4 }]}
                onPress={handleSave} disabled={saving || included.size === 0 || !isCustomValid} activeOpacity={0.85}>
                {saving ? <ActivityIndicator color={C.white} size="small" /> : <Text style={s.purpleBtnText}>Guardar gasto</Text>}
              </TouchableOpacity>
            </ScrollView>
          )}

          {step === 'confirm' && savedExpense && (
            <ScrollView contentContainerStyle={[s.modalBody, { alignItems: 'center', paddingTop: sp.xxl }]}>
              <Text style={{ fontSize: 64 }}>✅</Text>
              <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 22, color: C.text, textAlign: 'center', marginTop: sp.md }}>¡Gasto compartido!</Text>
              <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 14, color: C.muted, textAlign: 'center' }}>El gasto se agregó correctamente al grupo.</Text>
              <View style={[s.card, { width: '100%', marginTop: sp.xl }]}>
                <View style={{ padding: sp.lg, gap: sp.md }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={[s.expName, { flex: 1 }]} numberOfLines={1}>{savedExpense.description}</Text>
                    <Text style={[s.expAmt, { color: C.green }]}>{formatCurrency(savedExpense.amount)}</Text>
                  </View>
                  <View style={s.divider} />
                  {[
                    { label: 'Pagó', value: savedExpense.paidByName },
                    { label: 'Personas', value: String(savedExpense.count) },
                    { label: 'Por persona', value: formatCurrency(savedExpense.amount / savedExpense.count) },
                  ].map(row => (
                    <View key={row.label} style={{ flexDirection: 'row', gap: sp.sm }}>
                      <Text style={s.radioDesc}>{row.label}:</Text>
                      <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: C.text }}>{row.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <TouchableOpacity style={[s.purpleBtn, { width: '100%', marginTop: sp.xl }]}
                onPress={() => { reset(); onClose(); }} activeOpacity={0.85}>
                <Text style={s.purpleBtnText}>Ver en el grupo</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Modal: Detalle de gasto (rediseñado) ────────────────────────────────────

function ExpenseDetailModal({
  visible, expense, splits, members, myUserId, onClose, onRefresh,
}: {
  visible: boolean; expense: GroupExpense | null;
  splits: FetchResult['rawSplits']; members: MemberDetail[];
  myUserId: string; onClose: () => void; onRefresh: () => void;
}) {
  const [settling, setSettling] = useState<string | null>(null);
  if (!expense) return null;
  const expSplits = splits.filter(sp => sp.group_expense_id === expense.id);
  const perPerson = expense.participantCount > 0 ? expense.amount / expense.participantCount : expense.amount;

  // Creditor manually confirms a specific split as settled (also used to confirm a debtor request)
  const handleSettle = async (splitUserId: string) => {
    setSettling(splitUserId);
    try {
      const { error } = await (supabase as any)
        .from('group_expense_splits')
        .update({ settled: true, settled_at: new Date().toISOString(), settle_requested_at: null })
        .eq('group_expense_id', expense.id)
        .eq('user_id', splitUserId);
      if (error) throw error;
      hapticSuccess();
      onRefresh(); onClose();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'No se pudo saldar.');
    } finally { setSettling(null); }
  };

  // Debtor signals they paid — sets settle_requested_at, waits for creditor confirmation
  const handleRequestSettle = async (splitUserId: string) => {
    setSettling(splitUserId);
    try {
      const { error } = await (supabase as any)
        .from('group_expense_splits')
        .update({ settle_requested_at: new Date().toISOString() })
        .eq('group_expense_id', expense.id)
        .eq('user_id', splitUserId);
      if (error) throw error;
      hapticMedium();
      Alert.alert(
        '¡Aviso enviado!',
        'Cuando la otra persona entre al grupo, podrá confirmar que recibió el pago.',
        [{ text: 'Entendido', onPress: () => { onRefresh(); onClose(); } }],
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'No se pudo enviar el aviso.');
    } finally { setSettling(null); }
  };

  // Creditor rejects the debtor's request — clears settle_requested_at
  const handleRejectSettle = async (splitUserId: string) => {
    setSettling(splitUserId);
    try {
      const { error } = await (supabase as any)
        .from('group_expense_splits')
        .update({ settle_requested_at: null })
        .eq('group_expense_id', expense.id)
        .eq('user_id', splitUserId);
      if (error) throw error;
      hapticMedium();
      onRefresh(); onClose();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'No se pudo rechazar.');
    } finally { setSettling(null); }
  };

  return (
    <FormSheetModal
      visible={visible}
      title="Detalle del gasto"
      onClose={onClose}
      presentationStyle="formSheet"
      backgroundColor={C.bg}
      contentContainerStyle={{ padding: 0, gap: 0 }}
    >
      {(
        <>
          {/* Hero */}
          <View style={{ backgroundColor: C.white, alignItems: 'center', paddingVertical: sp.xxl, paddingHorizontal: sp.xl, gap: sp.md }}>
            <View style={s.expEmojiBox}>
              <CategoryIcon description={expense.description} size={64} />
            </View>
            <Text style={s.detailTitle} numberOfLines={2}>{expense.description}</Text>
            <Text style={s.detailAmount}>{formatCurrency(expense.amount)}</Text>
            <Text style={s.detailDate}>{dateLabel(expense.date)}</Text>
          </View>

          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.lg, gap: sp.lg }}>
            {/* Quién pagó */}
            <View style={s.card}>
              <View style={{ padding: sp.lg, gap: sp.sm }}>
                <Text style={s.sectionLabel}>PAGÓ</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 16, color: C.text }}>{expense.paidByName}</Text>
                  {expSplits.length > 0 && (
                    <Text style={s.expMeta}>
                      Dividido entre {expSplits.length} · {formatCurrency(perPerson)} c/u
                    </Text>
                  )}
                </View>
              </View>
            </View>

            {/* ¿Quién pagó? — participantes */}
            <View style={{ gap: sp.sm }}>
              <Text style={s.sectionLabel}>PARTICIPANTES</Text>
              <View style={s.card}>
                {expSplits.map((split, i) => {
                  const member       = members.find(m => m.userId === split.user_id);
                  const isPayer      = split.user_id === expense.paidById;
                  const isMe         = split.user_id === myUserId;
                  const iAmPayer     = expense.paidById === myUserId;
                  const hasPending   = !!split.settle_requested_at;
                  const days         = daysAgo(expense.date);

                  // What button to show:
                  // - Creditor + debtor sent request  → Confirmar + Rechazar
                  // - Creditor + no request           → Saldar (manual)
                  // - Debtor + no request             → Avisé que pagué
                  // - Debtor + request sent           → "Esperando confirmación" (disabled)
                  const canConfirm        = iAmPayer && !split.settled && !isPayer && hasPending;
                  const canManualSettle   = iAmPayer && !split.settled && !isPayer && !hasPending;
                  const canRequestSettle  = isMe && !isPayer && !split.settled && !hasPending;
                  const waitingConfirm    = isMe && !isPayer && !split.settled && hasPending;

                  let variant: BadgeVariant;
                  if (isPayer || split.settled) variant = 'paid';
                  else if (hasPending) variant = 'pending';
                  else if (days >= 7) variant = 'overdue';
                  else variant = 'pending';

                  const label = isPayer ? 'Pagado'
                    : split.settled  ? 'Pagado'
                    : hasPending     ? 'En revisión'
                    : days >= 7      ? 'Atrasado'
                    : 'Pendiente';

                  return (
                    <View key={split.user_id}>
                      {i > 0 && <View style={s.divider} />}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg }}>
                        <Avatar name={member?.name ?? '?'} color={member?.color ?? C.muted} size={40} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.memberName}>{member?.isMe ? 'Vos' : (member?.name ?? 'Miembro')}</Text>
                          <Text style={s.expMeta}>{formatCurrency(split.amount)}</Text>
                        </View>
                        <StatusBadge variant={variant} label={label} />
                      </View>

                      {/* Action buttons — below the row */}
                      {(canConfirm || canManualSettle || canRequestSettle || waitingConfirm) && (
                        <View style={{ flexDirection: 'row', gap: sp.sm, paddingHorizontal: sp.lg, paddingBottom: sp.md }}>
                          {canConfirm && (
                            <>
                              <TouchableOpacity
                                style={{ flex: 1, backgroundColor: C.green, borderRadius: 8, paddingVertical: 7, alignItems: 'center' }}
                                onPress={() => handleSettle(split.user_id)}
                                disabled={settling === split.user_id}
                              >
                                {settling === split.user_id
                                  ? <ActivityIndicator size="small" color={C.white} />
                                  : <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 12, color: C.white }}>✓ Confirmar</Text>
                                }
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={{ flex: 1, backgroundColor: C.redLt, borderRadius: 8, paddingVertical: 7, alignItems: 'center', borderWidth: 1, borderColor: C.red + '40' }}
                                onPress={() => handleRejectSettle(split.user_id)}
                                disabled={settling === split.user_id}
                              >
                                <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: C.red }}>✕ No recibí</Text>
                              </TouchableOpacity>
                            </>
                          )}
                          {canManualSettle && (
                            <TouchableOpacity
                              style={{ backgroundColor: C.green, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}
                              onPress={() => handleSettle(split.user_id)}
                              disabled={settling === split.user_id}
                            >
                              {settling === split.user_id
                                ? <ActivityIndicator size="small" color={C.white} />
                                : <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: C.white }}>Saldar</Text>
                              }
                            </TouchableOpacity>
                          )}
                          {canRequestSettle && (
                            <TouchableOpacity
                              style={{ flex: 1, backgroundColor: C.orange + '18', borderRadius: 8, paddingVertical: 7, alignItems: 'center', borderWidth: 1, borderColor: C.orange + '50' }}
                              onPress={() => handleRequestSettle(split.user_id)}
                              disabled={settling === split.user_id}
                            >
                              {settling === split.user_id
                                ? <ActivityIndicator size="small" color={C.orange} />
                                : <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: C.orange }}>Ya pagué 💸</Text>
                              }
                            </TouchableOpacity>
                          )}
                          {waitingConfirm && (
                            <View style={{ flex: 1, backgroundColor: C.border, borderRadius: 8, paddingVertical: 7, alignItems: 'center' }}>
                              <Text style={{ fontFamily: 'Montserrat_500Medium', fontSize: 12, color: C.muted }}>Esperando confirmación…</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Botones */}
            <View style={{ flexDirection: 'row', gap: sp.md }}>
              <TouchableOpacity style={[s.outlineBtn, { flex: 1 }]} onPress={onClose} activeOpacity={0.8}>
                <Text style={s.outlineBtnText}>Cerrar</Text>
              </TouchableOpacity>
              {expense.paidById === myUserId && expSplits.some(s => !s.settled && s.user_id !== myUserId) && (
                <TouchableOpacity style={[s.purpleBtn, { flex: 1 }]} onPress={onClose} activeOpacity={0.85}>
                  <Text style={s.purpleBtnText}>Recordar pendientes</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </>
      )}
    </FormSheetModal>
  );
}

// ─── Sheet: Perfil de miembro ─────────────────────────────────────────────────

function MemberProfileSheet({
  visible, member, myUserId, debts, expenses, rawSplits, rawExpenses,
  onClose, onRemind,
}: {
  visible: boolean; member: MemberDetail | null; myUserId: string;
  debts: DebtEntry[]; expenses: GroupExpense[];
  rawSplits: FetchResult['rawSplits']; rawExpenses: { id: string; paid_by: string }[];
  onClose: () => void; onRemind: (member: MemberDetail) => void;
}) {
  if (!member) return null;

  const debt      = debts.find(d => d.fromUserId === member.userId && d.toUserId === myUserId);
  const iOweThem  = debts.find(d => d.fromUserId === myUserId && d.toUserId === member.userId);
  const debtAmt   = debt?.amount ?? 0;
  const iOweAmt   = iOweThem?.amount ?? 0;
  const hasDebt   = debtAmt > 0.01;
  const iOwe      = iOweAmt > 0.01;

  const paidByMap: Record<string, string> = {};
  for (const e of rawExpenses) paidByMap[e.id] = e.paid_by;

  // Shared expenses (both have splits)
  const myExpIds    = new Set(rawSplits.filter(s => s.user_id === myUserId).map(s => s.group_expense_id));
  const theirExpIds = new Set(rawSplits.filter(s => s.user_id === member.userId).map(s => s.group_expense_id));
  const sharedIds   = [...myExpIds].filter(id => theirExpIds.has(id));
  const sharedExps  = expenses.filter(e => sharedIds.includes(e.id)).slice(0, 5);

  const gastosJuntos = sharedExps.reduce((s, e) => s + e.amount, 0);
  const memberPaid   = sharedExps.filter(e => e.paidById === member.userId).reduce((s, e) => s + e.amount, 0);

  const oldestDate  = hasDebt
    ? oldestDebtDate(rawSplits, rawExpenses, expenses, member.userId, myUserId)
    : iOwe
      ? oldestDebtDate(rawSplits, rawExpenses, expenses, myUserId, member.userId)
      : null;
  const days = oldestDate ? daysAgo(oldestDate) : 0;

  const badgeLabel = hasDebt ? 'Te debe' : iOwe ? 'Le debés' : 'Al día';
  const badgeColor = hasDebt ? C.green : iOwe ? C.red : C.muted;
  const badgeBg    = hasDebt ? C.accent : iOwe ? C.redLt : C.bg;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={[s.modal, { backgroundColor: C.bg }]} edges={['top', 'bottom']}>
        <View style={[s.modalHeader, { backgroundColor: C.white }]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={22} color={C.muted} />
          </TouchableOpacity>
          <Text style={s.modalTitle}>{member.name.split(' ')[0]}</Text>
          <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="ellipsis-horizontal" size={22} color={C.muted} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* Hero */}
          <View style={{ backgroundColor: C.white, alignItems: 'center', paddingVertical: sp.xxl, gap: sp.md }}>
            <Avatar name={member.name} color={member.color} size={80} />
            <View style={[s.badge, { backgroundColor: badgeBg }]}>
              <Text style={[s.badgeText, { color: badgeColor, fontSize: 12 }]}>{badgeLabel}</Text>
            </View>
            {(hasDebt || iOwe) && (
              <>
                <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 34, color: hasDebt ? C.green : C.red, letterSpacing: -1 }}>
                  {formatCurrency(hasDebt ? debtAmt : iOweAmt)}
                </Text>
                {oldestDate && (
                  <Text style={s.expMeta}>
                    Pendiente desde el {dateLabel(oldestDate)}
                  </Text>
                )}
                {days >= 1 && (
                  <View style={[s.badge, { backgroundColor: C.orangeLt }]}>
                    <Text style={[s.badgeText, { color: C.orange }]}>⏰ {daysAgoLabel(days)}</Text>
                  </View>
                )}
              </>
            )}
            {!hasDebt && !iOwe && (
              <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 24, color: C.green }}>Al día ✓</Text>
            )}
          </View>

          <View style={{ paddingHorizontal: sp.lg, gap: sp.lg, paddingTop: sp.lg }}>
            {/* Resumen con esta persona */}
            <View style={{ gap: sp.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={s.sectionLabel}>RESUMEN CON {member.name.split(' ')[0].toUpperCase()}</Text>
                <Text style={s.mutedSmall}>Este mes</Text>
              </View>
              <View style={s.card}>
                <View style={{ flexDirection: 'row', padding: sp.lg, gap: sp.md }}>
                  {[
                    { label: 'Gastos juntos', value: formatCurrency(gastosJuntos), color: C.text },
                    { label: 'Pagó', value: formatCurrency(memberPaid), color: C.green },
                    { label: 'Debe', value: formatCurrency(debtAmt), color: debtAmt > 0 ? C.red : C.muted },
                  ].map((col, i) => (
                    <View key={col.label} style={{ flex: 1, alignItems: i === 1 ? 'center' : i === 2 ? 'flex-end' : 'flex-start', gap: 3 }}>
                      <Text style={s.summaryLabel}>{col.label}</Text>
                      <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 15, color: col.color }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{col.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            {/* Últimos gastos juntos */}
            {sharedExps.length > 0 && (
              <View style={{ gap: sp.sm }}>
                <Text style={s.sectionLabel}>ÚLTIMOS GASTOS JUNTOS</Text>
                <View style={s.card}>
                  {sharedExps.map((exp, i) => {
                    const mySplit    = rawSplits.find(s => s.group_expense_id === exp.id && s.user_id === myUserId);
                    const theirSplit = rawSplits.find(s => s.group_expense_id === exp.id && s.user_id === member.userId);
                    const isSettled  = theirSplit?.settled || mySplit?.settled || exp.paidById === member.userId;
                    return (
                      <View key={exp.id}>
                        {i > 0 && <View style={s.divider} />}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg }}>
                          <CategoryIcon description={exp.description} size={36} />
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={s.expName} numberOfLines={1}>{exp.description}</Text>
                            <Text style={s.expMeta}>{dateLabel(exp.date)} · Pagó {exp.paidByName}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end', gap: 4 }}>
                            <Text style={s.expAmt}>{formatCurrency(exp.amount)}</Text>
                            <StatusBadge variant={isSettled ? 'paid' : 'pending'} />
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Botones */}
            <TouchableOpacity
              style={s.remindBtn}
              onPress={() => { hapticMedium(); onRemind(member); }}
              activeOpacity={0.85}>
              <Ionicons name="logo-whatsapp" size={18} color={C.green} />
              <Text style={s.remindBtnText}>Recordar a {member.name.split(' ')[0]}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={{ alignItems: 'center', paddingVertical: sp.md }} activeOpacity={0.7}>
              <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.green }}>
                Ver historial completo →
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Modal: Recordar ──────────────────────────────────────────────────────────

type RemindTone = 'amigable' | 'directo' | 'divertido';

const TONE_CONFIG: { val: RemindTone; emoji: string; label: string; desc: string }[] = [
  { val: 'amigable',  emoji: '😊', label: 'Amigable',  desc: 'Cercano y considerado'  },
  { val: 'directo',   emoji: '🫡', label: 'Directo',   desc: 'Claro y al grano'       },
  { val: 'divertido', emoji: '😎', label: 'Divertido', desc: 'Con humor y buena onda' },
];

function buildMessage(tone: RemindTone, name: string, amount: string, description: string): string {
  const first = name.split(' ')[0];
  switch (tone) {
    case 'amigable':
      return `Hola ${first} 👋\nSolo paso a recordarte que quedaron pendientes ${amount} de "${description}".\n\nGracias 🙌`;
    case 'directo':
      return `Hola ${first}, te aviso que tenés pendiente ${amount} de "${description}". ¿Cuándo podés resolverlo?`;
    case 'divertido':
      return `Ey ${first} 😎 ¿te acordás de los ${amount} de "${description}"? El cartel de "te pago después" ya venció 😅 Avisame cuando puedas!`;
  }
}

function RecordarModal({
  visible, member, debtAmount, debtDescription, onClose,
}: {
  visible: boolean; member: MemberDetail | null;
  debtAmount: number; debtDescription: string;
  onClose: () => void;
}) {
  const [tone,    setTone]    = useState<RemindTone>('amigable');
  const [step,    setStep]    = useState<'tone' | 'preview'>('tone');
  const [sending, setSending] = useState(false);

  useEffect(() => { if (!visible) { setStep('tone'); setTone('amigable'); } }, [visible]);

  if (!member) return null;

  const message = buildMessage(tone, member.name, formatCurrency(debtAmount), debtDescription);

  const handleSend = async () => {
    setSending(true);
    const url = `whatsapp://send?text=${encodeURIComponent(message)}`;
    const fallback = `https://wa.me/?text=${encodeURIComponent(message)}`;
    try {
      const can = await Linking.canOpenURL(url);
      await Linking.openURL(can ? url : fallback);
    } catch {
      await Linking.openURL(fallback);
    } finally { setSending(false); onClose(); }
  };

  return (
    <FormSheetModal
      visible={visible}
      title={step === 'tone' ? `Recordar a ${member.name.split(' ')[0]}` : 'Mensaje para ' + member.name.split(' ')[0]}
      onClose={onClose}
      onBack={step === 'preview' ? () => setStep('tone') : undefined}
      presentationStyle="formSheet"
      backgroundColor={C.bg}
    >
      {step === 'tone' && (
        <>
          <Text style={s.sectionLabel}>ELEGÍ EL TONO DEL MENSAJE</Text>
          <View style={{ flexDirection: 'row', gap: sp.md }}>
            {TONE_CONFIG.map(t => (
              <TouchableOpacity
                key={t.val}
                style={[s.toneCard, tone === t.val && { borderColor: C.green, backgroundColor: C.accent }]}
                onPress={() => { setTone(t.val); hapticLight(); }} activeOpacity={0.8}>
                <Text style={{ fontSize: 26 }}>{t.emoji}</Text>
                <Text style={[s.toneName, tone === t.val && { color: C.green }]}>{t.label}</Text>
                <Text style={s.toneDesc}>{t.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <FormSheetButton
            label="Generar mensaje"
            color="#25D366"
            icon="logo-whatsapp"
            onPress={() => setStep('preview')}
          />
        </>
      )}

      {step === 'preview' && (
        <>
          <Text style={s.sectionLabel}>VISTA PREVIA</Text>
          <View style={s.waBubbleContainer}>
            <View style={s.waBubble}>
              <Text style={s.waBubbleText}>{message}</Text>
              <Text style={s.waBubbleTime}>11:30 ✓✓</Text>
            </View>
          </View>
          <FormSheetButton
            label="Enviar por WhatsApp"
            color={C.green}
            icon="logo-whatsapp"
            loading={sending}
            onPress={handleSend}
          />
        </>
      )}
    </FormSheetModal>
  );
}

// ─── DebtMatchBanner ─────────────────────────────────────────────────────────

function DebtMatchBanner({
  suggestion, members, onConfirm, onDismiss,
}: {
  suggestion: any;
  members: MemberDetail[];
  onConfirm: (s: any) => void;
  onDismiss: (s: any) => void;
}) {
  const debtor      = members.find(m => m.userId === suggestion.debtor_user_id);
  const debtorName  = debtor?.name ?? 'Alguien';
  const matchedAmt  = formatCurrency(suggestion.matched_amount);
  const debtAmt     = formatCurrency(suggestion.debt_amount);
  const dateStr     = (suggestion.created_at ?? '').split('T')[0];
  const dateDisplay = dateStr ? dateLabel(dateStr) : '';

  let actionLabel: string;
  let noteText: string;
  if (suggestion.match_type === 'exact') {
    noteText    = 'Monto exacto — coincide con la deuda';
    actionLabel = 'Confirmar y saldar';
  } else if (suggestion.match_type === 'partial') {
    noteText    = `Pago parcial (${matchedAmt} de ${debtAmt})`;
    actionLabel = 'Confirmar pago parcial';
  } else {
    noteText    = `Recibiste más que la deuda (deuda: ${debtAmt})`;
    actionLabel = 'Confirmar y saldar igual';
  }

  return (
    <View style={dmb.wrap}>
      <View style={dmb.row}>
        <View style={dmb.iconWrap}>
          <Ionicons name="cash-outline" size={18} color="#27AE60" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={dmb.title}>Pago detectado</Text>
          <Text style={dmb.sub}>
            Recibiste {matchedAmt} de {debtorName}{dateDisplay ? ` · ${dateDisplay}` : ''}
          </Text>
        </View>
      </View>
      <Text style={dmb.note}>{noteText}</Text>
      <Text style={dmb.question}>¿Esto cancela su deuda en el grupo?</Text>
      <View style={dmb.actions}>
        <TouchableOpacity
          style={dmb.confirmBtn}
          onPress={() => { hapticSuccess(); onConfirm(suggestion); }}
          activeOpacity={0.85}>
          <Ionicons name="checkmark" size={15} color="#FFF" />
          <Text style={dmb.confirmText}>{actionLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={dmb.dismissBtn}
          onPress={() => { hapticLight(); onDismiss(suggestion); }}
          activeOpacity={0.7}>
          <Text style={dmb.dismissText}>No es esto</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── AmbiguousDebtMatchBanner ────────────────────────────────────────────────

function AmbiguousDebtMatchBanner({
  suggestions, members, onConfirm, onDismissAll,
}: {
  suggestions: any[];
  members: MemberDetail[];
  onConfirm: (s: any) => void;
  onDismissAll: (pendingTxId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const first       = suggestions[0];
  const matchedAmt  = formatCurrency(first.matched_amount);
  const senderMember = first.sender_name
    ? members.find(m => m.name.toLowerCase().includes((first.sender_name ?? '').toLowerCase()))
    : null;
  const senderLabel = senderMember?.name ?? first.sender_name ?? null;
  const dateStr     = (first.created_at ?? '').split('T')[0];
  const dateDisplay = dateStr ? dateLabel(dateStr) : '';

  const selected = suggestions.find(s => s.id === selectedId) ?? null;

  return (
    <View style={dmb.wrap}>
      <View style={dmb.row}>
        <View style={dmb.iconWrap}>
          <Ionicons name="cash-outline" size={18} color="#27AE60" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={dmb.title}>Pago detectado</Text>
          <Text style={dmb.sub}>
            Recibiste {matchedAmt}{senderLabel ? ` de ${senderLabel}` : ''}{dateDisplay ? ` · ${dateDisplay}` : ''}
          </Text>
        </View>
      </View>

      <Text style={dmb.question}>
        Encontramos varias deudas posibles. ¿A cuál corresponde este pago?
      </Text>

      <View style={{ gap: sp.sm }}>
        {suggestions.map(sg => {
          const debtor   = members.find(m => m.userId === sg.debtor_user_id);
          const name     = debtor?.name ?? 'Alguien';
          const amt      = formatCurrency(sg.debt_amount);
          const isSelected = sg.id === selectedId;
          return (
            <TouchableOpacity
              key={sg.id}
              style={[dmb.radioRow, isSelected && dmb.radioRowActive]}
              onPress={() => { hapticLight(); setSelectedId(sg.id); }}
              activeOpacity={0.7}>
              <View style={[dmb.radioCircle, isSelected && dmb.radioCircleActive]}>
                {isSelected && <View style={dmb.radioDot} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[dmb.radioLabel, isSelected && { color: '#1C1C1C' }]} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={dmb.radioSub}>{amt}</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Ninguna de estas */}
        <TouchableOpacity
          style={[dmb.radioRow, selectedId === 'none' && dmb.radioRowActive]}
          onPress={() => { hapticLight(); setSelectedId('none'); }}
          activeOpacity={0.7}>
          <View style={[dmb.radioCircle, selectedId === 'none' && dmb.radioCircleActive]}>
            {selectedId === 'none' && <View style={dmb.radioDot} />}
          </View>
          <Text style={[dmb.radioLabel, selectedId === 'none' && { color: '#1C1C1C' }]}>
            Ninguna de estas
          </Text>
        </TouchableOpacity>
      </View>

      <View style={dmb.actions}>
        <TouchableOpacity
          style={[dmb.confirmBtn, !selectedId && { opacity: 0.45 }]}
          disabled={!selectedId}
          onPress={() => {
            if (!selectedId) return;
            hapticSuccess();
            if (selectedId === 'none') {
              onDismissAll(first.pending_tx_id);
            } else if (selected) {
              onConfirm(selected);
            }
          }}
          activeOpacity={0.85}>
          <Ionicons name="checkmark" size={15} color="#FFF" />
          <Text style={dmb.confirmText}>
            {selectedId === 'none' ? 'Descartar' : 'Confirmar y saldar'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Tab: Friends Inicio ──────────────────────────────────────────────────────

// ─── SettleConfirmBanner — shown to creditor when debtor marked as paid ──────

function SettleConfirmBanner({
  debtorName, amount, expenseDesc, onConfirm, onReject, loading,
}: {
  debtorName: string; amount: number; expenseDesc: string;
  onConfirm: () => void; onReject: () => void; loading: boolean;
}) {
  return (
    <View style={scb.wrap}>
      <View style={scb.header}>
        <View style={scb.iconWrap}>
          <Text style={{ fontSize: 20 }}>💸</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={scb.title}>{debtorName} avisó que pagó</Text>
          <Text style={scb.sub}>{expenseDesc} · {formatCurrency(amount)}</Text>
        </View>
      </View>
      <Text style={scb.question}>¿Confirmás que recibiste el pago?</Text>
      <View style={{ flexDirection: 'row', gap: sp.sm }}>
        <TouchableOpacity style={[scb.btn, scb.confirmBtn]} onPress={onConfirm} disabled={loading} activeOpacity={0.85}>
          {loading
            ? <ActivityIndicator size="small" color="#FFF" />
            : <Text style={scb.confirmText}>✓ Sí, lo recibí</Text>
          }
        </TouchableOpacity>
        <TouchableOpacity style={[scb.btn, scb.rejectBtn]} onPress={onReject} disabled={loading} activeOpacity={0.85}>
          <Text style={scb.rejectText}>✕ No llegó</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const scb = StyleSheet.create({
  wrap:       { backgroundColor: C.orangeLt, borderWidth: 1, borderColor: C.orange + '40', borderLeftWidth: 3, borderLeftColor: C.orange, borderRadius: 16, padding: sp.lg, gap: sp.md },
  header:     { flexDirection: 'row', alignItems: 'center', gap: sp.md },
  iconWrap:   { width: 40, height: 40, borderRadius: 20, backgroundColor: C.orange + '18', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title:      { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.text },
  sub:        { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted },
  question:   { fontFamily: 'Montserrat_500Medium', fontSize: 13, color: C.text2 },
  btn:        { flex: 1, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  confirmBtn: { backgroundColor: C.green },
  rejectBtn:  { backgroundColor: C.redLt, borderWidth: 1, borderColor: C.red + '40' },
  confirmText:{ fontFamily: 'Montserrat_700Bold', fontSize: 13, color: '#FFF' },
  rejectText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: C.red },
});

// ─── Tab: Friends Inicio ──────────────────────────────────────────────────────

function FriendsMainTab({
  detail, myUserId, onAddExpense, onMemberPress, onRemindAll,
  suggestions, onConfirmSuggestion, onDismissSuggestion, onDismissAllForTx,
  onRefresh,
}: {
  detail: FetchResult; myUserId: string;
  onAddExpense: () => void;
  onMemberPress: (m: MemberDetail) => void;
  onRemindAll: () => void;
  suggestions: any[];
  onConfirmSuggestion: (s: any) => void;
  onDismissSuggestion: (s: any) => void;
  onDismissAllForTx: (pendingTxId: string) => void;
  onRefresh: () => void;
}) {
  const owedToMe = detail.debts.filter(d => d.toUserId === myUserId);
  const myDebts  = detail.debts.filter(d => d.fromUserId === myUserId);
  const owedAmt  = owedToMe.reduce((s, d) => s + d.amount, 0);
  const iOweAmt  = myDebts.reduce((s, d) => s + d.amount, 0);

  const ranking = computeRanking(detail.rawSplits, detail.rawExpenses, detail.members);
  const myRank  = ranking.findIndex(r => r.member.isMe) + 1;
  const allSettled = detail.debts.length === 0;

  // Settle requests pending my confirmation (I'm the creditor)
  const paidByMeIds = new Set(detail.rawExpenses.filter(e => e.paid_by === myUserId).map(e => e.id));
  const pendingSettleRequests = detail.rawSplits.filter(
    sp => sp.settle_requested_at && !sp.settled && sp.user_id !== myUserId && paidByMeIds.has(sp.group_expense_id),
  );
  const [settlingRequest, setSettlingRequest] = useState<string | null>(null);

  const handleConfirmRequest = async (split: typeof detail.rawSplits[0]) => {
    setSettlingRequest(split.user_id + split.group_expense_id);
    try {
      const { error } = await (supabase as any)
        .from('group_expense_splits')
        .update({ settled: true, settled_at: new Date().toISOString(), settle_requested_at: null })
        .eq('group_expense_id', split.group_expense_id)
        .eq('user_id', split.user_id);
      if (error) throw error;
      hapticSuccess();
      onRefresh();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'No se pudo confirmar.');
    } finally { setSettlingRequest(null); }
  };

  const handleRejectRequest = async (split: typeof detail.rawSplits[0]) => {
    setSettlingRequest(split.user_id + split.group_expense_id);
    try {
      const { error } = await (supabase as any)
        .from('group_expense_splits')
        .update({ settle_requested_at: null })
        .eq('group_expense_id', split.group_expense_id)
        .eq('user_id', split.user_id);
      if (error) throw error;
      hapticMedium();
      onRefresh();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'No se pudo rechazar.');
    } finally { setSettlingRequest(null); }
  };

  const insight = (() => {
    if (allSettled && detail.expenses.length > 0)
      return { emoji: '🔥', title: '¡Todos al día!', sub: 'El grupo no tiene deudas pendientes.' };
    if (myRank === 1 && ranking[0]?.settledCount > 0)
      return { emoji: '🏆', title: '¡El más cumplidor!', sub: 'Sos quien más pagó a tiempo en el grupo.' };
    if (myRank === 2)
      return { emoji: '🏆', title: '¡Buen trabajo!', sub: 'Sos el 2° más cumplidor del grupo este mes.' };
    if (owedAmt > 0)
      return { emoji: '💸', title: 'Te deben plata', sub: `${formatCurrency(owedAmt)} en total de ${owedToMe.length} persona${owedToMe.length > 1 ? 's' : ''}.` };
    if (iOweAmt > 0)
      return { emoji: '👋', title: 'Tenés deudas pendientes', sub: `Debés ${formatCurrency(iOweAmt)} en el grupo.` };
    return { emoji: '👥', title: 'El grupo está activo', sub: `${detail.members.length} miembros compartiendo gastos.` };
  })();

  const otherMembers = detail.members.filter(m => !m.isMe);

  return (
    <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>

      {/* Summary card */}
      <View style={s.summaryCard}>
        <Text style={s.scMonthLabel}>Este mes</Text>
        <Text style={s.scTotal} numberOfLines={1}>{formatCurrency(detail.totalMonth)}</Text>
        <Text style={s.scTotalLabel}>Total compartido</Text>
        <View style={s.scDivider} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, gap: 4, marginRight: 8 }}>
            <Text style={s.summaryLabel}>Te deben</Text>
            <Text style={[s.scBalAmt, { color: C.green }]} numberOfLines={1}>{formatCurrency(owedAmt)}</Text>
          </View>
          <View style={{ width: 1, backgroundColor: C.border }} />
          <View style={{ flex: 1, gap: 4, alignItems: 'flex-end', marginLeft: 8 }}>
            <Text style={s.summaryLabel}>Debés</Text>
            <Text style={[s.scBalAmt, { color: C.red }]} numberOfLines={1}>{formatCurrency(iOweAmt)}</Text>
          </View>
        </View>
      </View>

      {/* Insight / Gamificación */}
      <View style={s.insightCard}>
        <Text style={{ fontSize: 28 }}>{insight.emoji}</Text>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.insightTitle}>{insight.title}</Text>
          <Text style={s.insightSub}>{insight.sub}</Text>
        </View>
      </View>

      {/* Confirmaciones de pago pendientes (yo soy el acreedor) */}
      {pendingSettleRequests.map(split => {
        const debtor   = detail.members.find(m => m.userId === split.user_id);
        const expense  = detail.expenses.find(e => e.id === split.group_expense_id);
        const key      = split.user_id + split.group_expense_id;
        return (
          <SettleConfirmBanner
            key={key}
            debtorName={debtor?.name ?? 'Alguien'}
            amount={split.amount}
            expenseDesc={expense?.description ?? 'Gasto compartido'}
            loading={settlingRequest === key}
            onConfirm={() => handleConfirmRequest(split)}
            onReject={() => handleRejectRequest(split)}
          />
        );
      })}

      {/* Sugerencias de pago de deudas — agrupadas por pending_tx_id */}
      {(() => {
        const groups = new Map<string, any[]>();
        for (const sg of suggestions) {
          const key = sg.pending_tx_id ?? sg.id;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(sg);
        }
        return Array.from(groups.entries()).map(([txId, group]) =>
          group.length > 1 ? (
            <AmbiguousDebtMatchBanner
              key={txId}
              suggestions={group}
              members={detail.members}
              onConfirm={onConfirmSuggestion}
              onDismissAll={onDismissAllForTx}
            />
          ) : (
            <DebtMatchBanner
              key={group[0].id}
              suggestion={group[0]}
              members={detail.members}
              onConfirm={onConfirmSuggestion}
              onDismiss={onDismissSuggestion}
            />
          )
        );
      })()}

      {/* Balances del grupo */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={s.sectionTitle}>Balances del grupo</Text>
        <TouchableOpacity activeOpacity={0.7}>
          <Text style={s.linkText}>Ver todo</Text>
        </TouchableOpacity>
      </View>

      <View style={s.card}>
        {otherMembers.map((member, i) => {
          const debt     = detail.debts.find(d => d.fromUserId === member.userId && d.toUserId === myUserId);
          const iOweThem = detail.debts.find(d => d.fromUserId === myUserId && d.toUserId === member.userId);
          let sub: string;
          let variant: BadgeVariant;

          if (debt) {
            const debtDate = oldestDebtDate(detail.rawSplits, detail.rawExpenses, detail.expenses, member.userId, myUserId);
            const days = debtDate ? daysAgo(debtDate) : 0;
            sub = `Te debe ${formatCurrency(debt.amount)}`;
            variant = days >= 7 ? 'overdue' : 'pending';
          } else if (iOweThem) {
            sub = `Vos le debés ${formatCurrency(iOweThem.amount)}`;
            variant = 'pending';
          } else {
            sub = 'Ya saldó';
            variant = 'paid';
          }

          return (
            <View key={member.userId}>
              {i > 0 && <View style={s.divider} />}
              <TouchableOpacity
                style={s.balanceRow}
                onPress={() => { hapticLight(); onMemberPress(member); }}
                activeOpacity={0.7}>
                <Avatar name={member.name} color={member.color} size={44} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.memberName}>{member.name}</Text>
                  <Text style={[s.memberMeta, { color: debt ? C.green : iOweThem ? C.red : C.muted }]}>{sub}</Text>
                </View>
                <StatusBadge variant={variant} />
              </TouchableOpacity>
            </View>
          );
        })}
        {otherMembers.length === 0 && (
          <View style={{ padding: sp.xl, alignItems: 'center', gap: sp.sm }}>
            <Text style={s.emptyTitle}>Sin otros miembros</Text>
          </View>
        )}
      </View>

      {/* Recordar a todos */}
      {detail.debts.some(d => d.toUserId === myUserId) && (
        <TouchableOpacity style={s.remindAllBtn} onPress={() => { hapticMedium(); onRemindAll(); }} activeOpacity={0.85}>
          <Ionicons name="paper-plane-outline" size={18} color={C.green} />
          <Text style={s.remindAllText}>Recordar a todos</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={s.purpleBtn} onPress={onAddExpense} activeOpacity={0.85}>
        <Ionicons name="add" size={20} color={C.white} />
        <Text style={s.purpleBtnText}>Agregar gasto compartido</Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

// ─── Tab: Friends Gastos ──────────────────────────────────────────────────────

function FriendsGastosTab({
  detail, onAddExpense, rawSplits, myUserId, onRefresh,
}: {
  detail: FetchResult; onAddExpense: () => void;
  rawSplits: FetchResult['rawSplits']; myUserId: string; onRefresh: () => void;
}) {
  const [selectedExpense, setSelectedExpense] = useState<GroupExpense | null>(null);
  const byDate: { date: string; label: string; items: GroupExpense[] }[] = [];
  for (const e of detail.expenses) {
    const last = byDate[byDate.length - 1];
    if (last && last.date === e.date) last.items.push(e);
    else byDate.push({ date: e.date, label: dateLabel(e.date), items: [e] });
  }
  return (
    <>
      <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={s.sectionTitle}>{monthLabel()}</Text>
          <TouchableOpacity style={s.addSmallBtn} onPress={onAddExpense} activeOpacity={0.8}>
            <Ionicons name="add" size={14} color={C.green} />
            <Text style={s.addSmallText}>Agregar</Text>
          </TouchableOpacity>
        </View>
        {detail.expenses.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={{ fontSize: 48 }}>🧾</Text>
            <Text style={s.emptyTitle}>Sin gastos todavía</Text>
            <Text style={s.emptySub}>Agregá el primer gasto compartido.</Text>
          </View>
        ) : byDate.map(group => (
          <View key={group.date} style={{ gap: sp.sm }}>
            <Text style={s.sectionLabel}>{group.label.toUpperCase()}</Text>
            <View style={s.card}>
              {group.items.map((e, i) => (
                <View key={e.id}>
                  {i > 0 && <View style={s.divider} />}
                  <TouchableOpacity onPress={() => { hapticLight(); setSelectedExpense(e); }} activeOpacity={0.75}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg }}>
                      <CategoryIcon description={e.description} size={40} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.expName} numberOfLines={1}>{e.description}</Text>
                        <Text style={s.expMeta}>{dateLabel(e.date)} · Pagó {e.paidByName}</Text>
                      </View>
                      <Text style={s.expAmt}>{formatCurrency(e.amount)}</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      <ExpenseDetailModal
        visible={selectedExpense !== null} expense={selectedExpense}
        splits={rawSplits} members={detail.members} myUserId={myUserId}
        onClose={() => setSelectedExpense(null)}
        onRefresh={() => { setSelectedExpense(null); onRefresh(); }}
      />
    </>
  );
}

// ─── Tab: Group Analytics ─────────────────────────────────────────────────────

function GroupAnalyticsTab({ detail }: { detail: FetchResult }) {
  const total = detail.totalMonth;
  const catMap: Record<string, { name: string; emoji: string; total: number }> = {};
  for (const e of detail.expenses) {
    const { name, emoji } = guessCategory(e.description);
    if (!catMap[name]) catMap[name] = { name, emoji, total: 0 };
    catMap[name].total += e.amount;
  }
  const cats   = Object.values(catMap).sort((a, b) => b.total - a.total).slice(0, 5);
  const topCat = cats[0];

  return (
    <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
      <View style={s.summaryCard}>
        <Text style={s.scMonthLabel}>Resumen del grupo · Este mes</Text>
        <Text style={s.scTotal}>{formatCurrency(total)}</Text>
        <Text style={s.scTotalLabel}>Total compartido</Text>
      </View>
      {cats.length > 0 ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={s.sectionTitle}>¿En qué gastaron más?</Text>
          </View>
          <View style={s.card}>
            {cats.map((cat, i) => {
              const pct = total > 0 ? cat.total / total : 0;
              return (
                <View key={cat.name}>
                  {i > 0 && <View style={s.divider} />}
                  <View style={{ paddingHorizontal: sp.lg, paddingVertical: sp.md, gap: sp.sm }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                      <Text style={{ fontSize: 20 }}>{cat.emoji}</Text>
                      <Text style={[s.memberName, { flex: 1 }]}>{cat.name}</Text>
                      <Text style={s.expAmt}>{formatCurrency(cat.total)}</Text>
                      <Text style={[s.mutedSmall, { width: 34, textAlign: 'right' }]}>{Math.round(pct * 100)}%</Text>
                    </View>
                    <View style={s.catBarBg}>
                      <View style={[s.catBarFill, { width: `${Math.round(pct * 100)}%` as any }]} />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
          {topCat && (
            <View style={s.insightCard}>
              <Text style={{ fontSize: 24 }}>{topCat.emoji}</Text>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={s.insightTitle}>El mayor gasto fue en {topCat.name}</Text>
                <Text style={s.insightSub}>
                  Representa el {total > 0 ? Math.round(topCat.total / total * 100) : 0}% del total del grupo.
                </Text>
              </View>
            </View>
          )}
        </>
      ) : (
        <View style={s.emptyBox}>
          <Text style={{ fontSize: 48 }}>📊</Text>
          <Text style={s.emptyTitle}>Sin datos todavía</Text>
          <Text style={s.emptySub}>Agregá gastos para ver el análisis del grupo.</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ─── Tab: Ranking ─────────────────────────────────────────────────────────────

function RankingTab({ detail }: { detail: FetchResult }) {
  const ranking = computeRanking(detail.rawSplits, detail.rawExpenses, detail.members);
  const improved = ranking.filter(r => r.settledCount > 0).length;
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={s.sectionTitle}>Ranking de cumplidores 🏆</Text>
        <Text style={s.mutedSmall}>Este mes</Text>
      </View>
      <View style={s.card}>
        {ranking.map((entry, i) => (
          <View key={entry.member.userId}>
            {i > 0 && <View style={s.divider} />}
            <View style={[s.rankRow, entry.member.isMe && { backgroundColor: C.accent }]}>
              <Text style={s.rankNumber}>{medals[i] ?? `${i + 1}`}</Text>
              <Avatar name={entry.member.name} color={entry.member.color} size={40} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[s.memberName, entry.member.isMe && { color: C.green }]}>
                  {entry.member.isMe ? 'Vos' : entry.member.name.split(' ')[0]}
                </Text>
                <Text style={s.memberMeta}>{entry.settledCount} {entry.settledCount === 1 ? 'pago' : 'pagos'} a tiempo</Text>
              </View>
              <View style={[s.badge, { backgroundColor: entry.points > 0 ? C.accent : C.bg }]}>
                <Text style={[s.badgeText, { color: entry.points > 0 ? C.green : C.muted }]}>+{entry.points} pts</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
      {improved > 0 && (
        <View style={s.insightCard}>
          <Text style={{ fontSize: 24 }}>⭐</Text>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.insightTitle}>¡Sigan así!</Text>
            <Text style={s.insightSub}>{improved} miembro{improved > 1 ? 's' : ''} pagó a tiempo este mes.</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ─── Tab: Family Resumen ──────────────────────────────────────────────────────

function FamilyResumenTab({ detail, isAdmin, onInvite, groupId }: {
  detail: GroupDetail; isAdmin: boolean;
  onInvite: () => void; groupId: string;
}) {
  const membersList  = detail.members.filter(m => m.role === 'Miembro');
  const membersTotal = membersList.reduce((s, m) => s + m.monthTotal, 0);

  const handleMemberPress = (m: MemberDetail) => {
    if (!isAdmin) return;
    router.push({
      pathname: '/(app)/member-detail',
      params: { userId: m.userId, groupId, memberName: m.name },
    } as any);
  };

  return (
    <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
      {isAdmin && (
        <View style={s.insightCard}>
          <Text style={{ fontSize: 24 }}>🛡️</Text>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.insightTitle}>Sos el admin</Text>
            <Text style={s.insightSub}>Podés ver los gastos de los miembros. Tus gastos no se comparten automáticamente.</Text>
          </View>
        </View>
      )}
      <View style={s.summaryCard}>
        <Text style={s.scMonthLabel}>Resumen del mes</Text>
        <Text style={s.scTotal}>{formatCurrency(membersTotal)}</Text>
        <Text style={s.scTotalLabel}>Total del grupo · {membersList.length} miembros</Text>
      </View>
      <Text style={s.sectionTitle}>Gastos por miembro</Text>
      {membersList.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={{ fontSize: 48 }}>👥</Text>
          <Text style={s.emptyTitle}>Sin miembros todavía</Text>
          <Text style={s.emptySub}>Invitá personas para ver sus gastos acá.</Text>
        </View>
      ) : (
        <View style={s.card}>
          {membersList.map((m, i) => (
            <View key={m.userId}>
              {i > 0 && <View style={s.divider} />}
              <TouchableOpacity style={s.balanceRow} onPress={() => handleMemberPress(m)} activeOpacity={isAdmin ? 0.7 : 1} disabled={!isAdmin}>
                <Avatar name={m.name} color={m.color} size={44} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.memberName} numberOfLines={1}>{m.isMe ? `Vos (${m.name})` : m.name}</Text>
                  <Text style={s.memberMeta}>{formatCurrency(m.monthTotal)} · {m.expenseCount} gastos</Text>
                  {m.pendingCount > 0 && (
                    <Text style={{ fontFamily: 'Montserrat_500Medium', fontSize: 11, color: C.orange }}>{m.pendingCount} sin clasificar</Text>
                  )}
                </View>
                {isAdmin && <Ionicons name="chevron-forward" size={16} color={C.muted} />}
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: sp.md, backgroundColor: '#D1F7E3', borderRadius: 14, padding: sp.lg }}>
        <Ionicons name="information-circle-outline" size={18} color={C.green} style={{ marginTop: 1 }} />
        <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 13, color: '#1C1C1C', flex: 1, lineHeight: 20 }}>
          Los miembros no cargan nada manualmente. Sus gastos se asocian automáticamente.
        </Text>
      </View>
      <TouchableOpacity style={s.purpleBtn} onPress={onInvite} activeOpacity={0.85}>
        <Ionicons name="add" size={20} color={C.white} />
        <Text style={s.purpleBtnText}>Agregar miembro</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Tab: Family Gastos ───────────────────────────────────────────────────────

function FamilyGastosTab({ detail }: { detail: GroupDetail }) {
  const byDate: { date: string; label: string; items: GroupExpense[] }[] = [];
  for (const e of detail.expenses) {
    const last = byDate[byDate.length - 1];
    if (last && last.date === e.date) last.items.push(e);
    else byDate.push({ date: e.date, label: dateLabel(e.date), items: [e] });
  }
  return (
    <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={s.sectionTitle}>{monthLabel()}</Text>
      {detail.expenses.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={{ fontSize: 48 }}>🧾</Text>
          <Text style={s.emptyTitle}>Sin gastos todavía</Text>
        </View>
      ) : byDate.map(group => (
        <View key={group.date} style={{ gap: sp.sm }}>
          <Text style={s.sectionLabel}>{group.label.toUpperCase()}</Text>
          <View style={s.card}>
            {group.items.map((e, i) => (
              <View key={e.id}>
                {i > 0 && <View style={s.divider} />}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg }}>
                  <CategoryIcon description={e.description} size={40} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.expName} numberOfLines={1}>{e.description}</Text>
                    <Text style={s.expMeta}>{dateLabel(e.date)} · {e.paidByName}</Text>
                  </View>
                  <Text style={s.expAmt}>{formatCurrency(e.amount)}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Tab: Miembros ────────────────────────────────────────────────────────────

function MiembrosTab({ detail, isAdmin, isFriends, onEdit, onInvite }: {
  detail: GroupDetail; isAdmin: boolean; isFriends: boolean;
  onEdit: (m: MemberDetail) => void; onInvite: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={s.sectionTitle}>Miembros del grupo</Text>
      <View style={s.card}>
        {detail.members.map((m, i) => {
          const canEdit = isAdmin && !m.isMe && !isFriends;
          return (
            <View key={m.userId}>
              {i > 0 && <View style={s.divider} />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg }}>
                <Avatar name={m.name} color={m.color} size={44} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.memberName} numberOfLines={1}>{m.isMe ? `Vos (${m.name})` : m.name}</Text>
                  {m.email ? <Text style={s.memberMeta} numberOfLines={1}>{m.email}</Text> : null}
                </View>
                {!isFriends && (
                  <View style={[s.badge, { backgroundColor: C.accent }]}>
                    <Text style={[s.badgeText, { color: C.green }]}>{m.role}</Text>
                  </View>
                )}
                {canEdit && (
                  <TouchableOpacity onPress={() => onEdit(m)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
                    <Ionicons name="ellipsis-horizontal" size={20} color={C.muted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </View>
      <TouchableOpacity style={s.remindAllBtn} onPress={onInvite} activeOpacity={0.85}>
        <Ionicons name="enter-outline" size={18} color={C.green} />
        <Text style={s.remindAllText}>Invitar con código</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({ tabs, active, onChange }: {
  tabs: { key: Tab; label: string }[];
  active: Tab; onChange: (t: Tab) => void;
}) {
  return (
    <View style={s.tabBar}>
      {tabs.map(t => (
        <TouchableOpacity key={t.key}
          style={[s.tabItem, active === t.key && s.tabItemActive]}
          onPress={() => onChange(t.key)} activeOpacity={0.7}>
          <Text style={[s.tabLabel, active === t.key && s.tabLabelActive]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();

  const [detail,        setDetail]       = useState<FetchResult | null>(null);
  const [loading,       setLoading]      = useState(true);
  const [activeTab,     setActiveTab]    = useState<Tab>('inicio');
  const [showAddExp,    setShowAddExp]   = useState(false);
  const [showMembers,   setShowMembers]  = useState(false);
  const [editingMember, setEditingMember]= useState<MemberDetail | null>(null);
  const [profileMember, setProfileMember]= useState<MemberDetail | null>(null);
  const [remindMember,  setRemindMember] = useState<MemberDetail | null>(null);
  const [suggestions,   setSuggestions]  = useState<any[]>([]);

  const fetchSuggestions = useCallback(async () => {
    if (!id || !user?.id) return [];
    const { data } = await (supabase as any)
      .from('debt_match_suggestions').select('*')
      .eq('group_id', id).eq('user_id', user.id).eq('status', 'pending')
      .order('created_at', { ascending: false });
    return data ?? [];
  }, [id, user?.id]);

  const load = useCallback(async () => {
    if (!id || !user?.id) return;
    const data = await fetchGroupDetail(id, user.id);
    setDetail(data);
    setLoading(false);
    if (data?.kind === 'amigos') {
      await runDebtMatchingFor(data, user.id, id);
      setSuggestions(await fetchSuggestions());
    }
  }, [id, user?.id, fetchSuggestions]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (detail) setActiveTab(detail.kind === 'amigos' ? 'inicio' : 'resumen');
  }, [detail?.kind]);

  const isFriends = detail?.kind === 'amigos';
  const isAdmin   = detail?.myRole === 'Admin';

  const friendsTabs: { key: Tab; label: string }[] = [
    { key: 'inicio',  label: 'Inicio'  },
    { key: 'gastos',  label: 'Gastos'  },
    { key: 'resumen', label: 'Resumen' },
    { key: 'ranking', label: 'Ranking' },
  ];
  const familyTabs: { key: Tab; label: string }[] = [
    { key: 'resumen', label: 'Resumen' },
    { key: 'gastos',  label: 'Gastos'  },
  ];

  const handleInvite = () => {
    if (detail?.inviteCode) {
      router.push({
        pathname: '/(app)/group-code',
        params: { code: detail.inviteCode, groupName: detail.name, groupId: id },
      } as any);
    }
  };

  const handleMemberPress = (m: MemberDetail) => {
    if (isFriends) setProfileMember(m);
    else if (isAdmin) setEditingMember(m);
  };

  const remindDebt = (() => {
    if (!remindMember || !detail) return { amount: 0, description: '' };
    const debt = detail.debts.find(d => d.fromUserId === remindMember.userId && d.toUserId === user!.id);
    if (!debt) return { amount: 0, description: '' };
    const oldestExp = detail.expenses.find(e => {
      const hasSplit = detail.rawSplits.find(s => s.group_expense_id === e.id && s.user_id === remindMember.userId && !s.settled);
      const isPayer  = detail.rawExpenses.find(re => re.id === e.id && re.paid_by === user!.id);
      return !!hasSplit && !!isPayer;
    });
    return { amount: debt.amount, description: oldestExp?.description ?? 'el grupo' };
  })();

  const handleConfirmSuggestion = async (suggestion: any) => {
    const db = supabase as any;

    if (suggestion.match_type === 'partial') {
      const { data: splitDetails } = await db
        .from('group_expense_splits')
        .select('id, amount, paid_amount')
        .in('id', suggestion.split_ids);

      if (splitDetails?.length) {
        const totalDebt = splitDetails.reduce((s: number, sp: any) => s + Number(sp.amount), 0);
        for (const sp of splitDetails) {
          const ratio    = totalDebt > 0 ? Number(sp.amount) / totalDebt : 1;
          const newPaid  = Number(sp.paid_amount ?? 0) + suggestion.matched_amount * ratio;
          const isSettled = newPaid >= Number(sp.amount) - 0.01;
          await db.from('group_expense_splits')
            .update({ paid_amount: newPaid, settled: isSettled })
            .eq('id', sp.id);
        }
      }
    } else {
      await db.from('group_expense_splits')
        .update({ settled: true })
        .in('id', suggestion.split_ids);
    }

    if (suggestion.pending_tx_id) {
      await db.from('pending_transactions')
        .update({ status: 'confirmed' })
        .eq('id', suggestion.pending_tx_id);
      // Fix 3: auto-dismiss other suggestions for the same payment (ambiguous matches)
      await db.from('debt_match_suggestions')
        .update({ status: 'dismissed' })
        .eq('pending_tx_id', suggestion.pending_tx_id)
        .neq('id', suggestion.id)
        .eq('status', 'pending');
    }

    await db.from('debt_match_suggestions')
      .update({ status: 'confirmed' })
      .eq('id', suggestion.id);
    hapticSuccess();
    load();
  };

  const handleDismissSuggestion = async (suggestion: any) => {
    await (supabase as any).from('debt_match_suggestions')
      .update({ status: 'dismissed' })
      .eq('id', suggestion.id);
    setSuggestions(prev => prev.filter((s: any) => s.id !== suggestion.id));
  };

  const handleDismissAllForTx = async (pendingTxId: string) => {
    await (supabase as any).from('debt_match_suggestions')
      .update({ status: 'dismissed' })
      .eq('pending_tx_id', pendingTxId)
      .eq('status', 'pending');
    setSuggestions(prev => prev.filter((s: any) => s.pending_tx_id !== pendingTxId));
    hapticLight();
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn}
          onPress={() => router.replace('/(app)/family' as any)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>

        {detail ? (
          <TouchableOpacity
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.md }}
            onPress={() => setShowMembers(true)} activeOpacity={0.7}>
            <View style={[s.groupAvatar, { backgroundColor: detail.groupColor + '22' }]}>
              <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 20, color: detail.groupColor }}>
                {detail.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle} numberOfLines={1}>{detail.name}</Text>
              <Text style={s.headerSub}>
                {detail.members.length} miembro{detail.members.length !== 1 ? 's' : ''}
              </Text>
            </View>
          </TouchableOpacity>
        ) : <View style={{ flex: 1 }}><Text style={s.headerTitle}>Grupo</Text></View>}

        <TouchableOpacity
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => Alert.alert('Opciones', '', [
            { text: 'Salir del grupo', style: 'destructive', onPress: async () => {
              if (!id || !user?.id) return;
              await (supabase as any).from('family_members').delete().eq('group_id', id).eq('user_id', user.id);
              router.replace('/(app)/family' as any);
            }},
            { text: 'Cancelar', style: 'cancel' },
          ])}
          activeOpacity={0.7}>
          <Ionicons name="create-outline" size={22} color={C.muted} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={C.green} size="large" /></View>
      ) : !detail ? (
        <View style={s.centered}>
          <Text style={s.emptyTitle}>No se pudo cargar el grupo.</Text>
          <TouchableOpacity onPress={load} style={{ marginTop: sp.md }}>
            <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.green }}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <TabBar tabs={isFriends ? friendsTabs : familyTabs} active={activeTab} onChange={setActiveTab} />

          {isFriends ? (
            <>
              {activeTab === 'inicio' && (
                <FriendsMainTab
                  detail={detail} myUserId={user!.id}
                  onAddExpense={() => setShowAddExp(true)}
                  onMemberPress={handleMemberPress}
                  onRemindAll={() => {
                    const first = detail.debts.find(d => d.toUserId === user!.id);
                    if (first) {
                      const m = detail.members.find(m => m.userId === first.fromUserId);
                      if (m) setRemindMember(m);
                    }
                  }}
                  suggestions={suggestions}
                  onConfirmSuggestion={handleConfirmSuggestion}
                  onDismissSuggestion={handleDismissSuggestion}
                  onDismissAllForTx={handleDismissAllForTx}
                  onRefresh={load}
                />
              )}
              {activeTab === 'gastos' && (
                <FriendsGastosTab detail={detail} onAddExpense={() => setShowAddExp(true)}
                  rawSplits={detail.rawSplits} myUserId={user!.id} onRefresh={load} />
              )}
              {activeTab === 'resumen' && <GroupAnalyticsTab detail={detail} />}
              {activeTab === 'ranking' && <RankingTab detail={detail} />}
            </>
          ) : (
            <>
              {activeTab === 'resumen' && (
                <FamilyResumenTab detail={detail} isAdmin={isAdmin} onInvite={handleInvite} groupId={id!} />
              )}
              {activeTab === 'gastos' && <FamilyGastosTab detail={detail} />}
            </>
          )}

          {isFriends && (
            <AddExpenseModal visible={showAddExp} onClose={() => setShowAddExp(false)}
              members={detail.members} groupId={id!} userId={user!.id} onSaved={load} />
          )}
          {/* Modal miembros */}
          <FormSheetModal visible={showMembers} title="Miembros" onClose={() => setShowMembers(false)} presentationStyle="formSheet">
            <View style={s.card}>
              {detail.members.map((m, i) => {
                const canEdit = isAdmin && !m.isMe && !isFriends;
                return (
                  <View key={m.userId}>
                    {i > 0 && <View style={s.divider} />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg }}>
                      <Avatar name={m.name} color={m.color} size={44} />
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={s.memberName} numberOfLines={1}>{m.isMe ? `Vos (${m.name})` : m.name}</Text>
                        {m.email ? <Text style={s.memberMeta} numberOfLines={1}>{m.email}</Text> : null}
                      </View>
                      {!isFriends && (
                        <View style={[s.badge, { backgroundColor: C.accent }]}>
                          <Text style={[s.badgeText, { color: C.green }]}>{m.role}</Text>
                        </View>
                      )}
                      {canEdit && (
                        <TouchableOpacity onPress={() => { setShowMembers(false); setEditingMember(m); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
                          <Ionicons name="ellipsis-horizontal" size={20} color={C.muted} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
            <TouchableOpacity style={s.remindAllBtn} onPress={() => { setShowMembers(false); handleInvite(); }} activeOpacity={0.85}>
              <Ionicons name="enter-outline" size={18} color={C.green} />
              <Text style={s.remindAllText}>Invitar con código</Text>
            </TouchableOpacity>
          </FormSheetModal>

          <MemberEditModal visible={editingMember !== null} member={editingMember}
            groupId={id!} allMembers={detail.members}
            onClose={() => setEditingMember(null)}
            onSaved={() => { setEditingMember(null); load(); }} />
          <MemberProfileSheet
            visible={profileMember !== null} member={profileMember}
            myUserId={user!.id} debts={detail.debts}
            expenses={detail.expenses} rawSplits={detail.rawSplits} rawExpenses={detail.rawExpenses}
            onClose={() => setProfileMember(null)}
            onRemind={m => { setProfileMember(null); setRemindMember(m); }} />
          <RecordarModal visible={remindMember !== null} member={remindMember}
            debtAmount={remindDebt.amount} debtDescription={remindDebt.description}
            onClose={() => setRemindMember(null)} />
        </>
      )}
    </SafeAreaView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.bg },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: sp.xl, gap: sp.md },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: sp.md,
    paddingHorizontal: sp.xl, paddingVertical: sp.md,
    backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  groupAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  headerTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 17, color: C.text, letterSpacing: -0.2 },
  headerSub:   { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted, marginTop: 1 },

  tabBar: { flexDirection: 'row', backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.border },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 13, borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  tabItemActive: { borderBottomColor: C.green },
  tabLabel:      { fontFamily: 'Montserrat_500Medium', fontSize: 12, color: C.muted },
  tabLabelActive:{ fontFamily: 'Montserrat_700Bold', fontSize: 12, color: C.green },

  tabContent: { paddingHorizontal: sp.xl, paddingTop: sp.xl, paddingBottom: 100, gap: sp.lg },

  card: {
    backgroundColor: C.white, borderRadius: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  divider: { height: 1, backgroundColor: C.border, marginHorizontal: sp.lg },

  summaryCard: {
    backgroundColor: C.white, borderRadius: 20, padding: sp.xl,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 10, elevation: 4,
  },
  scMonthLabel: { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: C.muted, marginBottom: sp.xs },
  scTotalLabel: { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted, marginTop: sp.xs },
  scTotal:      { fontFamily: 'Montserrat_700Bold', fontSize: 26, color: C.text, letterSpacing: -0.5, lineHeight: 34 },
  scDivider:    { height: 1, backgroundColor: C.border, marginVertical: sp.lg },
  scBalAmt:     { fontFamily: 'Montserrat_700Bold', fontSize: 22, letterSpacing: -0.5, lineHeight: 30 },

  summaryLabel: { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted },
  summaryAmt:   { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: C.text },

  insightCard: {
    backgroundColor: C.accent, borderRadius: 16,
    flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg,
  },
  insightTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.text },
  insightSub:   { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.text2, lineHeight: 17, marginTop: 2 },

  sectionTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: C.text },
  sectionLabel: { fontFamily: 'Montserrat_700Bold', fontSize: 10, color: C.muted, letterSpacing: 0.8 },

  badge:     { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, flexShrink: 0 },
  badgeText: { fontFamily: 'Montserrat_700Bold', fontSize: 11, letterSpacing: 0.2 },

  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.lg, paddingVertical: sp.md },
  memberName: { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.text },
  memberMeta: { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted },

  avatarBase:    { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarInitial: { fontFamily: 'Montserrat_700Bold' },
  avatarRow:     { flexDirection: 'row', gap: sp.md, flexWrap: 'wrap' },

  expName:   { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.text },
  expMeta:   { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted },
  expAmt:    { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.text, flexShrink: 0 },
  expIconSm: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  expEmojiBox: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#D1F7E3', alignItems: 'center', justifyContent: 'center' },
  detailTitle:  { fontFamily: 'Montserrat_700Bold', fontSize: 20, color: C.text, textAlign: 'center', lineHeight: 26 },
  detailAmount: { fontFamily: 'Montserrat_700Bold', fontSize: 32, color: C.green, letterSpacing: -1, lineHeight: 40 },
  detailDate:   { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.muted },

  rankRow:    { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.lg, paddingVertical: sp.md },
  rankNumber: { fontFamily: 'Montserrat_700Bold', fontSize: 18, width: 28, textAlign: 'center' },

  activityDot: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  catBarBg:   { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  catBarFill: { height: '100%', backgroundColor: C.green, borderRadius: 3 },

  purpleBtn: {
    backgroundColor: C.green, borderRadius: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm,
    paddingVertical: 16,
    shadowColor: C.green, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4,
  },
  purpleBtnText: { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: C.white },

  outlineBtn: {
    borderRadius: 16, borderWidth: 1.5, borderColor: C.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm,
    paddingVertical: 14, backgroundColor: C.white,
  },
  outlineBtnText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.text2 },

  remindAllBtn: {
    borderRadius: 16, borderWidth: 1.5, borderColor: C.green,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm,
    paddingVertical: 14, backgroundColor: C.white,
  },
  remindAllText: { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.green },

  remindBtn: {
    borderRadius: 16, borderWidth: 1.5, borderColor: C.green,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm,
    paddingVertical: 14, backgroundColor: C.white,
  },
  remindBtnText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.green },

  addSmallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: 10, borderWidth: 1, borderColor: C.green + '60',
    paddingHorizontal: sp.sm, paddingVertical: sp.xs, backgroundColor: C.accent,
  },
  addSmallText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: C.green },

  linkText:   { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: C.green },
  mutedSmall: { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted },

  emptyBox:   { alignItems: 'center', gap: sp.md, paddingVertical: sp.xxl },
  emptyTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: C.text },
  emptySub:   { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.muted, textAlign: 'center' },

  modal:       { flex: 1, backgroundColor: C.bg },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: sp.xl, paddingVertical: sp.lg,
    borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.white,
  },
  modalTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 17, color: C.text },
  modalBody:  { paddingHorizontal: sp.xl, paddingTop: sp.xl, paddingBottom: 40, gap: sp.xl },

  editName:  { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: C.text },
  editEmail: { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.muted },

  radioRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: sp.md,
    borderRadius: 14, borderWidth: 1.5, borderColor: C.border, padding: sp.lg, backgroundColor: C.white,
  },
  radioCircle: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
  },
  radioDot:   { width: 10, height: 10, borderRadius: 5 },
  radioTitle: { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.text },
  radioDesc:  { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted, lineHeight: 17 },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  checkLabel: { fontFamily: 'Montserrat_500Medium', fontSize: 14, color: C.text, flex: 1 },

  textInput: {
    fontFamily: 'Montserrat_500Medium', fontSize: 16, color: C.text,
    borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    paddingHorizontal: sp.lg, paddingVertical: sp.md, backgroundColor: C.white,
  },

  payerRow:  { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.lg, paddingVertical: sp.md },
  payerName: { fontFamily: 'Montserrat_500Medium', fontSize: 14, color: C.text, flex: 1 },

  sourceCard: {
    flexDirection: 'row', alignItems: 'center', gap: sp.md,
    borderWidth: 1.5, borderColor: C.border, borderRadius: 16, padding: sp.lg, backgroundColor: C.white,
  },
  sourceIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: sp.sm,
    backgroundColor: C.white, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, paddingHorizontal: sp.md, paddingVertical: sp.sm,
  },
  searchInput: { flex: 1, fontFamily: 'Montserrat_400Regular', fontSize: 14, color: C.text, paddingVertical: 0 },

  pickExpRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp.md,
    backgroundColor: C.white, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, padding: sp.md,
  },
  createManualRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp.md,
    borderRadius: 12, borderWidth: 1, borderColor: C.green + '30',
    backgroundColor: C.accent, padding: sp.md, marginTop: sp.sm,
  },

  miniExpCard: {
    flexDirection: 'row', alignItems: 'center', gap: sp.md,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: sp.md,
  },

  toneCard: {
    flex: 1, alignItems: 'center', gap: sp.sm, padding: sp.md,
    borderRadius: 16, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.white,
  },
  toneName: { fontFamily: 'Montserrat_700Bold', fontSize: 13, color: C.text, textAlign: 'center' },
  toneDesc: { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted, textAlign: 'center', lineHeight: 15 },

  waBubbleContainer: { backgroundColor: '#E5DDD5', borderRadius: 14, padding: sp.lg, minHeight: 120 },
  waBubble: {
    backgroundColor: '#DCF8C6', borderRadius: 14, borderTopRightRadius: 4,
    padding: sp.lg, alignSelf: 'flex-end', maxWidth: '90%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 1,
  },
  waBubbleText: { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: '#111', lineHeight: 20 },
  waBubbleTime: { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#667085', textAlign: 'right', marginTop: 4 },
});

const dmb = StyleSheet.create({
  wrap: {
    backgroundColor: '#D1F7E3', borderRadius: 18,
    borderWidth: 1.5, borderColor: '#A8D5C2',
    padding: sp.lg, gap: sp.sm,
    shadowColor: '#27AE60', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md },
  iconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#D1F7E3', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  title:    { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#1C1C1C' },
  sub:      { fontFamily: 'Montserrat_500Medium', fontSize: 12, color: '#6D6A63', lineHeight: 17 },
  note:     { fontFamily: 'Montserrat_500Medium', fontSize: 12, color: '#27AE60', marginTop: 2 },
  question: { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: '#1C1C1C' },
  actions:  { flexDirection: 'row', gap: sp.sm, marginTop: sp.xs },
  confirmBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: '#27AE60', borderRadius: 12, paddingVertical: 11,
  },
  confirmText: { fontFamily: 'Montserrat_700Bold', fontSize: 13, color: '#FFF' },
  dismissBtn: {
    paddingHorizontal: sp.lg, paddingVertical: 11,
    borderRadius: 12, borderWidth: 1.5, borderColor: '#A8D5C2',
    alignItems: 'center', justifyContent: 'center',
  },
  dismissText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: '#27AE60' },

  radioRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp.md,
    borderRadius: 12, borderWidth: 1.5, borderColor: '#A8D5C2',
    backgroundColor: '#D1F7E3', padding: sp.md,
  },
  radioRowActive: {
    borderColor: '#27AE60', backgroundColor: '#D1F7E3',
  },
  radioCircle: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#86EFAC',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  radioCircleActive: { borderColor: '#27AE60' },
  radioDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: '#27AE60' },
  radioLabel:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: '#1C1C1C' },
  radioSub:    { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#6D6A63', marginTop: 1 },
});
