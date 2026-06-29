/**
 * Bottom-sheet style result card. Shown over the camera when a match is found.
 */
import React from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Share,
  ScrollView,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { colors, radius, spacing } from "@/src/theme";
import type { Order } from "@/src/lib/api";

type Props = {
  visible: boolean;
  order: Order | null;
  orderId: string;
  matched: boolean;
  onClose: () => void;
  onScanNext: () => void;
};

export default function ScanResultSheet({ visible, order, orderId, matched, onClose, onScanNext }: Props) {
  const copy = async () => {
    await Clipboard.setStringAsync(orderId || "");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };
  const share = async () => {
    const lines = order
      ? [
          `Order ID: ${order.order_id}`,
          `Customer: ${order.customer_name}`,
          `Phone: ${order.customer_phone}`,
          `Product: ${order.product_name}`,
          `Amount Due: ${order.amount}`,
          `Order Date: ${order.order_date}`,
        ]
      : [`Order ID: ${orderId}`, "No matching order found."];
    try {
      await Share.share({ message: lines.join("\n") });
    } catch {}
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="scan-result-backdrop">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} testID="scan-result-sheet">
          <View style={styles.handle} />

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.lg }}>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusBadge,
                  matched ? styles.statusBadgeOk : styles.statusBadgeWarn,
                ]}
              >
                <MaterialCommunityIcons
                  name={matched ? "check-circle" : "alert-circle"}
                  size={16}
                  color={matched ? colors.success : colors.error}
                />
                <Text style={[styles.statusText, { color: matched ? colors.success : colors.error }]}>
                  {matched ? "MATCH FOUND" : "NO MATCHING ORDER"}
                </Text>
              </View>
            </View>

            <Text style={styles.orderIdLabel}>ORDER ID</Text>
            <Text style={styles.orderId} selectable testID="scan-result-order-id">
              {orderId || "—"}
            </Text>

            {matched && order ? (
              <View style={styles.grid}>
                <Field label="CUSTOMER" value={order.customer_name || "—"} />
                <Field label="PHONE" value={order.customer_phone || "—"} testID="scan-result-phone" />
                <Field label="PRODUCT" value={order.product_name || "—"} wide />
                <Field label="AMOUNT DUE" value={order.amount || "—"} highlight />
                <Field label="ORDER DATE" value={order.order_date || "—"} />
              </View>
            ) : (
              <Text style={styles.noMatch}>
                No matching order found in the synced sheet. Try again or refresh the sheet from
                Settings.
              </Text>
            )}

            <View style={styles.iconRow}>
              <TouchableOpacity style={styles.iconBtn} onPress={copy} testID="copy-id-button">
                <MaterialCommunityIcons name="content-copy" size={22} color={colors.textPrimary} />
                <Text style={styles.iconBtnLabel}>Copy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={share} testID="share-button">
                <MaterialCommunityIcons name="share-variant" size={22} color={colors.textPrimary} />
                <Text style={styles.iconBtnLabel}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={onClose} testID="close-button">
                <MaterialCommunityIcons name="close" size={22} color={colors.textPrimary} />
                <Text style={styles.iconBtnLabel}>Close</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={onScanNext}
              testID="scan-next-button"
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="line-scan" size={22} color={colors.background} />
              <Text style={styles.primaryBtnText}>SCAN NEXT PACKAGE</Text>
            </TouchableOpacity>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Field({
  label,
  value,
  wide,
  highlight,
  testID,
}: {
  label: string;
  value: string;
  wide?: boolean;
  highlight?: boolean;
  testID?: string;
}) {
  return (
    <View style={[styles.fieldBox, wide && { width: "100%" }]} testID={testID}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, highlight && { color: colors.primary, fontSize: 22 }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    maxHeight: "85%",
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  statusRow: { flexDirection: "row", marginBottom: spacing.sm },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  statusBadgeOk: { backgroundColor: colors.successBg },
  statusBadgeWarn: { backgroundColor: colors.errorBg },
  statusText: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  orderIdLabel: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginTop: spacing.sm,
  },
  orderId: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  fieldBox: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: spacing.md,
    width: "48.5%",
    minHeight: 70,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 6,
  },
  fieldValue: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "600",
  },
  noMatch: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginVertical: spacing.md,
  },
  iconRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  iconBtn: {
    flex: 1,
    backgroundColor: colors.surfaceElevated,
    height: 64,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconBtnLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: "700", marginTop: 4 },
  primaryBtn: {
    backgroundColor: colors.primary,
    height: 64,
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
});
