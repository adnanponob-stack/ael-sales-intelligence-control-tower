#!/usr/bin/env python3
"""One-off: fetch Sales Officer (SO) daily productivity from RTM and dump JSON."""
import os, json, time, urllib.request

MCP_URL = "https://arl-mcp.ibos.io/mcp"
TOOL_NAME = "ExecuteRtmQueryAsync"
START = "2026-01-01"
BU = 144

def api_key():
    k = os.environ.get("RTM_MCP_API_KEY")
    if k:
        return k.strip()
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rtm_key.txt")
    with open(p, encoding="utf-8") as f:
        return f.read().strip()

def rtm(sql, limit=200):
    payload = {"jsonrpc": "2.0", "id": int(time.time()*1000) % 100000,
               "method": "tools/call",
               "params": {"name": TOOL_NAME, "arguments": {"sqlQuery": sql, "limit": limit}}}
    req = urllib.request.Request(MCP_URL, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
                 "X-API-Key": api_key(), "User-Agent": "AEL/1.0"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.loads(r.read().decode())
    if data.get("error"):
        raise RuntimeError(data["error"])
    content = data.get("result", {}).get("content", [])
    if not content:
        return [], []
    text = content[0].get("text", "")
    header, rows = [], []
    for ln in text.split("\n"):
        ln = ln.strip()
        if not ln.startswith("|"):
            continue
        cells = [c.strip() for c in ln.strip("|").split("|")]
        if all(set(c) <= set("-: ") for c in cells):
            continue
        if not header:
            header = cells
        else:
            rows.append(cells)
    return header, rows

def dicts(header, rows):
    out = []
    for r in rows:
        out.append({header[i]: r[i] if i < len(r) else None for i in range(len(header))})
    return out

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

# ---- national daily series (last ~90 days) ----
SQL_DAILY = """
SELECT d, COUNT(DISTINCT so) so, SUM(tgt) tgt, SUM(vis) vis, SUM(calls) calls, SUM(amt) amt
FROM (
  SELECT intActionBy so, CONVERT(date,dteDeliveryDate) d,
         MAX(intTotalOutlet) tgt,
         COUNT(DISTINCT intOutletId) vis,
         COUNT(*) calls,
         SUM(numTotalDeliveryAmount) amt
  FROM rtm.tblOutletDeliveryHeader WITH (NOLOCK)
  WHERE intBusinessUnitId={bu} AND dteDeliveryDate>='{start}' AND intActionBy IS NOT NULL
  GROUP BY intActionBy, CONVERT(date,dteDeliveryDate)
) x GROUP BY d ORDER BY d DESC
""".format(bu=BU, start=START)

# ---- per-SO header aggregates (paginated by hash of intActionBy) ----
SQL_SO = """
SELECT intActionBy, MAX(strTerritoryName) terr, COUNT(DISTINCT d) days,
       SUM(tgt) tgt, SUM(vis) vis, SUM(calls) calls, SUM(amt) amt
FROM (
  SELECT intActionBy, strTerritoryName, CONVERT(date,dteDeliveryDate) d,
         MAX(intTotalOutlet) tgt,
         COUNT(DISTINCT intOutletId) vis,
         COUNT(*) calls,
         SUM(numTotalDeliveryAmount) amt
  FROM rtm.tblOutletDeliveryHeader WITH (NOLOCK)
  WHERE intBusinessUnitId={bu} AND dteDeliveryDate>='{start}' AND intActionBy IS NOT NULL
    AND ABS(CAST(HASHBYTES('MD5', ISNULL(CONVERT(varchar,intActionBy),'')) AS INT)) % {buckets} = {bucket}
  GROUP BY intActionBy, strTerritoryName, CONVERT(date,dteDeliveryDate)
) x GROUP BY intActionBy
"""

# ---- national daily line count ----
SQL_DAILY_LINES = """
SELECT CONVERT(date,h.dteDeliveryDate) d, COUNT(*) lines
FROM rtm.tblOutletDeliveryRow r WITH (NOLOCK)
JOIN rtm.tblOutletDeliveryHeader h WITH (NOLOCK) ON r.intDeliveryId = h.intDeliveryId
WHERE h.intBusinessUnitId={bu} AND h.dteDeliveryDate>='{start}'
GROUP BY CONVERT(date,h.dteDeliveryDate)
ORDER BY CONVERT(date,h.dteDeliveryDate) DESC
"""

# ---- per-SO line count (lines per call = delivery rows) paginated ----
SQL_LINES = """
SELECT h.intActionBy, COUNT(*) lines
FROM rtm.tblOutletDeliveryRow r WITH (NOLOCK)
JOIN rtm.tblOutletDeliveryHeader h WITH (NOLOCK) ON r.intDeliveryId = h.intDeliveryId
WHERE h.intBusinessUnitId={bu} AND h.dteDeliveryDate>='{start}' AND h.intActionBy IS NOT NULL
  AND ABS(CAST(HASHBYTES('MD5', ISNULL(CONVERT(varchar,h.intActionBy),'')) AS INT)) % {buckets} = {bucket}
GROUP BY h.intActionBy
"""

def main():
    k = api_key()
    print("daily...")
    h, r = rtm(SQL_DAILY, limit=200)
    daily = []
    for x in dicts(h, r):
        daily.append({"d": x["d"], "so": int(num(x["so"])), "tgt": int(num(x["tgt"])),
                      "vis": int(num(x["vis"])), "calls": int(num(x["calls"])),
                      "amt": round(num(x["amt"]))})
    daily.reverse()
    print("  %d days" % len(daily))

    h2, r2 = rtm(SQL_DAILY_LINES.format(bu=BU, start=START), limit=200)
    lines_by_d = {x["d"]: int(num(x["lines"])) for x in dicts(h2, r2)}
    for x in daily:
        x["lines"] = lines_by_d.get(x["d"], 0)
    print("  daily lines merged")

    B = 8
    officers = {}
    for b in range(B):
        h, r = rtm(SQL_SO.format(bu=BU, start=START, buckets=B, bucket=b), limit=200)
        for x in dicts(h, r):
            officers[int(num(x["intActionBy"]))] = {
                "terr": (x["terr"] or "").strip(),
                "days": int(num(x["days"])), "tgt": int(num(x["tgt"])),
                "vis": int(num(x["vis"])), "calls": int(num(x["calls"])),
                "amt": round(num(x["amt"])), "lines": 0}
        print("  so bucket %d -> %d" % (b, len(dicts(h, r))))

    for b in range(B):
        h, r = rtm(SQL_LINES.format(bu=BU, start=START, buckets=B, bucket=b), limit=200)
        for x in dicts(h, r):
            aid = int(num(x["intActionBy"]))
            if aid in officers:
                officers[aid]["lines"] = int(num(x["lines"]))
        print("  lines bucket %d -> %d" % (b, len(dicts(h, r))))

    so_list = sorted(officers.values(), key=lambda o: -o["amt"])
    out = {"daily": daily, "officers": so_list, "lastSync": time.strftime("%Y-%m-%d")}
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "so_prod.json"),
              "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print("wrote so_prod.json: %d officers" % len(so_list))

if __name__ == "__main__":
    main()
