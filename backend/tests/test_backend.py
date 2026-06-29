"""Backend API tests for Package OCR Scanner.

Covers:
- Health endpoint
- Settings GET/POST
- Sync from Google Sheet (real public CSV)
- Orders list & search
- Orders lookup (exact + fuzzy fallback)
- OCR endpoint with synthetic PNG containing real Order ID, plus a no-id image
- Negative: /api/sync with empty sheet_url -> 400
"""
import os
import io
import base64
import time
import pytest
import requests
from PIL import Image, ImageDraw, ImageFont

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
SHEET_URL = ("https://docs.google.com/spreadsheets/d/"
             "1z0c9wIl1yGAhg73hRiJvYUbnHT4rKC15hghAjGyMGe4/"
             "edit?gid=434048213#gid=434048213")
KNOWN_ORDER_IDS = ["OD437102142031898100", "OD437102137290137100"]


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _png_with_text(text: str, w: int = 800, h: int = 220) -> str:
    """Generate a real-looking PNG containing printed text. Adds noise/lines so it's not a uniform image."""
    img = Image.new("RGB", (w, h), (245, 245, 240))
    d = ImageDraw.Draw(img)
    # noise lines (real visual features)
    for i in range(0, w, 20):
        d.line([(i, 0), (i, h)], fill=(225, 225, 225), width=1)
    d.rectangle([10, 10, w - 10, h - 10], outline=(80, 80, 80), width=2)
    d.line([(20, 60), (w - 20, 60)], fill=(120, 120, 120), width=1)
    try:
        font_big = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 38)
        font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
    except Exception:
        font_big = ImageFont.load_default()
        font_sm = ImageFont.load_default()
    d.text((30, 20), "AMAZON PACKAGE", fill=(20, 20, 20), font=font_sm)
    d.text((30, 80), f"Order ID: {text}", fill=(0, 0, 0), font=font_big)
    d.text((30, 160), "Deliver To: Test Customer", fill=(40, 40, 40), font=font_sm)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _png_no_id() -> str:
    img = Image.new("RGB", (600, 200), (240, 240, 250))
    d = ImageDraw.Draw(img)
    for i in range(0, 600, 25):
        d.line([(0, i), (600, i)], fill=(220, 220, 230), width=1)
    d.rectangle([5, 5, 595, 195], outline=(90, 90, 90), width=2)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
    except Exception:
        font = ImageFont.load_default()
    d.text((20, 40), "Hello World", fill=(0, 0, 0), font=font)
    d.text((20, 100), "Have a nice day!", fill=(20, 20, 20), font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ---------- Health ----------
class TestHealth:
    def test_root(self, api):
        r = api.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        body = r.json()
        assert body.get("status") == "ok"


# ---------- Settings ----------
class TestSettings:
    def test_get_settings(self, api):
        r = api.get(f"{BASE_URL}/api/settings")
        assert r.status_code == 200
        body = r.json()
        assert "sheet_url" in body
        assert "total_orders" in body

    def test_set_settings_persists(self, api):
        r = api.post(f"{BASE_URL}/api/settings", json={"sheet_url": SHEET_URL})
        assert r.status_code == 200
        assert r.json()["sheet_url"] == SHEET_URL
        # verify via GET
        r2 = api.get(f"{BASE_URL}/api/settings")
        assert r2.json()["sheet_url"] == SHEET_URL


# ---------- Sync ----------
class TestSync:
    def test_sync_empty_url_returns_400(self, api):
        # temporarily clear url
        api.post(f"{BASE_URL}/api/settings", json={"sheet_url": ""})
        r = api.post(f"{BASE_URL}/api/sync")
        assert r.status_code == 400
        # restore
        api.post(f"{BASE_URL}/api/settings", json={"sheet_url": SHEET_URL})

    def test_sync_success_509(self, api):
        api.post(f"{BASE_URL}/api/settings", json={"sheet_url": SHEET_URL})
        r = api.post(f"{BASE_URL}/api/sync", timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["success"] is True
        assert body["message"] == "Sync completed successfully."
        assert body["total_orders"] == 509, f"expected 509, got {body['total_orders']}"
        assert body["last_sync_at"]


# ---------- Orders ----------
class TestOrders:
    def test_list_orders(self, api):
        r = api.get(f"{BASE_URL}/api/orders")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) == 509
        # ensure no _id leak
        assert "_id" not in data[0]
        assert "order_id" in data[0]

    def test_search_by_order_id(self, api):
        r = api.get(f"{BASE_URL}/api/orders/search", params={"q": KNOWN_ORDER_IDS[0]})
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        assert any(o["order_id"].upper() == KNOWN_ORDER_IDS[0] for o in data)

    def test_search_partial(self, api):
        r = api.get(f"{BASE_URL}/api/orders/search", params={"q": "OD4371021"})
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_lookup_exact_match(self, api):
        r = api.get(f"{BASE_URL}/api/orders/lookup", params={"order_id": KNOWN_ORDER_IDS[0]})
        assert r.status_code == 200
        body = r.json()
        assert body["matched"] is True
        assert body["order"]["order_id"].upper() == KNOWN_ORDER_IDS[0]

    def test_lookup_fuzzy_match(self, api):
        # replace a '0' with 'O' to simulate OCR confusion (one-char swap)
        oid = KNOWN_ORDER_IDS[0]
        # find first '0' and swap
        idx = oid.find("0")
        assert idx >= 0
        bad = oid[:idx] + "O" + oid[idx + 1:]
        r = api.get(f"{BASE_URL}/api/orders/lookup", params={"order_id": bad})
        assert r.status_code == 200
        body = r.json()
        assert body["matched"] is True, f"expected fuzzy match for {bad}, got {body}"
        assert body["order"]["order_id"].upper() == oid

    def test_lookup_nonexistent(self, api):
        r = api.get(f"{BASE_URL}/api/orders/lookup", params={"order_id": "OD000000000000000000"})
        assert r.status_code == 200
        body = r.json()
        assert body["matched"] is False
        assert body["order"] is None


# ---------- OCR ----------
class TestOcr:
    def test_ocr_with_real_order_id(self, api):
        b64 = _png_with_text(KNOWN_ORDER_IDS[0])
        r = api.post(f"{BASE_URL}/api/ocr", json={"image_base64": b64}, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        # LLM OCR should detect the text & match
        assert body["matched"] is True, f"expected match, got body={body}"
        assert body["order"] is not None
        assert body["order"]["order_id"].upper() == KNOWN_ORDER_IDS[0]

    def test_ocr_no_id_does_not_crash(self, api):
        b64 = _png_no_id()
        r = api.post(f"{BASE_URL}/api/ocr", json={"image_base64": b64}, timeout=60)
        assert r.status_code == 200
        body = r.json()
        assert body["matched"] is False
        assert body["order"] is None
