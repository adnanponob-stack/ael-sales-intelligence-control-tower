#!/usr/bin/env python3
"""Build daily_prod.json for the Daily Performance Report."""
import json, time, urllib.request, sys, datetime

MCP_URL = "https://arl-mcp.ibos.io/mcp"
BU = 144

def key():
    return open('rtm_key.txt', encoding='utf-8').read().strip()

def call(tool, args):
    p = {"jsonrpc":"2.0","id":int(time.time()*1000)%100000,"method":"tools/call",
         "params":{"name":tool,"arguments":args}}
    req = urllib.request.Request(MCP_URL, data=json.dumps(p).encode(),
        headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream",
                 "X-API-Key":key(),"User-Agent":"AEL/1.0"}, method="POST")
    d = json.loads(urllib.request.urlopen(req, timeout=240).read().decode())
    c = d.get("result",{}).get("content",[])
    return c[0].get("text","") if c else ""

def parse(txt):
    hdr, rows = [], []
    for ln in txt.split("\n"):
        ln = ln.strip()
        if not ln.startswith("|"): continue
        cells = [x.strip() for x in ln.strip("|").split("|")]
        if all(set(x) <= set("-: ") for x in cells): continue
        if not hdr: hdr = cells
        else: rows.append(cells)
    return hdr, rows

def dicts(h, r):
    return [{h[i]:(r[i] if i<len(r) else None) for i in range(len(h))} for r in r]

def num(v):
    if v is None: return 0.0
    try: return float(str(v).replace(",","").strip())
    except: return 0.0

def w(s): sys.stdout.buffer.write((s+"\n").encode("utf-8","replace"))

SR_SET = "('Sales Representative','Market Developer','Territory Officer','Territory Sales Officer','Territory Sales Manager')"
ZSM_SET = "('Zonal Sales Manager')"

# latest full day from RTM
txt = call("ExecuteRtmQueryAsync", {"sqlQuery":"SELECT MAX(dteDeliveryDate) md FROM rtm.tblOutletDeliveryHeader WITH (NOLOCK) WHERE intBusinessUnitId=144 AND dteDeliveryDate<='2026-09-20'","limit":20})
t = parse(txt); md = t[1][0][0] if len(t)>1 and t[1] else "2026-09-20"
dstr = md[:10]
w("report date: " + dstr)

# --- attendance (PeopleDesk) for latest day ---
att_sr = {}
txt = call("ExecutePeopleDeskQueryAsync", {"query": "SELECT dg.strDesignation desig, SUM(CASE WHEN a.isPresent=1 THEN 1 ELSE 0 END) present, SUM(CASE WHEN a.isLate=1 THEN 1 ELSE 0 END) late, SUM(CASE WHEN a.isLeave=1 THEN 1 ELSE 0 END) leave, SUM(CASE WHEN a.isAbsent=1 THEN 1 ELSE 0 END) absent, COUNT(*) total FROM saas.timeAttendanceDailySummary a JOIN saas.empEmployeeBasicInfo e ON e.intEmployeeBasicInfoId=a.intEmployeeId JOIN saas.masterDesignation dg ON dg.intDesignationId=e.intDesignationId WHERE e.intBusinessUnitId=144 AND a.dteAttendanceDate='"+dstr+"' GROUP BY dg.strDesignation","maxRows":200})
hdr, rows = parse(txt)
rows = dicts(hdr, rows)
att = {}
for x in rows:
    att[x["desig"]] = {"present":int(num(x["present"])),"late":int(num(x["late"])),
                       "leave":int(num(x["leave"])),"absent":int(num(x["absent"])),"total":int(num(x["total"]))}
def att_sum(designations):
    s = {"present":0,"late":0,"leave":0,"absent":0,"total":0}
    for d in designations:
        a = att.get(d)
        if a:
            for k in s: s[k]+=a[k]
    return s
sr = att_sum(["Sales Representative","Market Developer","Territory Officer","Territory Sales Officer","Territory Sales Manager"])
zsm = att_sum(["Zonal Sales Manager"])
w("SR att: "+json.dumps(sr))
w("ZSM att: "+json.dumps(zsm))

# --- daily secondary sales + calls (RTM) ---
txt = call("ExecuteRtmQueryAsync", {"sqlQuery": "SELECT CONVERT(date,dteDeliveryDate) d, SUM(numTotalDeliveryAmount) amt, COUNT(*) calls, COUNT(DISTINCT intOutletId) outlets, SUM(CASE WHEN numTotalDeliveryAmount>0 THEN 1 ELSE 0 END) productive, COUNT(DISTINCT intActionBy) so FROM rtm.tblOutletDeliveryHeader WITH (NOLOCK) WHERE intBusinessUnitId=144 AND dteDeliveryDate>='2026-09-13' GROUP BY CONVERT(date,dteDeliveryDate) ORDER BY d","limit":200})
daily = []
for x in dicts(*parse(txt)):
    daily.append({"d":x["d"][:10], "amt":round(num(x["amt"])), "calls":int(num(x["calls"])),
                  "outlets":int(num(x["outlets"])), "productive":int(num(x["productive"])), "so":int(num(x["so"]))})

# --- MTD ---
txt = call("ExecuteRtmQueryAsync", {"sqlQuery":"SELECT SUM(numTotalDeliveryAmount) amt, COUNT(*) calls FROM rtm.tblOutletDeliveryHeader WITH (NOLOCK) WHERE intBusinessUnitId=144 AND dteDeliveryDate>='2026-09-01' AND dteDeliveryDate<'"+dstr[:8]+"21'","limit":20})
x = dicts(*parse(txt))[0]
mtd = {"amt": round(num(x["amt"])), "calls": int(num(x["calls"]))}
w("MTD IMS amt: "+str(mtd))

# --- coverage: DB points (L8), SO territories (L9) ---
txt = call("ExecuteRtmQueryAsync", {"sqlQuery":"SELECT COUNT(DISTINCT L8) pts, COUNT(DISTINCT L9) terr FROM rtm.tblTerritoryInfoSetup WITH (NOLOCK) WHERE L1=22600 AND isActive=1 AND intLevelId>=7","limit":20})
x = dicts(*parse(txt))[0]
cov = {"dbPoints": int(num(x["pts"])), "soTerritories": int(num(x["terr"]))}
w("coverage: "+json.dumps(cov))

out = {"date": dstr, "sr": sr, "zsm": zsm, "daily": daily, "mtd": mtd, "coverage": cov}
json.dump(out, open("daily_prod.json","w",encoding="utf-8"), ensure_ascii=False)
w("wrote daily_prod.json")
