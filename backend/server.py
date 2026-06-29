"""
Amazon Package OCR Scanner - Backend API
- Sync Google Sheet (CSV export) -> MongoDB orders collection
- OCR endpoint (LLM vision) for extracting Order IDs from camera frames
- Order lookup & search endpoints
"""
import os
import re
import csv
import io
import uuid
import base64
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
import httpx

# Load env
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Package OCR Backend")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger("ocr_backend")


# ---------- Models ----------
class Order(BaseModel):
    order_id: str
    order_date: str = ""
    customer_name: str = ""
    customer_phone: str = ""
    product_name: str = ""
    amount: str = ""


class SettingsIn(BaseModel):
    sheet_url: str


class SettingsOut(BaseModel):
    sheet_url: str = ""
    last_sync_at: Optional[str] = None
    last_sync_status: str = ""
    total_orders: int = 0


class SyncResult(BaseModel):
    success: bool
    message: str
    total_orders: int = 0
    last_sync_at: Optional[str] = None


class OcrIn(BaseModel):
    image_base64: str  # JPEG/PNG bytes, base64-encoded (no data: prefix)


class OcrOut(BaseModel):
    detected_text: str = ""
    order_id: Optional[str] = None
    order: Optional[Order] = None
    matched: bool = False


# ---------- Helpers ----------
ORDER_ID_PATTERNS = [
    re.compile(r"\bOD[A-Z0-9]{15,22}\b"),               # Flipkart-style
    re.compile(r"\b\d{3}-\d{7}-\d{7}\b"),               # Amazon US-style 402-8965243-6123526
    re.compile(r"\b\d{15,22}\b"),                       # Long numeric
]


def extract_order_id_candidates(text: str) -> List[str]:
    """Find Amazon/Flipkart-like Order IDs in text. Returns deduped, ordered by pattern priority."""
    if not text:
        return []
    upper = text.upper()
    found: List[str] = []
    for pat in ORDER_ID_PATTERNS:
        for m in pat.findall(upper):
            if m not in found:
                found.append(m)
    return found


def gsheet_to_csv_url(url: str) -> Optional[str]:
    """Convert a Google Sheets edit URL to the CSV export URL.
    Supports: /edit#gid=N, /edit?gid=N, /edit?usp=...#gid=N
    """
    if not url:
        return None
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url)
    if not m:
        return None
    sheet_id = m.group(1)
    gid_match = re.search(r"[#?&]gid=(\d+)", url)
    gid = gid_match.group(1) if gid_match else "0"
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"


def parse_sheet_csv(csv_text: str) -> List[Order]:
    """Parse CSV with the agreed columns: B=order_id, C=order_date, D=customer_name,
    E=customer_phone, F=product_name, R=amount. Row 1 is headers."""
    reader = csv.reader(io.StringIO(csv_text))
    rows = list(reader)
    if not rows:
        return []
    orders: List[Order] = []
    for i, row in enumerate(rows):
        if i == 0:
            continue  # skip header
        # pad row to at least 18 cols
        if len(row) < 18:
            row = row + [""] * (18 - len(row))
        order_id_raw = (row[1] or "").strip()
        if not order_id_raw:
            continue
        orders.append(Order(
            order_id=order_id_raw,
            order_date=(row[2] or "").strip(),
            customer_name=(row[3] or "").strip(),
            customer_phone=(row[4] or "").strip(),
            product_name=(row[5] or "").strip(),
            amount=(row[17] or "").strip(),
        ))
    return orders


def normalize_id(s: str) -> str:
    """For matching: uppercase, strip whitespace; we keep dashes since spec format has them."""
    return (s or "").strip().upper()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Settings + Sync ----------
@api.get("/settings", response_model=SettingsOut)
async def get_settings():
    doc = await db.app_settings.find_one({"_id": "main"}, {"_id": 0})
    if not doc:
        return SettingsOut()
    return SettingsOut(**doc)


@api.post("/settings", response_model=SettingsOut)
async def set_settings(payload: SettingsIn):
    current = await db.app_settings.find_one({"_id": "main"}, {"_id": 0}) or {}
    current["sheet_url"] = payload.sheet_url
    await db.app_settings.update_one({"_id": "main"}, {"$set": current}, upsert=True)
    return SettingsOut(**current)


@api.post("/sync", response_model=SyncResult)
async def sync_sheet():
    settings_doc = await db.app_settings.find_one({"_id": "main"}, {"_id": 0}) or {}
    sheet_url = settings_doc.get("sheet_url", "")
    if not sheet_url:
        raise HTTPException(status_code=400, detail="No Google Sheet URL configured. Set it in Settings.")
    csv_url = gsheet_to_csv_url(sheet_url)
    if not csv_url:
        raise HTTPException(status_code=400, detail="Invalid Google Sheet URL.")

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as cx:
            r = await cx.get(csv_url)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Sheet fetch failed (HTTP {r.status_code}). Make sure the sheet is shared as 'Anyone with the link can view'.")
        text = r.text
        if not text.strip():
            raise HTTPException(status_code=502, detail="Sheet is empty or not publicly accessible.")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("sheet fetch error")
        raise HTTPException(status_code=502, detail=f"Sheet fetch error: {e}")

    orders = parse_sheet_csv(text)
    if not orders:
        # still considered success but warn
        await db.orders.delete_many({})
        last = now_iso()
        await db.app_settings.update_one(
            {"_id": "main"},
            {"$set": {"last_sync_at": last, "last_sync_status": "empty", "total_orders": 0}},
            upsert=True,
        )
        return SyncResult(success=True, message="Sheet contained no order rows.", total_orders=0, last_sync_at=last)

    # Replace strategy (simple + reliable for staff workflow)
    await db.orders.delete_many({})
    docs = []
    for o in orders:
        d = o.model_dump()
        d["order_id_norm"] = normalize_id(o.order_id)
        docs.append(d)
    if docs:
        await db.orders.insert_many(docs)
    # ensure index
    try:
        await db.orders.create_index("order_id_norm")
    except Exception:
        pass

    last = now_iso()
    await db.app_settings.update_one(
        {"_id": "main"},
        {"$set": {"last_sync_at": last, "last_sync_status": "ok", "total_orders": len(docs), "sheet_url": sheet_url}},
        upsert=True,
    )
    return SyncResult(success=True, message="Sync completed successfully.", total_orders=len(docs), last_sync_at=last)


