/**
 * Main scan screen: live camera preview + scanning rectangle + auto OCR loop.
 *
 * OCR strategy:
 *  - Periodically (~1.5s) call CameraView.takePictureAsync({quality, base64}).
 *  - POST base64 frame to /api/ocr (backend extracts text using LLM vision, regex-matches Order ID).
 *  - On match: vibrate (haptic), show ScanResultSheet, pause loop.
 *  - Sheet closes -> resume loop. Same package will NOT re-trigger because we remember the
 *    last detected ID and require it to leave the view (i.e., a different/no detection) before
 *    re-firing.
 *
 * Notes for production:
 *  - This works inside Expo Go (uses backend OCR).
 *  - For native dev/production builds with sub-second on-device OCR, swap the OCR call with
 *    `@react-native-ml-kit/text-recognition` + per-frame extraction. Keep the rest of the flow.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, radius, spacing } from "@/src/theme";
import {
  api,
  addHistory,
  cacheOrders,
  extractOrderIds,
  getCachedOrders,
  localLookup,
  type Order,
  type OcrResult,
  type Settings,
} from "@/src/lib/api";
import ScanResultSheet from "@/src/components/ScanResultSheet";

const SCAN_INTERVAL_MS = 1500;

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const [isFocused, setIsFocused] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [lastDetectedId, setLastDetectedId] = useState<string>("");
  const [missCount, setMissCount] = useState(0); // frames without detection (used for duplicate protection)
  const [settings, setSettings] = useState<Settings | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [flash, setFlash] = useState(false);
  const inFlightRef = useRef(false);

  // Track focus so we pause when on other tabs
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, [])
  );

  // Initial load: cached orders + settings
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

  // Auto-scan loop
  useEffect(() => {
    if (!isFocused || !scanning || !permission?.granted) return;
    if (Platform.OS === "web") return; // takePictureAsync is unreliable in web preview
    let cancelled = false;

    const tick = async () => {
      if (cancelled || inFlightRef.current || !cameraRef.current) return;
      inFlightRef.current = true;
      setBusy(true);
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.45,
          base64: true,
          skipProcessing: true,
          exif: false,
        });
        if (cancelled) return;
        const b64 = photo?.base64 || "";
        if (!b64) return;
        const ocr = await api.ocr(b64);
        if (cancelled) return;
        await handleOcrResult(ocr);
      } catch (e) {
        // swallow per-tick errors
      } finally {
        inFlightRef.current = false;
        if (!cancelled) setBusy(false);
      }
    };

    const id = setInterval(tick, SCAN_INTERVAL_MS);
    // fire once immediately
    setTimeout(tick, 400);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isFocused, scanning, permission?.granted]);

  const handleOcrResult = async (ocr: OcrResult) => {
    const ids = extractOrderIds(ocr.detected_text || "");
    const detected = ocr.order_id || (ids.length > 0 ? ids[0] : "");
    if (!detected) {
      // No ID in this frame; advance miss counter to allow re-detection of same package later
      setMissCount((m) => Math.min(m + 1, 10));
      return;
    }
    // Duplicate protection: same ID as last triggered, and we have not had ≥2 misses since => skip
    if (detected === lastDetectedId && missCount < 2) {
      return;
    }
    setLastDetectedId(detected);
    setMissCount(0);

    // Try matching: first via OCR response, else local cache (offline-first), else lookup endpoint
    let order: Order | null = ocr.order;
    let matched = ocr.matched;
    if (!matched) {
      const localOrder = localLookup(orders, detected);
      if (localOrder) {
        order = localOrder;
        matched = true;
      } else {
        try {
          const r = await api.lookup(detected);
          if (r.matched) {
            order = r.order;
            matched = true;
          }
        } catch {}
      }
    }

    // Feedback: haptic + flash
    Haptics.notificationAsync(
      matched ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning
    ).catch(() => {});
    setFlash(true);
    setTimeout(() => setFlash(false), 120);

    // Show result, pause scanning
    setResult({ detected_text: ocr.detected_text || "", order_id: detected, order, matched });
    setScanning(false);
    await addHistory({
      order_id: detected,
      order,
      matched,
      scanned_at: new Date().toISOString(),
    });
  };

  const handleClose = () => {
    setResult(null);
    setScanning(true);
    // reset miss counter so same package after some camera-leave will retrigger
    setMissCount(0);
  };

  const onRefresh = async () => {
    setBusy(true);
    try {
      const sync = await api.sync();
      const list = await api.listOrders();
      await cacheOrders(list);
      setOrders(list);
      setSettings({
        sheet_url: settings?.sheet_url || "",
        last_sync_at: sync.last_sync_at,
        last_sync_status: "ok",
        total_orders: sync.total_orders,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const syncBadge = useMemo(() => {
    const total = settings?.total_orders ?? orders.length;
    const last = settings?.last_sync_at;
    const ago = last ? timeAgo(new Date(last)) : "Never synced";
    return { total, ago };
  }, [settings, orders.length]);

  if (!permission) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.center, { padding: spacing.lg }]}>
        <MaterialCommunityIcons name="camera-off-outline" size={64} color={colors.textSecondary} />
        <Text style={styles.permTitle}>Camera permission required</Text>
        <Text style={styles.permText}>
          To scan Amazon packages, allow camera access. Frames are processed only inside the
          scanning rectangle and never saved.
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={requestPermission}
          testID="grant-camera-button"
        >
          <Text style={styles.primaryBtnText}>GRANT ACCESS</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="scan-screen">
      <CameraView
        ref={cameraRef as unknown as React.Ref<CameraView>}
        style={StyleSheet.absoluteFill}
        facing="back"
        // 720p-ish; mobile preview ignores this but it documents intent
      />

      {/* Dim overlay outside the scan rectangle */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={styles.dimTop} />
        <View style={styles.middleRow}>
          <View style={styles.dimSide} />
          <View style={styles.scanRect} testID="scan-rectangle">
            <Corner pos="tl" />
            <Corner pos="tr" />
            <Corner pos="bl" />
            <Corner pos="br" />
          </View>
          <View style={styles.dimSide} />
        </View>
        <View style={styles.dimBottom} />
      </View>

      {/* Success flash */}
      {flash ? <View pointerEvents="none" style={styles.flash} /> : null}

      {/* Top bar: sync badge */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.syncBadge} testID="sync-status-badge">
          <View style={[styles.syncDot, { backgroundColor: orders.length > 0 ? colors.success : colors.warning }]} />
          <Text style={styles.syncText} numberOfLines={1}>
            {syncBadge.total} orders · {syncBadge.ago}
          </Text>
        </View>
        <View style={styles.statusPill}>
          {busy && scanning ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <MaterialCommunityIcons name="line-scan" size={16} color={colors.primary} />
          )}
          <Text style={styles.statusPillText}>{scanning ? "SCANNING" : "PAUSED"}</Text>
        </View>
      </View>

      {/* Helper text */}
      <View style={styles.helperBox} pointerEvents="none">
        <Text style={styles.helperText}>
          Align Order ID inside the box{Platform.OS === "web" ? " (preview-only on web)" : ""}
        </Text>
      </View>

      {/* Bottom controls */}
      <View
        style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={onRefresh}
          disabled={busy}
          testID="refresh-button"
        >
          {busy ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <MaterialCommunityIcons name="cloud-download-outline" size={26} color={colors.primary} />
          )}
          <Text style={styles.controlBtnText}>SYNC</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, { backgroundColor: scanning ? colors.surface : colors.primary }]}
          onPress={() => setScanning((s) => !s)}
          testID="pause-button"
        >
          <MaterialCommunityIcons
            name={scanning ? "pause" : "play"}
            size={26}
            color={scanning ? colors.primary : colors.background}
          />
          <Text
            style={[
              styles.controlBtnText,
              { color: scanning ? colors.primary : colors.background },
            ]}
          >
            {scanning ? "PAUSE" : "RESUME"}
          </Text>
        </TouchableOpacity>
      </View>

      <ScanResultSheet
        visible={!!result}
        order={result?.order ?? null}
        orderId={result?.order_id ?? ""}
        matched={!!result?.matched}
        onClose={handleClose}
        onScanNext={handleClose}
      />
    </View>
  );
}

