/**
 * Manual search screen — searches local cached orders first (instant), with backend fallback.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, radius, spacing } from "@/src/theme";
import { api, getCachedOrders, localSearch, type Order } from "@/src/lib/api";
import ScanResultSheet from "@/src/components/ScanResultSheet";

export default function SearchScreen() {
  const [q, setQ] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);

  useEffect(() => {
    (async () => {
      const cached = await getCachedOrders();
      if (cached.length > 0) setOrders(cached);
      try {
        const list = await api.listOrders();
        if (list.length > 0) setOrders(list);
      } catch {}
    })();
  }, []);

  const results = useMemo(() => localSearch(orders, q), [orders, q]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>SEARCH</Text>
          <Text style={styles.subtitle}>{orders.length} orders in local cache</Text>
        </View>
        <View style={styles.inputWrap}>
          <MaterialCommunityIcons name="magnify" size={22} color={colors.textSecondary} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Order ID, name, phone, product…"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            testID="search-input"
            returnKeyType="search"
          />
          {q.length > 0 ? (
            <TouchableOpacity onPress={() => setQ("")} testID="search-clear">
              <MaterialCommunityIcons name="close-circle" size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          ) : null}
        </View>

        {q.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="package-variant-closed" size={64} color={colors.textTertiary} />
            <Text style={styles.emptyText}>Type Order ID, customer name, or phone to search.</Text>
          </View>
        ) : results.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No matching order found.</Text>
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(o, i) => `${o.order_id}-${i}`}
            contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.row}
                onPress={() => setSelected(item)}
                testID={`search-row-${item.order_id}`}
              >
                <Text style={styles.rowId} numberOfLines={1}>{item.order_id}</Text>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.customer_name || "—"}
                </Text>
                <View style={styles.rowMeta}>
                  <Text style={styles.rowMetaText} numberOfLines={1}>
                    {item.customer_phone || ""}
                  </Text>
                  <Text style={[styles.rowMetaText, { color: colors.primary }]}>
                    {item.amount || ""}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </KeyboardAvoidingView>

      <ScanResultSheet
        visible={!!selected}
        order={selected}
        orderId={selected?.order_id ?? ""}
        matched={!!selected}
        onClose={() => setSelected(null)}
        onScanNext={() => setSelected(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: "900", letterSpacing: 0.5 },
  subtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  inputWrap: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  input: { flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: "500" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  emptyText: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.md, textAlign: "center" },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowId: { color: colors.primary, fontSize: 14, fontWeight: "800", letterSpacing: 0.5 },
  rowName: { color: colors.textPrimary, fontSize: 16, fontWeight: "700", marginTop: 4 },
  rowMeta: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  rowMetaText: { color: colors.textSecondary, fontSize: 13 },
});
