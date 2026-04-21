import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Card, Button } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { usePlanStore } from '@/store/planStore';
import { supabase } from '@/lib/supabase';
import { PLANS, type PlanId, formatMsgLimit } from '@/lib/plans';
import { formatCurrency } from '@/utils/format';

// ─── Feature rows para comparación ───────────────────────────────────────────

interface FeatureRow {
  label: string;
  free:    string | boolean;
  pro:     string | boolean;
  premium: string | boolean;
}

const FEATURES: FeatureRow[] = [
  { label: 'Informe mensual',           free: true,   pro: true,   premium: true    },
  { label: 'Mensajes con el asesor IA', free: '15',   pro: '100',  premium: '∞'     },
  { label: 'Análisis detallado',        free: false,  pro: true,   premium: true    },
  { label: 'Simulaciones',              free: false,  pro: true,   premium: true    },
  { label: 'Plan automático',           free: false,  pro: false,  premium: true    },
  { label: 'Seguimiento mensual',       free: false,  pro: false,  premium: true    },
];

// ─── Componentes ──────────────────────────────────────────────────────────────

function FeatureCell({ value, highlight }: { value: string | boolean; highlight: boolean }) {
  if (typeof value === 'boolean') {
    return (
      <View style={fcStyles.cell}>
        <Ionicons
          name={value ? 'checkmark' : 'close'}
          size={16}
          color={value ? (highlight ? colors.neon : colors.primary) : colors.text.tertiary}
        />
      </View>
    );
  }
  return (
    <View style={fcStyles.cell}>
      <Text variant="caption" color={highlight ? colors.neon : colors.text.primary}
        style={{ fontFamily: 'Montserrat_600SemiBold' }}>
        {value}
      </Text>
    </View>
  );
}
const fcStyles = StyleSheet.create({
  cell: { flex: 1, alignItems: 'center' },
});

// ─── Plan Card ────────────────────────────────────────────────────────────────

