import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#2E7D32',
        tabBarInactiveTintColor: '#757575',
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
      <Tabs.Screen name="grupo-familia"  options={{ href: null }} />
      <Tabs.Screen name="group-detail"   options={{ href: null }} />
      <Tabs.Screen name="group-code"     options={{ href: null }} />
      <Tabs.Screen name="member-detail"  options={{ href: null }} />
      <Tabs.Screen name="plans"          options={{ href: null }} />
      <Tabs.Screen name="simulator"      options={{ href: null }} />
      <Tabs.Screen name="gmail-connect"  options={{ href: null }} />
      <Tabs.Screen name="insight"         options={{ href: null }} />
      <Tabs.Screen name="savings-plan"    options={{ href: null }} />
      <Tabs.Screen name="category-detail"        options={{ href: null }} />
      <Tabs.Screen name="savings-opportunities"  options={{ href: null }} />
      <Tabs.Screen name="savings-goal"           options={{ href: null }} />
      <Tabs.Screen name="smart-alerts"           options={{ href: null }} />
      <Tabs.Screen name="help"                   options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    height: 64,
    paddingTop: spacing[2],
    paddingBottom: Platform.OS === 'ios' ? spacing[5] : spacing[2],
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
