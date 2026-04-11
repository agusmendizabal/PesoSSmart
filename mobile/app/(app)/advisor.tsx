import React, { useEffect, useRef, useState } from 'react';
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
import { supabase } from '@/lib/supabase';
import { useLocalSearchParams } from 'expo-router';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

const SUGGESTED_QUESTIONS = [
  '¿En qué estoy gastando de más este mes?',
  '¿Qué hago con la plata que me sobra?',
  '¿Mis suscripciones valen la pena?',
  '¿Cómo arranco a invertir con poco?',
  '¿Cuánto me falta para mi meta de ahorro?',
  '¿Cómo bajo mis gastos prescindibles?',
  '¿Me conviene el dólar MEP?',
];

export default function AdvisorScreen() {
  const { user, profile } = useAuthStore();
  const { initialContext } = useLocalSearchParams<{ initialContext?: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const contextSentRef = useRef(false);

  // Si viene con contexto del Informe, enviarlo automáticamente como primer mensaje
  useEffect(() => {
    if (initialContext && !contextSentRef.current && user?.id) {
      contextSentRef.current = true;
      sendMessage(initialContext);
    }
  }, [initialContext, user?.id]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || !user?.id || isThinking) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      created_at: new Date().toISOString(),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsThinking(true);

    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      const { data, error } = await supabase.functions.invoke('ai-advisor', {
        body: {
          message: text.trim(),
          history,
          user_id: user.id,
        },
      });

      if (error) {
        const ctx = (error as any)?.context;
        const body = ctx ? await ctx.text?.() : null;
        throw new Error(body ?? error.message);
      }
      if (!data?.message) throw new Error(`Sin mensaje: ${JSON.stringify(data)}`);

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: data.message,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch {
      const errMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: 'Uy, algo salió mal de nuestro lado. Probá de nuevo en un momento.',
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsThinking(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const clearChat = () => setMessages([]);

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
          <Text
            variant="bodySmall"
            color={isUser ? colors.black : colors.text.primary}
            style={{ lineHeight: 20 }}
          >
            {item.content}
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
            <Text variant="label" color={colors.black} style={{ fontSize: 11 }}>SP</Text>
          </View>
          <View>
            <Text variant="subtitle">Asesor SmartPesos</Text>
            <Text variant="caption" color={colors.neon}>IA con contexto financiero real</Text>
          </View>
        </View>
        {messages.length > 0 && (
          <TouchableOpacity onPress={clearChat} style={styles.refreshBtn}>
            <Ionicons name="trash-outline" size={20} color={colors.text.secondary} />
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        {/* Messages */}
        {messages.length === 0 ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.emptyState}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.emptyAvatar}>
              <Text variant="h3" color={colors.black}>SP</Text>
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
          </ScrollView>
        ) : (
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
              keyboardShouldPersistTaps="handled"
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
    backgroundColor: colors.primary,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtn: { padding: spacing[2] },
  emptyState: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[8],
    alignItems: 'center',
    gap: spacing[4],
    paddingBottom: spacing[8],
  },
  emptyAvatar: {
    width: 72,
    height: 72,
    backgroundColor: colors.primary,
    borderRadius: 36,
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
    borderColor: colors.primary + '44',
    borderRadius: 8,
    padding: spacing[3],
    backgroundColor: colors.primary + '0D',
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
    backgroundColor: colors.primary,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bubble: {
    maxWidth: '78%',
    padding: spacing[4],
    borderRadius: 12,
  },
  bubbleUser: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 2,
  },
  bubbleAI: {
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderBottomLeftRadius: 2,
    minWidth: 60,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thinkingWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: layout.screenPadding,
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
    borderRadius: 16,
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
    borderRadius: 8,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    maxHeight: 100,
    minHeight: 44,
  },
  sendBtn: {
    width: 44,
    height: 44,
    backgroundColor: colors.primary,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.mediumGray },
  disclaimer: { paddingBottom: spacing[3] },
});
