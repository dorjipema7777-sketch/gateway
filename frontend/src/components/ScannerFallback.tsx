/**
 * Fallback shown when ML Kit Text Recognition isn't available in the current runtime
 * (Expo Go, or web preview). The full ML Kit OCR pipeline activates after a native
 * development/production build is generated via Emergent's Publish button.
 *
 * The Sync / Search / History / Settings tabs still work in this fallback.
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, radius, spacing } from "@/src/theme";
import { api, cacheOrders, getCachedOrders, type Order, type Settings as TSettings } from "@/src/lib/api";

export default function ScannerFallback() {
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<Order[]>([]);
  const [settings, setSettings] = useState<TSettings | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    (async () => {
      const cached = await getCachedOrders();
      setOrders(cached);
      try {
        const s = await api.getSettings();
        setSettings(s);
      } catch {}
    })();
  }, []);

  const onRefresh = async () => {
    setSyncing(true);
    try {
      await api.sync();
      const list = await api.listOrders();
      await cacheOrders(list);
      setOrders(list);
      const s = await api.getSettings();
      setSettings(s);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID="scanner-fallback">
      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons name="line-scan" size={64} color={colors.primary} />
        </View>
        <Text style={styles.title}>BUILD REQUIRED</Text>
        <Text style={styles.subtitle}>
          On-device ML Kit Text Recognition needs a native build. The live scanner activates
          automatically once you publish the app from the Emergent "Publish" button (top right).
        </Text>

        <View style={styles.engineCard}>
          <View style={styles.engineRow}>
            <MaterialCommunityIcons name="cpu-64-bit" size={18} color={colors.primary} />
            <Text style={styles.engineKey}>OCR engine</Text>
            <Text style={styles.engineVal}>Google ML Kit v2 (on-device)</Text>
          </View>
          <View style={styles.engineRow}>
            <MaterialCommunityIcons name="camera-outline" size={18} color={colors.primary} />
            <Text style={styles.engineKey}>Camera</Text>
            <Text style={styles.engineVal}>CameraX · 1280×720 · 15 FPS</Text>
          </View>
          <View style={styles.engineRow}>
            <MaterialCommunityIcons name="wifi-off" size={18} color={colors.primary} />
            <Text style={styles.engineKey}>Network</Text>
            <Text style={styles.engineVal}>Not required during scanning</Text>
          </View>
          <View style={styles.engineRow}>
            <MaterialCommunityIcons name="database-search-outline" size={18} color={colors.primary} />
            <Text style={styles.engineKey}>Lookup</Text>
            <Text style={styles.engineVal}>Local cache · {orders.length} orders</Text>
          </View>
        </View>

        <Text style={styles.note}>
          You can still use Search, History, and sync the Google Sheet from this preview.
        </Text>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={onRefresh}
          disabled={syncing}
          testID="refresh-button"
        >
          {syncing ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <>
              <MaterialCommunityIcons name="cloud-download-outline" size={22} color={colors.background} />
              <Text style={styles.primaryBtnText}>SYNC SHEET NOW</Text>
            </>
          )}
        </TouchableOpacity>

        {settings?.last_sync_at ? (
          <Text style={styles.lastSync}>
            Last sync · {new Date(settings.last_sync_at).toLocaleString()}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center" },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 1.5,
    textAlign: "center",
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  engineCard: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 10,
    marginBottom: spacing.lg,
  },
  engineRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  engineKey: { color: colors.textSecondary, fontSize: 13, width: 90, fontWeight: "700" },
  engineVal: { color: colors.textPrimary, fontSize: 13, fontWeight: "600", flex: 1 },
  note: { color: colors.textTertiary, fontSize: 12, textAlign: "center", marginBottom: spacing.md },
  primaryBtn: {
    backgroundColor: colors.primary,
    height: 60,
    paddingHorizontal: spacing.lg,
    minWidth: 240,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryBtnText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
  lastSync: { color: colors.textSecondary, fontSize: 12, marginTop: spacing.md },
});
