#!/usr/bin/env python3
"""
AEL Sales Intelligence Control Tower — RTM sync script.

Pulls LIVE RTM data from the iBOS RTM MCP endpoint (https://arl-mcp.ibos.io/mcp)
and regenerates js/data.js so the dashboard reflects the latest database state.

Usage:
    python sync_rtm.py            # fetch + write js/data.js
    python sync_rtm.py --push     # fetch + write + git commit & push (updates GitHub Pages)

Schedule (automatic): run `run_sync.cmd` via Windows Task Scheduler (e.g. hourly).

Secrets: the RTM API key is read from env var RTM_MCP_API_KEY, or from a local
`rtm_key.txt` (git-ignored). NEVER commit the key to the repository.
"""

import os
import json
import re
import sys
import time
import datetime as dt
import urllib.request

# ============================================================================
# CONFIGURATION
# ============================================================================
MCP_URL = "https://arl-mcp.ibos.io/mcp"
TOOL_NAME = "ExecuteRtmQueryAsync"

# ---- date range to sync (YYYY-MM-DD). Default: current year to date ----
START_DATE = "2026-01-01"

# ---- Akij Essential (Distributor) identity ----
AEL_BUSINESS_UNIT = 144   # intBusinessUnitId on deliveries
AEL_HIERARCHY_L1 = 22600  # L1 in tblTerritoryInfoSetup = "Akij Essential (Distributor)"

# ---- target model ----
# "memo_x_avg" : Target (BDT) = (memo target count) x (avg delivery value), Actual = BDT amount
# "memo_count" : Target = memo target count, Actual = delivery count (consistent activity units)
TARGET_MODEL = "memo_x_avg"

# Optional: fixed average memo/order value (BDT) to convert memo targets to BDT.
# When None, it is auto-derived as (total amount / total deliveries).
AVG_MEMO_VALUE_OVERRIDE = None

# ---- pagination ----
# The RTM MCP caps results at 200 rows; paginate by hashing territory name into buckets.
BUCKETS = 50

# ---- region -> [lat, lng] for the schematic Bangladesh map ----
REGION_COORDS = {
    "Dhaka North Division": [23.85, 90.42],
    "Dhaka South Division": [23.70, 90.42],
    "Chittagong Division": [22.33, 91.83],
    "Khulna Division": [22.82, 89.55],
    "Rajshahi Division": [24.37, 88.60],
    "Sylhet Division": [24.89, 91.87],
    "Barisal Division": [22.70, 90.37],
    "Rangpur Division": [25.75, 89.25],
    "Mymensingh Division": [24.75, 90.40],
    "East": [23.85, 91.60],
    "West": [23.85, 89.00],
    "East-L": [23.85, 92.10],
    "West-L": [23.85, 88.70],
}

# ---- district/zone name -> [lat, lng] (schematic map placement) ----
DISTRICT_COORDS = {
    "Dhaka": [23.81, 90.41], "Dhanmondi": [23.75, 90.37], "Mirpur": [23.82, 90.37],
    "Gulshan": [23.79, 90.42], "Uttara": [23.88, 90.39], "Jatrabari": [23.70, 90.43],
    "Malibag": [23.75, 90.42], "Savar": [23.85, 90.26], "Keraniganj": [23.68, 90.35],
    "Mohammadpur": [23.77, 90.36], "Dohar": [23.59, 90.12], "Nawabganj": [23.66, 90.17],
    "Narayanganj": [23.62, 90.50], "Munshiganj": [23.55, 90.53], "Narsingdi": [23.92, 90.72],
    "Manikganj": [23.86, 90.00], "Gazipur": [23.99, 90.42], "Tangail": [24.25, 89.92],
    "Mymensingh": [24.75, 90.40], "Jamalpur": [24.92, 89.94], "Netrokona": [24.88, 90.73],
    "Kishoreganj": [24.44, 90.78], "Brahmanbaria": [23.95, 91.11], "Cumilla": [23.46, 91.18],
    "Chandpur": [23.23, 90.65], "Noakhali": [22.87, 91.10], "Feni": [23.02, 91.40],
    "Lakshmipur": [22.94, 90.83], "Chittagong": [22.33, 91.83], "Cox's Bazar": [21.43, 91.97],
    "Khagrachhari": [23.11, 91.99], "Rangamati": [22.64, 92.18], "Bandarban": [22.20, 92.22],
    "Sylhet": [24.89, 91.87], "Moulvibazar": [24.48, 91.77], "Habiganj": [24.38, 91.42],
    "Sunamganj": [25.07, 91.40], "Khulna": [22.82, 89.55], "Bagerhat": [22.65, 89.79],
    "Satkhira": [22.72, 89.07], "Jessore": [23.16, 89.21], "Jhenaidah": [23.54, 89.18],
    "Magura": [23.49, 89.42], "Narail": [23.17, 89.50], "Kushtia": [23.90, 89.12],
    "Chuadanga": [23.64, 88.85], "Meherpur": [23.76, 88.63], "Barishal": [22.70, 90.37],
    "Bhola": [22.68, 90.65], "Patuakhali": [22.36, 90.33], "Barguna": [22.16, 90.13],
    "Jhalokathi": [22.64, 90.20], "Pirojpur": [22.58, 89.97], "Rajshahi": [24.37, 88.60],
    "Natore": [24.42, 89.00], "Pabna": [24.00, 89.24], "Sirajganj": [24.45, 89.70],
    "Bogra": [24.85, 89.37], "Naogaon": [24.81, 88.95], "Joypurhat": [25.10, 89.03],
    "Rangpur": [25.75, 89.25], "Dinajpur": [25.62, 88.63], "Thakurgaon": [26.03, 88.46],
    "Panchagarh": [26.33, 88.56], "Nilphamari": [25.93, 88.85], "Gaibandha": [25.33, 89.54],
    "Kurigram": [25.81, 89.65], "Lalmonirhat": [25.92, 89.45], "Faridpur": [23.60, 89.84],
    "Gopalganj": [23.01, 89.83], "Madaripur": [23.17, 90.21], "Shariatpur": [23.24, 90.35],
    "Rajbari": [23.76, 89.64],
}

