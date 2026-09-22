#!/usr/bin/env python3
"""
AEL Light Engineering Sales Dashboard — RTM sync script.

Pulls LIVE RTM data for Akij Light Engineering Limited (BU 237, all 5 sales units)
and regenerates js/data_ale.js so the Light Engineering dashboard reflects live data.

Mirrors sync_rtm.py (Akij Essential) but:
  - BU 237 (Akij Light Engineering Limited)
  - Hierarchy: Division = business unit (NL1), Zone = NL7, Point = NL8, Section = NL9
  - Target model: memo_x_avg (no official PDF target file)
"""

import os
import json
import re
import sys
import time
import datetime as dt
import urllib.request

MCP_URL = "https://arl-mcp.ibos.io/mcp"
TOOL_NAME = "ExecuteRtmQueryAsync"

START_DATE = "2026-01-01"

ALE_BUSINESS_UNIT = 237  # Akij Light Engineering Limited

# memo target count x avg delivery value
TARGET_MODEL = "memo_x_avg"
AVG_MEMO_VALUE_OVERRIDE = None

BUCKETS = 50

# business-unit short labels (Division names)
BU_SHORT = {
    "Akij Light Engineering Limited (Electrical)": "Electrical",
    "Akij Light Engineering Limited (Electrical-L)": "Electrical-L",
    "Akij Light Engineering Limited (Home Appliances)": "Home Appliances",
    "Akij Light Engineering Limited (Hardware Tools)": "Hardware Tools",
    "Akij Light Engineering Limited (Wastage (ALEL))": "Wastage",
}

DISTRICT_COORDS = {
    "Dhaka": [23.81, 90.41], "Dhanmondi": [23.75, 90.37], "Mirpur": [23.82, 90.37],
    "Gulshan": [23.79, 90.42], "Uttara": [23.88, 90.39], "Jatrabari": [23.70, 90.43],
    "Malibag": [23.75, 90.42], "Savar": [23.85, 90.26], "Keraniganj": [23.68, 90.35],
    "Mohammadpur": [23.77, 90.36], "Narayanganj": [23.62, 90.50], "Munshiganj": [23.55, 90.53],
    "Narsingdi": [23.92, 90.72], "Manikganj": [23.86, 90.00], "Gazipur": [23.99, 90.42],
    "Tangail": [24.25, 89.92], "Mymensingh": [24.75, 90.40], "Jamalpur": [24.92, 89.94],
    "Netrokona": [24.88, 90.73], "Kishoreganj": [24.44, 90.78], "Brahmanbaria": [23.95, 91.11],
    "Cumilla": [23.46, 91.18], "Chandpur": [23.23, 90.65], "Noakhali": [22.87, 91.10],
    "Feni": [23.02, 91.40], "Lakshmipur": [22.94, 90.83], "Chittagong": [22.33, 91.83],
    "Cox's Bazar": [21.43, 91.97], "Khagrachhari": [23.11, 91.99], "Rangamati": [22.64, 92.18],
    "Bandarban": [22.20, 92.22], "Sylhet": [24.89, 91.87], "Moulvibazar": [24.48, 91.77],
    "Habiganj": [24.38, 91.42], "Sunamganj": [25.07, 91.40], "Khulna": [22.82, 89.55],
    "Bagerhat": [22.65, 89.79], "Satkhira": [22.72, 89.07], "Jessore": [23.16, 89.21],
    "Jhenaidah": [23.54, 89.18], "Magura": [23.49, 89.42], "Narail": [23.17, 89.50],
    "Kushtia": [23.90, 89.12], "Chuadanga": [23.64, 88.84], "Meherpur": [23.76, 88.63],
    "Rajshahi": [24.37, 88.60], "Bogura": [24.85, 89.37], "Naogaon": [24.81, 88.95],
    "Pabna": [24.00, 89.24], "Sirajganj": [24.45, 89.70], "Natore": [24.42, 88.99],
    "Joypurhat": [25.10, 89.03], "Chapainawabganj": [24.59, 88.27], "Rangpur": [25.75, 89.25],
    "Dinajpur": [25.62, 88.63], "Thakurgaon": [26.03, 88.47], "Panchagarh": [26.34, 88.55],
    "Nilphamari": [25.93, 88.85], "Lalmonirhat": [25.92, 89.45], "Kurigram": [25.81, 89.65],
    "Gaibandha": [25.33, 89.54], "Barishal": [22.70, 90.37], "Bhola": [22.69, 90.65],
    "Patuakhali": [22.36, 90.32], "Barguna": [22.16, 90.13], "Pirojpur": [22.58, 89.99],
    "Jhalokathi": [22.64, 90.20], "Madaripur": [23.17, 90.19], "Gopalganj": [23.01, 89.83],
    "Faridpur": [23.61, 89.84], "Shariatpur": [23.21, 90.35], "Nawabganj": [23.66, 90.17],
}


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
    raise RuntimeError("RTM API key not found.")


