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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout, textVariants } from '@/theme';
import { Text } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';
import { useLocalSearchParams } from 'expo-router';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface ClientContext {
  month_total: number;
  income: number | null;
  income_pct: number | null;
  month_status: 'good' | 'tight' | 'over';
  necessary: number;
  disposable: number;
  disposable_pct: number;
  investable: number;
  recoverable: number;
}

// ─── Lógica de contexto ───────────────────────────────────────────────────────

function buildClientContext(
  totalThisMonth: number,
  totalNecessary: number,
  totalDisposable: number,
  totalInvestable: number,
  estimatedIncome: number | null,
): ClientContext {
  const total     = totalThisMonth;
  const dispPct   = total > 0 ? Math.round((totalDisposable / total) * 100) : 0;
  const incomePct = estimatedIncome && estimatedIncome > 0
    ? Math.round((total / estimatedIncome) * 100)
    : null;

  const status: ClientContext['month_status'] =
    incomePct !== null && incomePct > 100 ? 'over' :
    (incomePct !== null && incomePct > 85) || dispPct > 20 ? 'tight' :
    'good';

  return {
    month_total:    total,
    income:         estimatedIncome,
    income_pct:     incomePct,
    month_status:   status,
    necessary:      totalNecessary,
    disposable:     totalDisposable,
    disposable_pct: dispPct,
    investable:     totalInvestable,
    recoverable:    total > 0 ? Math.round(totalDisposable * 0.5) : 0,
  };
}

