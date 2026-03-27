import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  FlatList,
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
import { Text, Card } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { formatRelativeTime } from '@/utils/format';
import type { AIChatMessage, AIChatThread } from '@/types';

const SUGGESTED_QUESTIONS = [
  '¿Cuánto debería tener de ahorro de emergencia?',
  '¿Cómo arranco a invertir con poco?',
  '¿Me conviene el dólar MEP?',
  '¿Qué FCI me recomendás para empezar?',
  '¿Cómo hago para gastar menos sin sufrir?',
];

export default function AdvisorScreen() {
  const { user, profile } = useAuthStore();
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [thread, setThread] = useState<AIChatThread | null>(null);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (user?.id) loadOrCreateThread();
  }, [user?.id]);

  const loadOrCreateThread = async () => {
    if (!user?.id) return;
    setIsLoadingHistory(true);
    try {
      // Buscar thread activo existente
      const { data: threads } = await supabase
        .from('ai_chat_threads')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1);

      let activeThread = threads?.[0] ?? null;

      if (!activeThread) {
        const { data: newThread } = await supabase
          .from('ai_chat_threads')
          .insert({
            user_id: user.id,
            title: 'Chat con el asesor',
            is_active: true,
            message_count: 0,
          })
          .select()
          .single();
        activeThread = newThread;
      }

      setThread(activeThread);

      if (activeThread) {
        const { data: msgs } = await supabase
          .from('ai_chat_messages')
          .select('*')
          .eq('thread_id', activeThread.id)
          .order('created_at', { ascending: true });
        setMessages(msgs ?? []);
      }
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || !user?.id || !thread || isThinking) return;

    const userMessage: AIChatMessage = {
      id: `temp-${Date.now()}`,
      thread_id: thread.id,
      user_id: user.id,
      role: 'user',
      content: text.trim(),
      tokens_used: null,
      model: null,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsThinking(true);

    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      // Guardar mensaje del usuario en Supabase
      const { data: savedUserMsg } = await supabase
        .from('ai_chat_messages')
        .insert({
          thread_id: thread.id,
          user_id: user.id,
          role: 'user',
          content: text.trim(),
        })
        .select()
        .single();

      // Llamar a la Edge Function segura de Supabase
      const { data: aiResponse, error } = await supabase.functions.invoke('ai-advisor', {
        body: {
          thread_id: thread.id,
          message: text.trim(),
          user_id: user.id,
        },
      });

      if (error) throw error;

      const assistantMessage: AIChatMessage = {
        id: `temp-ai-${Date.now()}`,
        thread_id: thread.id,
        user_id: user.id,
        role: 'assistant',
        content: aiResponse.message,
        tokens_used: aiResponse.tokens_used ?? null,
        model: aiResponse.model ?? null,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== userMessage.id),
        savedUserMsg as AIChatMessage,
        assistantMessage,
      ]);

      // Actualizar contador del thread
      await supabase
        .from('ai_chat_threads')
        .update({
          message_count: (thread.message_count ?? 0) + 2,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', thread.id);

    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
      const errorMsg: AIChatMessage = {
        id: `error-${Date.now()}`,
        thread_id: thread.id,
        user_id: user.id,
        role: 'assistant',
        content: 'Uy, algo salió mal de nuestro lado. Probá de nuevo en un momento.',
        tokens_used: null,
        model: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsThinking(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const renderMessage = ({ item }: { item: AIChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageWrapper, isUser ? styles.messageWrapperUser : styles.messageWrapperAI]}>
        {!isUser && (
          <View style={styles.avatarAI}>
            <Text variant="label" color={colors.black} style={{ fontSize: 10 }}>PS</Text>
          </View>
        )}
        <View
          style={[
            styles.bubble,
            isUser ? styles.bubbleUser : styles.bubbleAI,
          ]}
        >
          <Text
            variant="bodySmall"
            color={isUser ? colors.black : colors.text.primary}
            style={{ lineHeight: 20 }}
          >
            {item.content}
          </Text>
          <Text
            variant="caption"
            color={isUser ? colors.black + '88' : colors.text.tertiary}
            style={styles.messageTime}
          >
            {formatRelativeTime(item.created_at)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.advisorAvatar}>
            <Text variant="label" color={colors.black} style={{ fontSize: 11 }}>PS</Text>
          </View>
          <View>
            <Text variant="subtitle">Asesor SmartPesos</Text>
            <Text variant="caption" color={colors.neon}>IA con contexto financiero real</Text>
          </View>
        </View>
        <TouchableOpacity onPress={loadOrCreateThread} style={styles.refreshBtn}>
          <Ionicons name="refresh-outline" size={20} color={colors.text.secondary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={90}
      >
        {/* Messages */}
        {isLoadingHistory ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.neon} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyAvatar}>
              <Text variant="h3" color={colors.black}>PS</Text>
            </View>
            <Text variant="subtitle" align="center">
              Hola, {profile?.full_name?.split(' ')[0] ?? 'ahí'}
            </Text>
            <Text variant="body" color={colors.text.secondary} align="center">
              Soy tu asesor financiero personal. Preguntame lo que quieras sobre tu plata, inversiones o gastos.
            </Text>
            <Text variant="caption" color={colors.text.tertiary} align="center">
              Tengo contexto real de tu perfil financiero.
            </Text>

            <View style={styles.suggestedQuestions}>
              <Text variant="label" color={colors.text.secondary} style={styles.suggestedTitle}>
                ALGUNAS IDEAS:
              </Text>
              {SUGGESTED_QUESTIONS.map((q) => (
                <TouchableOpacity
                  key={q}
                  style={styles.suggestedChip}
                  onPress={() => sendMessage(q)}
                >
                  <Text variant="bodySmall" color={colors.neon}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() =>
              flatListRef.current?.scrollToEnd({ animated: false })
            }
            ListFooterComponent={
              isThinking ? (
                <View style={styles.thinkingWrapper}>
                  <View style={styles.avatarAI}>
                    <Text variant="label" color={colors.black} style={{ fontSize: 10 }}>PS</Text>
                  </View>
                  <View style={styles.bubbleAI}>
                    <ActivityIndicator color={colors.neon} size="small" />
                  </View>
                </View>
              ) : null
            }
          />
        )}

        {/* Input */}
        <View style={styles.inputContainer}>
          {messages.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.suggestionsRow}
            >
              {SUGGESTED_QUESTIONS.slice(0, 3).map((q) => (
                <TouchableOpacity
                  key={q}
                  style={styles.inlineSuggestion}
                  onPress={() => sendMessage(q)}
                >
                  <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
                    {q}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
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
              returnKeyType="send"
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  advisorAvatar: {
    width: 40,
    height: 40,
    backgroundColor: colors.neon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtn: { padding: spacing[2] },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyState: {
    flex: 1,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[8],
    alignItems: 'center',
    gap: spacing[4],
  },
  emptyAvatar: {
    width: 72,
    height: 72,
    backgroundColor: colors.neon,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  suggestedQuestions: {
    width: '100%',
    marginTop: spacing[4],
    gap: spacing[3],
  },
  suggestedTitle: { marginBottom: spacing[1] },
  suggestedChip: {
    borderWidth: 1,
    borderColor: colors.neon + '44',
    padding: spacing[3],
    backgroundColor: colors.neon + '08',
  },
  messageList: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[4],
    gap: spacing[4],
  },
  messageWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing[2],
  },
  messageWrapperUser: { justifyContent: 'flex-end' },
  messageWrapperAI: { justifyContent: 'flex-start' },
  avatarAI: {
    width: 28,
    height: 28,
    backgroundColor: colors.neon,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bubble: {
    maxWidth: '78%',
    padding: spacing[4],
    gap: spacing[1],
  },
  bubbleUser: {
    backgroundColor: colors.neon,
  },
  bubbleAI: {
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  messageTime: { marginTop: spacing[1] },
  thinkingWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
  },
  inputContainer: {
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    backgroundColor: colors.bg.secondary,
  },
  suggestionsRow: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[2],
    gap: spacing[2],
  },
  inlineSuggestion: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colors.border.default,
    maxWidth: 200,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  textInput: {
    flex: 1,
    ...textVariants.body,
    color: colors.text.primary,
    backgroundColor: colors.bg.input,
    borderWidth: 1,
    borderColor: colors.border.default,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    maxHeight: 100,
    minHeight: 44,
  },
  sendBtn: {
    width: 44,
    height: 44,
    backgroundColor: colors.neon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.mediumGray },
  disclaimer: { paddingBottom: spacing[3] },
});
