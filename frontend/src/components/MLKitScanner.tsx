/**
 * MLKitScanner — production OCR pipeline.
 *
 *  • react-native-vision-camera v5 + react-native-vision-camera-ocr-plus v2
 *    (Google ML Kit Text Recognition v2, fully on-device via Nitro Modules).
 *  • CameraX-backed `<Camera>` with continuous autofocus + auto-exposure (defaults).
 *  • 1280×720 format requested via `useCameraFormat`; capped at 15 FPS.
 *  • `scanRegion` crops the frame to the centered scanning rectangle BEFORE OCR.
 *  • Regex filters to Amazon / Flipkart Order ID formats only.
 *  • Two-consecutive-frame confirmation prevents false positives.
 *  • Stops on confirmed detection; resumes only when "Scan Next" tap.
 *  • Local-DB lookup only (offline). NO network OCR.
 *
 * This module is loaded *lazily* — never required in Expo Go (no native build).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  Camera as VCCamera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
} from "react-native-vision-camera";
import { Camera as OcrCamera, type Text as OcrText } from "react-native-vision-camera-ocr-plus";

import { colors, radius, spacing } from "@/src/theme";
import {
  addHistory,
  cacheOrders,
  extractOrderIds,
  getCachedOrders,
  localLookup,
  api,
  type Order,
  type Settings as TSettings,
} from "@/src/lib/api";
import ScanResultSheet from "@/src/components/ScanResultSheet";

// Scan rectangle as percentage of frame (matches the on-screen overlay)
const SCAN_REGION = { left: "10%", top: "42%", width: "80%", height: "16%" } as const;
const REGION_VISUAL = { left: 0.1, top: 0.42, width: 0.8, height: 0.16 };

export default function MLKitScanner() {
  const insets = useSafeAreaInsets();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("back");

  // Request 720p, fall back to closest available
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1280, height: 720 } },
    { fps: 30 },
  ]);

  const [isFocused, setIsFocused] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [result, setResult] = useState<{ order_id: string; order: Order | null; matched: boolean } | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [settings, setSettings] = useState<TSettings | null>(null);
  const [flash, setFlash] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Frame-level state lives in refs so the OCR callback (called many times/sec)
  // doesn't churn React state.
  const lastCandidateRef = useRef<string>("");
  const consecutiveRef = useRef(0);
  const acceptedIdRef = useRef<string>("");  // currently shown ID; ignore until cleared

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, [])
  );

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

  const handleDetectedText = useCallback(
    (text: string) => {
      // This runs on JS thread, called by the OCR plugin's callback.
      if (!scanning) return;
      const ids = extractOrderIds(text);
      if (ids.length === 0) {
        // No valid ID this frame: reset consecutive counter so a fresh package starts at 0
        lastCandidateRef.current = "";
        consecutiveRef.current = 0;
        return;
      }
      // Pick the first match; prefer the longest one as tie-break (Order IDs > misc numbers)
      const candidate = ids.reduce((a, b) => (b.length > a.length ? b : a));

      // Don't re-fire on a currently-shown result
      if (candidate === acceptedIdRef.current) {
        return;
      }

      if (candidate === lastCandidateRef.current) {
        consecutiveRef.current += 1;
      } else {
        lastCandidateRef.current = candidate;
        consecutiveRef.current = 1;
      }

      // Spec: "If the same Order ID is detected in consecutive frames, accept it immediately"
      if (consecutiveRef.current >= 2) {
        acceptCandidate(candidate);
      }
    },
    [scanning]
  );

  const acceptCandidate = useCallback(
    async (candidate: string) => {
      acceptedIdRef.current = candidate;
      setScanning(false);

      // Local-only lookup with fuzzy fallback
      const order = localLookup(orders, candidate);
      const matched = !!order;

      Haptics.notificationAsync(
        matched ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning
      ).catch(() => {});
      setFlash(true);
      setTimeout(() => setFlash(false), 120);

      setResult({ order_id: candidate, order, matched });
      await addHistory({
        order_id: candidate,
        order,
        matched,
        scanned_at: new Date().toISOString(),
      });
    },
    [orders]
  );

  const handleClose = () => {
    setResult(null);
    acceptedIdRef.current = "";
    lastCandidateRef.current = "";
    consecutiveRef.current = 0;
    setScanning(true);
  };

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

  const syncBadge = useMemo(() => {
    const total = settings?.total_orders ?? orders.length;
    const last = settings?.last_sync_at;
    const ago = last ? timeAgo(new Date(last)) : "Never synced";
    return { total, ago };
  }, [settings, orders.length]);

  if (!hasPermission) {
    return (
      <View style={[styles.container, styles.center, { padding: spacing.lg }]}>
        <MaterialCommunityIcons name="camera-off-outline" size={64} color={colors.textSecondary} />
        <Text style={styles.permTitle}>Camera permission required</Text>
        <Text style={styles.permText}>
          Real-time on-device OCR needs camera access. Frames are processed inside the scanning
          rectangle and never leave the device.
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

  if (!device) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.permText, { marginTop: spacing.md }]}>Initializing camera…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="scan-screen-mlkit">
      <OcrCamera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isFocused && scanning}
        format={format}
        fps={15}
        mode="recognize"
        options={{
          language: "latin",
          frameSkipThreshold: 2,
          scanRegion: SCAN_REGION,
          useLightweightMode: true,
        }}
        callback={(data) => {
          const t = data as OcrText;
          if (t?.resultText) handleDetectedText(t.resultText);
        }}
      />

      {/* Dimmed overlay outside the centered scan region */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.dim, { left: 0, right: 0, top: 0, height: `${REGION_VISUAL.top * 100}%` }]} />
        <View
          style={[
            styles.dim,
            {
              left: 0,
              right: 0,
              bottom: 0,
              height: `${(1 - REGION_VISUAL.top - REGION_VISUAL.height) * 100}%`,
            },
          ]}
        />
        <View
          style={[
            styles.dim,
            {
              left: 0,
              top: `${REGION_VISUAL.top * 100}%`,
              width: `${REGION_VISUAL.left * 100}%`,
              height: `${REGION_VISUAL.height * 100}%`,
            },
          ]}
        />
        <View
          style={[
            styles.dim,
            {
              right: 0,
              top: `${REGION_VISUAL.top * 100}%`,
              width: `${REGION_VISUAL.left * 100}%`,
              height: `${REGION_VISUAL.height * 100}%`,
            },
          ]}
        />
        {/* Scan rectangle outline */}
        <View
          style={[
            styles.scanRect,
            {
              left: `${REGION_VISUAL.left * 100}%`,
              top: `${REGION_VISUAL.top * 100}%`,
              width: `${REGION_VISUAL.width * 100}%`,
              height: `${REGION_VISUAL.height * 100}%`,
            },
          ]}
          testID="scan-rectangle"
        >
          <Corner pos="tl" />
          <Corner pos="tr" />
          <Corner pos="bl" />
          <Corner pos="br" />
        </View>
      </View>

      {flash ? <View pointerEvents="none" style={styles.flash} /> : null}

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.syncBadge} testID="sync-status-badge">
          <View style={[styles.syncDot, { backgroundColor: orders.length > 0 ? colors.success : colors.warning }]} />
          <Text style={styles.syncText} numberOfLines={1}>
            {syncBadge.total} orders · {syncBadge.ago}
          </Text>
        </View>
        <View style={styles.statusPill}>
          <MaterialCommunityIcons name="line-scan" size={16} color={scanning ? colors.primary : colors.textTertiary} />
          <Text style={[styles.statusPillText, { color: scanning ? colors.primary : colors.textTertiary }]}>
            {scanning ? "SCANNING" : "PAUSED"}
          </Text>
        </View>
      </View>

      <View style={styles.helperBox} pointerEvents="none">
        <Text style={styles.helperText}>Align Order ID inside the box</Text>
        <Text style={styles.engineText}>ML Kit · on-device · 720p · 15fps</Text>
      </View>

      {/* Bottom controls */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={onRefresh}
          disabled={syncing}
          testID="refresh-button"
        >
          {syncing ? (
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
          <Text style={[styles.controlBtnText, { color: scanning ? colors.primary : colors.background }]}>
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
  const base = { position: "absolute" as const, width: 28, height: 28, borderColor: colors.primary };
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
  return `${Math.floor(h / 24)}d ago`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { alignItems: "center", justifyContent: "center" },
  dim: { position: "absolute", backgroundColor: colors.overlay },
  scanRect: {
    position: "absolute",
    borderColor: colors.primary,
    borderWidth: 1.5,
    borderRadius: radius.sm,
    backgroundColor: "transparent",
  },
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
  statusPillText: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  helperBox: { position: "absolute", left: 0, right: 0, top: "60%", alignItems: "center" },
  helperText: {
    color: colors.textPrimary,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    fontSize: 12,
    fontWeight: "600",
  },
  engineText: {
    color: colors.textSecondary,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 8,
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
