/* ============================================================
   AEL Control Tower — utils.js
   Data access, calculations, health engine, reference data.
   ============================================================ */

/* ---------- Configuration (all thresholds tunable) ---------- */
const CFG = {
  health: {
    weights: { achievement: 0.40, trend: 0.15, persistence: 0.15, recovery: 0.10, volatility: 0.10, coverage: 0.10 },
    bands: { healthy: 78, watch: 62, risk: 46 } // >=healthy, >=watch, >=risk, else critical
  },
  achievement: { weak: 90, critical: 70 },          // % thresholds for signals
  persistence: { months: 3 },
  trend: { declinePP: 10, improvePP: 8 },           // percentage-point thresholds
  volatility: { cv: 0.18 },
  severity: { impactLakh: { critical: 500, warning: 150, watch: 40 } }
};

/* ---------- Formatting ---------- */
const FMT = {
  money(v) {
    if (v == null || isNaN(v)) return '—';
    const a = Math.abs(v);
    if (a >= 10000000) return (v / 10000000).toFixed(2) + ' Cr';
    if (a >= 100000) return (v / 100000).toFixed(1) + ' L';
    if (a >= 1000) return (v / 1000).toFixed(1) + ' K';
    return String(Math.round(v));
  },
  moneyFull(v) { return v == null ? '—' : 'BDT ' + Math.round(v).toLocaleString('en-IN'); },
  num(v) { return v == null ? '—' : Math.round(v).toLocaleString('en-IN'); },
  pct(v, d = 1) { return (v == null || isNaN(v)) ? '—' : (v).toFixed(d) + '%'; },
  pp(v, d = 1) { return (v == null || isNaN(v)) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + ' pp'; },
  delta(v, d = 1) { return (v == null || isNaN(v)) ? '—' : (v >= 0 ? '↑ ' : '↓ ') + Math.abs(v).toFixed(d) + '%'; }
};

/* ---------- Data access ---------- */
const Store = (function () {
  const months = AEL_DATA.months;
  // normalize rows
  const rows = AEL_DATA.rows.map(r => ({
    sr: r[0], zone: r[1], point: r[2], zm: r[3],
    dsm: (r[4] && r[4].trim()) ? r[4] : 'Unassigned',
    mi: r[5], target: r[6], actual: r[7]
  }));

  const zoneList = Array.from(new Set(rows.map(r => r.zone))).sort();
  const pointList = Array.from(new Set(rows.map(r => r.point))).sort();
  const srList = Array.from(new Set(rows.map(r => r.sr))).sort();
  const dsmList = Array.from(new Set(rows.map(r => r.dsm))).sort();

  // zone -> point -> sr hierarchy
  const zonePoints = {};
  zoneList.forEach(z => { zonePoints[z] = Array.from(new Set(rows.filter(r => r.zone === z).map(r => r.point))).sort(); });
  const pointSrs = {};
  pointList.forEach(p => { pointSrs[p] = Array.from(new Set(rows.filter(r => r.point === p).map(r => r.sr))).sort(); });
  const zoneSrs = {};
  zoneList.forEach(z => { zoneSrs[z] = Array.from(new Set(rows.filter(r => r.zone === z).map(r => r.sr))).sort(); });
  const srZone = {}; rows.forEach(r => { srZone[r.sr] = r.zone; srZone[r.sr + '|' + r.point] = r.zone; });
  const srPoint = {}; rows.forEach(r => { srPoint[r.sr] = r.point; });
  const zoneDsm = {}; rows.forEach(r => { zoneDsm[r.zone] = r.dsm; });

  const filterRows = (f = {}) => rows.filter(r =>
    (f.dsm == null || f.dsm === 'all' || r.dsm === f.dsm) &&
    (f.zone == null || f.zone === 'all' || r.zone === f.zone) &&
    (f.sr == null || f.sr === 'all' || r.sr === f.sr) &&
    (f.month == null || f.month === 'all' || r.mi === f.month)
  );

  // monthly series for a set of rows: [ {t,a} x 12 ]
  const monthly = (rs) => {
    const out = Array.from({ length: 12 }, () => ({ t: 0, a: 0 }));
    rs.forEach(r => { out[r.mi].t += r.target; out[r.mi].a += r.actual; });
    return out;
  };

  // aggregate rows by keyFn -> { name, target, actual, series }
  const aggBy = (rs, keyFn) => {
    const m = new Map();
    rs.forEach(r => {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, { name: k, target: 0, actual: 0, series: monthly([]) });
      const e = m.get(k);
      e.target += r.target; e.actual += r.actual;
      e.series[r.mi].t += r.target; e.series[r.mi].a += r.actual;
    });
    return Array.from(m.values());
  };

  return {
    months, rows, zoneList, pointList, srList, dsmList,
    zonePoints, pointSrs, zoneSrs, srZone, srPoint, zoneDsm,
    filterRows, monthly, aggBy
  };
})();