def rtm_query(sql, api_key, limit=200):
    payload = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000) % 100000,
        "method": "tools/call",
        "params": {"name": TOOL_NAME, "arguments": {"sqlQuery": sql, "limit": limit}},
    }
    req = urllib.request.Request(
        MCP_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "X-API-Key": api_key,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ALE-Dashboard/1.0",
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
    return parse_md_table(content[0].get("text", ""))


def parse_md_table(text):
    header, rows = [], []
    for ln in text.split("\n"):
        ln = ln.strip()
        if not ln.startswith("|"):
            continue
        cells = [c.strip() for c in ln.strip("|").split("|")]
        if not cells or all(c == "" for c in cells):
            continue
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


SQL_ACTUAL = """
SELECT d.strTerritoryName AS Territory,
       MAX(d.intTerritoryid) AS TerrId,
       COALESCE(s.NL1, '') AS Division,
       COALESCE(s.NL7, '') AS Zone,
       COALESCE(s.NL8, d.strTerritoryName) AS Point,
       YEAR(d.dteDeliveryDate) AS Yr,
       MONTH(d.dteDeliveryDate) AS Mn,
       SUM(d.numTotalDeliveryAmount) AS Amount,
       COUNT(*) AS Cnt
FROM rtm.tblOutletDeliveryHeader d WITH (NOLOCK)
LEFT JOIN rtm.tblTerritoryInfoSetup s WITH (NOLOCK)
  ON s.L9 = d.intTerritoryid AND s.isActive = 1 AND s.intLevelId = 9 AND s.intBusinessUnitId = {ale_bu}
WHERE d.intBusinessUnitId = {ale_bu}
  AND d.dteDeliveryDate >= '{start}' AND d.dteDeliveryDate < '{end}'
  AND ABS(CAST(HASHBYTES('MD5', ISNULL(d.strTerritoryName, '')) AS INT)) % {buckets} = {bucket}
GROUP BY d.strTerritoryName, s.NL1, s.NL7, s.NL8, YEAR(d.dteDeliveryDate), MONTH(d.dteDeliveryDate)
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

SQL_META = """
SELECT COUNT(DISTINCT intOutletId) AS ActiveCustomers,
       COUNT(DISTINCT intActionBy) AS ActiveSalesOfficers,
       COUNT(DISTINCT intBusinessPartnerId) AS Distributors
FROM rtm.tblOutletDeliveryHeader WITH (NOLOCK)
WHERE dteDeliveryDate >= '{start}' AND dteDeliveryDate < '{end}'
  AND intBusinessUnitId = {ale_bu}
"""

SQL_MONTHLY_CUSTOMERS = """
SELECT MONTH(dteDeliveryDate) AS Mn,
       COUNT(DISTINCT intOutletId) AS Customers,
       COUNT(DISTINCT intActionBy) AS Officers,
       COUNT(DISTINCT intBusinessPartnerId) AS Distributors,
       COUNT(*) AS Deliveries
FROM rtm.tblOutletDeliveryHeader WITH (NOLOCK)
WHERE dteDeliveryDate >= '{start}' AND dteDeliveryDate < '{end}'
  AND intBusinessUnitId = {ale_bu}
GROUP BY MONTH(dteDeliveryDate)
"""

SQL_PRODUCTS = """
SELECT r.strProductName AS SKU,
       SUM(r.numDeliveryQuantity) AS Qty,
       SUM(r.numDeliveryAmount) AS Amt
FROM rtm.tblOutletDeliveryRow r WITH (NOLOCK)
JOIN rtm.tblOutletDeliveryHeader h WITH (NOLOCK) ON r.intDeliveryId = h.intDeliveryId
WHERE h.dteDeliveryDate >= '{start}' AND h.dteDeliveryDate < '{end}'
  AND h.intBusinessUnitId = {ale_bu}
GROUP BY r.strProductName
ORDER BY Amt DESC
"""

SQL_DISTRIBUTORS = """
SELECT strBusinessPartnerName AS Distributor,
       MONTH(dteDeliveryDate) AS Mn,
       SUM(numTotalDeliveryAmount) AS Amt,
       COUNT(DISTINCT intOutletId) AS Outlets
FROM rtm.tblOutletDeliveryHeader WITH (NOLOCK)
WHERE dteDeliveryDate >= '{start}' AND dteDeliveryDate < '{end}'
  AND intBusinessUnitId = {ale_bu}
  AND ABS(CAST(HASHBYTES('MD5', ISNULL(strBusinessPartnerName, '')) AS INT)) % {buckets} = {bucket}
GROUP BY strBusinessPartnerName, MONTH(dteDeliveryDate)
"""


def main():
    api_key = get_api_key()
    today = time.strftime("%Y-%m-%d")
    end_date = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 86400))

    print("[1/5] Fetching actual deliveries ...")
    actual = paged_query(SQL_ACTUAL, api_key, start=START_DATE, end=end_date, ale_bu=ALE_BUSINESS_UNIT)
    print("      %d rows" % len(actual))

    print("[2/5] Fetching memo targets ...")
    target = paged_query(SQL_TARGET, api_key, year=int(START_DATE[:4]))
    print("      %d rows" % len(target))

    print("[3/5] Fetching meta counts ...")
    h_meta, r_meta = rtm_query(SQL_META.format(start=START_DATE, end=end_date, ale_bu=ALE_BUSINESS_UNIT), api_key)
    meta_row = rows_to_dicts(h_meta, r_meta)
    meta_counts = meta_row[0] if meta_row else {}

    print("[4/5] Fetching monthly activity ...")
    h_mo, r_mo = rtm_query(SQL_MONTHLY_CUSTOMERS.format(start=START_DATE, end=end_date, ale_bu=ALE_BUSINESS_UNIT), api_key)
    monthly_customers = [0] * 12
    monthly_officers = [0] * 12
    monthly_distributors = [0] * 12
    monthly_deliveries = [0] * 12
    for m in rows_to_dicts(h_mo, r_mo):
        mi_ = int(num(m.get("Mn"))) - 1
        if 0 <= mi_ < 12:
            monthly_customers[mi_] = int(num(m.get("Customers")))
            monthly_officers[mi_] = int(num(m.get("Officers")))
            monthly_distributors[mi_] = int(num(m.get("Distributors")))
            monthly_deliveries[mi_] = int(num(m.get("Deliveries")))

    print("[5/5] Fetching products & distributors ...")
    h_sku, r_sku = rtm_query(SQL_PRODUCTS.format(start=START_DATE, end=end_date, ale_bu=ALE_BUSINESS_UNIT), api_key, limit=200)
    products = []
    for p in rows_to_dicts(h_sku, r_sku):
        products.append({"sku": (p.get("SKU") or "").strip(), "qty": round(num(p.get("Qty"))), "amt": round(num(p.get("Amt")))})

    dist_rows = paged_query(SQL_DISTRIBUTORS, api_key, buckets=25, start=START_DATE, end=end_date, ale_bu=ALE_BUSINESS_UNIT)
    distributor_sales = []
    for r in dist_rows:
        d = (r.get("Distributor") or "").strip()
        mn = int(num(r.get("Mn")))
        if not d or mn < 1 or mn > 12:
            continue
        distributor_sales.append({"distributor": d, "mn": mn - 1, "amt": round(num(r.get("Amt"))), "outlets": int(num(r.get("Outlets")))})

    if not actual:
        print("!! No live delivery data — aborting.")
        return 1

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

    total_amount = sum(num(a.get("Amount")) for a in actual)
    total_cnt = sum(num(a.get("Cnt")) for a in actual)
    avg_delivery_value = (total_amount / total_cnt) if total_cnt else 0.0
    if AVG_MEMO_VALUE_OVERRIDE:
        avg_delivery_value = float(AVG_MEMO_VALUE_OVERRIDE)
    print("      avg delivery value = BDT %.1f" % avg_delivery_value)

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
        raw_div = (a.get("Division") or "").strip()
        if not raw_div or raw_div == "National":
            continue
        division = BU_SHORT.get(raw_div, raw_div or zone)
        memotarget = carried_target(terr, mn)
        sr = terr  # no employee mapping for BU 237

        mi_idx = mn - 1
        target_val = memotarget * avg_delivery_value
        actual_val = amount

        if mn < 1 or mn > 12:
            continue
        rows.append([sr, zone, point, zone, division, mi_idx, round(target_val), round(actual_val), int(cnt), int(round(memotarget))])
        if zone not in zone_set:
            zone_set[zone] = True

    def coord_for(zone):
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
            "distributorSales": distributor_sales,
        },
    }
    js = ("(function(){\nwindow.ALE_DATA = "
          + json.dumps(out, ensure_ascii=False)
          + ";\n})();\n")
    base = os.path.dirname(os.path.abspath(__file__))
    data_path = os.path.join(base, "js", "data_ale.js")
    with open(data_path, "w", encoding="utf-8") as f:
        f.write(js)
    print("[done] Wrote %s (rows=%d, zones=%d, divisions=%d)" % (data_path, len(rows), len(zone_set), len(dsms)))


if __name__ == "__main__":
    sys.exit(main())
