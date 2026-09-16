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
import urllib.request

# ============================================================================
# CONFIGURATION
# ============================================================================
MCP_URL = "https://arl-mcp.ibos.io/mcp"
TOOL_NAME = "ExecuteRtmQueryAsync"

# ---- date range to sync (YYYY-MM-DD). Default: current year to date ----
START_DATE = "2026-01-01"

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


def paged_query(sql_template, api_key, **fmt):
    """Fetch across all hash buckets (each bucket < 200 rows)."""
    all_rows = []
    for b in range(BUCKETS):
        sql = sql_template.format(bucket=b, buckets=BUCKETS, **fmt)
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
SELECT strTerritoryName AS Territory,
       YEAR(dteDeliveryDate) AS Yr,
       MONTH(dteDeliveryDate) AS Mn,
       SUM(numTotalDeliveryAmount) AS Amount,
       COUNT(*) AS Cnt
FROM rtm.tblOutletDeliveryHeader WITH (NOLOCK)
WHERE dteDeliveryDate >= '{start}' AND dteDeliveryDate < '{end}'
  AND ABS(CAST(HASHBYTES('MD5', ISNULL(strTerritoryName, '')) AS INT)) % {buckets} = {bucket}
GROUP BY strTerritoryName, YEAR(dteDeliveryDate), MONTH(dteDeliveryDate)
"""

SQL_TARGET = """
SELECT strTerritoryName AS Territory,
       strRegionName AS Region,
       strAreaName AS Area,
       intYear AS Yr,
       intMonth AS Mn,
       SUM(intTotalMemoTarget) AS MemoTarget
FROM rtm.tblMemoTargetSetup WITH (NOLOCK)
WHERE isActive = 1 AND intYear = {year}
  AND ABS(CAST(HASHBYTES('MD5', ISNULL(strTerritoryName, '')) AS INT)) % {buckets} = {bucket}
GROUP BY strTerritoryName, strRegionName, strAreaName, intYear, intMonth
"""

SQL_EMPLOYEE = """
SELECT strTerritoryName AS Territory, strEmployeeName AS Employee
FROM rtm.tblEmployeeTerritory WITH (NOLOCK)
WHERE isActive = 1
"""


def main():
    push = "--push" in sys.argv
    api_key = get_api_key()

    today = time.strftime("%Y-%m-%d")
    end_date = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 86400))

    print("[1/4] Fetching actual deliveries (live, %d buckets) ..." % BUCKETS)
    actual = paged_query(SQL_ACTUAL, api_key, start=START_DATE, end=end_date)
    print("      %d rows" % len(actual))

    print("[2/4] Fetching memo targets (%d buckets) ..." % BUCKETS)
    target = paged_query(SQL_TARGET, api_key, year=int(START_DATE[:4]))
    print("      %d rows" % len(target))

    print("[3/4] Fetching employee-territory mapping ...")
    h_emp, r_emp = rtm_query(SQL_EMPLOYEE, api_key)
    emp = rows_to_dicts(h_emp, r_emp)
    emp_by_terr = {}
    for e in emp:
        t = (e.get("Territory") or "").strip()
        if t and t not in emp_by_terr:
            emp_by_terr[t] = (e.get("Employee") or "").strip()
    print("      %d territories mapped" % len(emp_by_terr))

    if not actual:
        print("!! No live delivery data found — aborting (keep existing data.js).")
        return 1

    # ---- build target lookup: (territory, yr, mn) -> (memoTarget, region, area) ----
    tgt_map = {}
    for t in target:
        terr = (t.get("Territory") or "").strip()
        yr = int(num(t.get("Yr")))
        mn = int(num(t.get("Mn")))
        key = (terr, yr, mn)
        cur = tgt_map.get(key)
        if cur is None:
            tgt_map[key] = (num(t.get("MemoTarget")), (t.get("Region") or "").strip(), (t.get("Area") or "").strip())
        else:
            # accumulate target amounts for the same territory/month
            cur[0] += num(t.get("MemoTarget"))

    # ---- national average delivery value (for memo_x_avg model) ----
    total_amount = sum(num(a.get("Amount")) for a in actual)
    total_cnt = sum(num(a.get("Cnt")) for a in actual)
    avg_delivery_value = (total_amount / total_cnt) if total_cnt else 0.0
    if AVG_MEMO_VALUE_OVERRIDE:
        avg_delivery_value = float(AVG_MEMO_VALUE_OVERRIDE)

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
        tinfo = tgt_map.get((terr, yr, mn))
        memotarget, region, area = (tinfo if tinfo else (0.0, "", ""))

        zone = region or area or "National"
        point = terr
        sr = emp_by_terr.get(terr, terr)

        if TARGET_MODEL == "memo_count":
            target_val = memotarget
            actual_val = cnt
        else:  # memo_x_avg
            target_val = memotarget * avg_delivery_value
            actual_val = amount

        if mn < 1 or mn > 12:
            continue
        rows.append([sr, zone, point, area or region or zone, region or zone, mn - 1, round(target_val), round(actual_val)])
        if zone not in zone_set:
            zone_set[zone] = True

    # ---- region coordinates ----
    def coord_for(zone):
        if zone in REGION_COORDS:
            return REGION_COORDS[zone]
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
        },
    }
    js = ("(function(){\nwindow.AEL_DATA = "
          + json.dumps(out, ensure_ascii=False)
          + ";\n})();\n")
    base = os.path.dirname(os.path.abspath(__file__))
    data_path = os.path.join(base, "js", "data.js")
    with open(data_path, "w", encoding="utf-8") as f:
        f.write(js)

    print("[4/4] Wrote %s" % data_path)
    if TARGET_MODEL == "memo_count":
        print("      zones=%d  rows=%d  actual=%.0f deliveries  target=%.0f memos" % (
            len(zone_set), len(rows), sum(r[7] for r in rows), sum(r[6] for r in rows)))
    else:
        print("      zones=%d  rows=%d  actual=BDT %.0f  target=BDT %.0f" % (
            len(zone_set), len(rows), total_amount, sum(r[6] for r in rows)))

    # ---- bump data.js version in index.html so browsers fetch the fresh file ----
    html_path = os.path.join(base, "index.html")
    with open(html_path, encoding="utf-8") as f:
        html = f.read()
    new_v = str(int(time.time()))
    html = re.sub(r'js/data\.js\?v=\d+', 'js/data.js?v=' + new_v, html)
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    print("      bumped index.html data.js version -> %s" % new_v)

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
        def git(*args):
            return subprocess.run(["git"] + list(args), cwd=base, capture_output=True, text=True)

        git("add", "js/data.js", "js/data.meta.json", "index.html")
        git("commit", "-m", "Sync live RTM data (%s)" % today)
        p = git("push")
        print("git push:", p.stdout.strip() or p.stderr.strip())
        if p.returncode != 0:
            print("!! push failed:", p.stderr.strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