/* ---------- Core calculations ---------- */
const Calc = {
  achievement(target, actual) { return target > 0 ? (actual / target) * 100 : null; },
  gap(target, actual) { return target - actual; },
  gapPct(target, actual) { return target > 0 ? ((target - actual) / target) * 100 : null; },
  mom(series, mi) {
    if (mi <= 0) return null;
    const cur = series[mi].a, prev = series[mi - 1].a;
    if (!prev) return null;
    return ((cur - prev) / prev) * 100;
  },
  // average achievement over recent `n` available months ending at `upto`
  avgAch(series, upto, n) {
    let t = 0, a = 0, c = 0;
    for (let i = upto; i >= 0 && c < n; i--) {
      if (series[i].t > 0) { t += series[i].t; a += series[i].a; c++; }
    }
    return t > 0 ? (a / t) * 100 : null;
  },
  // persistence: consecutive months (from upto backwards) with target>0 & ach < threshold
  persistence(series, upto, threshold) {
    let count = 0;
    for (let i = upto; i >= 0; i--) {
      if (series[i].t > 0 && (series[i].a / series[i].t) * 100 < threshold) count++;
      else if (series[i].t > 0) break;
    }
    return count;
  },
  volatility(series, upto) {
    const vals = [];
    for (let i = 0; i <= upto; i++) if (series[i].t > 0) vals.push((series[i].a / series[i].t) * 100);
    if (vals.length < 2) return 0;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length);
    return mean > 0 ? sd / mean : 0; // coefficient of variation
  },
  // latest month index that actually has any target/actual data
  lastDataMonth(series) {
    for (let i = series.length - 1; i >= 0; i--) if (series[i].t > 0) return i;
    return -1;
  },
  // recovery: current 2-month avg ach vs prior 2-month avg ach (improvement after a dip)
  recovery(series, upto) {
    if (upto < 3) return null;
    const recent = this.avgAch(series, upto, 2);
    const prior = this.avgAch(series, upto - 2, 2);
    if (recent == null || prior == null) return null;
    return recent - prior;
  }
};

