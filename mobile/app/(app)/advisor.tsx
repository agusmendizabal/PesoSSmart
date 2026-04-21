import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { colors, spacing, layout, textVariants } from '@/theme';
import { Text } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { usePlanStore } from '@/store/planStore';
import { useSavingsStore } from '@/store/savingsStore';
import { useGoalsStore } from '@/store/goalsStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';
import { useLocalSearchParams, router } from 'expo-router';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type View    = 'bots' | 'threads' | 'chat';
type BotId   = 'general' | 'inversiones' | 'ahorro' | 'gastos';

interface ChatMessage {
  id:         string;
  role:       'user' | 'assistant';
  content:    string;
  created_at: string;
}

interface Thread {
  id:              string;
  title:           string | null;
  created_at:      string;
  last_message_at: string;
}

interface BotSummary {
  thread_count: number;
  last_active:  string | null;
}

interface ClientContext {
  month_total:    number;
  income:         number | null;
  income_pct:     number | null;
  month_status:   'good' | 'tight' | 'over';
  necessary:      number;
  disposable:     number;
  disposable_pct: number;
  investable:     number;
  recoverable:    number;
}

// ─── Bots ─────────────────────────────────────────────────────────────────────

const BOTS: Record<BotId, {
  name:        string;
  emoji:       string;
  description: string;
  color:       string;
  quickActions: (ctx: ClientContext) => string[];
}> = {
  general: {
    name:        'General',
    emoji:       '🧠',
    description: 'Tu asesor financiero personal para Argentina',
    color:       colors.primary,
    quickActions: (ctx) => {
      const actions: string[] = [];
      if (ctx.month_status === 'over')        actions.push('¿Cómo recorto gastos para no pasarme?');
      else if (ctx.month_status === 'tight')  actions.push('¿Qué gastos puedo ajustar este mes?');
      else if (ctx.recoverable > 0)           actions.push(`Tengo ~${formatCurrency(ctx.recoverable)} libres — ¿qué hago?`);
      else                                    actions.push('¿Cómo mejoro mi salud financiera?');
      actions.push(ctx.disposable_pct > 15 ? '¿Cuáles son mis gastos más prescindibles?' : '¿Mis gastos están bien distribuidos?');
      actions.push('¿Cuál es mi plan para el próximo mes?');
      return actions;
    },
  },
  inversiones: {
    name:        'Inversiones',
    emoji:       '📈',
    description: 'Cedears · FCI · Bonos · Dólar MEP',
    color:       colors.accent,
    quickActions: (ctx) => [
      ctx.recoverable > 0 ? `Tengo ${formatCurrency(ctx.recoverable)} para invertir — ¿en qué?` : '¿Con $50.000 cómo empiezo a invertir?',
      '¿Cedears o dólar MEP hoy?',
      '¿Vale la pena el Plazo Fijo UVA ahora?',
      '¿Cómo armo una cartera diversificada?',
    ],
  },
  ahorro: {
    name:        'Ahorro',
    emoji:       '💰',
    description: 'Metas · Presupuesto · Fondo de emergencia',
    color:       colors.yellow,
    quickActions: (ctx) => [
      '¿Cómo armo mi fondo de emergencia?',
      ctx.recoverable > 0 ? `¿Cómo ahorro ${formatCurrency(ctx.recoverable)} por mes?` : '¿Cuánto debería ahorrar por mes?',
      '¿Cómo llego a mi meta más rápido?',
      '¿Qué porcentaje del sueldo ahorrar?',
    ],
  },
  gastos: {
    name:        'Gastos',
    emoji:       '💳',
    description: 'Análisis y optimización de tus gastos',
    color:       colors.red,
    quickActions: (ctx) => [
      ctx.month_status === 'over' ? '¿Cómo reduzco mis gastos urgente?' : '¿Están bien mis gastos este mes?',
      ctx.disposable_pct > 20 ? `Tengo ${ctx.disposable_pct}% en prescindibles — ¿qué recorto?` : '¿Cuáles son mis gastos más innecesarios?',
      '¿Mis suscripciones son muchas?',
      '¿Cómo clasifico mejor mis gastos?',
    ],
  },
};

