/* ============================================================
   AEL Control Tower — app.js
   Router, filters, view renderers, drawers, search, notifications
   ============================================================ */
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const state = {
    view: 'overview',
    filters: { month: 'all', scope: 'ytd', dsm: 'all', zone: 'all', sr: 'all' },
    mapMetric: 'health',
    searchOpen: false
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ---------------- Context ---------------- */
  function getContext() {
    const f = state.filters;
    const upto = f.month !== 'all' ? Number(f.month) : MTD_MONTH;
    let rows;
    if (f.scope === 'mtd') {
      rows = Store.filterRows({ dsm: f.dsm, zone: f.zone, sr: f.sr, month: upto });
    } else {
      rows = Store.filterRows({ dsm: f.dsm, zone: f.zone, sr: f.sr }).filter(r => r.mi <= upto);
    }
    return { rows, upto, month: f.month, scope: f.scope };
  }

  function sum(rows, key) { return rows.reduce((s, r) => s + r[key], 0); }

  function zoneStats(rows, upto) {
    const agg = Store.aggBy(rows, r => r.zone);
    const sigs = {};
    Signals.all().filter(s => s.severity === 'critical').forEach(s => { sigs[s.location] = (sigs[s.location] || 0) + 1; });
    return agg.map(e => {
      const health = Health.forEntity(e, upto);
      const gap = e.target - e.actual;
      return Object.assign({}, e, { health, gap, gapLakh: Math.max(gap, 0) / 100000, ach: Calc.achievement(e.target, e.actual), sigCount: sigs[e.name] || 0 });
    });
  }

  /* ---------------- KPI helpers ---------------- */
  function kpiCard(label, value, sub, delta, deltaClass, accent) {
    return '<div class="kpi"><div class="kpi-accent"></div>' +
      '<div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-value">' + value + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') +
      (delta ? '<div class="kpi-delta ' + (deltaClass || '') + '">' + delta + '</div>' : '') +
      '</div>';
  }

  /* ---------------- Summary text ---------------- */
  function buildSummary(ctx, zstats) {
    const target = sum(ctx.rows, 'target'), actual = sum(ctx.rows, 'actual');
    const ach = target > 0 ? (actual / target) * 100 : 0;
    const gap = target - actual;
    const below = zstats.filter(z => z.target > 0 && (z.actual / z.target) * 100 < CFG.achievement.weak).length;
    const worst = zstats.slice().sort((a, b) => b.gap - a.gap)[0];
    const counts = Signals.counts();
    const pc = Program.counts();
    const cat = counts.byCategory;
    return {
      ach, target, actual, gap, below, worst, counts, pc, cat,
      html: function () {
        const p = [];
        p.push('National achievement is <strong>' + ach.toFixed(1) + '%</strong>, with a sales gap of <strong>BDT ' + FMT.money(gap) + '</strong> (' + (target > 0 ? ((gap / target) * 100).toFixed(1) : 0) + '% of target).');
        p.push('<strong>' + below + '</strong> zones are below the ' + CFG.achievement.weak + '% performance threshold.');
        p.push('The largest contribution to the gap comes from <strong>' + esc(worst ? worst.name : '—') + '</strong> (BDT ' + FMT.money(worst ? worst.gap : 0) + ').');
        p.push('<strong>' + counts.critical + '</strong> critical signals require investigation; <strong>' + counts.active + '</strong> active signals overall.');
        p.push('<strong>' + pc.researchOpen + '</strong> research cases are open and <strong>' + pc.actionsOverdue + '</strong> management actions are overdue.');
        const tags = [];
        Object.keys(cat).forEach(k => { if (cat[k]) tags.push('<span class="st">' + esc(k) + ': ' + cat[k] + '</span>'); });
        return '<p>' + p.join('</p><p>') + '</p><div class="summary-tags">' + tags.join('') + '</div>';
      }
    };
  }

  /* ---------------- 01 OVERVIEW ---------------- */
  function renderOverview() {
    const ctx = getContext();
    const zstats = zoneStats(ctx.rows, ctx.upto);
    const target = sum(ctx.rows, 'target'), actual = sum(ctx.rows, 'actual');
    const ach = target > 0 ? (actual / target) * 100 : 0;
    const gap = target - actual;
    const counts = Signals.counts();
    const pc = Program.counts();
    const sum_ = buildSummary(ctx, zstats);
    const series = Store.monthly(ctx.rows);
    const labels = M.slice(0, ctx.upto + 1);
    const t = labels.map((_, i) => series[i].t), a = labels.map((_, i) => series[i].a);
    const achS = labels.map((_, i) => series[i].t > 0 ? ((series[i].a / series[i].t) * 100).toFixed(1) : null);

    // scoreboard (MoM: latest month vs previous month)
    const lastM = ctx.upto, prevM = Math.max(0, lastM - 1);
    const salesCur = series[lastM].a, salesPrev = series[prevM].a;
    const salesChg = salesPrev > 0 ? ((salesCur - salesPrev) / salesPrev) * 100 : null;
    const achCur = series[lastM].t > 0 ? (series[lastM].a / series[lastM].t) * 100 : null;
    const achPrev = series[prevM].t > 0 ? (series[prevM].a / series[prevM].t) * 100 : null;
    const gapCur = series[lastM].t - series[lastM].a, gapPrev = series[prevM].t - series[prevM].a;
    const activeSrs = Store.aggBy(ctx.rows, r => r.sr).filter(e => e.target > 0).length;
    const sb = { salesCur, salesChg, achCur, achPrev, gapCur, gapPrev, activeSrs, actual, activeCustomers: REF.customers.filter(c => c.active).length, critical: counts.critical };

    const topGaps = zstats.filter(z => z.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 10);
    const topSignals = Signals.all().filter(s => s.severity === 'critical').slice(0, 5);

    const catColors = { performance: Charts.PAL.navy, manpower: Charts.PAL.darkblue, customer: Charts.PAL.info, competitor: Charts.PAL.warn, market: Charts.PAL.slate };
    const catLabels = Object.keys(counts.byCategory).filter(k => counts.byCategory[k]);

    $('#content').querySelector('[data-view-panel="overview"]').innerHTML =
      '<div class="summary-box"><h3>Management Intelligence Summary</h3>' + sum_.html() + '</div>' +
      '<div class="kpi-grid">' +
        kpiCard('National Sales (Actual)', 'BDT ' + FMT.money(actual), FMT.moneyFull(actual)) +
        kpiCard('Target', 'BDT ' + FMT.money(target), FMT.moneyFull(target)) +
        kpiCard('Achievement', ach.toFixed(1) + '%', 'Actual vs Target') +
        kpiCard('Sales Gap', 'BDT ' + FMT.money(gap), target > 0 ? (gap / target * 100).toFixed(1) + '% of target' : '—', null, 'down') +
        kpiCard('Active Signals', counts.active, 'open &amp; unresolved') +
        kpiCard('Critical Signals', counts.critical, 'high priority', null, 'down') +
        kpiCard('Research Queue', pc.researchOpen, 'pending CI/R&amp;I') +
        kpiCard('Actions Overdue', pc.actionsOverdue, 'past deadline', null, 'down') +
      '</div>' +

      '<div class="grid grid-2 mb18">' +
        '<div class="card"><div class="card-title">National Sales Trend</div><div class="card-sub">Target vs Actual &amp; achievement %</div><div class="chart-box lg"><canvas id="chTrend"></canvas></div></div>' +
        '<div class="card"><div class="card-title">Management Scoreboard</div><div class="card-sub">Current vs previous period</div>' + scoreboardTable(sb) + '</div>' +
      '</div>' +

      '<div class="card mb18">' +
        '<div class="section-head"><div><div class="card-title">Bangladesh Zone Health Map</div><div class="card-sub">Health derived from performance, trend, manpower, customer &amp; competitor signals</div></div>' +
        '<div class="flex">' + mapViewToggle() + '</div></div>' +
        '<div class="map-wrap"><div id="mapBox" class="map-box"></div><div class="map-side">' + mapLegend() + '<div class="mt-note">Click a zone to open its intelligence drawer. Schematic map — approximate geographic placement.</div></div></div>' +
      '</div>' +

      '<div class="grid grid-2">' +
        '<div class="card"><div class="card-title">Sales Gap Decomposition</div><div class="card-sub">Top zones driving the national gap</div><div class="chart-box md"><canvas id="chGap"></canvas></div></div>' +
        '<div class="card"><div class="card-title">Signal Categories</div><div class="card-sub">Distribution by intelligence category</div><div class="chart-box md"><canvas id="chCat"></canvas></div></div>' +
      '</div>';

    Charts.trend('chTrend', labels, t, a, achS);
    Charts.donut('chCat', catLabels, catLabels.map(k => counts.byCategory[k]), catLabels.map(k => catColors[k]));
    Charts.hbar('chGap', topGaps.map(z => z.name), topGaps.map(z => z.gap), v => v >= 40000000 ? Charts.PAL.crit : v >= 15000000 ? Charts.PAL.neg : Charts.PAL.warn);

    renderMap(zstats);
  }

  function scoreboardTable(sb) {
    const prod = sb.activeSrs ? sb.actual / sb.activeSrs : null;
    const rows = [
      { k: 'Sales', cur: 'BDT ' + FMT.money(sb.salesCur), chg: sb.salesChg },
      { k: 'Achievement', cur: sb.achCur != null ? sb.achCur.toFixed(1) + '%' : '—', chg: (sb.achCur != null && sb.achPrev != null) ? (sb.achCur - sb.achPrev) : null, pp: true },
      { k: 'Sales Gap', cur: 'BDT ' + FMT.money(sb.gapCur), chg: (sb.gapPrev !== 0 && sb.gapPrev != null) ? ((sb.gapCur - sb.gapPrev) / Math.abs(sb.gapPrev)) * 100 : null },
      { k: 'Active Customers', cur: sb.activeCustomers.toLocaleString('en-IN'), chg: null },
      { k: 'Employee Productivity', cur: prod != null ? 'BDT ' + FMT.money(prod) + ' / SR' : '—', chg: null },
      { k: 'Critical Signals', cur: String(sb.critical), chg: null }
    ];
    return '<div class="table-wrap"><table class="tbl"><thead><tr><th>KPI</th><th class="num">Current</th><th class="num">Change</th><th>Status</th></tr></thead><tbody>' +
      rows.map(r => {
        let chgCell = '—', status = '<span class="pill pill-gray">Stable</span>';
        if (r.chg != null) {
          const chg = r.chg;
          const cls = chg > 0 ? 'up' : 'down';
          const chgTxt = (r.pp ? (chg >= 0 ? '+' : '') + chg.toFixed(1) + ' pp' : (chg > 0 ? '↑' : '↓') + ' ' + Math.abs(chg).toFixed(1) + '%');
          chgCell = '<span class="' + cls + '">' + chgTxt + '</span>';
          status = chg > (r.pp ? 2 : 3) ? '<span class="pill pill-pos">Improving</span>' : chg < (r.pp ? -2 : -3) ? '<span class="pill pill-neg">Deteriorating</span>' : '<span class="pill pill-gray">Stable</span>';
        }
        return '<tr class="row"><td>' + r.k + '</td><td class="num mono">' + r.cur + '</td><td class="num">' + chgCell + '</td><td>' + status + '</td></tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  function productivity(actual, n) { return actual ? ('BDT ' + FMT.money(actual / 1)) : '—'; }

  /* ---------------- Map helpers ---------------- */
  function mapViewToggle() {
    const opts = [['health', 'Signal Health'], ['achievement', 'Achievement'], ['gap', 'Sales Gap'], ['signals', 'Critical Signals']];
    return opts.map(o => '<button class="pill ' + (state.mapMetric === o[0] ? 'pill-info' : 'pill-gray') + '" data-mapmetric="' + o[0] + '" style="border:none">' + o[1] + '</button>').join(' ');
  }

  function mapLegend() {
    const items = [['healthy', 'Healthy'], ['watch', 'Watch'], ['risk', 'At Risk'], ['critical', 'Critical']];
    return '<div class="legend">' + items.map(i => '<span class="li"><span class="health-dot" style="background:' + Charts.PAL.health[i[0]] + '"></span>' + i[1] + '</span>').join('') + '</div>';
  }

  function renderMap(zstats) {
    const map = {};
    zstats.forEach(z => { map[z.name] = { series: z.series, health: z.health, gapLakh: z.gapLakh, sigCount: z.sigCount }; });
    ZoneMap.render('mapBox', state.mapMetric, map, zone => openZoneDrawer(zone));
  }

  /* ---------------- 02 PERFORMANCE ---------------- */
  function renderPerformance() {
    const ctx = getContext();
    const target = sum(ctx.rows, 'target'), actual = sum(ctx.rows, 'actual');
    const ach = target > 0 ? (actual / target) * 100 : 0;
    const series = Store.monthly(ctx.rows);
    const labels = M.slice(0, ctx.upto + 1);

    const sr = Store.aggBy(ctx.rows, r => r.sr).map(e => ({ name: e.name, target: e.target, actual: e.actual, ach: Calc.achievement(e.target, e.actual), zone: Store.srZone[e.name] || '—', point: Store.srPoint[e.name] || '—' }));
    const top = sr.slice().sort((a, b) => b.actual - a.actual).slice(0, 12);
    const bottom = sr.filter(x => x.target > 0).sort((a, b) => (a.ach == null ? 999 : a.ach) - (b.ach == null ? 999 : b.ach)).slice(0, 12);

    $('#content').querySelector('[data-view-panel="performance"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Sales Performance</div></div>' +
      '<div class="flex"><button class="btn btn-primary" onclick="App.exportTable()">Export CSV</button></div></div>' +
      '<div class="kpi-grid">' +
        kpiCard('Target', 'BDT ' + FMT.money(target), FMT.moneyFull(target)) +
        kpiCard('Actual', 'BDT ' + FMT.money(actual), FMT.moneyFull(actual)) +
        kpiCard('Achievement', ach.toFixed(1) + '%', 'Actual vs Target') +
        kpiCard('Sales Gap', 'BDT ' + FMT.money(target - actual), (target > 0 ? ((target - actual) / target * 100).toFixed(1) + '% of target' : '—'), null, 'down') +
      '</div>' +
      '<div class="card mb18"><div class="card-title">Monthly Target vs Actual</div><div class="chart-box lg"><canvas id="chPerf"></canvas></div></div>' +
      '<div class="grid grid-2">' +
        '<div class="card"><div class="card-title">Top SRs by Actual Sales</div><div class="table-wrap">' + srTable(top, false) + '</div></div>' +
        '<div class="card"><div class="card-title">Lowest Achievement SRs</div><div class="table-wrap">' + srTable(bottom, true) + '</div></div>' +
      '</div>';

    Charts.targetActual('chPerf', labels, labels.map((_, i) => series[i].t), labels.map((_, i) => series[i].a));
  }

  function srTable(list, byAch) {
    return '<table class="tbl"><thead><tr><th>SR / Employee</th><th>Zone</th><th class="num">Target</th><th class="num">Actual</th><th class="num">Ach %</th></tr></thead><tbody>' +
      list.map(e => '<tr class="row"><td class="clickable" data-sr="' + esc(e.name) + '">' + esc(e.name) + '</td><td>' + esc(e.zone) + '</td><td class="num mono">' + FMT.money(e.target) + '</td><td class="num mono">' + FMT.money(e.actual) + '</td><td class="num mono ' + (e.ach == null ? '' : e.ach >= 100 ? 'h-healthy' : e.ach >= 90 ? 'h-watch' : e.ach >= 70 ? 'h-atrisk' : 'h-critical') + '">' + (e.ach == null ? '—' : e.ach.toFixed(1) + '%') + '</td></tr>').join('') +
      '</tbody></table>';
  }

  /* ---------------- 03 GEOGRAPHY ---------------- */
  function renderGeography() {
    const ctx = getContext();
    const zstats = zoneStats(ctx.rows, ctx.upto).sort((a, b) => b.actual - a.actual);

    $('#content').querySelector('[data-view-panel="geography"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Geographic Intelligence</div><div class="section-desc">Zone → Point (territory) → SR performance</div></div></div>' +
      '<div class="card mb18"><div class="section-head"><div><div class="card-title">Zone Health Map</div></div><div class="flex">' + mapViewToggle() + '</div></div>' +
      '<div class="map-wrap"><div id="mapBoxGeo" class="map-box"></div><div class="map-side">' + mapLegend() + '</div></div></div>' +
      '<div class="card"><div class="card-title">Zone Performance</div><div class="card-sub">Click a zone to drill down</div>' + zoneTable(zstats) + '</div>';

    const map = {};
    zstats.forEach(z => { map[z.name] = { series: z.series, health: z.health, gapLakh: z.gapLakh, sigCount: z.sigCount }; });
    ZoneMap.render('mapBoxGeo', state.mapMetric, map, zone => openZoneDrawer(zone));
  }

  function zoneTable(zstats) {
    return '<div class="table-wrap"><table class="tbl"><thead><tr><th>Zone</th><th>DSM</th><th>Health</th><th class="num">Target</th><th class="num">Actual</th><th class="num">Gap</th><th class="num">Ach %</th><th class="num">Trend</th><th class="num">Signals</th></tr></thead><tbody>' +
      zstats.map(z => {
        const h = z.health;
        const trend = h.subscores.trendPP;
        return '<tr class="row"><td class="clickable" data-zone="' + esc(z.name) + '">' + esc(z.name) + '</td>' +
          '<td>' + esc(Store.zoneDsm[z.name] || '—') + '</td>' +
          '<td><span class="pill ' + (h.band === 'healthy' ? 'pill-pos' : h.band === 'watch' ? 'pill-warn' : h.band === 'risk' ? 'pill-neg' : h.band === 'critical' ? 'pill-crit' : 'pill-gray') + '"><span class="health-dot" style="background:' + Charts.PAL.health[h.band] + '"></span>' + Health.label(h.band) + '</span></td>' +
          '<td class="num mono">' + FMT.money(z.target) + '</td><td class="num mono">' + FMT.money(z.actual) + '</td>' +
          '<td class="num mono ' + (z.gap > 0 ? 'h-critical' : 'h-healthy') + '">' + (z.gap > 0 ? '−' : '') + FMT.money(Math.abs(z.gap)) + '</td>' +
          '<td class="num mono ' + (z.ach == null ? '' : z.ach >= 100 ? 'h-healthy' : z.ach >= 90 ? 'h-watch' : z.ach >= 70 ? 'h-atrisk' : 'h-critical') + '">' + (z.ach == null ? '—' : z.ach.toFixed(1) + '%') + '</td>' +
          '<td class="num mono ' + (trend > 0 ? 'h-healthy' : trend < 0 ? 'h-critical' : '') + '">' + (trend == null ? '—' : (trend >= 0 ? '+' : '') + trend.toFixed(1) + ' pp') + '</td>' +
          '<td class="num mono">' + z.sigCount + '</td></tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  /* ---------------- 04 MANPOWER ---------------- */
  function renderManpower() {
    const ctx = getContext();
    const srs = Store.aggBy(ctx.rows, r => r.sr).map(e => ({ name: e.name, target: e.target, actual: e.actual, ach: Calc.achievement(e.target, e.actual), zone: Store.srZone[e.name] || '—', point: Store.srPoint[e.name] || '—' }));
    const active = srs.filter(s => s.target > 0);
    const avgProd = active.length ? sum(ctx.rows, 'actual') / active.length : 0;
    const lowProd = active.filter(s => s.ach != null && s.ach < 60 && s.target > 300000).sort((a, b) => a.ach - b.ach).slice(0, 12);
    const mSignals = Signals.all().filter(s => s.category === 'manpower');

    const scatter = active.filter(s => s.target > 0).slice().sort((a, b) => b.target - a.target).slice(0, 80).map(s => ({ x: s.target, y: s.ach == null ? 0 : s.ach }));

    $('#content').querySelector('[data-view-panel="manpower"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Manpower Intelligence</div><div class="section-desc">Employee productivity &amp; coverage signals</div></div></div>' +
      '<div class="kpi-grid">' +
        kpiCard('Total SRs', String(srs.length), 'in scope') +
        kpiCard('Active SRs', String(active.length), 'with target') +
        kpiCard('Avg Productivity', 'BDT ' + FMT.money(avgProd), 'actual per SR') +
        kpiCard('Low Productivity', String(lowProd.length), 'SRs &lt; 60%', null, 'down') +
      '</div>' +
      '<div class="grid grid-2 mb18">' +
        '<div class="card"><div class="card-title">Employee Productivity Matrix</div><div class="card-sub">X = target, Y = achievement %</div><div class="chart-box md"><canvas id="chProd"></canvas></div></div>' +
        '<div class="card"><div class="card-title">Manpower Signals</div><div class="card-sub">Generated from productivity patterns</div>' + signalList(mSignals.slice(0, 6)) + '</div>' +
      '</div>' +
      '<div class="card"><div class="card-title">Low Productivity Employees</div><div class="table-wrap">' + srTable(lowProd, true) + '</div></div>';

    Charts.scatter('chProd', scatter, 'Target (BDT)', 'Achievement %');
  }

  function signalList(list) {
    if (!list.length) return '<div class="empty">No signals</div>';
    return '<div class="signal-grid" style="grid-template-columns:1fr">' + list.map(signalCard).join('') + '</div>';
  }

  /* ---------------- 05 CUSTOMER ---------------- */
  function renderCustomer() {
    const ctx = getContext();
    const activeC = REF.customers.filter(c => c.active).length;
    const totalC = REF.customers.length;
    const zoneCust = {};
    REF.customers.forEach(c => { zoneCust[c.zone] = zoneCust[c.zone] || { t: 0, a: 0 }; zoneCust[c.zone].t++; if (c.active) zoneCust[c.zone].a++; });
    const topCust = REF.customers.slice().sort((a, b) => b.monthlyValue - a.monthlyValue).slice(0, 15);
    const dep = REF.distributors.slice().sort((a, b) => b.dependency - a.dependency).slice(0, 10);
    const cSignals = Signals.all().filter(s => s.category === 'customer');

    $('#content').querySelector('[data-view-panel="customer"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Customer Intelligence</div><div class="section-desc">Customer, distributor &amp; channel intelligence</div></div></div>' +
      '<div class="kpi-grid">' +
        kpiCard('Active Customers', String(activeC).replace(/\B(?=(\d{3})+(?!\d))/g, ','), 'of ' + totalC.toLocaleString('en-IN')) +
        kpiCard('Customer Retention', (totalC ? (activeC / totalC * 100).toFixed(1) + '%' : '—'), 'active ratio') +
        kpiCard('Distributors', String(REF.distributors.length), 'in network') +
        kpiCard('Customer Signals', String(cSignals.length), 'open', null, 'down') +
      '</div>' +
      '<div class="grid grid-2 mb18">' +
        '<div class="card"><div class="card-title">Customer Sales Contribution (Pareto)</div><div class="card-sub">Top customers by monthly value</div><div class="chart-box md"><canvas id="chPareto"></canvas></div></div>' +
        '<div class="card"><div class="card-title">Distributor Dependency</div><div class="card-sub">Zones overly reliant on a single distributor</div><div class="table-wrap"><table class="tbl"><thead><tr><th>Distributor</th><th>Zone</th><th class="num">Dependency</th><th>Status</th></tr></thead><tbody>' +
        dep.map(d => '<tr class="row"><td>' + esc(d.name) + '</td><td>' + esc(d.zone) + '</td><td class="num mono">' + (d.dependency * 100).toFixed(0) + '%</td><td>' + (d.status === 'Stock Issue' ? '<span class="pill pill-neg">Stock Issue</span>' : d.status === 'Watch' ? '<span class="pill pill-warn">Watch</span>' : '<span class="pill pill-pos">Healthy</span>') + '</td></tr>').join('') +
        '</tbody></table></div></div>' +
      '</div>' +
      '<div class="card"><div class="card-title">Customer Signals</div>' + signalList(cSignals.slice(0, 8)) + '</div>';

    Charts.pareto('chPareto', topCust.map(c => c.name), topCust.map(c => c.monthlyValue));
  }

  /* ---------------- 06 COMPETITOR ---------------- */
  function renderCompetitor() {
    const zones = Store.zoneList.slice(0, 10);
    const rows = zones.map(z => {
      const c = REF.compZone[z];
      return { zone: z, priceGap: c.priceGap, availability: c.availability, distribution: c.distribution, pressure: (c.priceGap < 0 ? 1 : 0) + (c.availability > .7 ? 1 : 0) + (c.distribution > .7 ? 1 : 0) };
    });
    const cSignals = Signals.all().filter(s => s.category === 'competitor');

    $('#content').querySelector('[data-view-panel="competitor"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Competitor Intelligence</div><div class="section-desc">Price, availability, distribution &amp; pressure</div></div></div>' +
      '<div class="card mb18"><div class="card-title">Competitive Comparison Matrix</div><div class="card-sub">Sample zones (pressure derived from price gap, availability &amp; distribution)</div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Zone</th><th class="num">AEL Price Gap</th><th class="num">Competitor Availability</th><th class="num">Competitor Distribution</th><th>Pressure</th></tr></thead><tbody>' +
      rows.map(r => '<tr class="row"><td class="clickable" data-zone="' + esc(r.zone) + '">' + esc(r.zone) + '</td>' +
        '<td class="num mono ' + (r.priceGap < 0 ? 'h-critical' : 'h-healthy') + '">' + (r.priceGap >= 0 ? '+' : '') + r.priceGap.toFixed(1) + '%</td>' +
        '<td class="num mono">' + (r.availability * 100).toFixed(0) + '%</td>' +
        '<td class="num mono">' + (r.distribution * 100).toFixed(0) + '%</td>' +
        '<td>' + (r.pressure >= 3 ? '<span class="pill pill-crit">High</span>' : r.pressure === 2 ? '<span class="pill pill-neg">Medium</span>' : '<span class="pill pill-pos">Low</span>') + '</td></tr>').join('') +
      '</tbody></table></div></div>' +
      '<div class="card"><div class="card-title">Competitor Signals</div>' + signalList(cSignals.slice(0, 8)) + '</div>';
  }

  /* ---------------- 07 MARKET ---------------- */
  function renderMarket() {
    const mk = REF.market;
    const labels = M.slice(0, mk.demandIndex.length);
    const mSignals = Signals.all().filter(s => s.category === 'market');

    $('#content').querySelector('[data-view-panel="market"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Market Intelligence</div><div class="section-desc">Demand, price, supply &amp; external signals</div></div></div>' +
      '<div class="grid grid-2 mb18">' +
        '<div class="card"><div class="card-title">Market Demand Index</div><div class="chart-box md"><canvas id="chDemand"></canvas></div></div>' +
        '<div class="card"><div class="card-title">Market Price Movement</div><div class="chart-box md"><canvas id="chPrice"></canvas></div></div>' +
      '</div>' +
      '<div class="card mb18"><div class="card-title">Seasonality &amp; Supply</div><div class="card-sub">Channel environment</div>' +
      '<div class="grid grid-4">' +
        Object.keys(mk.seasonality).map(q => '<div class="card"><div class="kpi-label">' + q + '</div><div class="kpi-value" style="font-size:20px">' + mk.seasonality[q] + '</div></div>').join('') +
      '</div></div>' +
      '<div class="card"><div class="card-title">Market Signals</div>' + signalList(mSignals.slice(0, 6)) + '</div>';

    Charts.line('chDemand', labels, [{ label: 'Demand Index', data: mk.demandIndex, color: Charts.PAL.darkblue }]);
    Charts.line('chPrice', labels, [{ label: 'Market Price', data: mk.marketPrice, color: Charts.PAL.warn }]);
  }

  /* ---------------- 08 SIGNALS ---------------- */
  function renderSignals() {
    const all = Signals.all();
    const crit = all.filter(s => s.severity === 'critical');
    const warn = all.filter(s => s.severity === 'warning');
    const watch = all.filter(s => s.severity === 'watch');
    const info = all.filter(s => s.severity === 'info');

    $('#content').querySelector('[data-view-panel="signals"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Sales Signal Center</div><div class="section-desc">Automatically generated exceptions across performance, manpower, customer, competitor &amp; market</div></div>' +
      '<div class="flex"><button class="btn btn-ghost" onclick="Signals.all(true)">Re-run engine</button></div></div>' +
      '<div class="grid grid-4 mb18">' +
        kpiCard('Critical', String(crit.length), 'immediate action', null, 'down') +
        kpiCard('Warning', String(warn.length), 'priority', null, 'down') +
        kpiCard('Watch', String(watch.length), 'monitor') +
        kpiCard('Recovery', String(info.filter(s => s.type === 'Recovery Detected').length), 'positive signals', null, 'up') +
      '</div>' +
      '<div class="card mb18"><div class="card-title">Signal Priority Matrix</div><div class="card-sub">Business impact vs evidence uncertainty</div>' + priorityMatrix() + '</div>' +
      '<div class="card"><div class="card-title">All Signals</div><div class="signal-grid">' + all.map(signalCard).join('') + '</div></div>';
  }

  function priorityMatrix() {
    const all = Signals.all();
    const quad = { hi: [], pi: [], mo: [], lo: [] };
    all.forEach(s => {
      const impact = s.severity === 'critical' || s.severity === 'warning';
      const evidence = s.confidence === 'High';
      if (impact && !evidence) quad.hi.push(s);
      else if (impact && evidence) quad.pi.push(s);
      else if (!impact && !evidence) quad.mo.push(s);
      else quad.lo.push(s);
    });
    const cell = (title, cls, arr) => '<div class="matrix-cell ' + cls + '"><div class="matrix-label">' + title + '</div><h4>' + arr.length + ' signals</h4><div class="tag-list">' + arr.slice(0, 4).map(s => '<span class="pill pill-gray" data-signal="' + s.id + '">' + s.id + '</span>').join('') + '</div></div>';
    return '<div class="matrix-grid">' +
      cell('High impact · Low evidence — Immediate Investigation', 'immediate', quad.hi) +
      cell('High impact · High evidence — Priority Research', 'priority', quad.pi) +
      cell('Low impact · Low evidence — Monitor', 'monitor', quad.mo) +
      cell('Low impact · High evidence — Low Priority', 'low', quad.lo) +
      '</div>';
  }

  /* ---------------- 09 ROOT CAUSE ---------------- */
  function renderRootCause() {
    const ctx = getContext();
    const zstats = zoneStats(ctx.rows, ctx.upto).sort((a, b) => b.gap - a.gap);
    const top = zstats.slice(0, 5);
    const nationalGap = sum(ctx.rows, 'target') - sum(ctx.rows, 'actual');

    const tree = '<div class="rca-tree">' +
      '<div class="rca-node"><span class="n-ico">◈</span><span class="n-name">Sales Gap — National</span><span class="n-meta">BDT ' + FMT.money(nationalGap) + '</span></div>' +
      '<div class="rca-children">' +
        top.map(z => {
          const pts = Store.zonePoints[z.name] || [];
          const topPts = Store.aggBy(ctx.rows.filter(r => r.zone === z.name), r => r.point).sort((a, b) => (b.target - b.actual) - (a.target - a.actual)).slice(0, 3);
          return '<div class="rca-node"><span class="n-ico">◉</span><span class="n-name">' + esc(z.name) + '</span><span class="n-meta">Gap BDT ' + FMT.money(z.gap) + '</span></div>' +
            '<div class="rca-children">' +
            topPts.map(p => {
              const srs = Store.aggBy(ctx.rows.filter(r => r.point === p.name), r => r.sr).sort((a, b) => (b.target - b.actual) - (a.target - a.actual)).slice(0, 3);
              return '<div class="rca-node"><span class="n-ico">▸</span><span class="n-name">' + esc(p.name) + '</span><span class="n-meta">Gap BDT ' + FMT.money(p.target - p.actual) + '</span></div>' +
                '<div class="rca-children">' + srs.map(s => '<div class="rca-node" data-sr="' + esc(s.name) + '"><span class="n-ico">·</span><span class="n-name">' + esc(s.name) + '</span><span class="n-meta">' + (Calc.achievement(s.target, s.actual) != null ? Calc.achievement(s.target, s.actual).toFixed(0) + '%' : '—') + '</span></div>').join('') + '</div>';
            }).join('') + '</div>';
        }).join('') +
      '</div></div>';

    const cats = [
      { c: 'Internal', items: ['Target setting', 'Manpower coverage', 'Productivity', 'Distributor stock', 'Customer churn', 'Product availability'] },
      { c: 'External', items: ['Competitor price', 'Market demand', 'Supply disruption', 'Seasonality', 'Channel shift'] },
      { c: 'Structural', items: ['Territory design', 'Distributor structure', 'Portfolio', 'Distribution model', 'Org capability'] }
    ];

    $('#content').querySelector('[data-view-panel="rootcause"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Root Cause Analysis</div><div class="section-desc">Drill from national gap to zone → territory → employee</div></div></div>' +
      '<div class="grid grid-2">' +
        '<div class="card"><div class="card-title">Gap Drill-down Tree</div><div class="card-sub">Top gap contributors</div>' + tree + '</div>' +
        '<div class="card"><div class="card-title">Root Cause Categories</div><div class="card-sub">Candidate causes requiring validation (not confirmed)</div>' +
          cats.map(g => '<div class="drawer-section"><h4>' + g.c + '</h4><div class="tag-list">' + g.items.map(i => '<span class="pill pill-gray">' + esc(i) + '</span>').join('') + '</div></div>').join('') +
          '<div class="mt-note" style="margin-top:14px">Note: categories are hypotheses until validated by evidence.</div>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- 10 RESEARCH ---------------- */
  function renderResearch() {
    const rs = Program.research;
    $('#content').querySelector('[data-view-panel="research"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">CI Research Queue</div><div class="section-desc">Signals converted into research assignments</div></div></div>' +
      '<div class="kpi-grid">' +
        kpiCard('Open Cases', String(rs.filter(r => r.status !== 'COMPLETED').length), 'research') +
        kpiCard('Field Research', String(rs.filter(r => r.status === 'FIELD RESEARCH').length), 'in progress') +
        kpiCard('Queued', String(rs.filter(r => r.status === 'QUEUED').length), 'awaiting start') +
        kpiCard('Owners', String(new Set(rs.map(r => r.owner)).size), 'R&I / CI teams') +
      '</div>' +
      '<div class="card"><div class="card-title">Research Cases</div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Signal</th><th>Business Question</th><th>Hypotheses</th><th>Evidence Required</th><th>Owner</th><th>Deadline</th><th>Status</th></tr></thead><tbody>' +
      rs.map(r => '<tr class="row"><td class="clickable" data-research="' + r.id + '">' + r.id + '</td>' +
        '<td><span class="clickable" data-signal="' + r.signalId + '">' + r.signalId + '</span></td>' +
        '<td>' + esc(r.question) + '</td>' +
        '<td style="white-space:normal;max-width:220px">' + r.hypotheses.slice(0, 2).map(h => '• ' + esc(h)).join('<br>') + '</td>' +
        '<td style="white-space:normal;max-width:200px">' + r.evidence.slice(0, 3).map(e => '• ' + esc(e)).join('<br>') + '</td>' +
        '<td>' + esc(r.owner) + '</td><td>' + esc(r.deadline) + '</td>' +
        '<td>' + researchPill(r.status) + '</td></tr>').join('') +
      '</tbody></table></div></div>';
  }

  function researchPill(s) {
    return s === 'COMPLETED' ? '<span class="pill pill-pos">Completed</span>' : s === 'FIELD RESEARCH' ? '<span class="pill pill-info">Field Research</span>' : s === 'EVIDENCE GATHERING' ? '<span class="pill pill-warn">Evidence</span>' : '<span class="pill pill-gray">Queued</span>';
  }

  /* ---------------- 11 IMPACT ---------------- */
  function renderImpact() {
    const crit = Signals.all().filter(s => s.severity === 'critical' || s.severity === 'warning');
    const totalLoss = crit.reduce((s, x) => s + (x.gapLakh || 0) * 100000, 0);
    const recovery = totalLoss * 0.4;
    const topZ = zoneStats(getContext().rows, getContext().upto).sort((a, b) => b.gap - a.gap).slice(0, 8);

    $('#content').querySelector('[data-view-panel="impact"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Business Impact</div><div class="section-desc">Quantified loss &amp; recovery opportunity</div></div></div>' +
      '<div class="kpi-grid">' +
        kpiCard('Estimated Sales Loss', 'BDT ' + FMT.money(totalLoss), 'from critical signals', null, 'down') +
        kpiCard('Recovery Opportunity', 'BDT ' + FMT.money(recovery), '≈ 40% recoverable', null, 'up') +
        kpiCard('Customer Value at Risk', 'BDT ' + FMT.money(totalLoss * 0.35), 'churn &amp; dependency') +
        kpiCard('Zones at Risk', String(zoneStats(getContext().rows, getContext().upto).filter(z => z.health.band === 'critical' || z.health.band === 'risk').length), 'critical / at-risk') +
      '</div>' +
      '<div class="card"><div class="card-title">Zone Impact</div><div class="card-sub">Affected sales by zone</div>' +
      '<div class="chart-box md"><canvas id="chImpact"></canvas></div></div>';

    Charts.hbar('chImpact', topZ.map(z => z.name), topZ.map(z => z.gap), v => v >= 40000000 ? Charts.PAL.crit : v >= 15000000 ? Charts.PAL.neg : Charts.PAL.warn);
  }

  /* ---------------- 12 ACTION ---------------- */
  function renderAction() {
    const acts = Program.actions;
    $('#content').querySelector('[data-view-panel="action"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Management Action Tracker</div><div class="section-desc">Decision → owner → deadline → status</div></div></div>' +
      '<div class="kpi-grid">' +
        kpiCard('Open', String(acts.filter(a => a.status === 'Open').length), 'not started') +
        kpiCard('In Progress', String(acts.filter(a => a.status === 'In Progress').length), 'underway') +
        kpiCard('Overdue', String(acts.filter(a => a.status === 'Overdue').length), 'past deadline', null, 'down') +
        kpiCard('Monitoring', String(acts.filter(a => a.status === 'Monitoring').length), 'watching outcome') +
      '</div>' +
      '<div class="card"><div class="card-title">Action Tracker</div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Issue</th><th>Action</th><th>Owner</th><th>Deadline</th><th class="num">Expected Impact</th><th>Status</th></tr></thead><tbody>' +
      acts.map(a => '<tr class="row"><td>' + esc(a.issue) + '</td><td style="white-space:normal;max-width:260px">' + esc(a.action) + '</td><td>' + esc(a.owner) + '</td><td>' + esc(a.deadline) + '</td><td class="num mono">' + esc(a.expectedImpact) + '</td><td>' + actionPill(a.status) + '</td></tr>').join('') +
      '</tbody></table></div></div>';
  }

  function actionPill(s) {
    return s === 'Overdue' ? '<span class="pill pill-crit">Overdue</span>' : s === 'In Progress' ? '<span class="pill pill-info">In Progress</span>' : s === 'Completed' ? '<span class="pill pill-pos">Completed</span>' : s === 'Monitoring' ? '<span class="pill pill-warn">Monitoring</span>' : s === 'Closed' ? '<span class="pill pill-gray">Closed</span>' : '<span class="pill pill-gray">Open</span>';
  }

  /* ---------------- 13 MONITORING ---------------- */
  function renderMonitoring() {
    const mon = Program.monitoring;
    $('#content').querySelector('[data-view-panel="monitoring"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Impact Monitoring</div><div class="section-desc">Did the management action improve the business?</div></div></div>' +
      '<div class="card"><div class="card-title">Before → Action → After</div><div class="card-sub">Observed change (correlation, not confirmed causality)</div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Zone</th><th>Action</th><th class="num">Before (Ach %)</th><th class="num">After (Ach %)</th><th class="num">Impact</th><th>Outcome</th></tr></thead><tbody>' +
      mon.map(m => {
        const d = m.after - m.before;
        return '<tr class="row"><td class="clickable" data-zone="' + esc(m.zone) + '">' + esc(m.zone) + '</td><td>' + esc(m.action) + '</td>' +
          '<td class="num mono">' + m.before + '%</td><td class="num mono">' + m.after + '%</td>' +
          '<td class="num mono ' + (d >= 0 ? 'h-healthy' : 'h-critical') + '">' + (d >= 0 ? '+' : '') + d.toFixed(0) + ' pp</td>' +
          '<td>' + (d >= 8 ? '<span class="pill pill-pos">Observed Improvement</span>' : d >= 3 ? '<span class="pill pill-warn">Under Monitoring</span>' : d < 0 ? '<span class="pill pill-neg">Deteriorated</span>' : '<span class="pill pill-gray">No Significant Change</span>') + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="mt-note" style="margin-top:12px">Labels reflect observed change only; causality requires triangulated evidence.</div></div>';
  }

  /* ---------------- 14 DATA QUALITY ---------------- */
  function renderDataQuality() {
    const total = Store.rows.length;
    const blankDsm = Store.rows.filter(r => r.dsm === 'Unassigned').length;
    const zeroTarget = Store.rows.filter(r => r.target === 0).length;
    const zeroActual = Store.rows.filter(r => r.actual === 0).length;
    const dupes = Store.rows.length - new Set(Store.rows.map(r => r.sr + '|' + r.zone + '|' + r.point + '|' + r.mi)).size;
    const issues = (blankDsm > 0 ? 1 : 0) + (zeroTarget > 0 ? 1 : 0) + (zeroActual > 0 ? 1 : 0) + (dupes > 0 ? 1 : 0);
    const score = Math.max(0, 100 - issues * 20 - (zeroTarget / total * 100) - (dupes / total * 100));

    $('#content').querySelector('[data-view-panel="dataquality"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Data Quality</div><div class="section-desc">Validation &amp; reliability monitoring</div></div></div>' +
      '<div class="kpi-grid">' +
        kpiCard('Total Records', total.toLocaleString('en-IN'), 'SR × month') +
        kpiCard('Valid Records', (total - zeroTarget - dupes).toLocaleString('en-IN'), 'usable') +
        kpiCard('Data Quality Score', Math.round(score) + '/100', 'transparent formula', null, score > 80 ? 'up' : 'down') +
        kpiCard('Issues Found', String(issues), 'categories', null, 'down') +
      '</div>' +
      '<div class="card"><div class="card-title">Quality Checks</div><div class="card-sub">Score = 100 − (issue categories × 20) − missing-target% − duplicate%</div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Check</th><th class="num">Records</th><th class="num">% of Total</th><th>Status</th></tr></thead><tbody>' +
        dqRow('Total records', total, 0, 'info') +
        dqRow('Unassigned DSM mapping', blankDsm, blankDsm / total * 100, blankDsm > 0 ? 'neg' : 'pos') +
        dqRow('Zero target (missing target)', zeroTarget, zeroTarget / total * 100, zeroTarget > 0 ? 'neg' : 'pos') +
        dqRow('Zero achievement', zeroActual, zeroActual / total * 100, zeroActual > total * 0.1 ? 'neg' : 'warn') +
        dqRow('Duplicate SR-zone-month', dupes, dupes / total * 100, dupes > 0 ? 'neg' : 'pos') +
      '</tbody></table></div>' +
      '<div class="mt-note" style="margin-top:12px">Last refresh: Sep 2026 &middot; Source: AEL Distributor SR Monthly (Jan 2026 – Till Date)</div></div>';
  }

  function dqRow(label, val, pct, status) {
    const pill = status === 'pos' ? '<span class="pill pill-pos">OK</span>' : status === 'neg' ? '<span class="pill pill-neg">Issue</span>' : status === 'warn' ? '<span class="pill pill-warn">Watch</span>' : '<span class="pill pill-info">Info</span>';
    return '<tr class="row"><td>' + esc(label) + '</td><td class="num mono">' + val.toLocaleString('en-IN') + '</td><td class="num mono">' + (pct ? pct.toFixed(1) + '%' : '—') + '</td><td>' + pill + '</td></tr>';
  }

  /* ---------------- Signal card ---------------- */
  function signalCard(s) {
    return '<div class="signal-card sev-' + s.severity + '" data-signal="' + s.id + '">' +
      '<div class="sig-top"><span class="sig-id">' + s.id + ' · ' + s.severityLabel + '</span><span class="pill ' + catPill(s.category) + '">' + s.categoryLabel + '</span></div>' +
      '<div class="sig-title">' + esc(s.type) + '</div>' +
      '<div class="sig-loc">' + (s.locationType === 'national' ? 'NATIONAL' : s.locationType.toUpperCase() + ': ' + esc(s.location)) + '</div>' +
      '<div class="sig-metrics">' +
        '<div class="sig-m"><span class="k">' + esc(s.metric) + '</span><span class="v">' + esc(s.current) + '</span></div>' +
        '<div class="sig-m"><span class="k">Persistence</span><span class="v">' + esc(s.persistence) + '</span></div>' +
        '<div class="sig-m"><span class="k">Impact</span><span class="v">' + esc(s.estimatedImpact) + '</span></div>' +
      '</div>' +
      '<div class="sig-foot"><span class="pill pill-gray">' + esc(s.status) + '</span><span class="muted" style="font-size:10.5px">' + esc(s.confidence) + ' confidence</span></div>' +
    '</div>';
  }

  function catPill(c) { return { performance: 'pill-info', manpower: 'pill-warn', customer: 'pill-neg', competitor: 'pill-crit', market: 'pill-gray' }[c] || 'pill-gray'; }

  /* ---------------- Drawers ---------------- */
  function openDrawer(title, html) {
    $('#drawerTitle').textContent = title;
    $('#drawerBody').innerHTML = html;
    $('#drawer').classList.add('open');
    $('#drawerOverlay').classList.add('open');
  }
  function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawerOverlay').classList.remove('open'); }

  function openZoneDrawer(zone) {
    const ctx = getContext();
    const z = zoneStats(ctx.rows, ctx.upto).find(x => x.name === zone);
    if (!z) return;
    const h = z.health;
    const ss = h.subscores;
    const sigs = Signals.byZone(zone);
    const research = Program.research.filter(r => r.location === zone);
    const actions = Program.actions.filter(a => a.issue.includes(zone));
    const comp = REF.compZone[zone];
    const dists = REF.distributors.filter(d => d.zone === zone);

    const rows = [
      ['Target', FMT.moneyFull(z.target)], ['Actual', FMT.moneyFull(z.actual)],
      ['Achievement', z.ach == null ? '—' : z.ach.toFixed(1) + '%'], ['Sales Gap', FMT.moneyFull(z.gap)],
      ['Trend (3M)', ss.trendPP == null ? '—' : (ss.trendPP >= 0 ? '+' : '') + ss.trendPP.toFixed(1) + ' pp'],
      ['Persistence', ss.persistenceMonths + ' months below ' + CFG.achievement.weak + '%'],
      ['Volatility (CV)', (ss.volatilityCV * 100).toFixed(0) + '%'],
      ['Critical Signals', String(sigs.filter(s => s.severity === 'critical').length)],
      ['Open Research', String(research.length)], ['Open Actions', String(actions.length)],
      ['Competitor Price Gap', comp ? (comp.priceGap >= 0 ? '+' : '') + comp.priceGap.toFixed(1) + '%' : '—'],
      ['Distributor Dependency', dists.length ? (dists.reduce((s, d) => s + d.dependency, 0) / dists.length * 100).toFixed(0) + '% avg' : '—']
    ];

    openDrawer(zone, '<div class="pill ' + (h.band === 'healthy' ? 'pill-pos' : h.band === 'watch' ? 'pill-warn' : h.band === 'risk' ? 'pill-neg' : h.band === 'critical' ? 'pill-crit' : 'pill-gray') + '" style="margin-bottom:12px"><span class="health-dot" style="background:' + Charts.PAL.health[h.band] + '"></span>' + Health.label(h.band) + (h.score != null ? ' — score ' + h.score + '/100' : '') + '</div>' +
      rows.map(r => '<div class="detail-row"><span class="lbl">' + r[0] + '</span><span class="val">' + r[1] + '</span></div>').join('') +
      '<div class="drawer-section"><h4>Top Signals</h4>' + (sigs.length ? sigs.slice(0, 5).map((s, i) => '<div class="rca-node" data-signal="' + s.id + '"><span class="n-ico">' + String(i + 1).padStart(2, '0') + '</span><span class="n-name">' + esc(s.type) + '</span><span class="n-meta">' + s.severityLabel + '</span></div>').join('') : '<div class="muted">No signals</div>') + '</div>' +
      '<div class="drawer-section"><h4>Points (Territories)</h4>' + '<div class="tag-list">' + (Store.zonePoints[zone] || []).map(p => '<span class="pill pill-gray" data-point="' + esc(p) + '">' + esc(p) + '</span>').join('') + '</div></div>' +
      '<div class="drawer-section"><h4>Distributors</h4>' + (dists.length ? dists.map(d => '<div class="detail-row"><span class="lbl">' + esc(d.name) + '</span><span class="val">' + (d.dependency * 100).toFixed(0) + '% dep</span></div>').join('') : '<div class="muted">None</div>') + '</div>');
  }

  function openSrDrawer(sr) {
    const ctx = getContext();
    const e = Store.aggBy(ctx.rows.filter(r => r.sr === sr), r => r.sr)[0];
    const ach = e ? Calc.achievement(e.target, e.actual) : null;
    const zone = Store.srZone[sr] || '—';
    const sigs = Signals.all().filter(s => s.location === sr);
    openDrawer(sr, '<div class="detail-row"><span class="lbl">Zone</span><span class="val">' + esc(zone) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Point</span><span class="val">' + esc(Store.srPoint[sr] || '—') + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Target</span><span class="val">' + FMT.moneyFull(e ? e.target : 0) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Actual</span><span class="val">' + FMT.moneyFull(e ? e.actual : 0) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Achievement</span><span class="val">' + (ach == null ? '—' : ach.toFixed(1) + '%') + '</span></div>' +
      '<div class="drawer-section"><h4>Monthly Trend</h4><div class="chart-box sm"><canvas id="chSr"></canvas></div></div>' +
      '<div class="drawer-section"><h4>Signals</h4>' + (sigs.length ? sigs.map(s => '<div class="rca-node" data-signal="' + s.id + '"><span class="n-name">' + esc(s.type) + '</span><span class="n-meta">' + s.severityLabel + '</span></div>').join('') : '<div class="muted">None</div>') + '</div>');
    if (e) {
      const s = e.series;
      const labels = M.slice(0, ctx.upto + 1);
      Charts.targetActual('chSr', labels, labels.map((_, i) => s[i].t), labels.map((_, i) => s[i].a));
    }
  }

  function openSignalDrawer(id) {
    const s = Signals.all().find(x => x.id === id);
    if (!s) return;
    const research = Program.research.find(r => r.signalId === id);
    const action = Program.actions.find(a => a.issue.includes(s.type) || a.issue.includes(s.location));
    openDrawer(s.id + ' — ' + s.type,
      '<div class="pill ' + catPill(s.category) + '" style="margin-bottom:8px">' + s.categoryLabel + '</div>' +
      '<div class="pill ' + (s.severity === 'critical' ? 'pill-crit' : s.severity === 'warning' ? 'pill-neg' : s.severity === 'watch' ? 'pill-warn' : 'pill-info') + '" style="margin-bottom:12px">' + s.severityLabel + '</div>' +
      '<div class="detail-row"><span class="lbl">Location</span><span class="val">' + esc(s.location) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Metric</span><span class="val">' + esc(s.metric) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Current</span><span class="val">' + esc(s.current) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Previous</span><span class="val">' + esc(s.previous) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Deviation</span><span class="val">' + (s.deviation == null ? '—' : (typeof s.deviation === 'number' ? (s.deviation >= 0 ? '+' : '') + s.deviation.toFixed(1) : s.deviation)) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Persistence</span><span class="val">' + esc(s.persistence) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Estimated Impact</span><span class="val">' + esc(s.estimatedImpact) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Confidence</span><span class="val">' + esc(s.confidence) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Status</span><span class="val">' + esc(s.status) + '</span></div>' +
      (research ? '<div class="drawer-section"><h4>Business Question</h4><p class="muted" style="margin:0">' + esc(research.question) + '</p><h4 style="margin-top:12px">Hypotheses</h4>' + research.hypotheses.map(h => '<div class="detail-row"><span class="lbl">•</span><span class="val" style="text-align:left">' + esc(h) + '</span></div>').join('') + '<h4 style="margin-top:12px">Evidence Required</h4>' + research.evidence.map(e => '<div class="detail-row"><span class="lbl">•</span><span class="val" style="text-align:left">' + esc(e) + '</span></div>').join('') + '</div>' : '') +
      (action ? '<div class="drawer-section"><h4>Management Action</h4><div class="detail-row"><span class="lbl">' + esc(action.action) + '</span><span class="val">' + esc(action.owner) + ' · ' + esc(action.status) + '</span></div></div>' : ''));
  }

  function openResearchDrawer(id) {
    const r = Program.research.find(x => x.id === id);
    if (!r) return;
    openDrawer(r.id + ' — ' + esc(r.question),
      '<div class="detail-row"><span class="lbl">Signal</span><span class="val">' + esc(r.signalId) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Location</span><span class="val">' + esc(r.location) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Method</span><span class="val">' + esc(r.method) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Owner</span><span class="val">' + esc(r.owner) + '</span></div>' +
      '<div class="detail-row"><span class="lbl">Deadline</span><span class="val">' + esc(r.deadline) + '</span></div>' +
      '<div class="drawer-section"><h4>Hypotheses</h4>' + r.hypotheses.map(h => '<div class="detail-row"><span class="lbl">•</span><span class="val" style="text-align:left">' + esc(h) + '</span></div>').join('') + '</div>' +
      '<div class="drawer-section"><h4>Evidence Required</h4>' + r.evidence.map(e => '<div class="detail-row"><span class="lbl">•</span><span class="val" style="text-align:left">' + esc(e) + '</span></div>').join('') + '</div>');
  }

  /* ---------------- Event delegation ---------------- */
  document.addEventListener('click', function (ev) {
    const zoneEl = ev.target.closest('[data-zone]');
    const srEl = ev.target.closest('[data-sr]');
    const sigEl = ev.target.closest('[data-signal]');
    const rsEl = ev.target.closest('[data-research]');
    const mmEl = ev.target.closest('[data-mapmetric]');
    if (mmEl) { state.mapMetric = mmEl.getAttribute('data-mapmetric'); renderView(state.view); return; }
    if (zoneEl) { openZoneDrawer(zoneEl.getAttribute('data-zone')); return; }
    if (srEl) { openSrDrawer(srEl.getAttribute('data-sr')); return; }
    if (sigEl) { openSignalDrawer(sigEl.getAttribute('data-signal')); return; }
    if (rsEl) { openResearchDrawer(rsEl.getAttribute('data-research')); return; }
  });

  /* ---------------- Notifications ---------------- */
  function updateNotifications() {
    const crit = Signals.critical();
    const overdue = Program.overdueActions();
    const recovery = Signals.all().filter(s => s.type === 'Recovery Detected');
    const dq = 1;
    const badge = crit.length + overdue.length;
    $('#notifBadge').textContent = badge;
    $('#notifBadge').style.display = badge ? 'grid' : 'none';

    const items = [];
    crit.slice(0, 4).forEach(s => items.push('<div class="notif-item" data-signal="' + s.id + '"><span class="notif-dot" style="background:' + Charts.PAL.crit + '"></span><div class="notif-body"><div class="notif-title">' + esc(s.type) + '</div><div class="notif-sub">' + esc(s.location) + ' · ' + s.id + '</div></div></div>'));
    overdue.slice(0, 3).forEach(a => items.push('<div class="notif-item"><span class="notif-dot" style="background:' + Charts.PAL.warn + '"></span><div class="notif-body"><div class="notif-title">Overdue action</div><div class="notif-sub">' + esc(a.issue) + '</div></div></div>'));
    recovery.slice(0, 3).forEach(s => items.push('<div class="notif-item"><span class="notif-dot" style="background:' + Charts.PAL.pos + '"></span><div class="notif-body"><div class="notif-title">Recovery signal</div><div class="notif-sub">' + esc(s.location) + '</div></div></div>'));
    if (items.length) $('#notifPanel').innerHTML = '<div class="np-head">Notifications</div>' + items.join('');
    else $('#notifPanel').innerHTML = '<div class="np-head">Notifications</div><div class="empty">No new items</div>';
  }

  /* ---------------- Search ---------------- */
  function buildIndex() {
    const idx = [];
    Store.zoneList.forEach(z => idx.push({ type: 'Zone', title: z, sub: Store.zoneDsm[z] || '', action: () => openZoneDrawer(z) }));
    Store.pointList.forEach(p => idx.push({ type: 'Point', title: p, sub: '', action: () => openZoneDrawer(Store.zonePoints.find(z => Store.zonePoints[z].includes(p)) || '') }));
    Store.srList.forEach(s => idx.push({ type: 'Employee', title: s, sub: Store.srZone[s] || '', action: () => openSrDrawer(s) }));
    Signals.all().forEach(s => idx.push({ type: 'Signal', title: s.id + ' · ' + s.type, sub: s.location, action: () => openSignalDrawer(s.id) }));
    Program.research.forEach(r => idx.push({ type: 'Research', title: r.id + ' · ' + r.question, sub: r.location, action: () => openResearchDrawer(r.id) }));
    REF.distributors.forEach(d => idx.push({ type: 'Distributor', title: d.name, sub: d.zone, action: () => openZoneDrawer(d.zone) }));
    return idx;
  }

  function runSearch(q) {
    q = q.trim().toLowerCase();
    const box = $('#searchResults');
    if (!q) { box.innerHTML = ''; return; }
    const idx = buildIndex();
    const hits = idx.filter(i => (i.title + ' ' + i.sub).toLowerCase().includes(q)).slice(0, 40);
    if (!hits.length) { box.innerHTML = '<div class="empty">No results for "' + esc(q) + '"</div>'; return; }
    const groups = {};
    hits.forEach(h => { groups[h.type] = groups[h.type] || []; groups[h.type].push(h); });
    box.innerHTML = Object.keys(groups).map(g => '<div class="sr-group">' + g + '</div>' + groups[g].map(h => '<div class="sr-item" data-search-idx="' + hits.indexOf(h) + '"><div class="t">' + esc(h.title) + '</div><div class="s">' + esc(h.sub) + '</div></div>').join('')).join('');
    box._hits = hits;
  }

  /* ---------------- Export ---------------- */
  function exportTable() {
    const ctx = getContext();
    const z = zoneStats(ctx.rows, ctx.upto);
    const head = ['Zone', 'DSM', 'Target', 'Actual', 'Gap', 'Achievement%', 'Health'];
    const lines = [head.join(',')];
    z.forEach(x => lines.push([x.name, Store.zoneDsm[x.name] || '', x.target, x.actual, x.gap, x.ach == null ? '' : x.ach.toFixed(2), Health.label(x.health.band)].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'AEL_Zone_Performance.csv';
    a.click();
    toast('Exported AEL_Zone_Performance.csv');
  }

  /* ---------------- Toast ---------------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------------- Router ---------------- */
  const renderers = {
    overview: renderOverview, performance: renderPerformance, geography: renderGeography,
    manpower: renderManpower, customer: renderCustomer, competitor: renderCompetitor,
    market: renderMarket, signals: renderSignals, rootcause: renderRootCause,
    research: renderResearch, impact: renderImpact, action: renderAction,
    monitoring: renderMonitoring, dataquality: renderDataQuality
  };

  function renderView(view) {
    state.view = view;
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.getAttribute('data-view') === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.getAttribute('data-view-panel') === view));
    Charts.destroyAll();
    const fn = renderers[view];
    if (fn) fn();
    updateNotifications();
  }

  /* ---------------- Init ---------------- */
  function populateFilters() {
    const mSel = $('#selMonth');
    mSel.innerHTML = '<option value="all">All months (YTD)</option>' + M.slice(0, MTD_MONTH + 1).map((m, i) => '<option value="' + i + '">' + m + ' 2026</option>').join('');
    const d = $('#selDsm'); d.innerHTML = '<option value="all">All DSMs</option>' + Store.dsmList.map(x => '<option value="' + esc(x) + '">' + esc(x) + '</option>').join('');
    refreshZoneFilter(); refreshSrFilter();
  }
  function refreshZoneFilter() {
    const z = $('#selZone');
    const dsm = state.filters.dsm;
    const zones = dsm === 'all' ? Store.zoneList : Store.zoneList.filter(zn => Store.zoneDsm[zn] === dsm);
    z.innerHTML = '<option value="all">All Zones</option>' + zones.map(x => '<option value="' + esc(x) + '">' + esc(x) + '</option>').join('');
  }
  function refreshSrFilter() {
    const s = $('#selSr');
    const { dsm, zone } = state.filters;
    let srs = Store.srList;
    if (dsm !== 'all') srs = srs.filter(sr => Store.srZone[sr] && (Store.zoneDsm[Store.srZone[sr]] === dsm));
    if (zone !== 'all') srs = srs.filter(sr => Store.srZone[sr] === zone);
    s.innerHTML = '<option value="all">All SRs</option>' + srs.map(x => '<option value="' + esc(x) + '">' + esc(x) + '</option>').join('');
  }

  function updateFilterSummary() {
    const f = state.filters;
    const parts = [];
    parts.push(f.dsm === 'all' ? 'All DSMs' : f.dsm);
    parts.push(f.zone === 'all' ? 'All Zones' : f.zone);
    parts.push(f.sr === 'all' ? 'All SRs' : f.sr);
    parts.push(f.month === 'all' ? 'YTD' : M[Number(f.month)] + ' 2026');
    $('#filterSummary').textContent = parts.join(' · ');
  }

  function cycleSteps() {
    const steps = ['Source', 'Validate', 'Model', 'Performance', 'Gap', 'Signal', 'Research', 'Impact', 'Action', 'Monitor'];
    $('#cycleSteps').innerHTML = steps.map(s => '<span class="cycle-step">' + s + '</span>').join('');
  }

  function init() {
    populateFilters();
    cycleSteps();
    updateFilterSummary();

    // dynamic header period / last-updated from live data
    if (AEL_DATA.meta) {
      const m0 = M[Store.rows.length ? Store.rows.reduce((x, r) => Math.min(x, r.mi), 11) : 0];
      const m1 = M[Store.maxMonth];
      $('#periodValue').textContent = m0 + ' – ' + m1 + ' 2026';
      $('#updatedValue').textContent = AEL_DATA.meta.lastSync || 'Live';
    }

    $$('.nav-item').forEach(n => n.addEventListener('click', () => { renderView(n.getAttribute('data-view')); if (window.innerWidth <= 900) $('#sidebar').classList.remove('open'); }));

    $('#selMonth').addEventListener('change', e => { state.filters.month = e.target.value; renderView(state.view); updateFilterSummary(); });
    $('#selScope').addEventListener('change', e => { state.filters.scope = e.target.value; renderView(state.view); });
    $('#selDsm').addEventListener('change', e => { state.filters.dsm = e.target.value; state.filters.zone = 'all'; state.filters.sr = 'all'; refreshZoneFilter(); refreshSrFilter(); $('#selZone').value = 'all'; $('#selSr').value = 'all'; renderView(state.view); updateFilterSummary(); });
    $('#selZone').addEventListener('change', e => { state.filters.zone = e.target.value; state.filters.sr = 'all'; refreshSrFilter(); $('#selSr').value = 'all'; renderView(state.view); updateFilterSummary(); });
    $('#selSr').addEventListener('change', e => { state.filters.sr = e.target.value; renderView(state.view); updateFilterSummary(); });
    $('#resetFilters').addEventListener('click', () => { state.filters = { month: 'all', scope: 'ytd', dsm: 'all', zone: 'all', sr: 'all' }; $('#selMonth').value = 'all'; $('#selScope').value = 'ytd'; $('#selDsm').value = 'all'; $('#selZone').value = 'all'; $('#selSr').value = 'all'; refreshZoneFilter(); refreshSrFilter(); updateFilterSummary(); renderView(state.view); });

    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerOverlay').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); closeSearch(); } });

    $('#themeToggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', cur);
      renderView(state.view);
    });
    $('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#refreshBtn').addEventListener('click', () => { renderView(state.view); toast('Dashboard refreshed'); });

    $('#notifBtn').addEventListener('click', e => { e.stopPropagation(); $('#notifPanel').classList.toggle('open'); });
    document.addEventListener('click', e => { if (!e.target.closest('.notification-wrap')) $('#notifPanel').classList.remove('open'); });

    $('#searchBtn').addEventListener('click', openSearch);
    $('#searchClose').addEventListener('click', closeSearch);
    $('#searchOverlay').addEventListener('click', e => { if (e.target === $('#searchOverlay')) closeSearch(); });
    $('#searchInput').addEventListener('input', e => runSearch(e.target.value));
    $('#searchResults').addEventListener('click', e => {
      const item = e.target.closest('.sr-item');
      if (item && $('#searchResults')._hits) { const h = $('#searchResults')._hits[Number(item.getAttribute('data-search-idx'))]; if (h) { closeSearch(); h.action(); } }
    });

    window.App = { exportTable };

    renderView('overview');
  }

  function openSearch() { $('#searchOverlay').classList.add('open'); setTimeout(() => $('#searchInput').focus(), 50); }
  function closeSearch() { $('#searchOverlay').classList.remove('open'); $('#searchInput').value = ''; $('#searchResults').innerHTML = ''; }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
