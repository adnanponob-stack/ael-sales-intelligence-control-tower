/* ============================================================
   AEL Control Tower — signals.js
   Sales signal engine + CI research program + actions + monitoring
   ============================================================ */

/* last complete month index (Jan=0..Sep=8; September treated as MTD) */
const COMPLETE_UPTO = 7;
const MTD_MONTH = 8;

const Signals = (function () {
  let cache = null;
  let seq = 0;

  function severityByImpact(lakh, persistence, sharp) {
    if (lakh >= CFG.severity.impactLakh.critical) return 'critical';
    if (sharp) return 'critical';
    if (lakh >= CFG.severity.impactLakh.warning) return persistence >= 3 ? 'critical' : 'warning';
    if (lakh >= CFG.severity.impactLakh.watch) return 'warning';
    return persistence >= 3 ? 'watch' : 'info';
  }
  const sevLabel = { info: 'INFO', watch: 'WATCH', warning: 'WARNING', critical: 'CRITICAL' };
  const catLabel = { performance: 'Performance', manpower: 'Manpower', customer: 'Customer', competitor: 'Competitor', market: 'Market' };

  function mk(o) {
    seq++;
    return Object.assign({
      id: 'SIG-' + String(seq).padStart(4, '0'),
      category: 'performance',
      severity: 'watch',
      location: 'National',
      locationType: 'zone',
      detected: 'Sep 2026',
      status: 'INTELLIGENCE REQUIRED',
      confidence: 'Low',
      evidenceCount: 0
    }, o, { severityLabel: sevLabel[o.severity] || sevLabel[o.severity] || '—', categoryLabel: catLabel[o.category] });
  }

  function build() {
    seq = 0;
    const out = [];
    const upto = COMPLETE_UPTO;
    const zones = Store.zoneList;
    const totalAch = Calc.achievement(Store.rows.reduce((s, r) => s + (r.mi <= upto ? r.target : 0), 0),
      Store.rows.reduce((s, r) => s + (r.mi <= upto ? r.actual : 0), 0));

    // ---- 1. Zone performance signals ----
    const zoneRows = Store.aggBy(Store.rows, r => r.zone);
    zoneRows.forEach(e => {
      const s = e.series;
      const ach = Calc.avgAch(s, upto, 9);
      const recent = Calc.avgAch(s, upto, 3);
      const prior = Calc.avgAch(s, upto - 3, 3);
      const trend = (recent != null && prior != null) ? recent - prior : 0;
      const pers = Calc.persistence(s, upto, CFG.achievement.weak);
      const vol = Calc.volatility(s, upto);
      const gapYTD = e.target - e.actual;
      const gapLakh = gapYTD / 100000;

      if (pers >= CFG.persistence.months && ach != null && ach < CFG.achievement.weak) {
        out.push(mk({
          type: 'Persistent Underachievement', category: 'performance', location: e.name, locationType: 'zone',
          metric: 'Achievement', current: ach.toFixed(1) + '%', previous: recent ? recent.toFixed(1) + '%' : '—',
          deviation: ach - totalAch, persistence: pers + ' months',
          estimatedImpact: 'BDT ' + FMT.money(gapYTD), gapLakh, severity: severityByImpact(gapLakh, pers, false),
          status: 'INTELLIGENCE REQUIRED', confidence: 'Medium'
        }));
      }
      if (trend <= -CFG.trend.declinePP && recent != null) {
        out.push(mk({
          type: 'Sudden Sales Decline', category: 'performance', location: e.name, locationType: 'zone',
          metric: '3M Trend', current: recent.toFixed(1) + '%', previous: (prior || 0).toFixed(1) + '%',
          deviation: trend, persistence: pers + ' months',
          estimatedImpact: 'BDT ' + FMT.money(gapYTD), gapLakh, severity: severityByImpact(gapLakh, pers, true),
          status: 'INTELLIGENCE REQUIRED', confidence: 'Medium'
        }));
      }
      if (trend >= CFG.trend.improvePP && recent != null) {
        out.push(mk({
          type: 'Recovery Detected', category: 'performance', location: e.name, locationType: 'zone',
          metric: '3M Trend', current: recent.toFixed(1) + '%', previous: (prior || 0).toFixed(1) + '%',
          deviation: trend, persistence: '—', estimatedImpact: 'Opportunity',
          gapLakh: 0, severity: 'info', status: 'MONITOR', confidence: 'High'
        }));
      }
      if (vol > CFG.volatility.cv && s.filter(x => x.t > 0).length >= 4) {
        out.push(mk({
          type: 'High Volatility', category: 'performance', location: e.name, locationType: 'zone',
          metric: 'Volatility (CV)', current: (vol * 100).toFixed(0) + '%', previous: '—',
          deviation: vol, persistence: '—', estimatedImpact: 'Stability risk',
          gapLakh: 0, severity: 'watch', status: 'MONITOR', confidence: 'High'
        }));
      }
    });

    // ---- 2. Manpower signals ----
    const srRows = Store.aggBy(Store.rows.filter(r => r.mi <= upto), r => r.sr);
    const totalSrs = srRows.length;
    srRows.forEach(e => {
      const ach = e.target > 0 ? (e.actual / e.target) * 100 : null;
      const gapLakh = Math.max(e.target - e.actual, 0) / 100000;
      if (e.target > 0 && e.actual === 0) {
        out.push(mk({
          type: 'Zero Achievement (SR)', category: 'manpower', location: e.name, locationType: 'employee',
          metric: 'YTD Achievement', current: '0%', previous: '—', deviation: -100, persistence: 'YTD',
          estimatedImpact: 'BDT ' + FMT.money(e.target), gapLakh, severity: severityByImpact(gapLakh, 4, false),
          status: 'INTELLIGENCE REQUIRED', confidence: 'High'
        }));
      } else if (ach != null && ach < 50 && e.target > 500000) {
        out.push(mk({
          type: 'Low Employee Productivity', category: 'manpower', location: e.name, locationType: 'employee',
          metric: 'YTD Achievement', current: ach.toFixed(1) + '%', previous: '—', deviation: ach - totalAch,
          persistence: 'YTD', estimatedImpact: 'BDT ' + FMT.money(e.target - e.actual), gapLakh,
          severity: severityByImpact(gapLakh, 2, false), status: 'INTELLIGENCE REQUIRED', confidence: 'High'
        }));
      }
    });
    // concentration: top SR share of a zone
    const zoneSrAgg = {};
    Store.rows.filter(r => r.mi <= upto).forEach(r => { zoneSrAgg[r.zone] = zoneSrAgg[r.zone] || {}; zoneSrAgg[r.zone][r.sr] = (zoneSrAgg[r.zone][r.sr] || 0) + r.actual; });
    zones.forEach(z => {
      const m = zoneSrAgg[z] || {}; const total = Object.values(m).reduce((a, b) => a + b, 0);
      if (!total) return;
      const top = Math.max.apply(null, Object.values(m));
      const share = top / total;
      if (share > 0.5) {
        const name = Object.keys(m).find(k => m[k] === top);
        out.push(mk({
          type: 'Productivity Concentration', category: 'manpower', location: z, locationType: 'zone',
          metric: 'Top SR share', current: (share * 100).toFixed(0) + '%', previous: '—',
          deviation: share, persistence: '—', estimatedImpact: 'Succession risk',
          gapLakh: 0, severity: 'watch', status: 'MONITOR', confidence: 'High'
        }));
      }
    });

    // ---- 3. Customer signals ----
    REF.distributors.forEach(d => {
      if (d.dependency > 0.72) {
        out.push(mk({
          type: 'Distributor Dependency', category: 'customer', location: d.zone, locationType: 'zone',
          metric: 'Dependency', current: (d.dependency * 100).toFixed(0) + '%', previous: '—',
          deviation: d.dependency, persistence: '—', estimatedImpact: 'Concentration risk',
          gapLakh: 0, severity: d.dependency > 0.85 ? 'warning' : 'watch', status: 'INTELLIGENCE REQUIRED', confidence: 'Medium'
        }));
      }
      if (d.status === 'Stock Issue') {
        out.push(mk({
          type: 'Distributor Stock Issue', category: 'customer', location: d.zone, locationType: 'zone',
          metric: 'Stock days', current: d.stockDays + ' days', previous: '—', deviation: d.stockDays,
          persistence: '—', estimatedImpact: 'Fulfilment risk', gapLakh: 0, severity: 'warning',
          status: 'INTELLIGENCE REQUIRED', confidence: 'Medium'
        }));
      }
    });
    zones.forEach(z => {
      const cs = REF.customers.filter(c => c.zone === z);
      if (cs.length) {
        const inactive = cs.filter(c => !c.active).length / cs.length;
        if (inactive > 0.4) {
          out.push(mk({
            type: 'Customer Activity Decline', category: 'customer', location: z, locationType: 'zone',
            metric: 'Inactive customers', current: (inactive * 100).toFixed(0) + '%', previous: '—',
            deviation: inactive, persistence: '—', estimatedImpact: 'Volume risk', gapLakh: 0,
            severity: 'watch', status: 'INTELLIGENCE REQUIRED', confidence: 'Medium'
          }));
        }
      }
    });

    // ---- 4. Competitor signals ----
    zones.forEach(z => {
      const c = REF.compZone[z]; if (!c) return;
      if (c.priceGap < -3) {
        out.push(mk({
          type: 'Competitor Price Advantage', category: 'competitor', location: z, locationType: 'zone',
          metric: 'AEL price gap', current: c.priceGap.toFixed(1) + '%', previous: '—', deviation: c.priceGap,
          persistence: '—', estimatedImpact: 'Margin / volume risk', gapLakh: 0,
          severity: c.priceGap < -6 ? 'warning' : 'watch', status: 'INTELLIGENCE REQUIRED', confidence: 'Medium'
        }));
      }
      if (c.availability > 0.82 && c.distribution > 0.8) {
        out.push(mk({
          type: 'Competitor Distribution Expansion', category: 'competitor', location: z, locationType: 'zone',
          metric: 'Availability', current: (c.availability * 100).toFixed(0) + '%', previous: '—', deviation: c.availability,
          persistence: '—', estimatedImpact: 'Share risk', gapLakh: 0, severity: 'watch',
          status: 'INTELLIGENCE REQUIRED', confidence: 'Medium'
        }));
      }
    });

    // ---- 5. Market signals ----
    const dm = REF.market.demandIndex;
    if (dm.length >= 3 && dm[dm.length - 1] < dm[dm.length - 3]) {
      out.push(mk({
        type: 'Market Demand Decline', category: 'market', location: 'National', locationType: 'national',
        metric: 'Demand index', current: String(dm[dm.length - 1]), previous: String(dm[dm.length - 3]),
        deviation: dm[dm.length - 1] - dm[dm.length - 3], persistence: '2 periods', estimatedImpact: 'Demand-side',
        gapLakh: 0, severity: 'watch', status: 'INTELLIGENCE REQUIRED', confidence: 'Low'
      }));
    }
    REF.market.supply.forEach((sp, i) => {
      if (sp === 'Tight' && i === REF.market.supply.length - 1) {
        out.push(mk({
          type: 'Supply Disruption', category: 'market', location: 'National', locationType: 'national',
          metric: 'Supply', current: 'Tight', previous: '—', deviation: null, persistence: '—',
          estimatedImpact: 'Availability risk', gapLakh: 0, severity: 'warning', status: 'INTELLIGENCE REQUIRED', confidence: 'Low'
        }));
      }
    });

    return out.sort((a, b) => (sevRank(b.severity) - sevRank(a.severity)) || ((b.gapLakh || 0) - (a.gapLakh || 0)));
  }

  function sevRank(s) { return { critical: 4, warning: 3, watch: 2, info: 1 }[s] || 0; }

  return {
    all(force) { if (!cache || force) cache = build(); return cache; },
    byZone(zone) { return this.all().filter(s => s.location === zone || (s.locationType === 'zone' && s.location === zone)); },
    byType(type) { return this.all().filter(s => s.type === type); },
    critical() { return this.all().filter(s => s.severity === 'critical'); },
    counts() {
      const all = this.all();
      return {
        active: all.filter(s => s.status !== 'MONITOR' && s.status !== 'CLOSED').length,
        critical: all.filter(s => s.severity === 'critical').length,
        warning: all.filter(s => s.severity === 'warning').length,
        watch: all.filter(s => s.severity === 'watch').length,
        recovery: all.filter(s => s.type === 'Recovery Detected').length,
        byCategory: { performance: all.filter(s => s.category === 'performance').length, manpower: all.filter(s => s.category === 'manpower').length, customer: all.filter(s => s.category === 'customer').length, competitor: all.filter(s => s.category === 'competitor').length, market: all.filter(s => s.category === 'market').length }
      };
    }
  };
})();