const BOT_IDS: BotId[] = ['general', 'inversiones', 'ahorro', 'gastos'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildClientContext(
  totalThisMonth:  number,
  totalNecessary:  number,
  totalDisposable: number,
  totalInvestable: number,
  estimatedIncome: number | null,
): ClientContext {
  const dispPct   = totalThisMonth > 0 ? Math.round((totalDisposable / totalThisMonth) * 100) : 0;
  const incomePct = estimatedIncome && estimatedIncome > 0
    ? Math.round((totalThisMonth / estimatedIncome) * 100) : null;
  const status: ClientContext['month_status'] =
    incomePct !== null && incomePct > 100 ? 'over' :
    (incomePct !== null && incomePct > 85) || dispPct > 20 ? 'tight' : 'good';
  return {
    month_total: totalThisMonth, income: estimatedIncome, income_pct: incomePct,
    month_status: status, necessary: totalNecessary, disposable: totalDisposable,
    disposable_pct: dispPct, investable: totalInvestable,
    recoverable: totalThisMonth > 0 ? Math.round(totalDisposable * 0.5) : 0,
  };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'Ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Ayer';
  return `hace ${days}d`;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AdvisorScreen() {
  const { user }                                                                  = useAuthStore();
  const { totalThisMonth, totalNecessary, totalDisposable, totalInvestable,
          estimatedIncome }                                                       = useExpensesStore();
  const { savings, investments }                                                  = useSavingsStore();
  const { goals }                                                                 = useGoalsStore();
  const { canSendMessage, remainingMessages, incrementUsage,
          load: loadPlan, msgLimit, isLoading: planLoading }                      = usePlanStore();
  const { initialContext }                                                        = useLocalSearchParams<{ initialContext?: string }>();

  // ── Navegación entre vistas ──────────────────────────────────────────────
  const [view,          setView]          = useState<View>('bots');
  const [activeBot,     setActiveBot]     = useState<BotId>('general');
  const [activeThread,  setActiveThread]  = useState<Thread | null>(null);

  // ── Estado de datos ──────────────────────────────────────────────────────
  const [botSummaries,  setBotSummaries]  = useState<Record<BotId, BotSummary>>({
    general: { thread_count: 0, last_active: null },
    inversiones: { thread_count: 0, last_active: null },
    ahorro: { thread_count: 0, last_active: null },
    gastos: { thread_count: 0, last_active: null },
  });
  const [threads,       setThreads]       = useState<Thread[]>([]);
  const [messages,      setMessages]      = useState<ChatMessage[]>([]);
  const [loadingThreads,  setLoadingThreads]  = useState(false);
  const [loadingMsgs,     setLoadingMsgs]     = useState(false);
  const [creatingThread,  setCreatingThread]  = useState(false);
  const [editModal,       setEditModal]       = useState<{ visible: boolean; threadId: string; text: string }>({
    visible: false, threadId: '', text: '',
  });

  // ── Estado de UI ─────────────────────────────────────────────────────────
  const [input,          setInput]          = useState('');
  const [isThinking,     setIsThinking]     = useState(false);
  const [isWelcoming,    setIsWelcoming]    = useState(false);
  const [isRecording,    setIsRecording]    = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const flatListRef   = useRef<FlatList>(null);
  const recordingRef  = useRef<Audio.Recording | null>(null);
  const isFirstMsg    = useRef(true); // para generar título del thread

  useEffect(() => { if (user?.id) loadPlan(user.id); }, [user?.id]);

  // ── Contexto financiero ──────────────────────────────────────────────────

  const clientContext = useMemo(() => buildClientContext(
    totalThisMonth, totalNecessary, totalDisposable, totalInvestable, estimatedIncome,
  ), [totalThisMonth, totalNecessary, totalDisposable, totalInvestable, estimatedIncome]);

  const savingsContext = useMemo(() => {
    const s = savings.map(sv => `${sv.label}: ${formatCurrency(sv.amount)} (${sv.currency})`);
    const i = investments.map(iv => `${iv.name}: ${formatCurrency(iv.amount)}${iv.annual_return ? ` al ${iv.annual_return}% anual` : ''}`);
    const g = goals.map(gl => {
      const pct = gl.target_amount > 0 ? Math.round((gl.current_amount / gl.target_amount) * 100) : 0;
      return `${gl.emoji} ${gl.title}: ${formatCurrency(gl.current_amount)}/${formatCurrency(gl.target_amount)} (${pct}%)`;
    });
    if (!s.length && !i.length && !g.length) return null;
    return {
      savings_summary:     s.length ? s.join(' | ') : null,
      goals_summary:       g.length ? g.join(' | ') : null,
      investments_summary: i.length ? i.join(' | ') : null,
    };
  }, [savings, investments, goals]);

  const quickActions = useMemo(
    () => BOTS[activeBot].quickActions(clientContext),
    [activeBot, clientContext],
  );

  // ── initialContext: ir directo a un nuevo chat general ───────────────────

  useEffect(() => {
    if (initialContext && user?.id) {
      handleOpenBot('general', true);
    }
  }, [initialContext, user?.id]);

  // ── Cargar resumen de bots (conteos y última actividad) ──────────────────

  const loadBotSummaries = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await (supabase as any)
      .from('chat_threads')
      .select('bot_type, last_message_at')
      .eq('user_id', user.id);

    if (!data) return;
    const summaries: Record<BotId, BotSummary> = {
      general:     { thread_count: 0, last_active: null },
      inversiones: { thread_count: 0, last_active: null },
      ahorro:      { thread_count: 0, last_active: null },
      gastos:      { thread_count: 0, last_active: null },
    };
    for (const row of data) {
      const b = row.bot_type as BotId;
      if (!summaries[b]) continue;
      summaries[b].thread_count++;
      if (!summaries[b].last_active || row.last_message_at > summaries[b].last_active!) {
        summaries[b].last_active = row.last_message_at;
      }
    }
    setBotSummaries(summaries);
  }, [user?.id]);

  useEffect(() => { loadBotSummaries(); }, [loadBotSummaries]);

  // ── Cargar threads de un bot ─────────────────────────────────────────────

  const loadThreads = useCallback(async (botId: BotId) => {
    if (!user?.id) return;
    setLoadingThreads(true);
    const { data } = await (supabase as any)
      .from('chat_threads')
      .select('id, title, created_at, last_message_at')
      .eq('user_id', user.id)
      .eq('bot_type', botId)
      .order('last_message_at', { ascending: false });
    setThreads(data ?? []);
    setLoadingThreads(false);
  }, [user?.id]);

  // ── Crear un nuevo thread ────────────────────────────────────────────────

  const createThread = useCallback(async (botId: BotId): Promise<Thread | null> => {
    if (!user?.id) return null;
    const { data, error } = await (supabase as any)
      .from('chat_threads')
      .insert({ user_id: user.id, bot_type: botId })
      .select()
      .single();
    if (error || !data) return null;
    return data as Thread;
  }, [user?.id]);

  // ── Cargar mensajes de un thread ─────────────────────────────────────────

  const loadMessages = useCallback(async (threadId: string) => {
    setLoadingMsgs(true);
    const { data } = await (supabase as any)
      .from('chat_history')
      .select('id, role, content, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    setMessages(data ?? []);
    setLoadingMsgs(false);
  }, []);

  // ── Guardar mensaje en DB ────────────────────────────────────────────────

  const saveMsgToDb = useCallback(async (
    threadId: string,
    role:     'user' | 'assistant',
    content:  string,
  ) => {
    const { error } = await (supabase as any).from('chat_history').insert({
      user_id:   user?.id,
      bot_type:  activeBot,
      thread_id: threadId,
      role,
      content,
    });
    if (error) console.error('[advisor] saveMsgToDb error:', error.message);
  }, [user?.id, activeBot]);

  // ── Actualizar título del thread con el primer mensaje ───────────────────

  const updateThreadTitle = useCallback(async (threadId: string, firstMsg: string) => {
    const title = firstMsg.length > 50 ? firstMsg.slice(0, 47) + '...' : firstMsg;
    await (supabase as any)
      .from('chat_threads')
      .update({ title })
      .eq('id', threadId);
    setActiveThread(prev => prev ? { ...prev, title } : prev);
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title } : t));
  }, []);

  // ── Actualizar last_message_at del thread ────────────────────────────────

  const touchThread = useCallback(async (threadId: string) => {
    const now = new Date().toISOString();
    await (supabase as any)
      .from('chat_threads')
      .update({ last_message_at: now })
      .eq('id', threadId);
  }, []);

  // ── Welcome message en background ───────────────────────────────────────

  const generateWelcome = useCallback(async (botId: BotId) => {
    setIsWelcoming(true);
    try {
      const { data, error } = await Promise.race([
        supabase.functions.invoke('ai-advisor', {
          body: {
            generate_welcome:  true,
            client_context:    clientContext,
            initial_context:   botId === 'general' ? (initialContext ?? null) : null,
            user_id:           user?.id,
            savings_context:   savingsContext,
            bot_focus:         botId,
          },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
      ]);
      if (!error && data?.message) {
        setMessages(prev => prev.length === 0 ? [{
          id:         `welcome-${Date.now()}`,
          role:       'assistant',
          content:    data.message,
          created_at: new Date().toISOString(),
        }] : prev);
      }
    } catch { /* silencioso */ }
    finally { setIsWelcoming(false); }
  }, [clientContext, initialContext, user?.id, savingsContext]);

  // ─── Navegar: bots → threads ────────────────────────────────────────────

  const handleOpenBot = useCallback(async (botId: BotId, autoNew = false) => {
    setActiveBot(botId);
    if (autoNew) {
      const thread = await createThread(botId);
      if (!thread) return;
      setActiveThread(thread);
      setMessages([]);
      isFirstMsg.current = true;
      setView('chat');
      generateWelcome(botId);
    } else {
      await loadThreads(botId);
      setView('threads');
    }
  }, [createThread, loadThreads, generateWelcome]);

  // ── Navegar: threads → chat (thread existente) ───────────────────────────

  const handleOpenThread = useCallback(async (thread: Thread) => {
    setActiveThread(thread);
    await loadMessages(thread.id);
    isFirstMsg.current = false; // ya tiene mensajes
    setView('chat');
  }, [loadMessages]);

  // ── Navegar: threads → chat (nuevo thread) ───────────────────────────────

  const handleNewThread = useCallback(async () => {
    if (creatingThread) return;
    setCreatingThread(true);
    try {
      const thread = await createThread(activeBot);
      if (!thread) {
        Alert.alert('Error', 'No se pudo crear la conversación. Asegurate de haber corrido la migración chat_threads.sql en Supabase.');
        return;
      }
      setActiveThread(thread);
      setMessages([]);
      isFirstMsg.current = true;
      setThreads(prev => [thread, ...prev]);
      setView('chat');
      generateWelcome(activeBot);
    } finally {
      setCreatingThread(false);
    }
  }, [activeBot, creatingThread, createThread, generateWelcome]);

  // ── Navegar: atrás ───────────────────────────────────────────────────────

  const handleBack = useCallback(() => {
    if (view === 'chat') {
      setMessages([]);
      setActiveThread(null);
      loadThreads(activeBot);
      setView('threads');
    } else if (view === 'threads') {
      loadBotSummaries();
      setView('bots');
    }
  }, [view, activeBot, loadThreads, loadBotSummaries]);

  // ── Borrar thread ────────────────────────────────────────────────────────

  const openEditModal = useCallback((thread: Thread) => {
    setEditModal({ visible: true, threadId: thread.id, text: thread.title ?? '' });
  }, []);

  const saveEditedTitle = useCallback(async () => {
    const { threadId, text } = editModal;
    const title = text.trim() || 'Nueva conversación';
    setEditModal(prev => ({ ...prev, visible: false }));
    await (supabase as any).from('chat_threads').update({ title }).eq('id', threadId);
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title } : t));
    if (activeThread?.id === threadId) setActiveThread(prev => prev ? { ...prev, title } : prev);
  }, [editModal, activeThread]);

  const handleLongPressThread = useCallback((thread: Thread) => {
    Alert.alert(
      'Eliminar conversación',
      `"${thread.title ?? 'Nueva conversación'}" se eliminará permanentemente.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive',
          onPress: async () => {
            await (supabase as any).from('chat_threads').delete().eq('id', thread.id);
            setThreads(prev => prev.filter(t => t.id !== thread.id));
            setBotSummaries(prev => ({
              ...prev,
              [activeBot]: {
                thread_count: Math.max(0, prev[activeBot].thread_count - 1),
                last_active:  prev[activeBot].last_active,
              },
            }));
          },
        },
      ],
    );
  }, [activeBot]);

  // ── Enviar mensaje ───────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !user?.id || isThinking || !activeThread) return;

    if (!canSendMessage()) {
      Alert.alert(
        'Límite de mensajes alcanzado',
        'Agotaste los mensajes de tu plan este mes.',
        [
          { text: 'Ahora no', style: 'cancel' },
          { text: 'Ver planes', onPress: () => router.push('/(app)/plans') },
        ],
      );
      return;
    }

    const userMsg: ChatMessage = {
      id:         `user-${Date.now()}`,
      role:       'user',
      content:    trimmed,
      created_at: new Date().toISOString(),
    };

    // Guardar en DB
    saveMsgToDb(activeThread.id, 'user', trimmed);

    // Actualizar título si es el primer mensaje del thread
    if (isFirstMsg.current) {
      isFirstMsg.current = false;
      updateThreadTitle(activeThread.id, trimmed);
    }

    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsThinking(true);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      const { data, error } = await Promise.race([
        supabase.functions.invoke('ai-advisor', {
          body: {
            message:         trimmed,
            history,
            user_id:         user.id,
            client_context:  clientContext,
            savings_context: savingsContext,
            bot_focus:       activeBot,
          },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000)),
      ]);

      if (error) {
        const status = ((error as any)?.context as Response | undefined)?.status;
        if (status === 429) {
          Alert.alert(
            'Límite de mensajes alcanzado',
            'Agotaste los mensajes de tu plan este mes.',
            [
              { text: 'Ahora no', style: 'cancel' },
              { text: 'Ver planes', onPress: () => router.push('/(app)/plans') },
            ],
          );
          setMessages(prev => prev.filter(m => m.id !== userMsg.id));
          return;
        }
        throw new Error(error.message);
      }
      if (!data?.message) throw new Error('Sin respuesta');

      const aiMsg: ChatMessage = {
        id:         `ai-${Date.now()}`,
        role:       'assistant',
        content:    data.message,
        created_at: new Date().toISOString(),
      };

      saveMsgToDb(activeThread.id, 'assistant', data.message);
      touchThread(activeThread.id);
      setMessages(prev => [...prev, aiMsg]);
      incrementUsage(user.id);
    } catch {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`, role: 'assistant',
        content: 'Algo salió mal. Intentá de nuevo.', created_at: new Date().toISOString(),
      }]);
    } finally {
      setIsThinking(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages, activeBot, activeThread, user?.id, isThinking, clientContext,
      savingsContext, canSendMessage, saveMsgToDb, updateThreadTitle, touchThread, incrementUsage]);

  // ── Voz ─────────────────────────────────────────────────────────────────

  const toggleVoice = useCallback(async () => {
    if (isRecording) {
      setIsRecording(false);
      setIsTranscribing(true);
      try {
        await recordingRef.current?.stopAndUnloadAsync();
        const uri = recordingRef.current?.getURI();
        recordingRef.current = null;
        if (!uri) return;
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const { data, error } = await (supabase as any).functions.invoke('transcribe', {
          body: { audio_base64: base64, mime_type: 'audio/m4a' },
        });
        if (!error && data?.text) setInput(data.text);
      } catch { Alert.alert('Error', 'No se pudo transcribir el audio.'); }
      finally  { setIsTranscribing(false); }
    } else {
      try {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permiso denegado', 'Necesitamos acceso al micrófono.');
          return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY,
        );
        recordingRef.current = recording;
        setIsRecording(true);
      } catch (e) { console.error('[voice]', e); }
    }
  }, [isRecording]);

  // ── Renders ──────────────────────────────────────────────────────────────

  const bot      = BOTS[activeBot];
  const canSend  = canSendMessage();

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[
        styles.messageWrapper,
        isUser ? styles.messageWrapperUser : styles.messageWrapperAI,
      ]}>
        {!isUser && (
          <View style={[styles.avatarAI, { backgroundColor: bot.color + '18', borderColor: bot.color + '40' }]}>
            <Text style={{ fontSize: 13 }}>{bot.emoji}</Text>
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAI]}>
          <Text variant="bodySmall" color={isUser ? colors.text.inverse : colors.text.primary} style={{ lineHeight: 20 }}>
            {item.content}
          </Text>
        </View>
      </View>
    );
  }, [bot]);

  // ════════════════════════════════════════════════════════════════
  //  VISTA: BOTS
  // ════════════════════════════════════════════════════════════════

  if (view === 'bots') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <View>
            <Text variant="h4">Asesores IA</Text>
            <Text variant="caption" color={colors.text.tertiary}>Elegí con quién hablar</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.botsScroll} showsVerticalScrollIndicator={false}>
          {BOT_IDS.map(botId => {
            const b   = BOTS[botId];
            const sum = botSummaries[botId];
            return (
              <TouchableOpacity
                key={botId}
                style={styles.botCard}
                onPress={() => handleOpenBot(botId)}
                activeOpacity={0.8}
              >
                <View style={[styles.botCardIcon, { backgroundColor: b.color + '18' }]}>
                  <Text style={{ fontSize: 30 }}>{b.emoji}</Text>
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text variant="subtitle">{b.name}</Text>
                  <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
                    {b.description}
                  </Text>
                  <Text variant="caption" color={colors.text.tertiary}>
                    {sum.thread_count === 0
                      ? 'Sin conversaciones'
                      : `${sum.thread_count} conversación${sum.thread_count !== 1 ? 'es' : ''}${sum.last_active ? ' · ' + timeAgo(sum.last_active) : ''}`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.text.tertiary} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ════════════════════════════════════════════════════════════════
  //  VISTA: THREADS
  // ════════════════════════════════════════════════════════════════

  if (view === 'threads') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: spacing[3] }}>
            <Text variant="h4">{bot.emoji} {bot.name}</Text>
            <Text variant="caption" color={colors.text.tertiary}>Tus conversaciones</Text>
          </View>
          <TouchableOpacity
            style={[styles.newThreadBtn, { borderColor: bot.color }, creatingThread && { opacity: 0.6 }]}
            onPress={handleNewThread}
            disabled={creatingThread}
            activeOpacity={0.8}
          >
            {creatingThread
              ? <ActivityIndicator size="small" color={bot.color} />
              : <Ionicons name="add" size={18} color={bot.color} />
            }
            <Text variant="caption" color={bot.color} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
              Nuevo chat
            </Text>
          </TouchableOpacity>
        </View>

        {loadingThreads ? (
          <View style={styles.centered}>
            <ActivityIndicator color={bot.color} />
          </View>
        ) : threads.length === 0 ? (
          <View style={styles.centered}>
            <Text style={{ fontSize: 40 }}>{bot.emoji}</Text>
            <Text variant="subtitle" align="center">{bot.name}</Text>
            <Text variant="body" color={colors.text.secondary} align="center" style={{ paddingHorizontal: spacing[6] }}>
              {bot.description}
            </Text>
            <TouchableOpacity
              style={[styles.startChatBtn, { backgroundColor: bot.color }, creatingThread && { opacity: 0.7 }]}
              onPress={handleNewThread}
              disabled={creatingThread}
              activeOpacity={0.8}
            >
              {creatingThread
                ? <ActivityIndicator size="small" color={colors.white} />
                : <Ionicons name="chatbubble-outline" size={16} color={colors.white} />
              }
              <Text style={[styles.startChatText, { color: colors.white }]}>
                {creatingThread ? 'Creando...' : 'Empezar conversación'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={threads}
            keyExtractor={t => t.id}
            contentContainerStyle={styles.threadsList}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={styles.threadRow}>
                {/* Tap en el cuerpo → abrir chat */}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3], flex: 1 }}
                  onPress={() => handleOpenThread(item)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.threadIcon, { backgroundColor: bot.color + '18' }]}>
                    <Ionicons name="chatbubble-outline" size={16} color={bot.color} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text variant="bodySmall" numberOfLines={1} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                      {item.title ?? 'Nueva conversación'}
                    </Text>
                    <Text variant="caption" color={colors.text.tertiary}>
                      {timeAgo(item.last_message_at)}
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* Botones de acción */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1] }}>
                  <TouchableOpacity
                    onPress={() => openEditModal(item)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={styles.threadActionBtn}
                  >
                    <Ionicons name="pencil-outline" size={15} color={colors.text.tertiary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleLongPressThread(item)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={styles.threadActionBtn}
                  >
                    <Ionicons name="trash-outline" size={15} color={colors.text.tertiary} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
            ListFooterComponent={null}
          />
        )}
      </SafeAreaView>
    );
  }

  // ════════════════════════════════════════════════════════════════
  //  VISTA: CHAT
  // ════════════════════════════════════════════════════════════════

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={{ flex: 1, marginLeft: spacing[3] }}
          onPress={() => activeThread && openEditModal(activeThread)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1] }}>
            <Text variant="bodySmall" numberOfLines={1} style={{ fontFamily: 'Montserrat_600SemiBold', flexShrink: 1 }}>
              {activeThread?.title ?? 'Nueva conversación'}
            </Text>
            <Ionicons name="pencil-outline" size={12} color={colors.text.tertiary} />
          </View>
          <Text variant="caption" color={colors.text.tertiary}>
            {bot.emoji} {bot.name}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleNewThread}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.newChatBtn}
        >
          <Ionicons name="add-circle-outline" size={22} color={colors.text.secondary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Cargando mensajes */}
        {loadingMsgs ? (
          <View style={styles.centered}>
            <ActivityIndicator color={bot.color} />
          </View>

        /* Generando welcome */
        ) : isWelcoming && messages.length === 0 ? (
          <View style={styles.centered}>
            <View style={[styles.emptyAvatar, { backgroundColor: bot.color + '18' }]}>
              <Text style={{ fontSize: 38 }}>{bot.emoji}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
              <ActivityIndicator color={bot.color} size="small" />
              <Text variant="caption" color={colors.text.secondary}>Preparando tu asesor...</Text>
            </View>
          </View>

        /* Estado vacío con quick actions */
        ) : messages.length === 0 ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.emptyState}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.emptyAvatar, { backgroundColor: bot.color + '18' }]}>
              <Text style={{ fontSize: 44 }}>{bot.emoji}</Text>
            </View>
            <Text variant="subtitle" align="center">{bot.name}</Text>
            <Text variant="body" align="center" color={colors.text.secondary} style={{ paddingHorizontal: spacing[2] }}>
              {bot.description}
            </Text>
            <View style={styles.qaSection}>
              <Text variant="label" color={colors.text.tertiary} style={{ marginBottom: spacing[1] }}>
                PREGUNTAS FRECUENTES
              </Text>
              {quickActions.map(q => (
                <TouchableOpacity
                  key={q}
                  style={[styles.qaChip, { borderColor: bot.color + '40', backgroundColor: bot.color + '08' }]}
                  onPress={() => sendMessage(q)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="flash-outline" size={14} color={bot.color} />
                  <Text variant="bodySmall" color={colors.text.primary} style={styles.qaText}>{q}</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.text.tertiary} />
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

        /* Mensajes */
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={item => item.id}
            renderItem={renderMessage}
            style={styles.flex}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            ListFooterComponent={isThinking ? (
              <View style={styles.thinkingRow}>
                <View style={[styles.avatarAI, { backgroundColor: bot.color + '18', borderColor: bot.color + '40' }]}>
                  <Text style={{ fontSize: 13 }}>{bot.emoji}</Text>
                </View>
                <View style={styles.thinkingBubble}>
                  <ActivityIndicator color={bot.color} size="small" />
                  <Text variant="caption" color={colors.text.secondary}>Escribiendo...</Text>
                </View>
              </View>
            ) : null}
          />
        )}

        {/* Input area */}
        <View style={styles.inputArea}>
          {msgLimit !== null && !planLoading && (
            <View style={styles.usageRow}>
              {canSend ? (
                <Text variant="caption" color={colors.text.tertiary}>
                  {remainingMessages()} {remainingMessages() === 1 ? 'mensaje restante' : 'mensajes restantes'}
                </Text>
              ) : (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1] }}
                  onPress={() => router.push('/(app)/plans')}
                >
                  <Ionicons name="lock-closed-outline" size={11} color={colors.red} />
                  <Text variant="caption" color={colors.red}>Límite alcanzado · </Text>
                  <Text variant="caption" color={colors.primary} style={{ textDecorationLine: 'underline' }}>Ver planes</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={styles.inputRow}>
            <TouchableOpacity
              style={[styles.voiceBtn, isRecording && { backgroundColor: colors.red }]}
              onPress={toggleVoice}
              disabled={isTranscribing || !canSend || isThinking}
            >
              {isTranscribing
                ? <ActivityIndicator size="small" color={colors.text.secondary} />
                : <Ionicons
                    name={isRecording ? 'stop-circle-outline' : 'mic-outline'}
                    size={20}
                    color={isRecording ? colors.white : colors.text.secondary}
                  />
              }
            </TouchableOpacity>

            <TextInput
              style={[styles.textInput, !canSend && styles.textInputDisabled]}
              value={input}
              onChangeText={setInput}
              placeholder={canSend ? `Preguntale a ${bot.name}...` : 'Límite alcanzado'}
              placeholderTextColor={colors.text.tertiary}
              multiline
              maxLength={500}
              selectionColor={bot.color}
              editable={canSend && !isRecording}
              returnKeyType="default"
            />

            <TouchableOpacity
              style={[
                styles.sendBtn,
                { backgroundColor: bot.color },
                (!input.trim() || isThinking || !canSend || isRecording) && styles.sendBtnDisabled,
              ]}
              onPress={() => sendMessage(input)}
              disabled={!input.trim() || isThinking || !canSend || isRecording}
            >
              {isThinking
                ? <ActivityIndicator size="small" color={colors.white} />
                : <Ionicons name="send" size={17} color={colors.white} />
              }
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Modal de edición de título */}
      <Modal
        visible={editModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditModal(prev => ({ ...prev, visible: false }))}
      >
        <TouchableOpacity
          style={modalStyles.overlay}
          activeOpacity={1}
          onPress={() => setEditModal(prev => ({ ...prev, visible: false }))}
        >
          <TouchableOpacity activeOpacity={1} style={modalStyles.box}>
            <Text variant="subtitle" style={{ marginBottom: spacing[3] }}>Renombrar conversación</Text>
            <TextInput
              style={modalStyles.input}
              value={editModal.text}
              onChangeText={text => setEditModal(prev => ({ ...prev, text }))}
              placeholder="Nombre del chat"
              placeholderTextColor={colors.text.tertiary}
              selectionColor={bot.color}
              autoFocus
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={saveEditedTitle}
            />
            <View style={modalStyles.actions}>
              <TouchableOpacity
                style={modalStyles.cancelBtn}
                onPress={() => setEditModal(prev => ({ ...prev, visible: false }))}
              >
                <Text variant="label" color={colors.text.secondary}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[modalStyles.saveBtn, { backgroundColor: bot.color }]}
                onPress={saveEditedTitle}
              >
                <Text variant="label" color={colors.white}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const modalStyles = StyleSheet.create({
  overlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent:  'center',
    alignItems:      'center',
    padding:         spacing[5],
  },
  box: {
    width:           '100%',
    backgroundColor: colors.bg.card,
    borderRadius:    16,
    padding:         spacing[5],
    gap:             spacing[2],
  },
  input: {
    ...textVariants.body,
    color:             colors.text.primary,
    backgroundColor:   colors.bg.elevated,
    borderWidth:       1,
    borderColor:       colors.border.default,
    borderRadius:      10,
    paddingHorizontal: spacing[4],
    paddingVertical:   spacing[3],
    marginBottom:      spacing[2],
  },
  actions: {
    flexDirection:  'row',
    gap:            spacing[3],
    justifyContent: 'flex-end',
    marginTop:      spacing[1],
  },
  cancelBtn: {
    paddingVertical:   spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius:      8,
    borderWidth:       1,
    borderColor:       colors.border.default,
  },
  saveBtn: {
    paddingVertical:   spacing[2],
    paddingHorizontal: spacing[5],
    borderRadius:      8,
  },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  flex: { flex: 1 },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical:   spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    backgroundColor:   colors.bg.card,
  },

  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[4],
    paddingHorizontal: layout.screenPadding,
  },

  // Bots view
  botsScroll: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical:   spacing[4],
    gap:               spacing[3],
  },
  botCard: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             spacing[4],
    backgroundColor: colors.bg.card,
    borderWidth:     1,
    borderColor:     colors.border.default,
    borderRadius:    14,
    padding:         spacing[4],
  },
  botCardIcon: {
    width:          56,
    height:         56,
    borderRadius:   28,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },

  // Threads view
  newThreadBtn: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            spacing[1],
    borderWidth:    1,
    borderRadius:   8,
    paddingVertical:   6,
    paddingHorizontal: 10,
  },
  threadsList: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical:   spacing[3],
    gap:               spacing[2],
  },
  threadRow: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             spacing[3],
    backgroundColor: colors.bg.card,
    borderWidth:     1,
    borderColor:     colors.border.default,
    borderRadius:    12,
    padding:         spacing[4],
  },
  threadIcon: {
    width:          36,
    height:         36,
    borderRadius:   18,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  threadActionBtn: {
    padding:         spacing[2],
    borderRadius:    6,
  },
  startChatBtn: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            spacing[2],
    borderRadius:   10,
    paddingVertical:   spacing[3],
    paddingHorizontal: spacing[5],
    marginTop:      spacing[2],
  },
  startChatText: { fontSize: 14, fontFamily: 'Montserrat_700Bold' },
  newChatBtn:    { padding: spacing[1] },

  // Chat view
  emptyState: {
    paddingHorizontal: layout.screenPadding,
    paddingTop:        spacing[8],
    paddingBottom:     spacing[6],
    alignItems:        'center',
    gap:               spacing[3],
  },
  emptyAvatar: {
    width:           72,
    height:          72,
    borderRadius:    36,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    spacing[1],
  },
  qaSection: { width: '100%', marginTop: spacing[3], gap: spacing[2] },
  qaChip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing[3],
    borderWidth:       1,
    borderRadius:      12,
    paddingVertical:   12,
    paddingHorizontal: spacing[3],
  },
  qaText: { flex: 1, lineHeight: 19 },

  messageList: {
    paddingHorizontal: layout.screenPadding,
    paddingTop:        spacing[4],
    paddingBottom:     spacing[3],
    gap:               spacing[3],
  },
  messageWrapper:     { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[2] },
  messageWrapperUser: { justifyContent: 'flex-end' },
  messageWrapperAI:   { justifyContent: 'flex-start' },
  avatarAI: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, flexShrink: 0,
  },
  bubble: {
    maxWidth: '80%', paddingHorizontal: spacing[4],
    paddingVertical: spacing[3], borderRadius: 16,
  },
  bubbleUser: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleAI: {
    backgroundColor: colors.bg.card, borderWidth: 1,
    borderColor: colors.border.default, borderBottomLeftRadius: 4,
  },
  thinkingRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[1], paddingBottom: spacing[2],
  },
  thinkingBubble: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    backgroundColor: colors.bg.card, borderWidth: 1,
    borderColor: colors.border.default, borderRadius: 16,
    borderBottomLeftRadius: 4, paddingHorizontal: spacing[4], paddingVertical: spacing[3],
  },

  // Input
  inputArea: {
    backgroundColor: colors.bg.card,
    borderTopWidth:  1,
    borderTopColor:  colors.border.subtle,
    paddingBottom:   spacing[4],
  },
  usageRow: {
    paddingHorizontal: layout.screenPadding,
    paddingTop:        spacing[2],
    paddingBottom:     spacing[1],
  },
  inputRow: {
    flexDirection:     'row',
    alignItems:        'flex-end',
    paddingHorizontal: layout.screenPadding,
    paddingTop:        spacing[2],
    gap:               spacing[2],
  },
  voiceBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border.default,
    backgroundColor: colors.bg.elevated, flexShrink: 0,
  },
  textInput: {
    flex:              1,
    ...textVariants.body,
    color:             colors.text.primary,
    backgroundColor:   colors.bg.input,
    borderWidth:       1,
    borderColor:       colors.border.default,
    borderRadius:      22,
    paddingHorizontal: spacing[4],
    paddingVertical:   spacing[3],
    maxHeight:         120,
    minHeight:         44,
  },
  textInputDisabled: { opacity: 0.45 },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  sendBtnDisabled: { opacity: 0.35 },
});
