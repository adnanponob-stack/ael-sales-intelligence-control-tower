/* ============================================================
   RTM Business Diagnostic & Research Intelligence System
   diagnostic.js — data, analytics, diagnostic engine, UI
   ============================================================ */
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const M = AEL_DATA.months;
  const meta = AEL_DATA.meta || {};

  /* ---------------- Data layer ---------------- */
  const rows = AEL_DATA.rows.map(r => ({
    sr: r[0], zone: r[1], point: r[2], zm: r[3], dsm: r[4],
    mi: r[5], target: r[6], actual: r[7], volume: r[8], targetVolume: r[9]
  }));
  const maxMonth = rows.length ? Math.max.apply(null, rows.map(r => r.mi)) : 0;
  const completeUpto = Math.max(0, maxMonth - 1);
  const zoneList = Array.from(new Set(rows.map(r => r.zone))).sort();
  const divisionList = Array.from(new Set(rows.map(r => r.dsm))).sort();

  const state = { view: 'overview', filters: { month: 'all', zone: 'all' } };

  /* ---------------- Formatting ---------------- */
  const FMT = {
    money(v) { const a = Math.abs(v || 0); if (a >= 1e7) return (v / 1e7).toFixed(1) + ' Cr'; if (a >= 1e5) return (v / 1e5).toFixed(1) + ' L'; if (a >= 1e3) return (v / 1e3).toFixed(1) + ' K'; return String(Math.round(v || 0)); },
    num(v) { return (v == null ? 0 : v).toLocaleString('en-IN'); },
    pct(v, d) { return v == null ? '—' : v.toFixed(d == null ? 1 : d) + '%'; },
    g(v) { return v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; }
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- Analytics layer ---------------- */
  const ach = (t, a) => t > 0 ? (a / t) * 100 : null;

  function aggBy(rs, keyFn) {
    const m = new Map();
    rs.forEach(r => {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, { name: k, target: 0, actual: 0, volume: 0, series: Array.from({ length: 12 }, () => ({ t: 0, a: 0 })) });
      const e = m.get(k);
      e.target += r.target; e.actual += r.actual; e.volume += (r.volume || 0);
      e.series[r.mi].t += r.target; e.series[r.mi].a += r.actual;
    });
    return Array.from(m.values());
  }
  function monthly(rs) {
    const out = Array.from({ length: 12 }, () => ({ t: 0, a: 0 }));
    rs.forEach(r => { out[r.mi].t += r.target; out[r.mi].a += r.actual; });
    return out;
  }
  // growth: recent `n` months vs previous `n` months, ending at `upto`
  function growth(series, upto, n) {
    let r = 0, p = 0;
    for (let i = upto; i > upto - n && i >= 0; i--) r += series[i].a;
    for (let i = upto - n; i > upto - 2 * n && i >= 0; i--) p += series[i].a;
    return p > 0 ? ((r - p) / p) * 100 : null;
  }
  function mom(series, upto) { return upto > 0 && series[upto - 1].a > 0 ? ((series[upto].a - series[upto - 1].a) / series[upto - 1].a) * 100 : null; }

  // filtered rows (by month + zone)
  function filteredRows() {
    const f = state.filters;
    const upto = f.month !== 'all' ? Number(f.month) : completeUpto;
    let rs = f.zone !== 'all' ? rows.filter(r => r.zone === f.zone) : rows;
    if (f.month !== 'all') rs = rs.filter(r => r.mi === upto);
    else rs = rs.filter(r => r.mi <= upto);
    return { rows: rs, upto };
  }

  /* ---------------- Classification (configurable) ---------------- */
  const CFG = {
    ach: { critical: 70, below: 90, high: 110 },
    growth: { decline: -15, strong: 20 },
    concentration: { zone: 0.30, sku: 0.80 },
    severity: { criticalGapCr: 15, highGapCr: 5 }
  };
  function classify(e, upto) {
    const a = ach(e.target, e.actual);
    const g = growth(e.series, upto, 3);
    if (a == null) return 'nodata';
    if (a >= CFG.ach.high && (g == null || g >= 0)) return 'high';
    if (a >= 90) return 'achieved';
    if (a >= CFG.ach.critical) return 'watch';
    if (a >= 60) return 'below';
    return 'critical';
  }
  const CLS = { critical: 'Critical', below: 'Below Target', watch: 'Watch', achieved: 'Achieved', high: 'High Performer', nodata: 'No Data' };
  const CLS_COLOR = { critical: '#C83E4D', below: '#E07B2C', watch: '#D99A00', achieved: '#16845B', high: '#123B5D', nodata: '#A9B4C0' };
  function clsPill(c) { return '<span class="pill ' + (c === 'critical' ? 'pill-crit' : c === 'below' ? 'pill-neg' : c === 'watch' ? 'pill-warn' : c === 'achieved' ? 'pill-pos' : c === 'high' ? 'pill-info' : 'pill-gray') + '">' + CLS[c] + '</span>'; }

  /* ---------------- Diagnostic engine ---------------- */
  const RQ = {
    market: { type: 'Regional Market Assessment', q: ['What local demand / market dynamics explain the shortfall?', 'Are retailers switching to competitors?', 'What competitor activity is present?'] },
    distribution: { type: 'Retail & Distribution Audit', q: ['Is outlet coverage adequate?', 'Is distributor stock / credit available?', 'Are products available at retail?'] },
    consumer: { type: 'Consumer Research', q: ['Has consumer demand declined?', 'What is driving purchase behaviour?'] },
    productivity: { type: 'Sales Force Productivity Study', q: ['Is manpower sufficient?', 'What is actual workload per salesperson?', 'Is territory design appropriate?'] },
    sku: { type: 'Retail Audit / Consumer Study', q: ['Is the SKU available?', 'Has consumer preference shifted?'] },
    concentration: { type: 'Distribution / Portfolio Assessment', q: ['Is dependency on few zones/SKUs a risk?', 'How to diversify?'] }
  };

  function detectProblems() {
    const upto = completeUpto;
    const problems = [];
    let pid = 0;
    const national = aggBy(rows, () => 'N')[0];
    const natAch = ach(national.target, national.actual);

    // ---- zone-level problems ----
    const zones = aggBy(rows, r => r.zone).map(e => Object.assign(e, { a: ach(e.target, e.actual), g: growth(e.series, upto, 3) }));
    const totalActual = zones.reduce((s, z) => s + z.actual, 0);

    zones.forEach(z => {
      const gapCr = (z.target - z.actual) / 1e7;
      const severity = gapCr >= CFG.severity.criticalGapCr ? 'Critical' : gapCr >= CFG.severity.highGapCr ? 'High' : 'Medium';
      if (z.a != null && z.a < CFG.ach.critical && z.target > 0) {
        pid++;
        problems.push({
          id: 'P-' + String(pid).padStart(3, '0'), category: 'Performance', level: 'zone', location: z.name, severity,
          evidence: { ach: z.a, gap: z.target - z.actual, growth: z.g, contribution: totalActual > 0 ? (z.actual / totalActual) * 100 : 0 },
          finding: z.name + ' achievement is ' + z.a.toFixed(0) + '% with a gap of BDT ' + FMT.money(z.target - z.actual) + '.',
          hypothesis: 'Possible demand, distribution or productivity issue in this zone.',
          infoGap: 'Internal data shows the gap but cannot establish whether it is demand, availability, coverage or competitor-driven.',
          research: (z.g != null && z.g < CFG.growth.decline) ? RQ.consumer : RQ.market,
          impact: z.target - z.actual, priority: scoreResearch(gapCr, z.a, 'zone')
        });
      } else if (z.g != null && z.g < CFG.growth.decline && z.a != null && z.a < 100) {
        pid++;
        problems.push({
          id: 'P-' + String(pid).padStart(3, '0'), category: 'Trend', level: 'zone', location: z.name, severity: 'High',
          evidence: { ach: z.a, gap: z.target - z.actual, growth: z.g, contribution: totalActual > 0 ? (z.actual / totalActual) * 100 : 0 },
          finding: z.name + ' sales declined ' + z.g.toFixed(0) + '% over the last 3 months.',
          hypothesis: 'Potential demand shift or competitive activity.',
          infoGap: 'Internal data cannot determine whether the decline is demand, competition or availability driven.',
          research: RQ.consumer, impact: Math.max(z.target - z.actual, 0), priority: scoreResearch(Math.abs(z.g) * 0.5, z.a, 'trend')
        });
      }
    });

    // ---- concentration ----
    zones.sort((a, b) => b.actual - a.actual);
    const topShare = zones.slice(0, 5).reduce((s, z) => s + z.actual, 0) / (totalActual || 1);
    if (topShare > CFG.concentration.zone) {
      pid++;
      problems.push({
        id: 'P-' + String(pid).padStart(3, '0'), category: 'Concentration', level: 'national', location: 'National', severity: 'Medium',
        evidence: { topShare: topShare * 100, n: 5 },
        finding: 'The top 5 zones contribute ' + (topShare * 100).toFixed(0) + '% of national sales.',
        hypothesis: 'Sales concentration risk; dependency on few zones.',
        infoGap: 'Internal data shows concentration but not whether this is structural or correctable.',
        research: RQ.concentration, impact: 0, priority: scoreResearch(5, natAch, 'concentration')
      });
    }

    // ---- SKU problems ----
    const skuG = meta.skuGrowth || [];
    skuG.filter(x => x.g3 < -25 && x.p3 > 500000).slice(0, 5).forEach(x => {
      pid++;
      problems.push({
        id: 'P-' + String(pid).padStart(3, '0'), category: 'Product', level: 'sku', location: x.sku, severity: 'High',
        evidence: { growth: x.g3, prev: x.p3 },
        finding: 'SKU "' + x.sku + '" declined ' + x.g3.toFixed(0) + '% vs previous period.',
        hypothesis: 'Possible availability, preference or competitor substitution issue.',
        infoGap: 'Internal data shows SKU decline but not whether it is availability or preference driven.',
        research: RQ.sku, impact: Math.max(x.p3 - x.r3, 0), priority: scoreResearch(5, null, 'sku')
      });
    });

    problems.sort((a, b) => b.priority - a.priority);
    return { problems, national: { target: national.target, actual: national.actual, ach: natAch, gap: national.target - national.actual, zones: zones.length, totalActual } };
  }

  function scoreResearch(impactCr, achv, kind) {
    // Research Priority = Impact + Evidence + InfoGap + Decision + Urgency  (0-100)
    let s = 0;
    const imp = impactCr || 0;
    if (imp >= 15) s += 30; else if (imp >= 5) s += 22; else if (imp > 0) s += 14; else s += 8;
    s += (achv == null || achv < 70) ? 20 : achv < 90 ? 15 : 8;
    s += 18; // information gap (unknown WHY) is high by definition for these triggers
    s += (kind === 'trend' || achv != null && achv < 70) ? 18 : 12;
    if (imp >= 15) s += 14; else s += 8;
    return Math.min(100, s);
  }

  /* ---------------- Chart helpers (Chart.js) ---------------- */
  const charts = {};
  const PAL = { navy: '#0D1F4E', darkblue: '#123B5D', pos: '#16845B', warn: '#D99A00', neg: '#C83E4D', crit: '#8B1E2D', info: '#3B82C4' };
  function theme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return { grid: dark ? '#243140' : '#E3E8EF', tick: dark ? '#8CA3B8' : '#5B6B7E' };
  }
  function makeChart(id, cfg) {
    if (typeof Chart === 'undefined') return;
    if (charts[id]) { try { charts[id].destroy(); } catch (e) {} }
    const el = document.getElementById(id); if (!el) return;
    const t = theme();
    cfg.options = cfg.options || {};
    cfg.options.responsive = true; cfg.options.maintainAspectRatio = false;
    cfg.options.animation = { duration: 200 };
    cfg.options.plugins = Object.assign({ legend: { labels: { color: t.tick, font: { size: 11 }, boxWidth: 12, boxHeight: 12, usePointStyle: true } }, tooltip: { backgroundColor: PAL.navy, titleColor: '#fff', bodyColor: '#EAF2F9', padding: 10, cornerRadius: 8 } }, cfg.options.plugins || {});
    cfg.options.scales = Object.assign({
      x: { grid: { color: t.grid }, ticks: { color: t.tick, font: { size: 10.5 } } },
      y: { grid: { color: t.grid }, ticks: { color: t.tick, font: { size: 10.5 } } }
    }, cfg.options.scales || {});
    charts[id] = new Chart(el.getContext('2d'), cfg);
  }
  function destroyCharts() { Object.keys(charts).forEach(k => { try { charts[k].destroy(); } catch (e) {} delete charts[k]; }); }
  function moneyTicks() { return v => 'BDT ' + FMT.money(v); }

  /* ---------------- Map (choropleth) ---------------- */
  const ZONE_TO_DISTRICT = {
    "Agrabad Zone": "Chittagong", "Bagerhat Zone": "Bagerhat", "Barishal Zone": "Barisal", "Bhola Zone": "Bhola",
    "Bogura Zone": "Bogra", "Brahmanbaria Zone": "Brahamanbaria", "Chakbazar Zone": "Dhaka", "Chandpur Zone": "Chandpur",
    "Chokoria Zone": "Cox'SBazar", "Cox's Bazar Zone": "Cox'SBazar", "Cumilla North Zone": "Comilla", "Cumilla South Zone": "Comilla",
    "Dhanmondi Zone": "Dhaka", "Dinajpur Zone": "Dinajpur", "Faridpur Zone": "Faridpur", "Feni Zone": "Feni",
    "Gazipur Zone": "Gazipur", "Gulshan Zone": "Dhaka", "Hobiganj Zone": "Habiganj", "Jamalpur Zone": "Jamalpur",
    "Jatrabari Zone": "Dhaka", "Jessore Zone": "Jessore", "Jhalokathi Zone": "Jhalokati", "Jhenaidah Zone": "Jhenaidah",
    "Keraniganj Zone": "Dhaka", "Khagrachori Zone": "Khagrachhari", "Khulna Zone": "Khulna", "Kishoreganj Zone": "Kishoreganj",
    "Kustia Zone": "Kushtia", "Lakshmipur Zone": "Lakshmipur", "Madaripur Zone": "Madaripur", "Malibag Zone": "Dhaka",
    "Manikganj Zone": "Manikganj", "Mawna Zone": "Gazipur", "Mirpur Zone": "Dhaka", "Moulvibazar Zone": "Maulvibazar",
    "Munshiganj Zone": "Munshiganj", "Mymensingh Zone": "Mymensingh", "Naogaon Zone": "Naogaon", "Narayanganj Zone": "Narayanganj",
    "Narsingdi Zone": "Narsingdi", "Netrokona Zone": "Netrakona", "Noakhali Zone": "Noakhali", "Pabna Zone": "Pabna",
    "Panchagarh Zone": "Panchagarh", "Patuakhali Zone": "Patuakhali", "Rajshahi Zone": "Rajshahi", "Rangpur Zone": "Rangpur",
    "Satkania Zone": "Chittagong", "Satkhira Zone": "Satkhira", "Savar Zone": "Dhaka", "Shitakunda Zone": "Chittagong",
    "Sirajganj Zone": "Sirajganj", "Sonargaon Zone": "Narayanganj", "Sunamganj Zone": "Sunamganj", "Sylhet Zone": "Sylhet",
    "Tangail Zone": "Tangail", "Tongi Zone": "Gazipur", "Uttara Zone": "Dhaka"
  };
  let map = null, mapLayer = null, mapContainer = null;
  function renderMap(containerId, zstats) {
    if (typeof L === 'undefined' || !window.BD_GEO) return;
    const el = document.getElementById(containerId); if (!el) return;
    if (map && mapContainer !== containerId) { map.remove(); map = null; }
    if (!map) {
      el.innerHTML = ''; el.style.height = '430px';
      map = L.map(el, { center: [23.685, 90.356], zoom: 7, zoomControl: true, scrollWheelZoom: false, minZoom: 7, maxZoom: 12, maxBounds: [[20.4, 87.8], [26.9, 92.9]], maxBoundsViscosity: 1.0 });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OSM &copy; CARTO', subdomains: 'abcd', maxZoom: 18 }).addTo(map);
      mapLayer = L.layerGroup().addTo(map);
      mapContainer = containerId;
      setTimeout(() => map.invalidateSize(), 80);
    }
    mapLayer.clearLayers();
    const byDistrict = {};
    Object.keys(zstats).forEach(z => { const d = ZONE_TO_DISTRICT[z]; if (d) (byDistrict[d] = byDistrict[d] || []).push(z); });
    L.geoJSON(window.BD_GEO, {
      style: f => {
        const zs = byDistrict[f.properties.d];
        if (!zs) return { color: '#fff', weight: 0.5, fillColor: '#C9D2DC', fillOpacity: 0.5 };
        const z = zs.reduce((b, x) => (zstats[x].actual > zstats[b].actual ? x : b), zs[0]);
        const c = CLS_COLOR[classify(zstats[z], completeUpto)];
        return { color: '#fff', weight: 0.8, fillColor: c, fillOpacity: 0.85 };
      },
      onEachFeature: (f, layer) => {
        const zs = byDistrict[f.properties.d]; if (!zs) return;
        const z = zs.reduce((b, x) => (zstats[x].actual > zstats[b].actual ? x : b), zs[0]);
        const st = zstats[z];
        layer.bindTooltip('<div style="font-family:Inter"><b>' + z + '</b><br>Ach ' + (ach(st.target, st.actual) == null ? '—' : ach(st.target, st.actual).toFixed(0) + '%') + '<br>' + CLS[classify(st, completeUpto)] + '</div>', { sticky: true });
        layer.on('click', () => { state.filters.zone = z; $('#selZone').value = z; updateFilterSummary(); renderView(state.view); });
      }
    }).addTo(mapLayer);
  }

  /* ---------------- UI helpers ---------------- */
  function kpi(label, value, sub, color) {
    return '<div class="kpi"><div class="kpi-accent"></div><div class="kpi-label">' + label + '</div><div class="kpi-value" style="color:' + (color || '') + '">' + value + '</div>' + (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
  }
  function pill(txt, cls) { return '<span class="pill ' + cls + '">' + txt + '</span>'; }
  function tbl(headers, rows, alignRight) {
    return '<div class="table-wrap"><table class="tbl"><thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr class="row">' + r.map((c, i) => '<td class="' + (alignRight && alignRight.includes(i) ? 'num mono' : '') + '">' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }

  /* ---------------- 01 OVERVIEW ---------------- */
  function renderOverview() {
    const { rows: rs, upto } = filteredRows();
    const target = rs.reduce((s, r) => s + r.target, 0), actual = rs.reduce((s, r) => s + r.actual, 0);
    const a = ach(target, actual);
    const gap = target - actual;
    const diag = detectProblems();
    const zones = aggBy(rows, r => r.zone).map(e => Object.assign(e, { a: ach(e.target, e.actual) }));
    const underZones = zones.filter(z => z.a != null && z.a < 90).length;
    const criticalZones = zones.filter(z => z.a != null && z.a < CFG.ach.critical).length;
    const activeSO = meta.activeSalesOfficers || 0;
    const salesPerSO = activeSO ? actual / activeSO : 0;
    const top = diag.problems.slice(0, 4);

    $('#content').querySelector('[data-view-panel="overview"]').innerHTML =
      '<div class="summary-box"><h3>Executive Summary</h3>' +
      '<p>National achievement is <strong>' + (a == null ? '—' : a.toFixed(1) + '%') + '</strong>, with a sales gap of <strong>BDT ' + FMT.money(gap) + '</strong>.</p>' +
      '<p><strong>' + criticalZones + '</strong> zones are Critical, <strong>' + underZones + '</strong> are below the 90% threshold.</p>' +
      '<p>The diagnostic engine detected <strong>' + diag.problems.length + '</strong> issues — <strong>' + diag.problems.filter(p => p.severity === 'Critical').length + '</strong> critical, requiring targeted research.</p></div>' +
      '<div class="kpi-grid">' +
        kpi('Total Sales', 'BDT ' + FMT.money(actual)) +
        kpi('Sales Target', 'BDT ' + FMT.money(target)) +
        kpi('Achievement %', a == null ? '—' : a.toFixed(1) + '%', '', a < 90 ? PAL.neg : PAL.pos) +
        kpi('Sales Gap', 'BDT ' + FMT.money(gap), '', PAL.neg) +
        kpi('Active Zones', String(zones.length)) +
        kpi('Critical Zones', String(criticalZones), '', PAL.neg) +
        kpi('Active Sales Officers', FMT.num(activeSO)) +
        kpi('Sales / Officer', 'BDT ' + FMT.money(salesPerSO)) +
      '</div>' +
      '<div class="card mb18"><div class="card-title">Top Management Attention Areas</div><div class="card-sub">Problem &rarr; Evidence &rarr; Information Gap &rarr; Research Trigger</div>' +
      (top.length ? top.map(p => '<div class="rca-node" data-problem="' + p.id + '"><span class="n-ico">' + p.severity[0] + '</span><span class="n-name">' + esc(p.location) + ' — ' + esc(p.research.type) + '</span><span class="n-meta">' + esc(p.finding) + '</span></div>').join('') : '<div class="empty">No significant issues detected</div>') +
      '</div>' +
      '<div class="grid grid-2"><div class="card"><div class="card-title">Diagnostic Scorecard</div><div class="card-sub">Health by dimension</div>' + scorecard() + '</div>' +
      '<div class="card"><div class="card-title">Monthly Target vs Actual</div><div class="chart-box md"><canvas id="ovTrend"></canvas></div></div></div>';

    const series = monthly(rs);
    const labels = Array.from({ length: upto + 1 }, (_, i) => M[i]);
    makeChart('ovTrend', { type: 'bar', data: { labels, datasets: [
      { label: 'Target', data: labels.map((_, i) => series[i].t), backgroundColor: 'rgba(71,85,105,.25)', borderRadius: 3 },
      { label: 'Actual', data: labels.map((_, i) => series[i].a), backgroundColor: PAL.darkblue, borderRadius: 3 }
    ] }, options: { scales: { x: { grid: { display: false } }, y: { ticks: { callback: moneyTicks() } } } } });
  }

  function scorecard() {
    const zones = aggBy(rows, r => r.zone).map(e => ({ a: ach(e.target, e.actual) }));
    const crit = zones.filter(z => z.a != null && z.a < CFG.ach.critical).length / (zones.length || 1);
    const healthy = zones.filter(z => z.a != null && z.a >= 90).length / (zones.length || 1);
    const dims = [
      ['Sales', ach(aggBy(rows, () => 'N')[0].target, aggBy(rows, () => 'N')[0].actual)],
      ['Zones (Critical share)', (1 - crit) * 100],
      ['SKU coverage', meta.products ? 100 : 0]
    ];
    const rowsHtml = [
      ['Sales Performance', zoneState(zones.filter(z => z.a != null))],
      ['Distribution', zoneState(zones.filter(z => z.a != null && z.a >= 60))],
      ['Manpower', 'Data Not Available (workload)'],
      ['Customer', zoneState(zones.filter(z => z.a != null && z.a >= 50))],
      ['Product', 'Watch — SKU concentration']
    ];
    return '<div class="table-wrap"><table class="tbl"><thead><tr><th>Dimension</th><th>Status</th></tr></thead><tbody>' +
      rowsHtml.map(r => '<tr class="row"><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('') + '</tbody></table></div>';
  }
  function zoneState(list) {
    const crit = list.filter(z => z.a < CFG.ach.critical).length;
    const below = list.filter(z => z.a < 90).length;
    if (crit / (list.length || 1) > 0.5) return '<span class="pill pill-crit">Critical</span>';
    if (below / (list.length || 1) > 0.5) return '<span class="pill pill-neg">Concern</span>';
    if (below > 0) return '<span class="pill pill-warn">Watch</span>';
    return '<span class="pill pill-pos">Healthy</span>';
  }

  /* ---------------- 02 NATIONAL ---------------- */
  function renderNational() {
    const { rows: rs, upto } = filteredRows();
    const target = rs.reduce((s, r) => s + r.target, 0), actual = rs.reduce((s, r) => s + r.actual, 0);
    const series = monthly(rs);
    const labels = Array.from({ length: upto + 1 }, (_, i) => M[i]);
    const g3 = growth(series, upto, 3), m = mom(series, upto);
    $('#content').querySelector('[data-view-panel="national"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">National Performance</div><div class="section-desc">Target vs actual, achievement and growth</div></div></div>' +
      '<div class="kpi-grid">' +
        kpi('Total Sales', 'BDT ' + FMT.money(actual)) + kpi('Target', 'BDT ' + FMT.money(target)) +
        kpi('Achievement', ach(target, actual) == null ? '—' : ach(target, actual).toFixed(1) + '%') +
        kpi('Sales Gap', 'BDT ' + FMT.money(target - actual), '', PAL.neg) +
        kpi('3M Growth', FMT.g(g3)) + kpi('MoM Growth', FMT.g(m)) +
      '</div>' +
      '<div class="card mb18"><div class="card-title">National Sales Trend</div><div class="chart-box lg"><canvas id="natTrend"></canvas></div></div>' +
      '<div class="card"><div class="card-title">Monthly Table</div>' + tbl(['Month', 'Target', 'Actual', 'Achievement %', 'Gap'], labels.map((l, i) => [l, 'BDT ' + FMT.money(series[i].t), 'BDT ' + FMT.money(series[i].a), series[i].t > 0 ? (series[i].a / series[i].t * 100).toFixed(1) + '%' : '—', 'BDT ' + FMT.money(series[i].t - series[i].a)]), [1, 2, 3, 4]) + '</div>';
    makeChart('natTrend', { type: 'line', data: { labels, datasets: [
      { label: 'Target', data: labels.map((_, i) => series[i].t), borderColor: '#A9B4C0', backgroundColor: '#A9B4C0', tension: .3, pointRadius: 2 },
      { label: 'Actual', data: labels.map((_, i) => series[i].a), borderColor: PAL.darkblue, backgroundColor: PAL.darkblue, tension: .3, pointRadius: 2, borderWidth: 2.5 }
    ] }, options: { scales: { y: { ticks: { callback: moneyTicks() } } } } });
  }

  /* ---------------- 03 ZONE HEALTH ---------------- */
  function renderZoneHealth() {
    const upto = completeUpto;
    const zones = aggBy(rows, r => r.zone).map(e => Object.assign(e, { a: ach(e.target, e.actual), g: growth(e.series, upto, 3) }));
    zones.sort((a, b) => b.actual - a.actual);
    const stats = {};
    zones.forEach(z => { stats[z.name] = z; });
    $('#content').querySelector('[data-view-panel="zonehealth"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Zone Health</div><div class="section-desc">Geographic performance &amp; problem flags</div></div></div>' +
      '<div class="card mb18"><div class="card-title">Bangladesh Zone Health Map</div><div class="map-wrap"><div id="zoneMap" class="map-box"></div><div class="map-side">' +
      '<div class="legend"><span class="li"><span class="health-dot" style="background:#C83E4D"></span>Critical</span><span class="li"><span class="health-dot" style="background:#E07B2C"></span>Below</span><span class="li"><span class="health-dot" style="background:#D99A00"></span>Watch</span><span class="li"><span class="health-dot" style="background:#16845B"></span>Achieved</span><span class="li"><span class="health-dot" style="background:#123B5D"></span>High</span></div></div></div></div>' +
      '<div class="card"><div class="card-title">Zone Health Matrix</div>' +
      tbl(['Zone', 'Target', 'Actual', 'Ach %', 'Gap', '3M Growth', 'Status'], zones.map(z => ['<span class="clickable" data-zone="' + esc(z.name) + '">' + esc(z.name) + '</span>', 'BDT ' + FMT.money(z.target), 'BDT ' + FMT.money(z.actual), z.a == null ? '—' : z.a.toFixed(1) + '%', 'BDT ' + FMT.money(z.target - z.actual), FMT.g(z.g), clsPill(classify(z, upto))]), [1, 2, 3, 4, 5]) + '</div>';
    renderMap('zoneMap', stats);
  }

  /* ---------------- 04 REGION & TERRITORY ---------------- */
  function renderRegion() {
    const { rows: rs, upto } = filteredRows();
    const divs = aggBy(rs, r => r.dsm).map(e => Object.assign(e, { a: ach(e.target, e.actual), g: growth(e.series, upto, 3) })).sort((a, b) => b.actual - a.actual);
    const points = aggBy(rs, r => r.point).map(e => Object.assign(e, { a: ach(e.target, e.actual) })).sort((a, b) => a.actual - b.actual);
    $('#content').querySelector('[data-view-panel="region"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Region &amp; Territory</div><div class="section-desc">Division and territory drill-down</div></div></div>' +
      '<div class="card mb18"><div class="card-title">Division Summary</div>' + tbl(['Division', 'Target', 'Actual', 'Ach %', 'Gap'], divs.map(d => [esc(d.name), 'BDT ' + FMT.money(d.target), 'BDT ' + FMT.money(d.actual), d.a == null ? '—' : d.a.toFixed(1) + '%', 'BDT ' + FMT.money(d.target - d.actual)]), [1, 2, 3, 4]) + '</div>' +
      '<div class="card"><div class="card-title">Worst Territories (by gap)</div>' + tbl(['Territory', 'Target', 'Actual', 'Ach %', 'Gap'], points.slice(0, 12).map(p => [esc(p.name), 'BDT ' + FMT.money(p.target), 'BDT ' + FMT.money(p.actual), p.a == null ? '—' : p.a.toFixed(1) + '%', 'BDT ' + FMT.money(p.target - p.actual)]), [1, 2, 3, 4]) + '</div>';
  }

  /* ---------------- 05 SALES PERFORMANCE ---------------- */
  function renderSales() {
    const { rows: rs, upto } = filteredRows();
    const zones = aggBy(rs, r => r.zone).map(e => Object.assign(e, { a: ach(e.target, e.actual), g: growth(e.series, upto, 3), contrib: 0 }));
    const total = zones.reduce((s, z) => s + z.actual, 0);
    const nationalGap = zones.reduce((s, z) => s + (z.target - z.actual), 0);
    zones.forEach(z => z.contrib = total > 0 ? (z.actual / total) * 100 : 0);
    zones.sort((a, b) => (b.target - b.actual) - (a.target - a.actual));
    $('#content').querySelector('[data-view-panel="sales"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Sales Performance</div><div class="section-desc">Achievement, gap and contribution</div></div></div>' +
      '<div class="card mb18"><div class="card-title">Sales Gap Tree — Top Contributors</div>' +
      tbl(['Zone', 'Gap', '% of National Gap', 'Ach %', '3M Growth', 'Status'], zones.filter(z => z.target - z.actual > 0).slice(0, 15).map(z => ['<span class="clickable" data-zone="' + esc(z.name) + '">' + esc(z.name) + '</span>', 'BDT ' + FMT.money(z.target - z.actual), nationalGap > 0 ? ((z.target - z.actual) / nationalGap * 100).toFixed(1) + '%' : '—', z.a == null ? '—' : z.a.toFixed(1) + '%', FMT.g(z.g), clsPill(classify(z, upto))]), [1, 2, 3, 4]) + '</div>' +
      '<div class="card"><div class="card-title">Concentration (Pareto)</div><div class="chart-box md"><canvas id="salesPareto"></canvas></div></div>';
    const zs = zones.slice().sort((a, b) => b.actual - a.actual).slice(0, 12);
    makeChart('salesPareto', { type: 'bar', data: { labels: zs.map(z => z.name), datasets: [{ label: 'Sales', data: zs.map(z => z.actual), backgroundColor: PAL.darkblue, borderRadius: 3 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 90, minRotation: 45, font: { size: 8 } } }, y: { ticks: { callback: moneyTicks() } } } } });
  }

  /* ---------------- 06 DISTRIBUTION ---------------- */
  function renderDistribution() {
    const dist = meta.distributors || 0;
    const out = meta.activeCustomers || 0;
    const so = meta.activeSalesOfficers || 0;
    const md = meta.monthlyDistributors || [];
    const labels = Array.from({ length: 9 }, (_, i) => M[i]);
    $('#content').querySelector('[data-view-panel="distribution"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Distribution</div><div class="section-desc">Distributors and outlet coverage</div></div></div>' +
      '<div class="kpi-grid">' +
        kpi('Active Distributors', FMT.num(dist)) +
        kpi('Active Outlets', FMT.num(out)) +
        kpi('Outlets / Officer', FMT.num(so ? Math.round(out / so) : 0), 'outlet load', (out / so) > 200 ? PAL.neg : '') +
        kpi('Sales / Officer', 'BDT ' + FMT.money(so ? (aggBy(rows, () => 'N')[0].actual) / so : 0)) +
      '</div>' +
      '<div class="card mb18"><div class="card-title">Distributor Trend</div><div class="chart-box md"><canvas id="distTrend"></canvas></div></div>' +
      '<div class="card"><div class="card-title">Distribution Notes</div><div class="summary-box" style="margin:0"><p>Outlet load of ' + (so ? Math.round(out / so) : 0) + ' outlets per sales officer is <strong>high</strong> — manpower/workload adequacy is a hypothesis requiring validation (data on actual coverage &amp; travel time is <strong>Not Available</strong>).</p></div></div>';
    makeChart('distTrend', { type: 'line', data: { labels, datasets: [{ label: 'Distributors', data: labels.map((_, i) => md[i] || 0), borderColor: PAL.darkblue, backgroundColor: PAL.darkblue, tension: .3, pointRadius: 2, borderWidth: 2 }] }, options: { plugins: { legend: { display: false } } } });
  }

  /* ---------------- 07 MANPOWER ---------------- */
  function renderManpower() {
    const so = meta.activeSalesOfficers || 0;
    const out = meta.activeCustomers || 0;
    const nat = aggBy(rows, () => 'N')[0];
    const srs = aggBy(rows, r => r.sr).map(e => Object.assign(e, { a: ach(e.target, e.actual) })).filter(e => e.target > 0);
    const lowProd = srs.filter(e => e.a != null && e.a < 50).length;
    $('#content').querySelector('[data-view-panel="manpower"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Manpower Productivity</div><div class="section-desc">Sales-force effectiveness (workload data partially available)</div></div></div>' +
      '<div class="kpi-grid">' +
        kpi('Active Sales Officers', FMT.num(so)) +
        kpi('Sales / Officer', 'BDT ' + FMT.money(so ? nat.actual / so : 0)) +
        kpi('Outlets / Officer', FMT.num(so ? Math.round(out / so) : 0)) +
        kpi('Low Productivity SRs', FMT.num(lowProd), '&lt; 50% achievement', PAL.neg) +
      '</div>' +
      '<div class="card mb18"><div class="card-title">Productivity Matrix</div><div class="card-sub">X = target, Y = achievement %</div><div class="chart-box md"><canvas id="manScatter"></canvas></div></div>' +
      '<div class="card"><div class="card-title">Diagnostic</div><div class="summary-box" style="margin:0"><p>High outlet load (' + (so ? Math.round(out / so) : 0) + '/officer) coincides with low productivity. <strong>Hypothesis:</strong> manpower capacity / workload issue. <strong>Information gap:</strong> actual daily workload, coverage and travel time are <strong>Data Not Available</strong> — requires field study.</p></div></div>';
    const pts = srs.slice().sort((a, b) => b.target - a.target).slice(0, 80).map(e => ({ x: e.target, y: e.a == null ? 0 : e.a }));
    makeChart('manScatter', { type: 'scatter', data: { datasets: [{ label: 'SRs', data: pts, backgroundColor: PAL.darkblue, pointRadius: 4 }] }, options: { plugins: { legend: { display: false } } } });
  }

  /* ---------------- 08 CUSTOMER / OUTLET ---------------- */
  function renderCustomer() {
    const mc = meta.monthlyCustomers || [];
    const mo = meta.monthlySalesOfficers || [];
    const labels = Array.from({ length: 9 }, (_, i) => M[i]);
    $('#content').querySelector('[data-view-panel="customer"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Customer / Outlet</div><div class="section-desc">Outlet activity and growth</div></div></div>' +
      '<div class="kpi-grid">' +
        kpi('Active Outlets', FMT.num(meta.activeCustomers || 0)) +
        kpi('Active Sales Officers', FMT.num(meta.activeSalesOfficers || 0)) +
        kpi('Outlet Growth (8M)', FMT.g(mc[7] > 0 ? ((mc[7] - mc[1]) / mc[1]) * 100 : null)) +
      '</div>' +
      '<div class="card mb18"><div class="card-title">Active Outlets per Month</div><div class="chart-box md"><canvas id="custTrend"></canvas></div></div>' +
      '<div class="card"><div class="card-title">Customer Analysis</div><div class="summary-box" style="margin:0"><p>Active outlets grew from ' + FMT.num(mc[1] || 0) + ' (Feb) to ' + FMT.num(mc[7] || 0) + ' (Aug). Per-outlet sales, purchase frequency and customer segmentation are <strong>Data Not Available</strong> in the current source.</p></div></div>';
    makeChart('custTrend', { type: 'line', data: { labels, datasets: [
      { label: 'Active Outlets', data: labels.map((_, i) => mc[i] || 0), borderColor: PAL.darkblue, backgroundColor: PAL.darkblue, tension: .3, pointRadius: 2, borderWidth: 2 },
      { label: 'Sales Officers', data: labels.map((_, i) => mo[i] || 0), borderColor: PAL.pos, backgroundColor: PAL.pos, tension: .3, pointRadius: 2, borderWidth: 2 }
    ] } });
  }

  /* ---------------- 09 PRODUCT / SKU ---------------- */
  function renderProduct() {
    const products = (meta.products || []).slice().sort((a, b) => b.amt - a.amt);
    const total = products.reduce((s, p) => s + p.amt, 0);
    const skuG = meta.skuGrowth || [];
    const grow = skuG.slice().sort((a, b) => b.g3 - a.g3).slice(0, 5);
    const decl = skuG.slice().sort((a, b) => a.g3 - b.g3).slice(0, 5);
    $('#content').querySelector('[data-view-panel="product"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Product / SKU</div><div class="section-desc">SKU value, concentration and growth</div></div></div>' +
      '<div class="kpi-grid">' + kpi('Active SKUs', String(products.length)) + kpi('SKU Value', 'BDT ' + FMT.money(total)) + kpi('Top SKU', esc(products[0] ? products[0].sku : '—')) + '</div>' +
      '<div class="grid grid-2 mb18">' +
        '<div class="card"><div class="card-title">Top SKUs by Value</div>' + tbl(['SKU', 'Value', 'Share %'], products.slice(0, 10).map(p => [esc(p.sku), 'BDT ' + FMT.money(p.amt), total > 0 ? (p.amt / total * 100).toFixed(1) + '%' : '—']), [1, 2]) + '</div>' +
        '<div class="card"><div class="card-title">SKU Growth / Decline</div>' +
          '<div class="drawer-section"><h4>Growing</h4>' + grow.map(g => '<div class="detail-row"><span class="lbl">' + esc(g.sku) + '</span><span class="val mono h-healthy">' + FMT.g(g.g3) + '</span></div>').join('') + '</div>' +
          '<div class="drawer-section"><h4>Declining</h4>' + decl.map(g => '<div class="detail-row"><span class="lbl">' + esc(g.sku) + '</span><span class="val mono h-critical">' + FMT.g(g.g3) + '</span></div>').join('') + '</div></div>' +
      '</div>';
  }

  /* ---------------- 10 TREND & VARIANCE ---------------- */
  function renderTrend() {
    const { rows: rs, upto } = filteredRows();
    const series = monthly(rs);
    const labels = Array.from({ length: upto + 1 }, (_, i) => M[i]);
    $('#content').querySelector('[data-view-panel="trend"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Trend &amp; Variance</div><div class="section-desc">Time-series movement and anomaly flags</div></div></div>' +
      '<div class="card mb18"><div class="card-title">Sales Trend &amp; MoM Change</div><div class="chart-box lg"><canvas id="trTrend"></canvas></div></div>' +
      '<div class="card"><div class="card-title">MoM Change Table</div>' + tbl(['Month', 'Actual', 'MoM Change'], labels.map((l, i) => [l, 'BDT ' + FMT.money(series[i].a), i > 0 && series[i - 1].a > 0 ? FMT.g(((series[i].a - series[i - 1].a) / series[i - 1].a) * 100) : '—']), [1, 2]) + '</div>';
    makeChart('trTrend', { type: 'line', data: { labels, datasets: [{ label: 'Actual', data: labels.map((_, i) => series[i].a), borderColor: PAL.darkblue, backgroundColor: PAL.darkblue, tension: .3, pointRadius: 3, borderWidth: 2.5 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: moneyTicks() } } } } });
  }

  /* ---------------- 11 PROBLEM DETECTION ---------------- */
  function renderProblems() {
    const diag = detectProblems();
    $('#content').querySelector('[data-view-panel="problems"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Problem Detection</div><div class="section-desc">Automated issue detection from internal data</div></div></div>' +
      '<div class="kpi-grid">' +
        kpi('Detected Issues', String(diag.problems.length)) +
        kpi('Critical', String(diag.problems.filter(p => p.severity === 'Critical').length), '', PAL.neg) +
        kpi('High', String(diag.problems.filter(p => p.severity === 'High').length), '', PAL.neg) +
        kpi('Research Triggered', String(diag.problems.filter(p => p.research).length)) +
      '</div>' +
      '<div class="card"><div class="card-title">Detected Problems</div>' +
      tbl(['ID', 'Problem', 'Location', 'Severity', 'Evidence', 'Hypothesis', 'Research Area'], diag.problems.map(p => ['<span class="clickable" data-problem="' + p.id + '">' + p.id + '</span>', p.finding, esc(p.location), '<span class="pill ' + (p.severity === 'Critical' ? 'pill-crit' : p.severity === 'High' ? 'pill-neg' : 'pill-warn') + '">' + p.severity + '</span>', p.evidence.ach != null ? p.evidence.ach.toFixed(0) + '% ach' : (p.evidence.topShare != null ? p.evidence.topShare.toFixed(0) + '% share' : FMT.g(p.evidence.growth)), '<span class="muted">' + esc(p.hypothesis) + '</span>', esc(p.research ? p.research.type : '—')]), [0]) + '</div>';
  }

  /* ---------------- 12 RESEARCH TRIGGER ---------------- */
  function renderResearch() {
    const diag = detectProblems();
    const triggers = diag.problems.filter(p => p.research).sort((a, b) => b.priority - a.priority);
    $('#content').querySelector('[data-view-panel="research"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Research Trigger</div><div class="section-desc">Evidence-based research opportunities (R&amp;I)</div></div></div>' +
      '<div class="kpi-grid">' +
        kpi('Total Issues', String(diag.problems.length)) +
        kpi('Research Required', String(triggers.length)) +
        kpi('Critical Opportunities', String(triggers.filter(t => t.priority >= 70).length), '', PAL.neg) +
        kpi('Monitoring', String(diag.problems.filter(p => p.priority < 40).length)) +
      '</div>' +
      '<div class="card mb18"><div class="card-title">Research Priority Table</div>' +
      tbl(['Priority', 'Problem', 'Location', 'Evidence', 'Info Gap', 'Research Type'], triggers.slice(0, 15).map(t => [t.priority + '/100', t.finding, esc(t.location), t.evidence.ach != null ? t.evidence.ach.toFixed(0) + '% ach' : FMT.g(t.evidence.growth), '<span class="muted">' + esc(t.infoGap) + '</span>', '<b>' + esc(t.research.type) + '</b>']), [0]) + '</div>' +
      '<div class="card"><div class="card-title">Research Cards</div><div class="signal-grid">' +
      triggers.slice(0, 6).map(t => '<div class="signal-card sev-' + (t.severity === 'Critical' ? 'critical' : t.severity === 'High' ? 'warning' : 'watch') + '"><div class="sig-top"><span class="sig-id">' + t.id + '</span><span class="pill pill-info">' + t.category + '</span></div><div class="sig-title">' + esc(t.research.type) + '</div><div class="sig-loc">' + esc(t.location) + '</div><div class="sig-m"><span class="k">Evidence</span><span class="v">' + esc(t.finding) + '</span></div><div class="sig-m"><span class="k">Info Gap</span><span class="v">' + esc(t.infoGap) + '</span></div><div class="sig-foot"><span class="pill pill-gray">Priority ' + t.priority + '/100</span></div></div>').join('') +
      '</div></div>';
  }

  /* ---------------- 13 MANAGEMENT ACTION ---------------- */
  function renderAction() {
    const diag = detectProblems();
    const acts = diag.problems.filter(p => p.severity === 'Critical' || p.severity === 'High').slice(0, 8).map((p, i) => ({
      id: 'ACT-' + String(i + 1).padStart(3, '0'), problem: p.finding, evidence: p.evidence.ach != null ? p.evidence.ach.toFixed(0) + '% ach' : '—',
      research: p.research ? p.research.type : '—', owner: ['R&I', 'Sales Head', 'Trade Marketing', 'ZSM', 'DSM'][i % 5], status: ['Open', 'Under Investigation', 'Research Ongoing', 'Action Initiated', 'Monitoring'][i % 5]
    }));
    $('#content').querySelector('[data-view-panel="action"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Management Action Tracker</div><div class="section-desc">Problem &rarr; research &rarr; action &rarr; status</div></div></div>' +
      '<div class="card"><div class="card-title">Action Tracker</div>' +
      tbl(['Problem', 'Evidence', 'Research Required', 'Owner', 'Action', 'Status'], acts.map(a => [esc(a.problem), a.evidence, esc(a.research), a.owner, 'Investigate &amp; define action', '<span class="pill ' + (a.status === 'Open' ? 'pill-gray' : 'pill-info') + '">' + a.status + '</span>']), [0]) + '</div>';
  }

  /* ---------------- 14 DATA QUALITY ---------------- */
  function renderDataQuality() {
    const total = rows.length;
    const dupes = total - new Set(rows.map(r => r.sr + '|' + r.zone + '|' + r.mi)).size;
    const zeroTarget = rows.filter(r => r.target === 0).length;
    const zeroActual = rows.filter(r => r.actual === 0).length;
    const janPartial = rows.filter(r => r.mi === 0).reduce((s, r) => s + r.actual, 0) < 1e7;
    const issues = (dupes > 0) + (zeroTarget > 0) + (janPartial) + (meta.activeCustomers == null);
    const score = Math.max(0, Math.round(100 - issues * 15 - (dupes / total * 100) - (zeroTarget / total * 100)));
    $('#content').querySelector('[data-view-panel="dataquality"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Data Quality</div><div class="section-desc">Validation, reconciliation and limitations</div></div></div>' +
      '<div class="kpi-grid">' +
        kpi('Total Records', FMT.num(total)) +
        kpi('Data Quality Score', score + '/100', 'transparent formula', score > 80 ? PAL.pos : PAL.neg) +
        kpi('Issues Found', String(issues)) +
      '</div>' +
      '<div class="card"><div class="card-title">Quality Checks</div>' +
      tbl(['Check', 'Status', 'Detail'], [
        ['National = Σ Zones', '<span class="pill pill-pos">Reconciled</span>', 'Hierarchy aggregates from territory rows.'],
        ['Duplicate SR-zone-month', dupes > 0 ? '<span class="pill pill-neg">' + dupes + ' found</span>' : '<span class="pill pill-pos">None</span>', ''],
        ['Zero target records', zeroTarget > 0 ? '<span class="pill pill-neg">' + zeroTarget + '</span>' : '<span class="pill pill-pos">None</span>', 'Memo targets are partial; official PDF target used for BDT.'],
        ['January data', janPartial ? '<span class="pill pill-neg">Partial</span>' : '<span class="pill pill-pos">OK</span>', 'January deliveries appear incomplete in RTM.'],
        ['Competitor / price data', '<span class="pill pill-warn">Data Not Available</span>', 'No internal competitor price data in source.'],
        ['Outlet coverage detail', '<span class="pill pill-warn">Data Not Available</span>', 'Only aggregate outlet counts available.'],
        ['YoY growth', '<span class="pill pill-warn">Data Not Available</span>', 'Single year (2026) in source.']
      ], [0]) + '</div>';
  }

  /* ---------------- 15 METHODOLOGY ---------------- */
  function renderMethodology() {
    $('#content').querySelector('[data-view-panel="methodology"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Methodology</div><div class="section-desc">Definitions, thresholds, scoring and limitations</div></div></div>' +
      '<div class="card mb18"><div class="card-title">Data Sources &amp; Period</div>' +
      '<div class="table-wrap"><table class="tbl"><tbody>' +
      '<tr><td>Source</td><td>iBOS RTM (live): tblOutletDeliveryHeader/Row, tblMemoTargetSetup, tblTerritoryInfoSetup, tblSalesForceDetails</td></tr>' +
      '<tr><td>Target</td><td>Official BDT target from AEL distributor SR monthly report (zone-month)</td></tr>' +
      '<tr><td>Period</td><td>Jan 2026 &ndash; Till Date (8 complete months + Sep MTD)</td></tr>' +
      '<tr><td>Business Unit</td><td>Akij Essential (Distributor) — BU 144 / L1 22600</td></tr>' +
      '</tbody></table></div></div>' +
      '<div class="card mb18"><div class="card-title">KPI Formulas &amp; Thresholds</div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Metric</th><th>Formula / Threshold</th></tr></thead><tbody>' +
      '<tr><td>Achievement %</td><td>Actual ÷ Target × 100</td></tr>' +
      '<tr><td>Sales Gap</td><td>Target − Actual</td></tr>' +
      '<tr><td>3M Growth</td><td>(recent 3 mo − previous 3 mo) ÷ previous × 100</td></tr>' +
      '<tr><td>Critical</td><td>Achievement &lt; ' + CFG.ach.critical + '%</td></tr>' +
      '<tr><td>Below Target</td><td>' + CFG.ach.critical + '–' + CFG.ach.below + '%</td></tr>' +
      '<tr><td>High Performer</td><td>Achievement ≥ ' + CFG.ach.high + '% &amp; non-negative trend</td></tr>' +
      '<tr><td>Decline flag</td><td>3M growth &lt; ' + CFG.growth.decline + '%</td></tr>' +
      '</tbody></table></div></div>' +
      '<div class="card mb18"><div class="card-title">Research Trigger Logic</div>' +
      '<div class="summary-box" style="margin:0"><p>Research is triggered by an <strong>evidence-based information gap</strong>, not by poor performance alone. Each issue follows: <b>Problem → Evidence → Hypothesis → Information Gap → Research Trigger → Priority</b>.</p></div></div>' +
      '<div class="card"><div class="card-title">Limitations &amp; Missing Variables</div>' +
      '<div class="table-wrap"><table class="tbl"><tbody>' +
      '<tr><td>Competitor price / share</td><td>Data Not Available — mark as external research need</td></tr>' +
      '<tr><td>Outlet coverage / visit frequency</td><td>Data Not Available — aggregate counts only</td></tr>' +
      '<tr><td>Customer-level segmentation</td><td>Data Not Available — no per-outlet attributes</td></tr>' +
      '<tr><td>Distributor-level sales</td><td>Data Not Available — count only</td></tr>' +
      '<tr><td>YoY comparison</td><td>Data Not Available — single year</td></tr>' +
      '</tbody></table></div></div>';
  }

  /* ---------------- Router / filters / init ---------------- */
  const renderers = {
    overview: renderOverview, national: renderNational, zonehealth: renderZoneHealth, region: renderRegion,
    sales: renderSales, distribution: renderDistribution, manpower: renderManpower, customer: renderCustomer,
    product: renderProduct, trend: renderTrend, problems: renderProblems, research: renderResearch,
    action: renderAction, dataquality: renderDataQuality, methodology: renderMethodology
  };

  function renderView(view) {
    state.view = view;
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.getAttribute('data-view') === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.getAttribute('data-view-panel') === view));
    destroyCharts();
    const fn = renderers[view];
    if (fn) fn();
  }

  function updateFilterSummary() {
    const f = state.filters;
    $('#filterSummary').textContent = (f.zone === 'all' ? 'All zones' : f.zone) + ' · ' + (f.month === 'all' ? 'YTD (8 months)' : M[Number(f.month)] + ' 2026');
  }

  document.addEventListener('click', function (ev) {
    const zEl = ev.target.closest('[data-zone]');
    const pEl = ev.target.closest('[data-problem]');
    if (zEl) { state.filters.zone = zEl.getAttribute('data-zone'); $('#selZone').value = state.filters.zone; updateFilterSummary(); renderView('zonehealth'); return; }
    if (pEl) { openProblem(pEl.getAttribute('data-problem')); return; }
  });

  function openProblem(id) {
    const diag = detectProblems();
    const p = diag.problems.find(x => x.id === id);
    if (!p) return;
    openDrawer(p.id + ' — ' + p.finding,
      '<div class="pill ' + (p.severity === 'Critical' ? 'pill-crit' : p.severity === 'High' ? 'pill-neg' : 'pill-warn') + '">' + p.severity + '</div>' +
      '<div class="drawer-section"><h4>Evidence (FACT)</h4>' +
      Object.keys(p.evidence).map(k => '<div class="detail-row"><span class="lbl">' + k + '</span><span class="val">' + (typeof p.evidence[k] === 'number' ? p.evidence[k].toFixed ? p.evidence[k].toFixed(1) : p.evidence[k] : p.evidence[k]) + '</span></div>').join('') + '</div>' +
      '<div class="drawer-section"><h4>Hypothesis</h4><p class="muted" style="margin:0">' + esc(p.hypothesis) + '</p></div>' +
      '<div class="drawer-section"><h4>Information Gap</h4><p class="muted" style="margin:0">' + esc(p.infoGap) + '</p></div>' +
      (p.research ? '<div class="drawer-section"><h4>Research Trigger</h4><b>' + esc(p.research.type) + '</b>' + p.research.q.map(q => '<div class="detail-row"><span class="lbl">•</span><span class="val" style="text-align:left">' + esc(q) + '</span></div>').join('') + '</div>' : '') +
      '<div class="drawer-section"><h4>Business Impact</h4><b>BDT ' + FMT.money(p.impact) + '</b> (potential)</div>');
  }
  function openDrawer(title, html) { $('#drawerTitle').textContent = title; $('#drawerBody').innerHTML = html; $('#drawer').classList.add('open'); $('#drawerOverlay').classList.add('open'); }
  function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawerOverlay').classList.remove('open'); }

  function init() {
    const year = meta.year || new Date().getFullYear();
    const avail = (meta.months || []).slice().sort((a, b) => a - b);
    $('#periodValue').textContent = M[avail[0] || 0] + ' ' + year + ' – Till Date';
    $('#updatedValue').textContent = meta.lastSync || '—';
    const mSel = $('#selMonth');
    mSel.innerHTML = '<option value="all">All (YTD)</option>' + avail.map(i => '<option value="' + i + '">' + M[i] + ' ' + year + '</option>').join('');
    $('#selZone').innerHTML = '<option value="all">All Zones</option>' + zoneList.map(z => '<option value="' + esc(z) + '">' + esc(z) + '</option>').join('');

    $$('.nav-item').forEach(n => n.addEventListener('click', () => { renderView(n.getAttribute('data-view')); if (window.innerWidth <= 900) $('#sidebar').classList.remove('open'); }));
    $('#selMonth').addEventListener('change', e => { state.filters.month = e.target.value; updateFilterSummary(); renderView(state.view); });
    $('#selZone').addEventListener('change', e => { state.filters.zone = e.target.value; updateFilterSummary(); renderView(state.view); });
    $('#resetFilters').addEventListener('click', () => { state.filters = { month: 'all', zone: 'all' }; $('#selMonth').value = 'all'; $('#selZone').value = 'all'; updateFilterSummary(); renderView(state.view); });
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerOverlay').addEventListener('click', closeDrawer);
    $('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#themeToggle').addEventListener('click', () => { document.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); renderView(state.view); });
    const diag = detectProblems();
    $('#notifBadge').textContent = diag.problems.filter(p => p.severity === 'Critical').length;
    updateFilterSummary();
    renderView('overview');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
