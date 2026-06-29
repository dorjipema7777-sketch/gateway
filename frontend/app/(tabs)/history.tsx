/**
 * Scan history — list of locally-stored recent scans (offline-only).
 */
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { colors, radius, spacing } from "@/src/theme";
import { clearHistory, getHistory, type HistoryEntry } from "@/src/lib/api";
import ScanResultSheet from "@/src/components/ScanResultSheet";

export default function HistoryScreen() {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<HistoryEntry | null>(null);

  const load = useCallback(async () => {
    const list = await getHistory();
    setItems(list);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleClear = async () => {
    await clearHistory();
    setItems([]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>HISTORY</Text>
          <Text style={styles.subtitle}>{items.length} recent scans</Text>
        </View>
        {items.length > 0 ? (
          <TouchableOpacity onPress={handleClear} style={styles.clearBtn} testID="clear-history-button">
            <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.textPrimary} />
            <Text style={styles.clearBtnText}>CLEAR</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="history" size={64} color={colors.textTertiary} />
          <Text style={styles.emptyText}>No scans yet. Start scanning packages.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(e, i) => `${e.order_id}-${e.scanned_at}-${i}`}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => setSelected(item)}
              testID={`history-row-${item.order_id}`}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: item.matched ? colors.success : colors.error },
                ]}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowId} numberOfLines={1}>
                  {item.order_id}
                </Text>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.matched ? item.order?.customer_name || "—" : "No match"}
                </Text>
              </View>
              <Text style={styles.rowTime}>{fmt(item.scanned_at)}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <ScanResultSheet
        visible={!!selected}
        order={selected?.order ?? null}
        orderId={selected?.order_id ?? ""}
        matched={!!selected?.matched}
        onClose={() => setSelected(null)}
        onScanNext={() => setSelected(null)}
      />
    </SafeAreaView>
  );
}

function fmt(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "flex-end",
  },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: "900", letterSpacing: 0.5 },
  subtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderColor: colors.border,
    borderWidth: 1,
  },
  clearBtnText: { color: colors.textPrimary, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  emptyText: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.md, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  rowId: { color: colors.primary, fontSize: 14, fontWeight: "800", letterSpacing: 0.5 },
  rowName: { color: colors.textPrimary, fontSize: 15, fontWeight: "600", marginTop: 2 },
  rowTime: { color: colors.textSecondary, fontSize: 12 },
});