# ============================================================================
# MCP client (stateless JSON-RPC over HTTP)
# ============================================================================
def get_api_key():
    key = os.environ.get("RTM_MCP_API_KEY")
    if key:
        return key.strip()
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rtm_key.txt")
    if os.path.exists(p):
        with open(p, "r", encoding="utf-8") as f:
            k = f.read().strip()
            if k:
                return k
    raise RuntimeError("RTM API key not found. Set RTM_MCP_API_KEY or create rtm_key.txt")


def rtm_query(sql, api_key, limit=200):
    payload = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000) % 100000,
        "method": "tools/call",
        "params": {
            "name": TOOL_NAME,
            "arguments": {"sqlQuery": sql, "limit": limit},
        },
    }
    req = urllib.request.Request(
        MCP_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "X-API-Key": api_key,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AEL-Control-Tower/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if data.get("error"):
        raise RuntimeError("MCP error: %s" % data["error"])
    content = data.get("result", {}).get("content", [])
    if not content:
        return [], []
    text = content[0].get("text", "")
    return parse_md_table(text)


def parse_md_table(text):
    """Parse the Markdown table returned by the MCP into (header, rows)."""
    header, rows = [], []
    for ln in text.split("\n"):
        ln = ln.strip()
        if not ln.startswith("|"):
            continue
        cells = [c.strip() for c in ln.strip("|").split("|")]
        if not cells or all(c == "" for c in cells):
            continue
        # separator row like | :--- | --- |
        if all(set(c) <= set("-: ") for c in cells):
            continue
        if not header:
            header = cells
        else:
            rows.append(cells)
    return header, rows


def rows_to_dicts(header, rows):
    out = []
    for r in rows:
        d = {}
        for i, h in enumerate(header):
            d[h] = r[i] if i < len(r) else None
        out.append(d)
    return out


def paged_query(sql_template, api_key, buckets=None, **fmt):
    """Fetch across all hash buckets (each bucket < 200 rows)."""
    nb = buckets or BUCKETS
    all_rows = []
    for b in range(nb):
        sql = sql_template.format(bucket=b, buckets=nb, **fmt)
        h, r = rtm_query(sql, api_key)
        all_rows.extend(rows_to_dicts(h, r))
    return all_rows


def num(v):
    if v is None:
        return 0.0
    s = str(v).replace(",", "").strip()
    if s in ("", "-", "None"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


# ============================================================================
# Query definitions
# ============================================================================
SQL_ACTUAL = """
SELECT d.strTerritoryName AS Territory,
       MAX(d.intTerritoryid) AS TerrId,
       COALESCE(s.NL5, '') AS Division,
       COALESCE(s.NL7, '') AS Zone,
       COALESCE(s.NL8, d.strTerritoryName) AS Point,
       YEAR(d.dteDeliveryDate) AS Yr,
       MONTH(d.dteDeliveryDate) AS Mn,
       SUM(d.numTotalDeliveryAmount) AS Amount,
       COUNT(*) AS Cnt
FROM rtm.tblOutletDeliveryHeader d WITH (NOLOCK)
LEFT JOIN rtm.tblTerritoryInfoSetup s WITH (NOLOCK)
  ON s.L9 = d.intTerritoryid AND s.isActive = 1 AND s.intLevelId = 9 AND s.L1 = {ael_l1}
WHERE d.intBusinessUnitId = {ael_bu}
  AND d.dteDeliveryDate >= '{start}' AND d.dteDeliveryDate < '{end}'
  AND ABS(CAST(HASHBYTES('MD5', ISNULL(d.strTerritoryName, '')) AS INT)) % {buckets} = {bucket}
GROUP BY d.strTerritoryName, s.NL5, s.NL7, s.NL8, YEAR(d.dteDeliveryDate), MONTH(d.dteDeliveryDate)
"""

SQL_TARGET = """
SELECT strTerritoryName AS Territory,
       intYear AS Yr,
       intMonth AS Mn,
       SUM(intTotalMemoTarget) AS MemoTarget
FROM rtm.tblMemoTargetSetup WITH (NOLOCK)
WHERE isActive = 1 AND intYear = {year}
  AND ABS(CAST(HASHBYTES('MD5', ISNULL(strTerritoryName, '')) AS INT)) % {buckets} = {bucket}
GROUP BY strTerritoryName, intYear, intMonth
"""

SQL_EMPLOYEE = """
SELECT intTerritoryId AS TerrId, MAX(strEmployeeName) AS Employee
FROM rtm.tblSalesForceDetails WITH (NOLOCK)
WHERE isActive = 1 AND strEmployeeName IS NOT NULL
  AND strEmployeeName NOT LIKE '%demonstration%' AND strEmployeeName NOT LIKE '%Test%'
GROUP BY intTerritoryId
"""

SQL_META = """
SELECT COUNT(DISTINCT intOutletId) AS ActiveCustomers,
       COUNT(DISTINCT intActionBy) AS ActiveSalesOfficers,
       COUNT(DISTINCT intBusinessPartnerId) AS Distributors,
       COUNT(DISTINCT strBusinessPartnerName) AS DistributorsByName
FROM rtm.tblOutletDeliveryHeader WITH (NOLOCK)
WHERE dteDeliveryDate >= '{start}' AND dteDeliveryDate < '{end}'
  AND intBusinessUnitId = {ael_bu}
"""

SQL_MONTHLY_CUSTOMERS = """
SELECT MONTH(dteDeliveryDate) AS Mn,
       COUNT(DISTINCT intOutletId) AS Customers,
       COUNT(DISTINCT intActionBy) AS Officers,
       COUNT(DISTINCT intBusinessPartnerId) AS Distributors,
       COUNT(*) AS Deliveries
FROM rtm.tblOutletDeliveryHeader WITH (NOLOCK)
WHERE dteDeliveryDate >= '{start}' AND dteDeliveryDate < '{end}'
  AND intBusinessUnitId = {ael_bu}
GROUP BY MONTH(dteDeliveryDate)
"""

SQL_PRODUCTS = """
SELECT r.strProductName AS SKU,
       SUM(r.numDeliveryQuantity) AS Qty,
       SUM(r.numDeliveryAmount) AS Amt
FROM rtm.tblOutletDeliveryRow r WITH (NOLOCK)
JOIN rtm.tblOutletDeliveryHeader h WITH (NOLOCK) ON r.intDeliveryId = h.intDeliveryId
WHERE h.dteDeliveryDate >= '{start}' AND h.dteDeliveryDate < '{end}'
  AND h.intBusinessUnitId = {ael_bu}
GROUP BY r.strProductName
ORDER BY Amt DESC
"""

# SKU growth (national, 3-month and month-over-month in one pass — single fast query)
SQL_SKU_GROWTH = """
SELECT r.strProductName AS SKU,
       SUM(CASE WHEN h.dteDeliveryDate >= '{r3}' THEN r.numDeliveryAmount ELSE 0 END) AS R3,
       SUM(CASE WHEN h.dteDeliveryDate >= '{p3}' AND h.dteDeliveryDate < '{r3}' THEN r.numDeliveryAmount ELSE 0 END) AS P3,
       SUM(CASE WHEN h.dteDeliveryDate >= '{rm}' THEN r.numDeliveryAmount ELSE 0 END) AS RM,
       SUM(CASE WHEN h.dteDeliveryDate >= '{pm}' AND h.dteDeliveryDate < '{rm}' THEN r.numDeliveryAmount ELSE 0 END) AS PM
FROM rtm.tblOutletDeliveryRow r WITH (NOLOCK)
JOIN rtm.tblOutletDeliveryHeader h WITH (NOLOCK) ON r.intDeliveryId = h.intDeliveryId
WHERE h.dteDeliveryDate >= '{p3}' AND h.dteDeliveryDate < '{end}'
  AND h.intBusinessUnitId = {ael_bu}
GROUP BY r.strProductName
"""


def main():
    push = "--push" in sys.argv
    api_key = get_api_key()

    today = time.strftime("%Y-%m-%d")
    end_date = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 86400))

    print("[1/4] Fetching actual deliveries (live, %d buckets) ..." % BUCKETS)
    actual = paged_query(SQL_ACTUAL, api_key, start=START_DATE, end=end_date, ael_l1=AEL_HIERARCHY_L1, ael_bu=AEL_BUSINESS_UNIT)
    print("      %d rows" % len(actual))

    print("[2/4] Fetching memo targets (%d buckets) ..." % BUCKETS)
    target = paged_query(SQL_TARGET, api_key, year=int(START_DATE[:4]))
    print("      %d rows" % len(target))

    print("[3/4] Fetching employee-territory mapping ...")
    h_emp, r_emp = rtm_query(SQL_EMPLOYEE, api_key)
    emp = rows_to_dicts(h_emp, r_emp)
    emp_by_id = {}
    for e in emp:
        tid = str(e.get("TerrId") or "").strip()
        nm = (e.get("Employee") or "").strip()
        if tid and nm and tid not in emp_by_id:
            emp_by_id[tid] = nm
    print("      %d employees mapped" % len(emp_by_id))

    print("[4/6] Fetching live customer / sales-officer / distributor counts ...")
    h_meta, r_meta = rtm_query(SQL_META.format(start=START_DATE, end=end_date, ael_bu=AEL_BUSINESS_UNIT), api_key)
    meta_row = rows_to_dicts(h_meta, r_meta)
    meta_counts = meta_row[0] if meta_row else {}
    print("      %s" % meta_counts)

    print("[5/6] Fetching monthly customer activity ...")
    h_mo, r_mo = rtm_query(SQL_MONTHLY_CUSTOMERS.format(start=START_DATE, end=end_date, ael_bu=AEL_BUSINESS_UNIT), api_key)
    monthly_rows = rows_to_dicts(h_mo, r_mo)
    monthly_customers = [0] * 12
    monthly_officers = [0] * 12
    monthly_distributors = [0] * 12
    monthly_deliveries = [0] * 12
    for m in monthly_rows:
        mi_ = int(num(m.get("Mn"))) - 1
        if 0 <= mi_ < 12:
            monthly_customers[mi_] = int(num(m.get("Customers")))
            monthly_officers[mi_] = int(num(m.get("Officers")))
            monthly_distributors[mi_] = int(num(m.get("Distributors")))
            monthly_deliveries[mi_] = int(num(m.get("Deliveries")))
    print("      customers by month: %s" % monthly_customers)

    print("[6/8] Fetching SKU-wise performance ...")
    h_sku, r_sku = rtm_query(SQL_PRODUCTS.format(start=START_DATE, end=end_date, ael_bu=AEL_BUSINESS_UNIT), api_key, limit=200)
    products = []
    for p in rows_to_dicts(h_sku, r_sku):
        products.append({"sku": (p.get("SKU") or "").strip(), "qty": round(num(p.get("Qty"))), "amt": round(num(p.get("Amt")))})
    print("      %d SKUs" % len(products))

    # ---- SKU x Zone growth (3-month and month-over-month in one pass) ----
    _cur = dt.date.today().replace(day=1)
    def _months_ago(d, n):
        m = d.month - n; y = d.year
        while m <= 0:
            m += 12; y -= 1
        return dt.date(y, m, 1)
    growth_end = _cur.isoformat()
    r3_start = _months_ago(_cur, 3).isoformat()
    p3_start = _months_ago(_cur, 6).isoformat()
    rm_start = _months_ago(_cur, 1).isoformat()
    pm_start = _months_ago(_cur, 2).isoformat()
    print("[7/8] Fetching SKU growth (3M & MoM) ...")
    h_g, r_g = rtm_query(SQL_SKU_GROWTH.format(r3=r3_start, p3=p3_start, rm=rm_start, pm=pm_start, end=growth_end, ael_bu=AEL_BUSINESS_UNIT), api_key, limit=200)
    sku_growth = []
    for r in rows_to_dicts(h_g, r_g):
        sku = (r.get("SKU") or "").strip()
        if not sku:
            continue
        r3 = num(r.get("R3")); p3 = num(r.get("P3")); rm = num(r.get("RM")); pm = num(r.get("PM"))
        g3 = ((r3 - p3) / p3 * 100) if p3 > 0 else (100.0 if r3 > 0 else 0.0)
        gm = ((rm - pm) / pm * 100) if pm > 0 else (100.0 if rm > 0 else 0.0)
        sku_growth.append({"sku": sku, "g3": round(g3, 1), "r3": round(r3), "p3": round(p3), "gm": round(gm, 1), "rm": round(rm), "pm": round(pm)})
    sku_growth.sort(key=lambda x: -x["g3"])
    print("      %d SKU growth rows" % len(sku_growth))

    if not actual:
        print("!! No live delivery data found — aborting (keep existing data.js).")
        return 1

    # ---- build target per territory (month -> memo target), then carry-forward ----
    target_year = int(START_DATE[:4])
    tgt_by_terr = {}
    for t in target:
        terr = (t.get("Territory") or "").strip()
        yr = int(num(t.get("Yr")))
        mn = int(num(t.get("Mn")))
        if yr != target_year or mn < 1 or mn > 12:
            continue
        d = tgt_by_terr.setdefault(terr, {})
        d[mn] = d.get(mn, 0.0) + num(t.get("MemoTarget"))

    def carried_target(terr, mn):
        d = tgt_by_terr.get(terr)
        if not d:
            return 0.0
        best = None
        for k in sorted(d):
            if k <= mn:
                best = d[k]
            else:
                break
        if best is None:
            best = d[min(d)]
        return best

    # ---- national average delivery value (for memo_x_avg model) ----
    total_amount = sum(num(a.get("Amount")) for a in actual)
    total_cnt = sum(num(a.get("Cnt")) for a in actual)
    avg_delivery_value = (total_amount / total_cnt) if total_cnt else 0.0
    if AVG_MEMO_VALUE_OVERRIDE:
        avg_delivery_value = float(AVG_MEMO_VALUE_OVERRIDE)

    # ---- load official PDF target (BDT per zone-month) ----
    base_dir = os.path.dirname(os.path.abspath(__file__))
    pdf_target = {}
    pdf_path = os.path.join(base_dir, "js", "pdf_target.json")
    if os.path.exists(pdf_path):
        with open(pdf_path, encoding="utf-8") as f:
            pdf_target = json.load(f).get("zoneMonth", {})

    # ---- zone-month actual (to distribute PDF target proportionally) ----
    zone_month_actual = {}
    for a in actual:
        z = (a.get("Zone") or "").strip() or (a.get("Division") or "").strip() or "National"
        mi_ = int(num(a.get("Mn"))) - 1
        key = (z, mi_)
        zone_month_actual[key] = zone_month_actual.get(key, 0.0) + num(a.get("Amount"))

    # ---- build rows ----
    MONTHS = ["January", "February", "March", "April", "May", "June", "July",
              "August", "September", "October", "November", "December"]
    rows = []
    zone_set = {}
    for a in actual:
        terr = (a.get("Territory") or "").strip()
        if not terr:
            continue
        yr = int(num(a.get("Yr")))
        mn = int(num(a.get("Mn")))
        amount = num(a.get("Amount"))
        cnt = num(a.get("Cnt"))
        zone = (a.get("Zone") or "").strip() or (a.get("Division") or "").strip() or "National"
        point = (a.get("Point") or "").strip() or terr
        division = (a.get("Division") or "").strip() or zone
        memotarget = carried_target(terr, mn)
        sr = emp_by_id.get(str(a.get("TerrId") or "").strip(), terr)

        mi_idx = mn - 1
        # prefer the official PDF BDT target (distributed proportionally to actual)
        pdf_t = pdf_target.get(zone, {}).get(str(mi_idx))
        if pdf_t is not None and zone_month_actual.get((zone, mi_idx)):
            target_val = pdf_t * (amount / zone_month_actual[(zone, mi_idx)])
            actual_val = amount
        elif TARGET_MODEL == "memo_count":
            target_val = memotarget
            actual_val = cnt
        else:  # memo_x_avg
            target_val = memotarget * avg_delivery_value
            actual_val = amount

        if mn < 1 or mn > 12:
            continue
        # [SR, Zone, Point, ZM, DSM, monthIdx, target, actual, volume, targetVolume]
        rows.append([sr, zone, point, zone, division, mi_idx, round(target_val), round(actual_val), int(cnt), int(round(memotarget))])
        if zone not in zone_set:
            zone_set[zone] = True

    # ---- zone coordinates ----
    def coord_for(zone):
        if zone in REGION_COORDS:
            return REGION_COORDS[zone]
        key = zone.replace(" Zone", "").replace(" Point", "").strip()
        if key in DISTRICT_COORDS:
            return DISTRICT_COORDS[key]
        tok = key.split(" ")[0] if key.split(" ") else key
        if tok in DISTRICT_COORDS:
            return DISTRICT_COORDS[tok]
        h = sum(ord(c) for c in zone)
        lat = 21.5 + (h % 50) / 10.0
        lng = 88.5 + (h % 40) / 10.0
        return [round(lat, 2), round(lng, 2)]

    zone_coord = {z: coord_for(z) for z in zone_set}
    dsms = sorted({r[4] for r in rows if r[4]})

    # ---- write js/data.js ----
    out = {
        "months": MONTHS,
        "dsms": dsms,
        "zoneCoord": zone_coord,
        "rows": rows,
        "meta": {
            "lastSync": today,
            "source": "RTM (live)",
            "model": TARGET_MODEL,
            "year": int(START_DATE[:4]),
            "months": sorted({r[5] for r in rows}),
            "activeCustomers": int(num(meta_counts.get("ActiveCustomers"))),
            "activeSalesOfficers": int(num(meta_counts.get("ActiveSalesOfficers"))),
            "distributors": int(num(meta_counts.get("Distributors"))),
            "monthlyCustomers": monthly_customers,
            "monthlySalesOfficers": monthly_officers,
            "monthlyDistributors": monthly_distributors,
            "monthlyDeliveries": monthly_deliveries,
            "products": products,
            "skuGrowth": sku_growth,
        },
    }
    js = ("(function(){\nwindow.AEL_DATA = "
          + json.dumps(out, ensure_ascii=False)
          + ";\n})();\n")
    base = os.path.dirname(os.path.abspath(__file__))
    data_path = os.path.join(base, "js", "data.js")
    with open(data_path, "w", encoding="utf-8") as f:
        f.write(js)

    print("[8/8] Wrote %s" % data_path)
    if TARGET_MODEL == "memo_count":
        print("      zones=%d  rows=%d  actual=%.0f deliveries  target=%.0f memos" % (
            len(zone_set), len(rows), sum(r[7] for r in rows), sum(r[6] for r in rows)))
    else:
        print("      zones=%d  rows=%d  actual=BDT %.0f  target=BDT %.0f" % (
            len(zone_set), len(rows), total_amount, sum(r[6] for r in rows)))

    # ---- bump cache-buster versions on all assets in index.html ----
    html_path = os.path.join(base, "index.html")
    with open(html_path, encoding="utf-8") as f:
        html = f.read()
    new_v = str(int(time.time()))
    html = re.sub(r'\?v=\d+', '?v=' + new_v, html)
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    print("      bumped index.html asset versions -> %s" % new_v)

    # ---- write a small manifest for traceability ----
    manifest = {
        "lastSync": today,
        "model": TARGET_MODEL,
        "zones": len(zone_set),
        "rows": len(rows),
        "totalActual": round(total_amount),
    }
    with open(os.path.join(base, "js", "data.meta.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    # ---- optional git push ----
    if push:
        import subprocess
        import shutil

        def find_git():
            candidates = [
                os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Git", "cmd", "git.exe"),
                os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "Git", "cmd", "git.exe"),
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Git", "cmd", "git.exe"),
            ]
            for c in candidates:
                if os.path.exists(c):
                    return c
            return "git" if shutil.which("git") else "git"

        def git(*args):
            return subprocess.run([find_git()] + list(args), cwd=base, capture_output=True, text=True)

        git("add", "js/data.js", "js/data.meta.json", "index.html")
        git("commit", "-m", "Sync live RTM data (%s)" % today)
        p = git("push")
        print("git push:", p.stdout.strip() or p.stderr.strip())
        if p.returncode != 0:
            print("!! push failed:", p.stderr.strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
