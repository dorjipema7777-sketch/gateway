/**
 * Settings — configure Google Sheet URL + manual sync.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, radius, spacing } from "@/src/theme";
import { api, cacheOrders, type Settings as TSettings } from "@/src/lib/api";

export default function SettingsScreen() {
  const [sheetUrl, setSheetUrl] = useState("");
  const [settings, setSettings] = useState<TSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.getSettings();
        setSettings(s);
        setSheetUrl(s.sheet_url || "");
      } catch (e: unknown) {
        showToast(errMsg(e), false);
      }
    })();
  }, [showToast]);

  const onSave = async () => {
    setSaving(true);
    try {
      const s = await api.setSettings(sheetUrl.trim());
      setSettings(s);
      showToast("Sheet URL saved.", true);
    } catch (e: unknown) {
      showToast(errMsg(e), false);
    } finally {
      setSaving(false);
    }
  };

  const onSync = async () => {
    setSyncing(true);
    try {
      // save first so backend uses latest URL
      if (sheetUrl !== (settings?.sheet_url || "")) {
        await api.setSettings(sheetUrl.trim());
      }
      const r = await api.sync();
      const list = await api.listOrders();
      await cacheOrders(list);
      const s = await api.getSettings();
      setSettings(s);
      showToast(r.message || "Sync completed successfully.", true);
    } catch (e: unknown) {
      showToast(errMsg(e), false);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>SETTINGS</Text>

          <Text style={styles.sectionLabel}>GOOGLE SHEET URL</Text>
          <Text style={styles.help}>
            Paste the URL of your Google Sheet. The sheet must be shared as "Anyone with the link
            can view". Columns: B=Order ID, C=Date, D=Customer, E=Phone, F=Product, R=Amount.
          </Text>
          <TextInput
            value={sheetUrl}
            onChangeText={setSheetUrl}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            testID="settings-sheet-url-input"
          />

          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={onSave}
            disabled={saving}
            testID="settings-save-button"
          >
            {saving ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <MaterialCommunityIcons name="content-save-outline" size={20} color={colors.textPrimary} />
                <Text style={styles.btnSecondaryText}>SAVE URL</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.divider} />

          <Text style={styles.sectionLabel}>SYNC STATUS</Text>
          <View style={styles.statusRow}>
            <Text style={styles.statusKey}>Last sync</Text>
            <Text style={styles.statusVal}>{settings?.last_sync_at ? new Date(settings.last_sync_at).toLocaleString() : "Never"}</Text>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.statusKey}>Total orders</Text>
            <Text style={styles.statusVal}>{settings?.total_orders ?? 0}</Text>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.statusKey}>Status</Text>
            <Text style={[styles.statusVal, { color: settings?.last_sync_status === "ok" ? colors.success : colors.textSecondary }]}>
              {settings?.last_sync_status || "—"}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={onSync}
            disabled={syncing}
            testID="settings-sync-button"
          >
            {syncing ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <>
                <MaterialCommunityIcons name="cloud-download-outline" size={22} color={colors.background} />
                <Text style={styles.btnPrimaryText}>SYNC NOW</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.divider} />

          <Text style={styles.sectionLabel}>ABOUT</Text>
          <Text style={styles.help}>
            Real-time OCR processes camera frames locally inside the scan rectangle. Images are
            never saved. The app works offline using the most recent sync; press Sync after
            connecting to refresh.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {toast ? (
        <View
          style={[styles.toast, { backgroundColor: toast.ok ? colors.successBg : colors.errorBg }]}
          testID="settings-toast"
        >
          <MaterialCommunityIcons
            name={toast.ok ? "check-circle" : "alert-circle"}
            size={18}
            color={toast.ok ? colors.success : colors.error}
          />
          <Text style={[styles.toastText, { color: toast.ok ? colors.success : colors.error }]}>
            {toast.msg}
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: "900", letterSpacing: 0.5, marginBottom: spacing.lg },
  sectionLabel: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  help: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 80,
    fontSize: 14,
    textAlignVertical: "top",
  },
  btn: {
    marginTop: spacing.md,
    height: 60,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: colors.background, fontSize: 15, fontWeight: "900", letterSpacing: 1 },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnSecondaryText: { color: colors.textPrimary, fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statusKey: { color: colors.textSecondary, fontSize: 14 },
  statusVal: { color: colors.textPrimary, fontSize: 14, fontWeight: "600", maxWidth: "65%", textAlign: "right" },
  toast: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md + 70,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toastText: { fontSize: 13, fontWeight: "700", flex: 1 },
});