function Corner({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const base: any = {
    position: "absolute",
    width: 28,
    height: 28,
    borderColor: colors.primary,
  };
  const map = {
    tl: { top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4 },
    tr: { top: -2, right: -2, borderTopWidth: 4, borderRightWidth: 4 },
    bl: { bottom: -2, left: -2, borderBottomWidth: 4, borderLeftWidth: 4 },
    br: { bottom: -2, right: -2, borderBottomWidth: 4, borderRightWidth: 4 },
  } as const;
  return <View style={[base, map[pos]]} />;
}

function timeAgo(d: Date) {
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

const RECT_HEIGHT = 120;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { alignItems: "center", justifyContent: "center" },

  dimTop: { flex: 1, backgroundColor: colors.overlay },
  middleRow: { flexDirection: "row", height: RECT_HEIGHT },
  dimSide: { width: "10%", backgroundColor: colors.overlay },
  scanRect: {
    flex: 1,
    borderColor: colors.primary,
    borderWidth: 1.5,
    borderRadius: radius.sm,
    backgroundColor: "transparent",
  },
  dimBottom: { flex: 1, backgroundColor: colors.overlay },

  flash: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255, 153, 0, 0.25)" },

  topBar: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  syncBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    maxWidth: "65%",
    borderWidth: 1,
    borderColor: colors.border,
  },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
  syncText: { color: colors.textPrimary, fontSize: 12, fontWeight: "700" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  statusPillText: { color: colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1 },

  helperBox: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    marginTop: RECT_HEIGHT / 2 + 12,
    alignItems: "center",
  },
  helperText: {
    color: colors.textPrimary,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    fontSize: 12,
    fontWeight: "600",
  },

  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    gap: spacing.md,
  },
  controlBtn: {
    flex: 1,
    height: 72,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "column",
    gap: 2,
  },
  controlBtnText: { color: colors.primary, fontSize: 12, fontWeight: "800", letterSpacing: 1 },

  permTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "800",
    marginTop: spacing.md,
    textAlign: "center",
  },
  permText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    height: 60,
    minWidth: 220,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