/* ---------- CI Research Program + Actions + Monitoring ---------- */
const Program = (function () {
  const researchOwners = ['R&I Team', 'CI Analyst', 'Field Research', 'Distributor Audit'];
  const actionOwners = ['ZSM', 'DSM', 'Trade Marketing', 'Supply Chain', 'Sales Head'];

  function buildResearch() {
    const sigs = Signals.all().filter(s => s.severity === 'critical' || s.severity === 'warning').slice(0, 14);
    return sigs.map((s, i) => ({
      id: 'RS-' + String(i + 1).padStart(3, '0'),
      signalId: s.id,
      location: s.location,
      question: 'What is driving the ' + s.type.toLowerCase() + ' in ' + s.location + '?',
      hypotheses: ['Customer loss / churn', 'Distributor stock or credit issue', 'Competitor price pressure', 'Manpower coverage or productivity', 'Product availability / portfolio'],
      evidence: ['Sales trend (internal)', 'Distributor interview', 'Retailer interview', 'Competitor price audit', 'Stock verification', 'SR coverage audit'],
      method: i % 3 === 0 ? 'Field research' : i % 3 === 1 ? 'Data triangulation' : 'Distributor interview',
      owner: researchOwners[i % researchOwners.length],
      deadline: 'Sep 2026',
      status: i < 4 ? 'FIELD RESEARCH' : i < 9 ? 'QUEUED' : 'EVIDENCE GATHERING',
      confidence: 'Unvalidated'
    }));
  }

  function buildActions() {
    const sigs = Signals.all().filter(s => s.severity === 'critical' || s.severity === 'warning').slice(0, 8);
    const actions = sigs.map((s, i) => ({
      id: 'ACT-' + String(i + 1).padStart(3, '0'),
      issue: s.type + ' — ' + s.location,
      action: ['Distributor restructuring & credit review', 'Deploy additional SR coverage', 'Competitive pricing & promo response', 'Retail activation drive', 'Stock re-allocation & replenishment', 'Channel partner performance review'][i % 6],
      owner: actionOwners[i % actionOwners.length],
      deadline: ['Sep 2026', 'Sep 2026', 'Oct 2026', 'Sep 2026', 'Sep 2026', 'Oct 2026'][i % 6],
      expectedImpact: 'BDT ' + FMT.money(s.gapLakh * 100000 * 0.4),
      status: i < 2 ? 'Overdue' : i < 4 ? 'In Progress' : i < 6 ? 'Open' : 'Monitoring'
    }));
    return actions;
  }

  function buildMonitoring() {
    const zones = ['Mirpur Zone', 'Sylhet Zone', 'Naogaon Zone', 'Gulshan Zone', 'Dinajpur Zone', 'Mymensingh Zone'];
    const before = [61, 58, 54, 63, 57, 60];
    const after = [74, 63, 57, 66, 71, 62];
    return zones.map((z, i) => ({
      zone: z, before: before[i], after: after[i],
      action: ['Distributor restructuring', 'SR redeployment', 'Price response', 'Retail activation', 'Stock reallocation', 'Coverage expansion'][i],
      outcome: (after[i] - before[i]) >= 8 ? 'Observed Improvement' : (after[i] - before[i]) >= 3 ? 'Under Monitoring' : 'No Significant Change'
    }));
  }

  let research = buildResearch();
  let actions = buildActions();
  let monitoring = buildMonitoring();

  return {
    research,
    actions,
    monitoring,
    overdueActions() { return actions.filter(a => a.status === 'Overdue'); },
    counts() {
      return {
        researchOpen: research.filter(r => r.status !== 'COMPLETED').length,
        actionsOverdue: actions.filter(a => a.status === 'Overdue').length,
        actionsOpen: actions.filter(a => a.status === 'Open' || a.status === 'In Progress' || a.status === 'Overdue').length
      };
    }
  };
})();
