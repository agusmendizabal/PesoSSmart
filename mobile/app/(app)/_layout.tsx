import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '@/theme';

type TabIconProps = {
  name: keyof typeof Ionicons.glyphMap;
  focused: boolean;
  color: string;
};

function TabIcon({ name, focused, color }: TabIconProps) {
  return (
    <View style={styles.iconWrapper}>
      <Ionicons
        name={focused ? name : (`${name}-outline` as keyof typeof Ionicons.glyphMap)}
        size={24}
        color={color}
      />
    </View>
  );
}

export default function AppLayout() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = 60 + insets.bottom;
  const tabBarPaddingBottom = insets.bottom > 0 ? insets.bottom + 4 : 12;

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarStyle: [styles.tabBar, { height: tabBarHeight, paddingBottom: tabBarPaddingBottom }],
        tabBarActiveTintColor: '#27AE60',
        tabBarInactiveTintColor: '#6D6A63',
        tabBarLabelStyle: styles.tabLabel,
        tabBarShowLabel: true,
      }}
    >
      <Tabs.Screen
        name="savings"
        options={{
          title: 'Ahorros',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="wallet" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          title: 'Gastos',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="bag" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="home"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="home" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="family"
        options={{
          title: 'Grupos',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="people" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="person" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="reports"        options={{ href: null }} />
      <Tabs.Screen name="advisor"        options={{ href: null }} />
      <Tabs.Screen name="group-detail"   options={{ href: null }} />
      <Tabs.Screen name="group-code"     options={{ href: null }} />
      <Tabs.Screen name="member-detail"  options={{ href: null }} />
      <Tabs.Screen name="plans"          options={{ href: null }} />
      <Tabs.Screen name="gmail-connect"  options={{ href: null }} />
      <Tabs.Screen name="savings-plan"    options={{ href: null }} />
      <Tabs.Screen name="category-detail"        options={{ href: null }} />
      <Tabs.Screen name="savings-opportunities"  options={{ href: null }} />
      <Tabs.Screen name="savings-goal"           options={{ href: null }} />
      <Tabs.Screen name="help"                   options={{ href: null }} />
      <Tabs.Screen name="investment-alternatives" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E8E2D9',
    paddingTop: spacing[2],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 8,
  },
  iconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 32,
  },
  tabLabel: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 10,
    letterSpacing: 0,
    marginTop: 2,
  },
});
