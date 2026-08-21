import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { colors, spacing } from '@/theme';

function SkeletonBox({ width, height = 16, borderRadius = 8, style }: {
  width: number | string; height?: number; borderRadius?: number; style?: any;
}) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1,   duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius, backgroundColor: '#E8E2D9', opacity },
        style,
      ]}
    />
  );
}

export function HomeSkeletonLoader() {
  return (
    <View style={s.wrap}>
      {/* Greeting */}
      <SkeletonBox width="50%" height={20} borderRadius={6} />
      <SkeletonBox width="70%" height={14} borderRadius={6} style={{ marginTop: 6 }} />

      {/* Hero card */}
      <View style={s.card}>
        <SkeletonBox width="60%" height={14} borderRadius={6} />
        <SkeletonBox width="80%" height={36} borderRadius={8} style={{ marginTop: 10 }} />
        <SkeletonBox width="40%" height={12} borderRadius={6} style={{ marginTop: 8 }} />
        <SkeletonBox width={120} height={36} borderRadius={10} style={{ marginTop: 14 }} />
      </View>

      {/* Inflation row */}
      <View style={s.card}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <SkeletonBox width="30%" height={40} borderRadius={10} />
          <SkeletonBox width="30%" height={40} borderRadius={10} />
          <SkeletonBox width="30%" height={40} borderRadius={10} />
        </View>
      </View>

      {/* Projected */}
      <View style={s.card}>
        <SkeletonBox width="50%" height={14} borderRadius={6} />
        <SkeletonBox width="60%" height={28} borderRadius={8} style={{ marginTop: 8 }} />
        <SkeletonBox width="100%" height={40} borderRadius={6} style={{ marginTop: 10 }} />
      </View>

      {/* Quick actions */}
      <View style={[s.card, { flexDirection: 'row', gap: 12 }]}>
        {[1, 2, 3, 4].map(i => (
          <View key={i} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
            <SkeletonBox width={52} height={52} borderRadius={26} />
            <SkeletonBox width={40} height={10} borderRadius={4} />
          </View>
        ))}
      </View>
    </View>
  );
}

export function ExpensesSkeletonLoader() {
  return (
    <View style={s.wrap}>
      {/* Filter pills */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[1, 2, 3, 4].map(i => <SkeletonBox key={i} width={72} height={32} borderRadius={999} />)}
      </View>

      {/* Summary card */}
      <View style={s.card}>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <SkeletonBox width={84} height={84} borderRadius={42} />
          <View style={{ flex: 1, gap: 8 }}>
            <SkeletonBox width="90%" height={14} borderRadius={6} />
            <SkeletonBox width="70%" height={14} borderRadius={6} />
            <SkeletonBox width="60%" height={14} borderRadius={6} />
          </View>
        </View>
      </View>

      {/* Expense rows */}
      {[1, 2, 3, 4, 5].map(i => (
        <View key={i} style={[s.card, { flexDirection: 'row', gap: 12, alignItems: 'center' }]}>
          <SkeletonBox width={44} height={44} borderRadius={22} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonBox width="60%" height={14} borderRadius={6} />
            <SkeletonBox width="40%" height={12} borderRadius={4} />
          </View>
          <SkeletonBox width={64} height={14} borderRadius={6} />
        </View>
      ))}
    </View>
  );
}

export function SmartLoadingState({ text }: { text: string }) {
  const dots = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(dots, { toValue: 3, duration: 1200, useNativeDriver: false }),
        Animated.timing(dots, { toValue: 0, duration: 0,    useNativeDriver: false }),
      ])
    ).start();
  }, []);

  return (
    <View style={s.loadingState}>
      <View style={s.loadingDots}>
        {[0, 1, 2].map(i => {
          const dotOpacity = dots.interpolate({
            inputRange:  [i, i + 0.5, i + 1],
            outputRange: [0.3, 1, 0.3],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View key={i} style={[s.dot, { opacity: dotOpacity }]} />
          );
        })}
      </View>
      <Animated.Text style={s.loadingText}>{text}</Animated.Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 16 },
  card: {
    backgroundColor: colors.bg.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border.default,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  loadingState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
  },
  loadingDots: {
    flexDirection: 'row',
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  loadingText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13,
    color: colors.text.secondary,
  },
});
