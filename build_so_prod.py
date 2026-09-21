#!/usr/bin/env python3
"""Rebuild so_prod.json: active SR only, with officer name, ZM/DSM/NSM, last-day visited outlets."""
import os, json, time, urllib.request

MCP_URL = "https://arl-mcp.ibos.io/mcp"
START = "2026-01-01"
BU = 144

def api_key():
    return open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "rtm_key.txt"),
                encoding="utf-8").read().strip()

def call(tool, args):
    payload = {"jsonrpc": "2.0", "id": int(time.time()*1000) % 100000,
               "method": "tools/call", "params": {"name": tool, "arguments": args}}
    req = urllib.request.Request(MCP_URL, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
                 "X-API-Key": api_key(), "User-Agent": "AEL/1.0"}, method="POST")
    with urllib.request.urlopen(req, timeout=240) as r:
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

def dicts(h, r):
    return [{h[i]: (r[i] if i < len(r) else None) for i in range(len(h))} for r in r]

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

# per-SO aggregate (+ zone NL7, point NL8)
SQL_SO = """
SELECT intActionBy, MAX(strTerritoryName) terr, MAX(NL7) zone, MAX(NL8) point, MAX(dteDeliveryDate) lastDate,
       COUNT(DISTINCT d) days, SUM(tgt) tgt, SUM(vis) vis, SUM(calls) calls, SUM(amt) amt
FROM (
  SELECT h.intActionBy, h.strTerritoryName, s.NL7, s.NL8, h.dteDeliveryDate, CONVERT(date,h.dteDeliveryDate) d,
         MAX(h.intTotalOutlet) tgt,
         COUNT(DISTINCT h.intOutletId) vis,
         COUNT(*) calls,
         SUM(h.numTotalDeliveryAmount) amt
  FROM rtm.tblOutletDeliveryHeader h WITH (NOLOCK)
  LEFT JOIN rtm.tblTerritoryInfoSetup s WITH (NOLOCK)
    ON s.L9 = h.intTerritoryid AND s.intLevelId = 9 AND s.isActive = 1 AND s.L1 = 22600
  WHERE h.intBusinessUnitId={bu} AND h.dteDeliveryDate>='{start}' AND h.intActionBy IS NOT NULL
    AND ABS(CAST(HASHBYTES('MD5', ISNULL(CONVERT(varchar,h.intActionBy),'')) AS INT)) % {buckets} = {bucket}
  GROUP BY h.intActionBy, h.strTerritoryName, s.NL7, s.NL8, h.dteDeliveryDate, CONVERT(date,h.dteDeliveryDate)
) x GROUP BY intActionBy
"""

# last-day distinct outlets visited per officer
SQL_LAST_VIS = """
SELECT x.intActionBy, COUNT(DISTINCT x.intOutletId) lastVis
FROM rtm.tblOutletDeliveryHeader x WITH (NOLOCK)
JOIN (
  SELECT intActionBy, MAX(CONVERT(date,dteDeliveryDate)) md
  FROM rtm.tblOutletDeliveryHeader WITH (NOLOCK)
  WHERE intBusinessUnitId={bu} AND dteDeliveryDate>='{start}' AND intActionBy IS NOT NULL
    AND ABS(CAST(HASHBYTES('MD5', ISNULL(CONVERT(varchar,intActionBy),'')) AS INT)) % {buckets} = {bucket}
  GROUP BY intActionBy
) m ON m.intActionBy = x.intActionBy AND CONVERT(date,x.dteDeliveryDate) = m.md
WHERE x.intBusinessUnitId={bu} AND x.dteDeliveryDate>='{start}'
GROUP BY x.intActionBy
"""

SQL_LINES = """
SELECT h.intActionBy, COUNT(*) lines
FROM rtm.tblOutletDeliveryRow r WITH (NOLOCK)
JOIN rtm.tblOutletDeliveryHeader h WITH (NOLOCK) ON r.intDeliveryId = h.intDeliveryId
WHERE h.intBusinessUnitId={bu} AND h.dteDeliveryDate>='{start}' AND h.intActionBy IS NOT NULL
  AND ABS(CAST(HASHBYTES('MD5', ISNULL(CONVERT(varchar,h.intActionBy),'')) AS INT)) % {buckets} = {bucket}
GROUP BY h.intActionBy
"""

SR_SET = {"Sales Representative", "Market Developer", "Territory Officer",
          "Territory Sales Officer", "Territory Sales Manager"}
ZM_SET = {"Zonal Sales Manager", "Area Manager", "Regional Manager", "Regional Sales Manager", "Territory Manager"}
DSM_SET = {"Divisional Sales Manager"}
DSM_FALLBACK = {"Manager", "Senior Manager", "Deputy Manager", "Assistant General Manager"}
NSM_SET = {"Head of Sales", "General Manager", "National Sales Manager",
           "Chief Operating Officer", "Head of Channel Development & Operation", "Chief Business Officer"}

