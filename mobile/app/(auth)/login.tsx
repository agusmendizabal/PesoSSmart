import React, { useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';

const { width } = Dimensions.get('window');
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { colors, spacing, layout } from '@/theme';
import { Text, Button, Input } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import type { LoginForm } from '@/types';

const loginSchema = z.object({
  email: z.string().email('Ingresá un email válido.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
});

export default function LoginScreen() {
  const { signIn, isLoading, error, clearError } = useAuthStore();
  const passwordRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async ({ email, password }: LoginForm) => {
    clearError();
    try {
      await signIn(email.trim().toLowerCase(), password);
      router.replace('/(app)/home');
    } catch {
      // El error ya está en el store
    }
  };

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
          {/* Logo / Marca */}
          <View style={styles.brand}>
            <View style={styles.brandAccent} />
            <View style={styles.brandRow}>
              <View style={styles.brandDot} />
              <Text variant="label" color={colors.neon} style={styles.brandTag}>
                FINANZAS PERSONALES
              </Text>
            </View>
            <Text variant="h1" color={colors.text.primary} style={styles.brandTitle}>
              SMART
              <Text variant="h1" color={colors.neon}>
                PESOS
              </Text>
            </Text>
            <View style={styles.brandDivider} />
            <Text variant="label" color={colors.text.secondary}>
              TU PLATA, INTELIGENTE.
            </Text>
          </View>

          {/* Título */}
          <View style={styles.header}>
            <Text variant="h3" color={colors.text.primary}>
              Bienvenido de vuelta
            </Text>
            <Text variant="body" color={colors.text.secondary} style={styles.subtitle}>
              Ingresá con tu cuenta para ver cómo va tu plata.
            </Text>
          </View>

          {/* Formulario */}
          <View style={styles.form}>
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
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
                  placeholder="••••••••"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.password?.message}
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

            <TouchableOpacity
              onPress={() => router.push('/(auth)/forgot-password')}
              style={styles.forgotLink}
            >
              <Text variant="bodySmall" color={colors.text.secondary}>
                ¿Olvidaste tu contraseña?
              </Text>
            </TouchableOpacity>

            <Button
              label="ENTRAR"
              variant="neon"
              size="lg"
              fullWidth
              isLoading={isLoading}
              onPress={handleSubmit(onSubmit)}
              style={styles.submitBtn}
            />
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text variant="body" color={colors.text.secondary}>
              ¿No tenés cuenta?{' '}
            </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
              <Text variant="body" color={colors.neon}>
                Creá una gratis
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
  kav: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[12],
    paddingBottom: spacing[8],
  },
  brand: {
    marginBottom: spacing[12],
    gap: spacing[2],
  },
  brandAccent: {
    width: 40,
    height: 4,
    backgroundColor: colors.neon,
    marginBottom: spacing[2],
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  brandDot: {
    width: 6,
    height: 6,
    backgroundColor: colors.neon,
  },
  brandTag: {
    letterSpacing: 2,
  },
  brandTitle: {
    lineHeight: 52,
  },
  brandDivider: {
    width: width * 0.5,
    height: 1,
    backgroundColor: colors.border.default,
    marginVertical: spacing[1],
  },
  header: {
    marginBottom: spacing[8],
    gap: spacing[2],
  },
  subtitle: {
    lineHeight: 22,
  },
  form: {
    gap: spacing[4],
    marginBottom: spacing[6],
  },
  errorBox: {
    backgroundColor: colors.red + '1A',
    borderWidth: 1,
    borderColor: colors.border.error,
    borderRadius: 8,
    padding: spacing[3],
  },
  forgotLink: {
    alignSelf: 'flex-end',
  },
  submitBtn: {
    marginTop: spacing[2],
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 'auto',
    paddingTop: spacing[8],
  },
});
