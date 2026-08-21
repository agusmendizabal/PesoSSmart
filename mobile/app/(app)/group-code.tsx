import React from 'react';
import {
  View, StyleSheet, TouchableOpacity, Share, Clipboard, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui';
import QRCode from 'react-native-qrcode-svg';

// ─── Tokens ───────────────────────────────────────────────────────────────────

const C = {
  bg:       '#FAFAF7',
  white:    '#FFFFFF',
  purple:   '#27AE60',
  purpleLt: '#D1F7E3',
  text:     '#1C1C1C',
  text2:    '#6D6A63',
  muted:    '#9B9790',
  border:   '#E8E2D9',
} as const;

const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

// ─── Pantalla ─────────────────────────────────────────────────────────────────

export default function GroupCodeScreen() {
  const { code = '', groupName = 'tu grupo', groupId = '' } = useLocalSearchParams<{
    code: string;
    groupName: string;
    groupId: string;
  }>();

  const handleBack = () => {
    if (groupId) {
      router.replace({ pathname: '/(app)/group-detail', params: { id: groupId } } as any);
    } else {
      router.replace('/(app)/family' as any);
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Unite a "${groupName}" en PesoSmart. Código: ${code}`,
      });
    } catch {}
  };

  const handleCopy = () => {
    Clipboard.setString(code);
    Alert.alert('Copiado', `El código ${code} fue copiado al portapapeles.`);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={handleBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Código de tu grupo</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={s.body}>

        {/* QR icon */}
        <View style={s.qrIconWrap}>
          <Ionicons name="qr-code" size={42} color={C.purple} />
        </View>

        <Text style={s.headline}>
          Compartí este código para invitar a otras personas a tu grupo
        </Text>

        {/* Card */}
        <View style={s.codeCard}>
          <View style={s.codeValueWrap}>
            <Text
              style={s.codeValue}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {code}
            </Text>
          </View>
          <Text style={s.codeSub}>Código de tu grupo</Text>

          {!!code && (
            <View style={s.qrArea}>
              <QRCode value={code} size={154} color={C.purple} backgroundColor={C.bg} />
            </View>
          )}
        </View>

        <Text style={s.disclaimer}>
          Este código es único y cualquiera puede usarlo para unirse a tu grupo.
        </Text>

        {/* Buttons */}
        <View style={s.btnGroup}>
          <TouchableOpacity style={s.btnPrimary} onPress={handleShare} activeOpacity={0.85}>
            <Ionicons name="share-outline" size={18} color={C.white} />
            <Text style={s.btnPrimaryText}>Compartir código</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.btnSecondary} onPress={handleCopy} activeOpacity={0.85}>
            <Ionicons name="copy-outline" size={18} color={C.purple} />
            <Text style={s.btnSecondaryText}>Copiar código</Text>
          </TouchableOpacity>
        </View>

      </View>

    </SafeAreaView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: sp.xl, paddingVertical: sp.md,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.white,
  },
  headerTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 17, color: C.text, letterSpacing: -0.2 },

  body: {
    flex: 1, alignItems: 'center',
    paddingHorizontal: sp.xl, paddingTop: sp.xxxl,
    gap: sp.xl,
  },

  qrIconWrap: {
    width: 88, height: 88, borderRadius: 24,
    backgroundColor: C.purpleLt,
    alignItems: 'center', justifyContent: 'center',
  },

  headline: {
    fontFamily: 'Montserrat_600SemiBold', fontSize: 16, color: C.text,
    textAlign: 'center', lineHeight: 24, maxWidth: 280,
  },

  codeCard: {
    width: '100%', backgroundColor: C.white, borderRadius: 24,
    padding: sp.xxl, alignItems: 'center', gap: sp.lg,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 16, elevation: 4,
  },
  codeValueWrap: {
    width: '100%', minHeight: 72,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: sp.lg, overflow: 'visible',
  },
  codeValue: {
    fontFamily: 'Montserrat_800ExtraBold', fontSize: 46,
    lineHeight: 58, color: C.purple,
    letterSpacing: 4, textAlign: 'center',
  },
  codeSub: { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.muted },

  qrArea: {
    padding: sp.lg, backgroundColor: C.bg, borderRadius: 16,
    marginTop: sp.sm,
  },

  disclaimer: {
    fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.muted,
    textAlign: 'center', lineHeight: 19, maxWidth: 280,
  },

  btnGroup: { width: '100%', gap: sp.md },
  btnPrimary: {
    backgroundColor: C.purple, borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm,
    paddingVertical: 16,
    shadowColor: C.purple, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  btnPrimaryText: { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: C.white },
  btnSecondary: {
    backgroundColor: C.purpleLt, borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm,
    paddingVertical: 16,
    borderWidth: 1.5, borderColor: C.purple + '40',
  },
  btnSecondaryText: { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: C.purple },
});