function buildQuickActions(ctx: ClientContext): string[] {
  const actions: string[] = [];

  // Acción primaria según estado del mes
  if (ctx.month_status === 'over') {
    actions.push('¿Cómo recorto gastos para no pasarme del ingreso?');
  } else if (ctx.month_status === 'tight') {
    actions.push('¿Qué gastos puedo ajustar este mes?');
  } else if (ctx.recoverable > 0) {
    actions.push(`Tengo ~${formatCurrency(ctx.recoverable)} disponibles — ¿en qué los invierto?`);
  } else {
    actions.push('¿Cómo mejoro mi situación financiera este mes?');
  }

  // Segunda acción según prescindibles
  if (ctx.disposable_pct > 15) {
    actions.push('¿Cuáles son mis gastos más prescindibles?');
  } else {
    actions.push('¿Mis gastos están bien distribuidos?');
  }

  // Acciones fijas útiles
  actions.push('¿Cuál es mi plan para el próximo mes?');
  actions.push('¿Me conviene FCI, Cedears o dólar MEP?');

  return actions;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AdvisorScreen() {
  const { user, profile }  = useAuthStore();
  const { totalThisMonth, totalNecessary, totalDisposable, totalInvestable, estimatedIncome } = useExpensesStore();
  const { initialContext } = useLocalSearchParams<{ initialContext?: string }>();

  const [messages,      setMessages]      = useState<ChatMessage[]>([]);
  const [input,         setInput]         = useState('');
  const [isThinking,    setIsThinking]    = useState(false);
  const [welcomeDone,   setWelcomeDone]   = useState(false);

  const flatListRef  = useRef<FlatList>(null);
  const welcomeRef   = useRef(false);

  // Contexto del mes calculado desde el store
  const clientContext = useMemo(() => buildClientContext(
    totalThisMonth, totalNecessary, totalDisposable, totalInvestable, estimatedIncome,
  ), [totalThisMonth, totalNecessary, totalDisposable, totalInvestable, estimatedIncome]);

  // Quick actions contextuales
  const quickActions = useMemo(() => buildQuickActions(clientContext), [clientContext]);

  // Generar bienvenida automática al montar
  useEffect(() => {
    if (!user?.id || welcomeRef.current) return;
    welcomeRef.current = true;
    generateWelcome();
  }, [user?.id]);

  const generateWelcome = useCallback(async () => {
    setIsThinking(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-advisor', {
        body: {
          generate_welcome:  true,
          client_context:    clientContext,
          initial_context:   initialContext ?? null,
          user_id:           user!.id,
        },
      });
      if (!error && data?.message) {
        setMessages([{
          id:         `welcome-${Date.now()}`,
          role:       'assistant',
          content:    data.message,
          created_at: new Date().toISOString(),
        }]);
      }
    } catch {
      // Falla silenciosa — el usuario ve el estado vacío igual
    } finally {
      setIsThinking(false);
      setWelcomeDone(true);
    }
  }, [clientContext, initialContext, user?.id]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !user?.id || isThinking) return;

    const userMsg: ChatMessage = {
      id:         `user-${Date.now()}`,
      role:       'user',
      content:    text.trim(),
      created_at: new Date().toISOString(),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsThinking(true);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      const { data, error } = await supabase.functions.invoke('ai-advisor', {
        body: {
          message:        text.trim(),
          history,
          user_id:        user.id,
          client_context: clientContext,
        },
      });

      if (error) {
        const ctx  = (error as any)?.context;
        const body = ctx ? await ctx.text?.() : null;
        throw new Error(body ?? error.message);
      }
      if (!data?.message) throw new Error(`Sin mensaje: ${JSON.stringify(data)}`);

      setMessages((prev) => [...prev, {
        id:         `ai-${Date.now()}`,
        role:       'assistant',
        content:    data.message,
        created_at: new Date().toISOString(),
      }]);
    } catch {
      setMessages((prev) => [...prev, {
        id:         `err-${Date.now()}`,
        role:       'assistant',
        content:    'Uy, algo salió mal de nuestro lado. Probá de nuevo en un momento.',
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setIsThinking(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages, user?.id, isThinking, clientContext]);

  const clearChat = () => {
    setMessages([]);
    welcomeRef.current = false;
    setWelcomeDone(false);
    generateWelcome();
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageWrapper, isUser ? styles.messageWrapperUser : styles.messageWrapperAI]}>
        {!isUser && (
          <View style={styles.avatarAI}>
            <Text variant="label" color={colors.black} style={{ fontSize: 10 }}>SP</Text>
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAI]}>
          <Text variant="bodySmall" color={isUser ? colors.black : colors.text.primary} style={{ lineHeight: 21 }}>
            {item.content}
          </Text>
        </View>
      </View>
    );
  };

  const showEmptyState = messages.length === 0 && !isThinking;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.advisorAvatar}>
            <Text variant="label" color={colors.black} style={{ fontSize: 11 }}>SP</Text>
          </View>
          <View>
            <Text variant="subtitle">Asesor SmartPesos</Text>
            <Text variant="caption" color={colors.neon}>IA con contexto financiero real</Text>
          </View>
        </View>
        {messages.length > 0 && (
          <TouchableOpacity onPress={clearChat} style={styles.refreshBtn}>
            <Ionicons name="refresh-outline" size={20} color={colors.text.secondary} />
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        {/* Cuerpo */}
        {showEmptyState ? (
          /* Estado vacío — solo si la bienvenida falló */
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.emptyState} keyboardShouldPersistTaps="handled">
            <View style={styles.emptyAvatar}>
              <Text variant="h3" color={colors.black}>SP</Text>
            </View>
            <Text variant="subtitle" align="center">
              Hola, {profile?.full_name?.split(' ')[0] ?? 'ahí'}
            </Text>
            <Text variant="body" color={colors.text.secondary} align="center">
              Soy tu asesor financiero. Tengo contexto real de tu mes. ¿Por dónde arrancamos?
            </Text>
            <QuickActionList actions={quickActions} onPress={sendMessage} />
          </ScrollView>
        ) : messages.length === 0 && isThinking ? (
          /* Generando bienvenida */
          <View style={styles.loadingWelcome}>
            <View style={styles.emptyAvatar}>
              <Text variant="h3" color={colors.black}>SP</Text>
            </View>
            <View style={styles.thinkingBubble}>
              <ActivityIndicator color={colors.neon} size="small" />
              <Text variant="caption" color={colors.text.secondary}>Analizando tu mes...</Text>
            </View>
          </View>
        ) : (
          /* Chat */
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            keyboardShouldPersistTaps="handled"
            ListFooterComponent={
              isThinking ? (
                <View style={styles.thinkingWrapper}>
                  <View style={styles.avatarAI}>
                    <Text variant="label" color={colors.black} style={{ fontSize: 10 }}>SP</Text>
                  </View>
                  <View style={[styles.bubbleAI, styles.thinkingBubbleInline]}>
                    <ActivityIndicator color={colors.neon} size="small" />
                  </View>
                </View>
              ) : null
            }
          />
        )}

        {/* Input */}
        <View style={styles.inputContainer}>
          {/* Quick actions — siempre visibles */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.actionsRow}
            keyboardShouldPersistTaps="handled"
          >
            {quickActions.map((q) => (
              <TouchableOpacity
                key={q}
                style={styles.actionChip}
                onPress={() => sendMessage(q)}
                disabled={isThinking}
              >
                <Text variant="caption" color={colors.neon} numberOfLines={1}>{q}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.textInput}
              value={input}
              onChangeText={setInput}
              placeholder="Preguntame lo que quieras..."
              placeholderTextColor={colors.text.tertiary}
              multiline
              maxLength={500}
              selectionColor={colors.neon}
              onSubmitEditing={() => sendMessage(input)}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!input.trim() || isThinking) && styles.sendBtnDisabled]}
              onPress={() => sendMessage(input)}
              disabled={!input.trim() || isThinking}
            >
              <Ionicons
                name="send"
                size={18}
                color={!input.trim() || isThinking ? colors.text.tertiary : colors.black}
              />
            </TouchableOpacity>
          </View>
          <Text variant="caption" color={colors.text.tertiary} align="center" style={styles.disclaimer}>
            Orientación general, no asesoramiento financiero profesional.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── QuickActionList ──────────────────────────────────────────────────────────