function PlanCard({
  planId,
  currentPlan,
  isTrialActive,
  onSelect,
  isLoading = false,
}: {
  planId: PlanId;
  currentPlan: PlanId;
  isTrialActive: boolean;
  onSelect: (id: PlanId) => void;
  isLoading?: boolean;
}) {
  const plan      = PLANS[planId];
  const isCurrent = planId === currentPlan;
  const isSelected= planId === currentPlan;

  return (
    <TouchableOpacity
      onPress={() => onSelect(planId)}
      activeOpacity={0.85}
    >
      <View style={[
        cardStyles.card,
        isSelected && { borderColor: plan.color, borderWidth: 2 },
        planId === 'premium' && { borderColor: colors.neon + '60' },
      ]}>
        {/* Badge */}
        {planId === 'premium' && (
          <View style={cardStyles.popularBadge}>
            <Text style={cardStyles.popularText}>MÁS COMPLETO</Text>
          </View>
        )}
        {isTrialActive && planId === 'premium' && (
          <View style={[cardStyles.popularBadge, { backgroundColor: colors.yellow }]}>
            <Text style={[cardStyles.popularText, { color: colors.black }]}>TRIAL ACTIVO</Text>
          </View>
        )}

        {/* Header */}
        <View style={cardStyles.header}>
          <Text style={{ fontSize: 24 }}>{plan.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text variant="subtitle" color={colors.text.primary}>{plan.name}</Text>
            <Text variant="caption" color={colors.text.secondary}>{plan.tagline}</Text>
          </View>
          <View style={cardStyles.priceBox}>
            {plan.price !== null ? (
              <>
                <Text variant="labelMd" color={plan.color}>
                  {formatCurrency(plan.price)}
                </Text>
                <Text variant="caption" color={colors.text.tertiary}>/mes</Text>
              </>
            ) : (
              <Text variant="labelMd" color={colors.text.secondary}>Gratis</Text>
            )}
          </View>
        </View>

        {/* Highlights */}
        <View style={cardStyles.highlights}>
          {plan.highlights.map((h, i) => (
            <View key={i} style={cardStyles.highlightRow}>
              <Ionicons name="checkmark-circle-outline" size={14} color={plan.color !== '#6B7280' ? plan.color : colors.primary} />
              <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, lineHeight: 17 }}>{h}</Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        {isCurrent ? (
          <View style={[cardStyles.ctaInactive]}>
            <Text variant="label" color={colors.text.tertiary}>
              {isTrialActive && planId === 'premium' ? 'TRIAL ACTIVO' : 'PLAN ACTUAL'}
            </Text>
          </View>
        ) : planId === 'free' ? null : (
          <TouchableOpacity
            style={[cardStyles.cta, { backgroundColor: plan.color }, isLoading && { opacity: 0.7 }]}
            onPress={() => onSelect(planId)}
            activeOpacity={0.85}
            disabled={isLoading}
          >
            {isLoading
              ? <ActivityIndicator size="small" color={planId === 'premium' ? colors.white : colors.black} />
              : <Text style={[cardStyles.ctaText, { color: planId === 'premium' ? colors.white : colors.black }]}>
                  {plan.ctaLabel}
                </Text>
            }
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}
const cardStyles = StyleSheet.create({
  card: {
    borderWidth: 1, borderColor: colors.border.default, borderRadius: 12,
    backgroundColor: colors.bg.card, padding: spacing[5], gap: spacing[4], overflow: 'hidden',
  },
  popularBadge: {
    position: 'absolute', top: 0, right: 0,
    backgroundColor: colors.neon, paddingHorizontal: spacing[3], paddingVertical: 4,
    borderBottomLeftRadius: 8,
  },
  popularText: { fontSize: 9, fontFamily: 'Montserrat_700Bold', color: colors.white },
  header:      { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  priceBox:    { alignItems: 'flex-end', gap: 1 },
  highlights:  { gap: spacing[2] },
  highlightRow:{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  cta: {
    borderRadius: 8, paddingVertical: spacing[3],
    alignItems: 'center', justifyContent: 'center',
  },
  ctaInactive: {
    borderRadius: 8, paddingVertical: spacing[3],
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  ctaText: { fontSize: 13, fontFamily: 'Montserrat_700Bold' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PlansScreen() {
  const { profile, user }    = useAuthStore();
  const {
    effectivePlan,
    isTrialActive,
    daysLeftInTrial,
    load,
    msgCount,
    msgLimit,
  } = usePlanStore();
  const [checkingOut, setCheckingOut] = useState<PlanId | null>(null);

  useEffect(() => {
    if (user?.id) load(user.id);
  }, [user?.id]);

  const trialActive = isTrialActive();
  const daysLeft    = daysLeftInTrial();

  const handleSelectPlan = async (planId: PlanId) => {
    if (planId === effectivePlan && !trialActive) return;
    if (planId === 'free') return;
    if (!user?.id) return;
    if (checkingOut) return;

    setCheckingOut(planId);
    try {
      // Crear preferencia de pago en MercadoPago
      const { data, error } = await (supabase as any).functions.invoke('create-payment', {
        body: { plan_id: planId },
      });

      if (error || !data?.init_point) {
        Alert.alert('Error', 'No pudimos iniciar el pago. Intentá de nuevo.');
        return;
      }

      // Abrir checkout de MercadoPago en browser embebido
      const result = await WebBrowser.openAuthSessionAsync(
        data.init_point,
        'pesossmart://payment-success',
      );

      if (result.type === 'success') {
        // El webhook de MP ya actualizó el plan en DB — recargar el store
        await load(user.id);
        Alert.alert(
          '¡Listo!',
          `Tu plan ${PLANS[planId].name} fue activado correctamente.`,
          [{ text: 'Continuar', onPress: () => router.back() }],
        );
      }
      // Si fue cancel/dismiss no hacemos nada (el webhook aún puede dispararse)
    } catch (e) {
      Alert.alert('Error', 'Ocurrió un problema al procesar el pago.');
    } finally {
      setCheckingOut(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <Text variant="subtitle">Tu plan</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Trial Banner */}
        {trialActive && (
          <View style={styles.trialBanner}>
            <Ionicons name="star-outline" size={18} color={colors.white} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="labelMd" color={colors.white}>Trial Premium activo</Text>
              <Text variant="caption" color={colors.white + 'CC'}>
                {daysLeft !== null && daysLeft > 0
                  ? `Te quedan ${daysLeft} día${daysLeft !== 1 ? 's' : ''} para explorar todas las funciones.`
                  : 'Tu trial está por vencer. Elegí un plan para continuar.'}
              </Text>
            </View>
          </View>
        )}

        {/* Uso del mes */}
        {msgLimit !== null && (
          <View style={styles.usageBar}>
            <View style={styles.usageInfo}>
              <Text variant="caption" color={colors.text.secondary}>Mensajes usados este mes</Text>
              <Text variant="caption" color={msgCount >= msgLimit ? colors.red : colors.text.primary}
                style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                {msgCount} / {msgLimit}
              </Text>
            </View>
            <View style={styles.usageTrack}>
              <View style={[
                styles.usageFill,
                {
                  width: `${Math.min((msgCount / msgLimit) * 100, 100)}%`,
                  backgroundColor: msgCount >= msgLimit ? colors.red : colors.primary,
                },
              ]} />
            </View>
          </View>
        )}

        {/* Cards de planes */}
        {(['premium', 'pro', 'free'] as PlanId[]).map((planId) => (
          <PlanCard
            key={planId}
            planId={planId}
            currentPlan={effectivePlan}
            isTrialActive={trialActive}
            onSelect={handleSelectPlan}
            isLoading={checkingOut === planId}
          />
        ))}

        {/* Tabla de comparación */}
        <View style={styles.comparisonSection}>
          <Text variant="label" color={colors.text.secondary} style={styles.comparisonTitle}>
            COMPARACIÓN DETALLADA
          </Text>
          <View style={styles.comparisonTable}>
            {/* Header de columnas */}
            <View style={styles.compRow}>
              <View style={styles.compLabel} />
              {(['free', 'pro', 'premium'] as PlanId[]).map((planId) => (
                <View key={planId} style={fcStyles.cell}>
                  <Text variant="caption" color={planId === effectivePlan ? colors.neon : colors.text.secondary}
                    style={{ fontFamily: 'Montserrat_700Bold', fontSize: 9 }}>
                    {PLANS[planId].name.toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>
            {FEATURES.map((row, i) => (
              <View key={i} style={[styles.compRow, i % 2 === 1 && styles.compRowAlt]}>
                <View style={styles.compLabel}>
                  <Text variant="caption" color={colors.text.secondary} numberOfLines={2}>{row.label}</Text>
                </View>
                <FeatureCell value={row.free}    highlight={effectivePlan === 'free'}    />
                <FeatureCell value={row.pro}     highlight={effectivePlan === 'pro'}     />
                <FeatureCell value={row.premium} highlight={effectivePlan === 'premium'} />
              </View>
            ))}
          </View>
        </View>

        {/* Footer legal */}
        <Text variant="caption" color={colors.text.tertiary} align="center" style={styles.legal}>
          Los precios están en pesos argentinos e incluyen IVA. La suscripción se renueva automáticamente. Podés cancelar en cualquier momento desde tu perfil.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding, paddingVertical: spacing[4],
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  backBtn: { padding: spacing[1] },
  scroll:  {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[5], paddingBottom: spacing[10],
    gap: spacing[4],
  },

  trialBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    backgroundColor: colors.neon, borderRadius: 12, padding: spacing[4],
  },

  usageBar: { gap: spacing[2] },
  usageInfo:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  usageTrack: { height: 6, backgroundColor: colors.border.subtle, borderRadius: 3, overflow: 'hidden' },
  usageFill:  { height: '100%', borderRadius: 3 },

  comparisonSection: { gap: spacing[3] },
  comparisonTitle:   { marginBottom: spacing[1] },
  comparisonTable:   {
    borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 10, overflow: 'hidden',
  },
  compRow:    {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing[3], paddingHorizontal: spacing[3],
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  compRowAlt: { backgroundColor: colors.bg.elevated },
  compLabel:  { width: 130, paddingRight: spacing[2] },

  legal: { lineHeight: 18, paddingHorizontal: spacing[4] },
});
