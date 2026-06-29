/**
 * Backend API client + local cache helpers.
 * Backend base URL comes exclusively from EXPO_PUBLIC_BACKEND_URL (no fallbacks).
 */
import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export type Order = {
  order_id: string;
  order_date: string;
  customer_name: string;
  customer_phone: string;
  product_name: string;
  amount: string;
};

export type OcrResult = {
  detected_text: string;
  order_id: string | null;
  order: Order | null;
  matched: boolean;
};

export type Settings = {
  sheet_url: string;
  last_sync_at: string | null;
  last_sync_status: string;
  total_orders: number;
};

export type SyncResult = {
  success: boolean;
  message: string;
  total_orders: number;
  last_sync_at: string | null;
};

export type HistoryEntry = {
  order_id: string;
  order: Order | null;
  matched: boolean;
  scanned_at: string;  // ISO
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE) throw new Error("Backend URL not configured");
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = j.detail || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getSettings: () => request<Settings>("/settings"),
  setSettings: (sheet_url: string) =>
    request<Settings>("/settings", { method: "POST", body: JSON.stringify({ sheet_url }) }),
  sync: () => request<SyncResult>("/sync", { method: "POST" }),
  listOrders: () => request<Order[]>("/orders"),
  search: (q: string) => request<Order[]>(`/orders/search?q=${encodeURIComponent(q)}`),
  lookup: (order_id: string) => request<OcrResult>(`/orders/lookup?order_id=${encodeURIComponent(order_id)}`),
  // NOTE: /api/ocr exists on the backend as an optional debug-only fallback.
  // The production scanner uses Google ML Kit on-device — NO network OCR.
};

// ---------- Local cache (offline-first) ----------
const ORDERS_CACHE_KEY = "orders_cache_v1";
const HISTORY_KEY = "scan_history_v1";

export async function cacheOrders(orders: Order[]) {
  await storage.setItem(ORDERS_CACHE_KEY, JSON.stringify(orders));
}

export async function getCachedOrders(): Promise<Order[]> {
  const raw = (await storage.getItem(ORDERS_CACHE_KEY, "")) as string;
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Order[];
  } catch {
    return [];
  }
}

export function localLookup(orders: Order[], orderIdRaw: string): Order | null {
  const norm = (orderIdRaw || "").trim().toUpperCase();
  if (!norm) return null;
  let found = orders.find((o) => o.order_id.toUpperCase() === norm);
  if (found) return found;
  // fuzzy: common OCR confusions, 1 char swap
  const swaps: [string, string][] = [
    ["0", "O"], ["O", "0"], ["1", "I"], ["I", "1"], ["1", "L"], ["L", "1"],
    ["5", "S"], ["S", "5"], ["8", "B"], ["B", "8"], ["2", "Z"], ["Z", "2"],
  ];
  for (const [a, b] of swaps) {
    for (let i = 0; i < norm.length; i++) {
      if (norm[i] === a) {
        const cand = norm.slice(0, i) + b + norm.slice(i + 1);
        found = orders.find((o) => o.order_id.toUpperCase() === cand);
        if (found) return found;
      }
    }
  }
  return null;
}

export function localSearch(orders: Order[], q: string, limit = 50): Order[] {
  const ql = q.trim().toLowerCase();
  if (!ql) return [];
  return orders
    .filter((o) => {
      return (
        o.order_id.toLowerCase().includes(ql) ||
        o.customer_name.toLowerCase().includes(ql) ||
        o.customer_phone.toLowerCase().includes(ql) ||
        o.product_name.toLowerCase().includes(ql)
      );
    })
    .slice(0, limit);
}

// ---------- History ----------
export async function getHistory(): Promise<HistoryEntry[]> {
  const raw = (await storage.getItem(HISTORY_KEY, "")) as string;
  if (!raw) return [];
  try {
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

export async function addHistory(entry: HistoryEntry) {
  const list = await getHistory();
  list.unshift(entry);
  await storage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 200)));
}

export async function clearHistory() {
  await storage.setItem(HISTORY_KEY, JSON.stringify([]));
}

// ---------- OrderID extraction (client-side, for instant local detection) ----------
const PATTERNS: RegExp[] = [
  /\bOD[A-Z0-9]{15,22}\b/g,
  /\b\d{3}-\d{7}-\d{7}\b/g,
  /\b\d{15,22}\b/g,
];

export function extractOrderIds(text: string): string[] {
  if (!text) return [];
  const upper = text.toUpperCase();
  const out: string[] = [];
  for (const p of PATTERNS) {
    const matches = upper.match(p) || [];
    for (const m of matches) {
      if (!out.includes(m)) out.push(m);
    }
  }
  return out;
}