function QuickActionList({ actions, onPress }: { actions: string[]; onPress: (q: string) => void }) {
  return (
    <View style={qaStyles.container}>
      <Text variant="label" color={colors.text.secondary} style={qaStyles.title}>PREGUNTAS RÁPIDAS</Text>
      {actions.map((q) => (
        <TouchableOpacity key={q} style={qaStyles.chip} onPress={() => onPress(q)}>
          <Ionicons name="flash-outline" size={14} color={colors.neon} />
          <Text variant="bodySmall" color={colors.text.primary} style={{ flex: 1, lineHeight: 18 }}>{q}</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.text.tertiary} />
        </TouchableOpacity>
      ))}
    </View>
  );
}
const qaStyles = StyleSheet.create({
  container: { width: '100%', gap: spacing[2], marginTop: spacing[4] },
  title:     { marginBottom: spacing[1] },
  chip:      {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    borderWidth: 1, borderColor: colors.border.default, borderRadius: 10,
    padding: spacing[3], backgroundColor: colors.bg.card,
  },
});

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: layout.screenPadding, paddingVertical: spacing[4],
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  headerLeft:    { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  advisorAvatar: { width: 40, height: 40, backgroundColor: colors.primary, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  refreshBtn:    { padding: spacing[2] },

  emptyState: {
    paddingHorizontal: layout.screenPadding, paddingTop: spacing[8],
    alignItems: 'center', gap: spacing[4], paddingBottom: spacing[8],
  },
  emptyAvatar: {
    width: 72, height: 72, backgroundColor: colors.primary,
    borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[2],
  },

  loadingWelcome: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[5] },
  thinkingBubble: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    backgroundColor: colors.bg.elevated, borderRadius: 12,
    paddingHorizontal: spacing[5], paddingVertical: spacing[3],
    borderWidth: 1, borderColor: colors.border.default,
  },

  messageList: { paddingHorizontal: layout.screenPadding, paddingVertical: spacing[4], gap: spacing[4] },
  messageWrapper:     { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[2] },
  messageWrapperUser: { justifyContent: 'flex-end' },
  messageWrapperAI:   { justifyContent: 'flex-start' },
  avatarAI: { width: 28, height: 28, backgroundColor: colors.primary, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  bubble:     { maxWidth: '78%', padding: spacing[4], borderRadius: 12 },
  bubbleUser: { backgroundColor: colors.primary, borderBottomRightRadius: 2 },
  bubbleAI:   { backgroundColor: colors.bg.elevated, borderWidth: 1, borderColor: colors.border.default, borderBottomLeftRadius: 2 },

  thinkingWrapper:     { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2], paddingHorizontal: layout.screenPadding },
  thinkingBubbleInline:{ minWidth: 60, minHeight: 44, alignItems: 'center', justifyContent: 'center' },

  inputContainer: { borderTopWidth: 1, borderTopColor: colors.border.subtle, backgroundColor: colors.bg.secondary },

  actionsRow: { paddingHorizontal: layout.screenPadding, paddingVertical: spacing[2], gap: spacing[2] },
  actionChip: {
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
    borderWidth: 1, borderColor: colors.neon + '44',
    borderRadius: 16, backgroundColor: colors.neon + '0D', maxWidth: 240,
  },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: layout.screenPadding, paddingVertical: spacing[3], gap: spacing[3],
  },
  textInput: {
    flex: 1, ...textVariants.body, color: colors.text.primary,
    backgroundColor: colors.bg.input, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 8, paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    maxHeight: 100, minHeight: 44,
  },
  sendBtn:         { width: 44, height: 44, backgroundColor: colors.primary, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: colors.mediumGray },
  disclaimer:      { paddingBottom: spacing[3] },
});
