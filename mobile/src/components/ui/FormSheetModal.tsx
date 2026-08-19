import React from 'react';
import {
  Modal,
  View,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text } from './Text';

// ─── FormSheetModal ─────────────────────────────────────────────────────────
// Cascarón compartido para los modales de "agregar/editar" de la app: handle,
// header (título + cerrar) y body scrolleable. Antes cada pantalla
// reimplementaba esto casi textual (~15 instancias en 8 pantallas).

interface FormSheetModalProps {
  visible: boolean;
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  onBack?: () => void;
  children: React.ReactNode;
  presentationStyle?: 'pageSheet' | 'formSheet';
  contentContainerStyle?: ViewStyle;
  scrollable?: boolean;
  backgroundColor?: string;
}

export function FormSheetModal({
  visible,
  title,
  subtitle,
  onClose,
  onBack,
  children,
  presentationStyle = 'pageSheet',
  contentContainerStyle,
  scrollable = true,
  backgroundColor,
}: FormSheetModalProps) {
  const body = (
    <>
      <View style={styles.handle} />
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginRight: spacing[2] }}>
            <Ionicons name="arrow-back" size={22} color={colors.text.secondary} />
          </TouchableOpacity>
        )}
        <View style={{ gap: 2, flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          {subtitle}
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={22} color={colors.text.secondary} />
        </TouchableOpacity>
      </View>
      {scrollable ? (
        <ScrollView
          contentContainerStyle={[styles.body, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.body, contentContainerStyle]}>{children}</View>
      )}
    </>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={presentationStyle} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <SafeAreaView style={[styles.sheet, backgroundColor ? { backgroundColor } : null]}>{body}</SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── FormSheetButton ────────────────────────────────────────────────────────
// El botón "Guardar/Confirmar" de cierre de cada modal — mismo esqueleto en
// todos lados (loading state + label), solo cambia el color/label por pantalla.

interface FormSheetButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  color?: string;
  variant?: 'primary' | 'secondary';
  icon?: keyof typeof Ionicons.glyphMap;
}

export function FormSheetButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  color = colors.primary,
  variant = 'primary',
  icon,
}: FormSheetButtonProps) {
  const isPrimary = variant === 'primary';
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity
      style={[
        styles.btn,
        isPrimary
          ? { backgroundColor: color }
          : { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: color + '40' },
        isDisabled && { opacity: 0.6 },
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator size="small" color={isPrimary ? '#FFFFFF' : color} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={isPrimary ? '#FFFFFF' : color} />}
          <Text style={[styles.btnText, !isPrimary && { color }]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  sheet:  { flex: 1, backgroundColor: colors.bg.card },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border.default, alignSelf: 'center', marginTop: spacing[3] },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing[5], paddingTop: spacing[3],
  },
  title:  { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: colors.text.primary },
  body:   { padding: spacing[5], gap: spacing[3], paddingBottom: spacing[10] },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2],
    borderRadius: 14, height: 54, marginTop: spacing[2],
  },
  btnText: { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: '#FFFFFF' },
});