def main():
    B = 8
    officers = {}
    for b in range(B):
        h, r = call("ExecuteRtmQueryAsync", {"sqlQuery": SQL_SO.format(bu=BU, start=START, buckets=B, bucket=b), "limit": 200})
        for x in dicts(h, r):
            aid = int(num(x["intActionBy"]))
            officers[aid] = {
                "terr": (x["terr"] or "").strip(),
                "zone": (x["zone"] or "").strip(),
                "point": (x["point"] or "").strip(),
                "lastDate": (x["lastDate"] or "")[:10],
                "lastVis": 0,
                "days": int(num(x["days"])), "tgt": int(num(x["tgt"])),
                "vis": int(num(x["vis"])), "calls": int(num(x["calls"])),
                "amt": round(num(x["amt"])), "lines": 0}
    print("SO count:", len(officers))

    for b in range(B):
        h, r = call("ExecuteRtmQueryAsync", {"sqlQuery": SQL_LAST_VIS.format(bu=BU, start=START, buckets=B, bucket=b), "limit": 200})
        for x in dicts(h, r):
            aid = int(num(x["intActionBy"]))
            if aid in officers:
                officers[aid]["lastVis"] = int(num(x["lastVis"]))
        print("lastVis bucket", b)

    for b in range(B):
        h, r = call("ExecuteRtmQueryAsync", {"sqlQuery": SQL_LINES.format(bu=BU, start=START, buckets=B, bucket=b), "limit": 200})
        for x in dicts(h, r):
            aid = int(num(x["intActionBy"]))
            if aid in officers:
                officers[aid]["lines"] = int(num(x["lines"]))
        print("lines bucket", b)

    # ---- resolve PeopleDesk: only the officer IDs we have ----
    aids = sorted(officers.keys())
    emps = {}   # id -> {nm, desig, lm, sup, active, bu}
    for i in range(0, len(aids), 100):
        chunk = aids[i:i+100]
        inlist = ",".join(str(a) for a in chunk)
        q = ("SELECT e.intEmployeeBasicInfoId id, e.strEmployeeName nm, d.strDesignation desig, "
             "e.intLineManagerId lm, e.intSupervisorId sup, e.isActive act, e.intBusinessUnitId bu "
             "FROM saas.empEmployeeBasicInfo e WITH (NOLOCK) "
             "LEFT JOIN saas.masterDesignation d WITH (NOLOCK) ON d.intDesignationId=e.intDesignationId "
             "WHERE e.intEmployeeBasicInfoId IN (" + inlist + ")")
        h, r = call("ExecutePeopleDeskQueryAsync", {"query": q, "maxRows": 200})
        for x in dicts(h, r):
            emps[int(num(x["id"]))] = {
                "nm": (x["nm"] or "").strip(), "desig": (x["desig"] or "").strip(),
                "lm": int(num(x["lm"])) if x["lm"] else None,
                "sup": int(num(x["sup"])) if x["sup"] else None,
                "act": str(x["act"]).strip().lower() == "true",
                "bu": int(num(x["bu"]))}
        print("people chunk", i, len(chunk), "matched", len(dicts(h, r)))

    # ---- manager chain (pull all managers too) ----
    allids = set(emps.keys())
    for e in list(emps.values()):
        if e.get("lm"):
            allids.add(e["lm"])
        if e.get("sup"):
            allids.add(e["sup"])
    def pull_mgr(ids):
        out = {}
        ids = sorted(ids)
        for i in range(0, len(ids), 100):
            chunk = ids[i:i+100]
            inlist = ",".join(str(a) for a in chunk)
            q = ("SELECT e.intEmployeeBasicInfoId id, e.strEmployeeName nm, d.strDesignation desig, "
                 "e.intLineManagerId lm FROM saas.empEmployeeBasicInfo e WITH (NOLOCK) "
                 "LEFT JOIN saas.masterDesignation d WITH (NOLOCK) ON d.intDesignationId=e.intDesignationId "
                 "WHERE e.intEmployeeBasicInfoId IN (" + inlist + ")")
            h, r = call("ExecutePeopleDeskQueryAsync", {"query": q, "maxRows": 200})
            for x in dicts(h, r):
                out[int(num(x["id"]))] = {"nm": (x["nm"] or "").strip(),
                                          "desig": (x["desig"] or "").strip(),
                                          "lm": int(num(x["lm"])) if x["lm"] else None}
        return out
    mgrs = pull_mgr(allids - set(emps.keys()))
    # expand chain up to 3 more levels
    for _ in range(3):
        more = set()
        for m in mgrs.values():
            if m.get("lm") and m["lm"] not in mgrs and m["lm"] not in emps:
                more.add(m["lm"])
        if not more:
            break
        mgrs.update(pull_mgr(more))
    print("managers resolved:", len(mgrs))

    def chain(eid):
        out = []; seen = set(); cur = eid
        while cur and cur not in seen and len(out) < 8:
            seen.add(cur)
            if cur in emps:
                e = emps[cur]
            elif cur in mgrs:
                e = mgrs[cur]
            else:
                break
            out.append(e)
            cur = e.get("lm")
        return out

    def resolve(aid):
        if aid not in emps:
            return None
        self_ = emps[aid]
        if not self_.get("act") or self_["bu"] != BU:
            return None
        if self_["desig"] not in SR_SET:
            return None
        ch = chain(aid)
        mgrlist = ch[1:]
        zm = next((m["nm"] for m in mgrlist if m["desig"] in ZM_SET), "")
        dsm = next((m["nm"] for m in mgrlist if m["desig"] in DSM_SET), "")
        if not dsm:
            dsm = next((m["nm"] for m in mgrlist if m["desig"] in DSM_FALLBACK), "")
        nsm = next((m["nm"] for m in mgrlist if m["desig"] in NSM_SET), "")
        return {"name": self_["nm"], "desig": self_["desig"], "zm": zm, "dsm": dsm, "nsm": nsm}

    so_list = []
    for aid, o in officers.items():
        r = resolve(aid)
        if not r:
            continue
        o["officer"] = r["name"]
        o["desig"] = r["desig"]
        o["zm"] = r["zm"]
        o["dsm"] = r["dsm"]
        o["nsm"] = r["nsm"]
        so_list.append(o)

    so_list.sort(key=lambda o: -o["amt"])
    out = {"officers": so_list, "lastSync": time.strftime("%Y-%m-%d")}
    with open("so_prod.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print("wrote so_prod.json:", len(so_list), "active SRs")

if __name__ == "__main__":
    main()
