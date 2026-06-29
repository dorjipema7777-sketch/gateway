/**
 * Scan tab entry point.
 *
 * Loads the production on-device ML Kit scanner (`MLKitScanner`) when the
 * react-native-vision-camera native module is linked (dev/production build).
 * Falls back to `ScannerFallback` in Expo Go / web preview, which surfaces
 * sync / settings / search but cannot run the live OCR.
 *
 * No network OCR. Once a native build is generated, ML Kit runs entirely
 * on-device using CameraX + Google ML Kit Text Recognition v2.
 */
import React from "react";
import { NativeModules, Platform } from "react-native";

import ScannerFallback from "@/src/components/ScannerFallback";

// Detect at runtime whether vision-camera's native module is linked.
// In Expo Go this returns undefined -> fall back. In dev/prod builds it's defined.
function hasNativeCamera(): boolean {
  if (Platform.OS === "web") return false;
  try {
    // VisionCameraProxy / CameraDevices are the native modules registered by
    // react-native-vision-camera v5.
    const mod = NativeModules.CameraDevices || NativeModules.VisionCameraProxy;
    return !!mod;
  } catch {
    return false;
  }
}

export default function ScanTab() {
  if (!hasNativeCamera()) {
    return <ScannerFallback />;
  }
  // Lazy require so JS bundling in Expo Go does NOT touch vision-camera's
  // import-time native bindings.
  const MLKitScanner = require("@/src/components/MLKitScanner").default;
  return <MLKitScanner />;
}