# ---------- Orders ----------
@api.get("/orders", response_model=List[Order])
async def list_orders(limit: int = 5000):
    cursor = db.orders.find({}, {"_id": 0, "order_id_norm": 0}).limit(limit)
    return [Order(**doc) async for doc in cursor]


@api.get("/orders/search", response_model=List[Order])
async def search_orders(q: str = Query(..., min_length=1), limit: int = 50):
    q_norm = normalize_id(q)
    # match against order_id_norm, customer_name, customer_phone, product_name
    filt = {
        "$or": [
            {"order_id_norm": {"$regex": re.escape(q_norm)}},
            {"customer_name": {"$regex": re.escape(q), "$options": "i"}},
            {"customer_phone": {"$regex": re.escape(q)}},
            {"product_name": {"$regex": re.escape(q), "$options": "i"}},
        ]
    }
    cursor = db.orders.find(filt, {"_id": 0, "order_id_norm": 0}).limit(limit)
    return [Order(**doc) async for doc in cursor]


@api.get("/orders/lookup", response_model=OcrOut)
async def lookup_order(order_id: str):
    """Lookup with fuzzy fallback (Levenshtein distance ≤ 1 char) for OCR misreads."""
    norm = normalize_id(order_id)
    doc = await db.orders.find_one({"order_id_norm": norm}, {"_id": 0, "order_id_norm": 0})
    if doc:
        return OcrOut(detected_text=order_id, order_id=doc["order_id"], order=Order(**doc), matched=True)

    # Fuzzy: try replacing common OCR confusions (0<->O, 1<->I/L, 5<->S, 8<->B)
    candidates = {norm}
    swaps = [("0", "O"), ("O", "0"), ("1", "I"), ("I", "1"), ("1", "L"), ("L", "1"),
             ("5", "S"), ("S", "5"), ("8", "B"), ("B", "8"), ("2", "Z"), ("Z", "2")]
    for a, b in swaps:
        for i, ch in enumerate(norm):
            if ch == a:
                candidates.add(norm[:i] + b + norm[i + 1:])
    candidates.discard(norm)
    if candidates:
        doc = await db.orders.find_one({"order_id_norm": {"$in": list(candidates)}}, {"_id": 0, "order_id_norm": 0})
        if doc:
            return OcrOut(detected_text=order_id, order_id=doc["order_id"], order=Order(**doc), matched=True)
    return OcrOut(detected_text=order_id, order_id=norm, order=None, matched=False)


# ---------- OCR ----------
@api.post("/ocr", response_model=OcrOut)
async def ocr_image(payload: OcrIn):
    """Run OCR on a camera frame and try to match an Order ID against synced data.
    Uses Emergent LLM key (gpt-4o-mini vision) as a portable OCR provider that runs
    even inside Expo Go. On a production native build, this can be replaced with
    on-device ML Kit Text Recognition for sub-second response and zero per-scan cost.
    """
    img_b64 = payload.image_base64 or ""
    if not img_b64:
        raise HTTPException(status_code=400, detail="image_base64 is required")
    # strip data URL prefix if present
    if img_b64.startswith("data:"):
        img_b64 = img_b64.split(",", 1)[-1]

    detected_text = ""
    if EMERGENT_LLM_KEY:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
            chat = LlmChat(
                api_key=EMERGENT_LLM_KEY,
                session_id=f"ocr-{uuid.uuid4()}",
                system_message=(
                    "You are an OCR engine. Extract ALL visible text from the image. "
                    "Return ONLY the raw text exactly as printed, with line breaks. "
                    "Do not add commentary, headings, or explanations. If nothing readable, return an empty string."
                ),
            ).with_model("openai", "gpt-4o-mini")
            msg = UserMessage(text="Extract all printed text from this image.", file_contents=[ImageContent(image_base64=img_b64)])
            resp = await chat.send_message(msg)
            detected_text = (resp or "").strip() if isinstance(resp, str) else str(resp)
        except Exception as e:
            logger.warning(f"LLM OCR failed: {e}")
            detected_text = ""

    candidates = extract_order_id_candidates(detected_text)
    if not candidates:
        return OcrOut(detected_text=detected_text, order_id=None, order=None, matched=False)

    # Try each candidate against DB (exact, then fuzzy)
    for cand in candidates:
        norm = normalize_id(cand)
        doc = await db.orders.find_one({"order_id_norm": norm}, {"_id": 0, "order_id_norm": 0})
        if doc:
            return OcrOut(detected_text=detected_text, order_id=doc["order_id"], order=Order(**doc), matched=True)

    # Fuzzy fallback on first candidate
    first = candidates[0]
    res = await lookup_order(first)
    if res.matched:
        res.detected_text = detected_text
        return res
    return OcrOut(detected_text=detected_text, order_id=first, order=None, matched=False)


# ---------- Health ----------
@api.get("/")
async def root():
    return {"status": "ok", "service": "package-ocr-backend"}


@api.get("/health")
async def health():
    return {"status": "ok", "time": now_iso()}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
