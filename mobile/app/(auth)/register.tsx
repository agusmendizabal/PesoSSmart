import React, { useRef, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Button, Input } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import type { RegisterForm } from '@/types';

const registerSchema = z
  .object({
    full_name: z
      .string()
      .min(2, 'Ingresá tu nombre completo.')
      .max(60, 'El nombre es muy largo.'),
    email: z.string().email('Ingresá un email válido.'),
    password: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres.')
      .regex(/[A-Z]/, 'Necesita al menos una mayúscula.')
      .regex(/[0-9]/, 'Necesita al menos un número.'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmPassword'],
  });

export default function RegisterScreen() {
  const { signUp, isLoading, error, clearError } = useAuthStore();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const [registered, setRegistered] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
    getValues,
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      full_name: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  const onSubmit = async ({ full_name, email, password }: RegisterForm) => {
    clearError();
    try {
      await signUp(email.trim().toLowerCase(), password, full_name.trim());
      setRegistered(true);
    } catch {
      // error en store
    }
  };

  if (registered) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={64} color={colors.neon} />
          </View>
          <Text variant="h3" align="center" style={styles.successTitle}>
            ¡Listo!
          </Text>
          <Text variant="body" color={colors.text.secondary} align="center" style={styles.successText}>
            Te mandamos un email de confirmación a{' '}
            <Text variant="body" color={colors.text.primary}>
              {getValues('email')}
            </Text>
            .{'\n'}Confirmá tu cuenta y después volvé a entrar.
          </Text>
          <Button
            label="IR AL LOGIN"
            variant="neon"
            fullWidth
            onPress={() => router.replace('/(auth)/login')}
            style={styles.successBtn}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.brand}>
            <Text variant="h1" color={colors.text.primary}>
              SMART<Text variant="h1" color={colors.neon}>PESOS</Text>
            </Text>
          </View>

          <View style={styles.header}>
            <Text variant="h3">Creá tu cuenta</Text>
            <Text variant="body" color={colors.text.secondary}>
              Empezá a entender tu plata hoy.
            </Text>
          </View>

          {/* Formulario */}
          <View style={styles.form}>
            <Controller
              control={control}
              name="full_name"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="NOMBRE COMPLETO"
                  placeholder="Juan García"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.full_name?.message}
                  autoCapitalize="words"
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                />
              )}
            />

            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  ref={emailRef}
                  label="EMAIL"
                  placeholder="tu@email.com"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.email?.message}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              )}
            />

            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  ref={passwordRef}
                  label="CONTRASEÑA"
                  placeholder="Mínimo 8 caracteres"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.password?.message}
                  hint="Al menos 8 caracteres, una mayúscula y un número."
                  secureTextEntry
                  returnKeyType="next"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                />
              )}
            />

            <Controller
              control={control}
              name="confirmPassword"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  ref={confirmRef}
                  label="REPETIR CONTRASEÑA"
                  placeholder="••••••••"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.confirmPassword?.message}
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit(onSubmit)}
                />
              )}
            />

            {error && (
              <View style={styles.errorBox}>
                <Text variant="bodySmall" color={colors.text.error}>
                  {error}
                </Text>
              </View>
            )}

            <Button
              label="CREAR CUENTA"
              variant="neon"
              size="lg"
              fullWidth
              isLoading={isLoading}
              onPress={handleSubmit(onSubmit)}
              style={styles.submitBtn}
            />

            <Text variant="caption" color={colors.text.secondary} align="center">
              Al crear tu cuenta aceptás nuestros términos y política de privacidad.
            </Text>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text variant="body" color={colors.text.secondary}>
              ¿Ya tenés cuenta?{' '}
            </Text>
            <TouchableOpacity onPress={() => router.replace('/(auth)/login')}>
              <Text variant="body" color={colors.neon}>
                Ingresá
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  kav: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing[8],
  },
  topBar: {
    paddingTop: spacing[4],
    paddingBottom: spacing[6],
  },
  brand: {
    marginBottom: spacing[6],
  },
  header: {
    marginBottom: spacing[8],
    gap: spacing[2],
  },
  form: {
    gap: spacing[4],
  },
  errorBox: {
    backgroundColor: colors.red + '1A',
    borderWidth: 1,
    borderColor: colors.border.error,
    borderRadius: 8,
    padding: spacing[3],
  },
  submitBtn: {
    marginTop: spacing[2],
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing[8],
  },
  successContainer: {
    flex: 1,
    paddingHorizontal: layout.screenPadding,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[6],
  },
  successIcon: {
    marginBottom: spacing[2],
  },
  successTitle: {
    marginBottom: spacing[1],
  },
  successText: {
    lineHeight: 24,
  },
  successBtn: {
    marginTop: spacing[4],
    width: '100%',
  },
});