/* ---------- Zone Health Engine (configurable) ---------- */
const Health = (function () {
  function subScores(e, upto) {
    const s = e.series, w = CFG.health.weights;
    const ach = Calc.avgAch(s, upto, 12);            // YTD achievement
    const last = Calc.avgAch(s, upto, 3);
    const prior = Calc.avgAch(s, upto - 3, 3);
    const trend = (last != null && prior != null) ? last - prior : 0;
    const pers = Calc.persistence(s, upto, CFG.achievement.weak);
    const vol = Calc.volatility(s, upto);
    const rec = Calc.recovery(s, upto);

    return {
      achievement: ach == null ? null : clamp(ach, 0, 120),
      trendPP: trend,
      persistenceMonths: pers,
      volatilityCV: vol,
      recoveryPP: rec,
      hasTarget: e.target > 0
    };
  }

  // normalize each sub-metric to 0..100 (100 = good)
  function score(e, upto) {
    const ss = subScores(e, upto);
    if (!ss.hasTarget) return { band: 'nodata', score: null, subscores: ss };
    const w = CFG.health.weights;
    let total = 0, wsum = 0;

    const add = (val, weight) => { if (val != null && !isNaN(val)) { total += clamp(val, 0, 100) * weight; wsum += weight; } };

    add(ss.achievement, w.achievement);                                   // 0..120 -> clamp 0..100
    add(50 + clamp(ss.trendPP, -25, 25) * 2, w.trend);                    // flat=50
    add(100 - Math.min(ss.persistenceMonths, 6) * 20, w.persistence);     // 0 pers = 100
    add(ss.recoveryPP == null ? null : 50 + clamp(ss.recoveryPP, -20, 20) * 2.5, w.recovery);
    add(100 - Math.min(ss.volatilityCV / CFG.volatility.cv * 50, 100), w.volatility);
    add(ss.achievement != null ? 100 : 0, w.coverage);                    // coverage proxy

    const sc = wsum > 0 ? total / wsum : 0;
    const b = CFG.health.bands;
    const band = sc >= b.healthy ? 'healthy' : sc >= b.watch ? 'watch' : sc >= b.risk ? 'risk' : 'critical';
    return { band, score: Math.round(sc), subscores: ss };
  }

  return {
    label(band) {
      return { healthy: 'Healthy', watch: 'Watch', risk: 'At Risk', critical: 'Critical', nodata: 'Insufficient Data' }[band] || '—';
    },
    forEntity(e, upto) { return score(e, upto); }
  };
})();

/* ---------- Seeded reference data (deterministic) ---------- */
const REF = (function () {
  function rng(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

  const zones = Store.zoneList;
  const competitors = ['Square', 'ACI', 'Bashundhara', 'Pran', 'ACI Pure'];
  const rC = rng(11);

  // distributors per zone (2-4)
  const distributors = [];
  zones.forEach((z, zi) => {
    const n = 2 + Math.floor(rC() * 3);
    for (let i = 0; i < n; i++) {
      distributors.push({
        id: 'D-' + String(zi + 1).padStart(3, '0') + '-' + (i + 1),
        zone: z,
        name: z.replace(' Zone', '') + ' Distributor ' + (i + 1),
        dependency: +(0.2 + rC() * 0.6).toFixed(2),
        stockDays: Math.round(7 + rC() * 40),
        status: rC() > 0.75 ? 'Stock Issue' : rC() > 0.5 ? 'Watch' : 'Healthy'
      });
    }
  });

  // customers per zone (sampled)
  const customers = [];
  zones.forEach((z, zi) => {
    const n = 8 + Math.floor(rC() * 20);
    for (let i = 0; i < n; i++) {
      customers.push({
        id: 'C-' + String(zi + 1).padStart(3, '0') + '-' + String(i + 1).padStart(2, '0'),
        zone: z,
        name: z.replace(' Zone', '') + ' Customer ' + (i + 1),
        monthlyValue: Math.round(20000 + rC() * 400000),
        active: rC() > 0.12
      });
    }
  });

  // competitor pressure per zone (price gap, availability, distribution)
  const compZone = {};
  zones.forEach((z, zi) => {
    const rg = rng(zi * 7 + 3);
    compZone[z] = {
      priceGap: +( (rg() * 14) - 6 ).toFixed(1),           // AEL premium (+) / discount (-) %
      availability: +(rg()).toFixed(2),                   // competitor availability 0..1
      distribution: +(rg()).toFixed(2),                   // competitor distribution 0..1
      promo: rg() > 0.5
    };
  });

  // market indicators
  const market = {
    demandIndex: Array.from({ length: 9 }, (_, i) => Math.round(106 - i * 1.4 + Math.sin(i * 1.1) * 7 + rC() * 4)),
    marketPrice: Array.from({ length: 9 }, (_, i) => Math.round(100 + i * 1.3 + rC() * 5)),
    supply: Array.from({ length: 9 }, (_, i) => rC() > 0.72 ? 'Tight' : 'Normal'),
    seasonality: { Q1: 'Low', Q2: 'Peak', Q3: 'Monsoon dip', Q4: 'Peak' }
  };

  return { competitors, distributors, customers, compZone, market };
})();

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function fmtHealthClass(band) { return 'h-' + band; }
