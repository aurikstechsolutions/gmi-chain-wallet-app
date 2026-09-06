import { Icon } from "@/components/Icon";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function TabLayout() {
  const colors = useColors();
  const isWeb = Platform.OS === "web";
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          position: "absolute",
          backgroundColor:
            Platform.OS === "ios" ? "transparent" : colors.card,
          borderTopWidth: Platform.OS === "ios" ? 0 : 1,
          borderTopColor: colors.border,
          elevation: 0,
          paddingTop: 8,
          paddingBottom: isWeb ? 0 : Math.max(insets.bottom, 10),
          paddingHorizontal: 8,
          ...(isWeb ? { height: 84 } : { height: 78 + insets.bottom }),
        },
        tabBarItemStyle: {
          paddingVertical: 2,
        },
        tabBarLabelStyle: {
          fontFamily: "Inter_600SemiBold",
          fontSize: 11,
          letterSpacing: 0.1,
          marginTop: 1,
        },
        tabBarBackground: () =>
          Platform.OS === "ios" ? (
            <View style={StyleSheet.absoluteFill}>
              <BlurView
                intensity={72}
                tint="light"
                style={StyleSheet.absoluteFill}
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: `${colors.card}E8`,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  },
                ]}
              />
            </View>
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: colors.card,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <Icon name={focused ? "home" : "home-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="send" options={{ href: null }} />
      <Tabs.Screen name="receive" options={{ href: null }} />
      <Tabs.Screen name="cards" options={{ href: null }} />
      <Tabs.Screen
        name="validator"
        options={{
          href: null,
          title: "Network",
          tabBarIcon: ({ color, focused }) => (
            <Icon name={focused ? "shield" : "shield-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="earnings" options={{ href: null }} />
      <Tabs.Screen
        name="trade"
        options={{
          href: null,
          title: "Trading",
          tabBarIcon: ({ color, focused }) => (
            <Icon name={focused ? "trending-up" : "trending-up-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="copy-trade" options={{ href: null }} />
      <Tabs.Screen name="bot-analytics" options={{ href: null }} />
      <Tabs.Screen name="bot-backtest" options={{ href: null }} />
      <Tabs.Screen
        name="p2p"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="swap"
        options={{
          title: "Swap",
          tabBarIcon: ({ color, focused }) => (
            <Icon name={focused ? "swap-horizontal" : "swap-horizontal-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="dapp"
        options={{
          title: "DApp",
          tabBarIcon: ({ color, focused }) => (
            <Icon name={focused ? "globe" : "globe-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, focused }) => (
            <Icon name={focused ? "settings" : "settings-outline"} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
