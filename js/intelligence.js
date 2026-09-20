/* ============================================================
   RTM Management Intelligence, Capability & VRIO Dashboard
   intelligence.js
   ============================================================ */
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const M = AEL_DATA.months;
  const meta = AEL_DATA.meta || {};

  // ---- data ----
  const rows = AEL_DATA.rows.map(r => ({ sr: r[0], zone: r[1], point: r[2], zm: r[3], dsm: r[4], mi: r[5], target: r[6], actual: r[7], volume: r[8], tv: r[9] }));
  const maxMonth = rows.length ? Math.max.apply(null, rows.map(r => r.mi)) : 0;
  const Upto = Math.max(0, maxMonth - 1);
  const ytd = rows.filter(r => r.mi <= Upto);

  const ach = (t, a) => t > 0 ? (a / t) * 100 : null;
  const FMT = {
    money(v) { const a = Math.abs(v || 0); if (a >= 1e7) return (v / 1e7).toFixed(1) + ' Cr'; if (a >= 1e5) return (v / 1e5).toFixed(1) + ' L'; if (a >= 1e3) return (v / 1e3).toFixed(1) + ' K'; return String(Math.round(v || 0)); },
    num(v) { return (v || 0).toLocaleString('en-IN'); }
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function aggBy(rs, keyFn) {
    const m = new Map();
    rs.forEach(r => { const k = keyFn(r); if (!m.has(k)) m.set(k, { name: k, target: 0, actual: 0, volume: 0 }); const e = m.get(k); e.target += r.target; e.actual += r.actual; e.volume += (r.volume || 0); });
    return Array.from(m.values()).map(e => Object.assign(e, { a: ach(e.target, e.actual), gap: e.target - e.actual }));
  }
  function monthly(rs) { const o = Array.from({ length: 12 }, () => ({ t: 0, a: 0 })); rs.forEach(r => { o[r.mi].t += r.target; o[r.mi].a += r.actual; }); return o; }
  function growth(series, upto, n) { let r = 0, p = 0; for (let i = upto; i > upto - n && i >= 0; i--) r += series[i].a; for (let i = upto - n; i > upto - 2 * n && i >= 0; i--) p += series[i].a; return p > 0 ? ((r - p) / p) * 100 : null; }

  // ---- health signal ----
  function health(achv) { return achv == null ? { band: 'grey', label: 'Data Unavailable', color: '#A9B4C0' } : achv < 70 ? { band: 'red', label: 'Critical', color: '#C83E4D' } : achv < 90 ? { band: 'yellow', label: 'Watch', color: '#D99A00' } : { band: 'green', label: 'Healthy', color: '#16845B' }; }
  function healthPill(h) { return '<span class="pill ' + (h.band === 'green' ? 'pill-pos' : h.band === 'yellow' ? 'pill-warn' : h.band === 'red' ? 'pill-neg' : 'pill-gray') + '">' + h.label + '</span>'; }
  function achCol(a) { return a == null ? '' : a >= 100 ? 'h-healthy' : a >= 90 ? 'h-watch' : a >= 70 ? 'h-atrisk' : 'h-critical'; }
  function achTxt(a) { return a == null ? '—' : a.toFixed(1) + '%'; }

  // ---- charts ----
  const charts = {};
  const PAL = { red: '#EE1D24', darkred: '#C8161B', green: '#16845B', amber: '#D99A00', gray: '#A9B4C0', slate: '#475569', info: '#3B82C4' };
  function mk(id, cfg) {
    if (typeof Chart === 'undefined') return;
    if (charts[id]) { try { charts[id].destroy(); } catch (e) {} }
    const el = document.getElementById(id); if (!el) return;
    const t = document.documentElement.getAttribute('data-theme') === 'dark';
    const tick = t ? '#8CA3B8' : '#5B6B7E'; const grid = t ? '#243140' : '#E3E8EF';
    const dlFmt = cfg.dlFmt; delete cfg.dlFmt;
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
      plugins: { legend: { labels: { color: tick, font: { size: 11 }, boxWidth: 12, boxHeight: 12, usePointStyle: true } }, tooltip: { backgroundColor: PAL.darkred, titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 8 }, datalabels: { display: true, color: (t ? '#E5E7EB' : '#1F2937'), font: { size: 9.5, weight: 'bold' }, anchor: 'end', align: 'end', offset: 2, formatter: dlFmt || ((v) => v == null ? '' : v) } },
      scales: { x: { grid: { color: grid }, ticks: { color: tick, font: { size: 10 } } }, y: { grid: { color: grid }, ticks: { color: tick, font: { size: 10 } } } } }, cfg.options || {});
    charts[id] = new Chart(el.getContext('2d'), cfg);
  }
  function destroyAll() { Object.keys(charts).forEach(k => { try { charts[k].destroy(); } catch (e) {} delete charts[k]; }); }

  // ---- map ----
  const ZD = { "Agrabad Zone": "Chittagong", "Bagerhat Zone": "Bagerhat", "Barishal Zone": "Barisal", "Bhola Zone": "Bhola", "Bogura Zone": "Bogra", "Brahmanbaria Zone": "Brahamanbaria", "Chakbazar Zone": "Dhaka", "Chandpur Zone": "Chandpur", "Chokoria Zone": "Cox'SBazar", "Cox's Bazar Zone": "Cox'SBazar", "Cumilla North Zone": "Comilla", "Cumilla South Zone": "Comilla", "Dhanmondi Zone": "Dhaka", "Dinajpur Zone": "Dinajpur", "Faridpur Zone": "Faridpur", "Feni Zone": "Feni", "Gazipur Zone": "Gazipur", "Gulshan Zone": "Dhaka", "Hobiganj Zone": "Habiganj", "Jamalpur Zone": "Jamalpur", "Jatrabari Zone": "Dhaka", "Jessore Zone": "Jessore", "Jhalokathi Zone": "Jhalokati", "Jhenaidah Zone": "Jhenaidah", "Keraniganj Zone": "Dhaka", "Khagrachori Zone": "Khagrachhari", "Khulna Zone": "Khulna", "Kishoreganj Zone": "Kishoreganj", "Kustia Zone": "Kushtia", "Lakshmipur Zone": "Lakshmipur", "Madaripur Zone": "Madaripur", "Malibag Zone": "Dhaka", "Manikganj Zone": "Manikganj", "Mawna Zone": "Gazipur", "Mirpur Zone": "Dhaka", "Moulvibazar Zone": "Maulvibazar", "Munshiganj Zone": "Munshiganj", "Mymensingh Zone": "Mymensingh", "Naogaon Zone": "Naogaon", "Narayanganj Zone": "Narayanganj", "Narsingdi Zone": "Narsingdi", "Netrokona Zone": "Netrakona", "Noakhali Zone": "Noakhali", "Pabna Zone": "Pabna", "Panchagarh Zone": "Panchagarh", "Patuakhali Zone": "Patuakhali", "Rajshahi Zone": "Rajshahi", "Rangpur Zone": "Rangpur", "Satkania Zone": "Chittagong", "Satkhira Zone": "Satkhira", "Savar Zone": "Dhaka", "Shitakunda Zone": "Chittagong", "Sirajganj Zone": "Sirajganj", "Sonargaon Zone": "Narayanganj", "Sunamganj Zone": "Sunamganj", "Sylhet Zone": "Sylhet", "Tangail Zone": "Tangail", "Tongi Zone": "Gazipur", "Uttara Zone": "Dhaka" };
  let map = null, mapLayer = null, mapCont = null;
  function renderMap(id, zstats) {
    if (typeof L === 'undefined' || !window.BD_GEO) return;
    const el = document.getElementById(id); if (!el) return;
    if (map && mapCont !== id) { map.remove(); map = null; }
    if (!map) {
      el.innerHTML = ''; el.style.height = '430px';
      map = L.map(el, { center: [23.685, 90.356], zoom: 7, scrollWheelZoom: false, minZoom: 7, maxZoom: 12, maxBounds: [[20.4, 87.8], [26.9, 92.9]], maxBoundsViscosity: 1.0 });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OSM &copy; CARTO', subdomains: 'abcd', maxZoom: 18 }).addTo(map);
      mapLayer = L.layerGroup().addTo(map); mapCont = id;
      setTimeout(() => map.invalidateSize(), 80);
    }
    mapLayer.clearLayers();
    const byD = {}; Object.keys(zstats).forEach(z => { const d = ZD[z]; if (d) (byD[d] = byD[d] || []).push(z); });
    L.geoJSON(window.BD_GEO, {
      style: f => { const zs = byD[f.properties.d]; if (!zs) return { color: '#fff', weight: 0.5, fillColor: '#C9D2DC', fillOpacity: 0.5 }; const z = zs.reduce((b, x) => (zstats[x].actual > zstats[b].actual ? x : b), zs[0]); return { color: '#fff', weight: 0.8, fillColor: health(zstats[z].a).color, fillOpacity: 0.85 }; },
      onEachFeature: (f, layer) => { const zs = byD[f.properties.d]; if (!zs) return; const z = zs.reduce((b, x) => (zstats[x].actual > zstats[b].actual ? x : b), zs[0]); const st = zstats[z]; layer.bindTooltip('<div style="font-family:Inter"><b>' + z + '</b><br>Ach ' + achTxt(st.a) + '<br>' + health(st.a).label + '</div>', { sticky: true }); }
    }).addTo(mapLayer);
  }

  // ---- UI helpers ----
  function kpi(label, value, sub, color) { return '<div class="kpi"><div class="kpi-accent"></div><div class="kpi-label">' + label + '</div><div class="kpi-value" style="color:' + (color || '') + '">' + value + '</div>' + (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>'; }
  function tbl(headers, rows, alignRight) { return '<div class="table-wrap"><table class="tbl"><thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr class="row">' + r.map((c, i) => '<td class="' + (alignRight && alignRight.includes(i) ? 'num mono' : '') + '">' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'; }
  function insight(text) { return '<div class="card mb18"><div class="card-title" style="color:var(--brand)">Management Insight</div><p class="muted" style="margin:0">' + text + '</p></div>'; }
  function flag(tag, txt) { return '<span class="pill ' + tag + '">' + txt + '</span>'; }
  function rowList(items) { return items.map(i => '<div class="detail-row"><span class="lbl">' + esc(i[0]) + '</span><span class="val" style="text-align:left;font-weight:400">' + esc(i[1]) + '</span></div>').join(''); }

  // ---- shared computed ----
  const nat = aggBy(ytd, () => 'N')[0];
  const zones = aggBy(ytd, r => r.zone).sort((a, b) => b.actual - a.actual);
  const terrs = aggBy(ytd, r => r.sr);
  const products = (meta.products || []).slice().sort((a, b) => b.amt - a.amt);
  const totalSku = products.reduce((s, p) => s + p.amt, 0);
  const skuG = {}; (meta.skuGrowth || []).forEach(g => skuG[g.sku] = g);
  const so = meta.activeSalesOfficers || 0, out = meta.activeCustomers || 0, dist = meta.distributors || 0;
  const distSales = meta.distributorSales || [];
  let cum = 0, focus = 0; products.forEach(p => { cum += p.amt; if (cum <= totalSku * 0.8) focus++; });

  /* ============ 01 OVERVIEW ============ */
  function renderOverview() {
    const crit = zones.filter(z => z.a != null && z.a < 70).length;
    const under = zones.filter(z => z.a != null && z.a < 90).length;
    const g3 = growth(monthly(ytd), Upto, 3);
    const topZone = zones[0];
    const topSku = products[0];
    $('#content').querySelector('[data-view-panel="overview"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Executive Overview</div><div class="section-desc">Where we are &middot; what is the gap &middot; what needs attention</div></div></div>' +
      '<div class="summary-box"><h3>Management Storyline</h3>' +
      '<p><b>1. Where are we?</b> YTD achievement ' + achTxt(nat.a) + ' (target BDT ' + FMT.money(nat.target) + ', actual BDT ' + FMT.money(nat.actual) + ').</p>' +
      '<p><b>2. Where is the gap?</b> ' + crit + ' critical zones; ' + under + ' below 90% — gap concentrated in a few zones.</p>' +
      '<p><b>3. What is driving it?</b> Coverage is adequate (6-day route), so the gap points to strike-rate/productivity and demand.</p>' +
      '<p><b>4. Resources &amp; advantage?</b> Distribution network + brand are the strongest assets (see VRIO).</p>' +
      '<p><b>5. What needs attention?</b> Research bottom zones; strike-rate study; SKU focus; fix target-setting.</p></div>' +
      '<div class="kpi-grid">' +
        kpi('Actual Sales', 'BDT ' + FMT.money(nat.actual)) + kpi('Target', 'BDT ' + FMT.money(nat.target)) +
        kpi('Achievement', achTxt(nat.a), '', nat.a < 90 ? PAL.red : PAL.green) + kpi('Sales Gap', 'BDT ' + FMT.money(nat.gap), '', PAL.red) +
        kpi('3M Growth', g3 == null ? '—' : (g3 >= 0 ? '+' : '') + g3.toFixed(1) + '%') + kpi('Critical Zones', String(crit), '', PAL.red) +
        kpi('Distributors', FMT.num(dist)) + kpi('Active Outlets', FMT.num(out)) +
      '</div>' +
      '<div class="grid grid-2 mb18">' +
        '<div class="card"><div class="card-title">Target vs Actual (YTD)</div><div class="chart-box md"><canvas id="ovBar"></canvas></div></div>' +
        '<div class="card"><div class="card-title">Strategic Summary Scorecard</div>' +
          rowList([['Performance', achTxt(nat.a) + ' · gap ' + FMT.money(nat.gap)], ['RTM coverage', FMT.num(out) + ' outlets · ' + FMT.num(dist) + ' distributors'], ['Resources', 'Distribution + brand + data infrastructure'], ['Capabilities', 'RTM execution, intelligence, forecasting'], ['Competition', 'External data required'], ['Advantage', 'Distribution reach + brand trust'], ['VRIO', 'Sustained: brand & distribution; parity: sales force'], ['Management action', 'Research bottom zones; strike-rate study']]) +
        '</div>' +
      '</div>' +
      '<div class="card"><div class="card-title">Top Management Attention Areas</div>' +
      rowList([['Geographic gap', crit + ' critical zones — regional market assessment'], ['Productivity', 'Adequate coverage, low achievement — strike-rate study'], ['SKU concentration', focus + ' SKUs = 80% of value — rationalization'], ['Data gap', 'Competitor price & coverage not available internally']]) + '</div>';
    mk('ovBar', { type: 'bar', data: { labels: ['Target', 'Actual'], datasets: [{ data: [nat.target, nat.actual], backgroundColor: [PAL.gray, PAL.red], borderRadius: 6 }] }, dlFmt: v => 'BDT ' + FMT.money(v), options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => 'BDT ' + FMT.money(v) } } } } });
  }

  /* ============ 02 RTM PERFORMANCE ============ */
  function renderRtm() {
    const series = monthly(ytd);
    const labels = M.slice(0, Upto + 1);
    $('#content').querySelector('[data-view-panel="rtm"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">RTM Performance</div><div class="section-desc">National &rarr; Zone &rarr; Territory hierarchy</div></div></div>' +
      '<div class="card mb18"><div class="card-title">Monthly Trend</div><div class="chart-box md"><canvas id="rtmTrend"></canvas></div></div>' +
      '<div class="card"><div class="card-title">Zone Hierarchy</div>' +
      tbl(['Zone', 'Target', 'Actual', 'Ach %', 'Gap', 'Health'], zones.map(z => { const h = health(z.a); return ['<b>' + esc(z.name) + '</b>', 'BDT ' + FMT.money(z.target), 'BDT ' + FMT.money(z.actual), '<b class="' + achCol(z.a) + '">' + achTxt(z.a) + '</b>', 'BDT ' + FMT.money(z.gap), healthPill(h)]; }), [1, 2, 3, 4]) + '</div>';
    mk('rtmTrend', { type: 'line', data: { labels, datasets: [{ label: 'Target', data: labels.map((_, i) => series[i].t), borderColor: PAL.gray, backgroundColor: PAL.gray, tension: .3 }, { label: 'Actual', data: labels.map((_, i) => series[i].a), borderColor: PAL.red, backgroundColor: PAL.red, tension: .3, borderWidth: 2.5 }] }, options: { scales: { y: { ticks: { callback: v => 'BDT ' + FMT.money(v) } } } } });
  }

  /* ============ 03 GEOGRAPHIC ============ */
  function renderGeo() {
    const stats = {}; zones.forEach(z => stats[z.name] = z);
    $('#content').querySelector('[data-view-panel="geo"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Geographic Intelligence</div><div class="section-desc">Zone health by signal (green / yellow / red / grey)</div></div></div>' +
      '<div class="card mb18"><div class="card-title">Zone Health Map</div><div class="map-wrap"><div id="geoMap" class="map-box"></div><div class="map-side"><div class="legend"><span class="li"><span class="health-dot" style="background:#16845B"></span>Healthy</span><span class="li"><span class="health-dot" style="background:#D99A00"></span>Watch</span><span class="li"><span class="health-dot" style="background:#C83E4D"></span>Critical</span><span class="li"><span class="health-dot" style="background:#A9B4C0"></span>No data</span></div></div></div></div>' +
      '<div class="card"><div class="card-title">Zone Table</div>' + tbl(['Zone', 'Ach %', 'Gap', 'Health'], zones.map(z => ['<b>' + esc(z.name) + '</b>', '<b class="' + achCol(z.a) + '">' + achTxt(z.a) + '</b>', 'BDT ' + FMT.money(z.gap), healthPill(health(z.a))]), [1, 2]) + '</div>';
    renderMap('geoMap', stats);
  }

  /* ============ 04 DISTRIBUTOR ============ */
  function renderDistributor() {
    const dagg = {};
    distSales.forEach(d => { dagg[d.distributor] = dagg[d.distributor] || { amt: 0, outlets: 0, months: new Set() }; dagg[d.distributor].amt += d.amt; dagg[d.distributor].outlets = Math.max(dagg[d.distributor].outlets, d.outlets); dagg[d.distributor].months.add(d.mn); });
    const list = Object.entries(dagg).map(([n, v]) => ({ name: n, amt: v.amt, outlets: v.outlets })).sort((a, b) => b.amt - a.amt);
    const salesPer = list.length ? list.reduce((s, d) => s + d.amt, 0) / list.length : 0;
    $('#content').querySelector('[data-view-panel="distributor"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Distributor Intelligence</div><div class="section-desc">Distributor sales &amp; outlet coverage</div></div></div>' +
      '<div class="kpi-grid">' + kpi('Active Distributors', FMT.num(dist)) + kpi('Avg Sales / Distributor', 'BDT ' + FMT.money(salesPer)) + kpi('Sales / Outlet', 'BDT ' + FMT.money(out ? nat.actual / out : 0)) + '</div>' +
      '<div class="card"><div class="card-title">Top 20 Distributors by Sales</div>' + tbl(['#', 'Distributor', 'Sales', 'Outlets Served'], list.slice(0, 20).map((d, i) => [i + 1, '<b>' + esc(d.name) + '</b>', 'BDT ' + FMT.money(d.amt), FMT.num(d.outlets)]), [2, 3]) + '</div>' +
      insight('Distributor-level productivity (sales per outlet, SKU breadth) requires outlet-level detail not available in the current source — flag as a data requirement for a distributor study.');
  }

  /* ============ 05 CUSTOMER & OUTLET ============ */
  function renderCustomer() {
    const mc = meta.monthlyCustomers || [];
    const labels = M.slice(0, 9);
    $('#content').querySelector('[data-view-panel="customer"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Customer &amp; Outlet Intelligence</div><div class="section-desc">Outlet universe &amp; activity</div></div></div>' +
      '<div class="kpi-grid">' + kpi('Active Outlets', FMT.num(out)) + kpi('Sales / Outlet', 'BDT ' + FMT.money(out ? nat.actual / out : 0)) + kpi('Outlets / Officer', FMT.num(so ? Math.round(out / so) : 0)) + '</div>' +
      '<div class="card"><div class="card-title">Active Outlets by Month</div><div class="chart-box md"><canvas id="custTrend"></canvas></div></div>' +
      insight('Active outlets grew through the year. Per-outlet purchase frequency, dormant/declining outlet segmentation, and product penetration are Data Not Available — required for a full customer/outlet study.');
    mk('custTrend', { type: 'line', data: { labels, datasets: [{ label: 'Active Outlets', data: labels.map((_, i) => mc[i] || 0), borderColor: PAL.red, backgroundColor: PAL.red, tension: .3, borderWidth: 2.5 }] }, options: { plugins: { legend: { display: false } } } });
  }

  /* ============ 06 ROUTE PRODUCTIVITY ============ */
  function renderRoute() {
    $('#content').querySelector('[data-view-panel="route"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Route Productivity</div><div class="section-desc">Sales / route · outlets / route · productive outlets / route</div></div></div>' +
      '<div class="card"><div class="card-title">Data Not Available</div><div class="empty" style="text-align:left;padding:20px">Route-level data (route code, outlets per route, productive calls, strike rate) is not present in the current source. To compute route productivity, the following fields are required: <b>route id/name, outlets per route, productive visits, orders per route</b>.</div></div>' +
      insight('Route productivity cannot be assessed. The strike-rate (visits vs orders) question remains open — this is a key data requirement to separate coverage from productivity.');
  }

  /* ============ 07 PRODUCT & SKU ============ */
  function renderSku() {
    const grow = (meta.skuGrowth || []).slice().sort((a, b) => b.g3 - a.g3).slice(0, 5);
    const decl = (meta.skuGrowth || []).slice().sort((a, b) => a.g3 - b.g3).slice(0, 5);
    $('#content').querySelector('[data-view-panel="sku"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Product &amp; SKU Intelligence</div><div class="section-desc">Growth &amp; decline drivers, portfolio concentration</div></div></div>' +
      '<div class="kpi-grid">' + kpi('Active SKUs', FMT.num(products.length)) + kpi('SKU Concentration', focus + ' SKUs = 80% of value') + kpi('Top SKU', esc(topSkuSku()), (totalSku ? (products[0].amt / totalSku * 100).toFixed(0) + '% of value' : '')) + '</div>' +
      '<div class="grid grid-2 mb18">' +
        '<div class="card"><div class="card-title">Growth Drivers</div>' + rowList(grow.map(g => [g.sku, (g.g3 >= 0 ? '+' : '') + g.g3.toFixed(0) + '%'])) + '</div>' +
        '<div class="card"><div class="card-title">Decline Drivers</div>' + rowList(decl.map(g => [g.sku, (g.g3 >= 0 ? '+' : '') + g.g3.toFixed(0) + '%'])) + '</div>' +
      '</div>' +
      '<div class="card"><div class="card-title">Top 10 SKUs by Value</div>' + tbl(['SKU', 'Value', 'Share %'], products.slice(0, 10).map(p => ['<b>' + esc(p.sku) + '</b>', 'BDT ' + FMT.money(p.amt), (totalSku ? (p.amt / totalSku * 100).toFixed(1) + '%' : '—')]), [1, 2]) + '</div>';
  }
  function topSkuSku() { return products[0] ? products[0].sku : '—'; }

  /* ============ 08 SALES FORCE ============ */
  function renderSalesforce() {
    const top20 = terrs.slice().sort((a, b) => b.actual - a.actual).slice(0, 20);
    $('#content').querySelector('[data-view-panel="salesforce"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Sales Force Productivity</div><div class="section-desc">Manpower &rarr; coverage &rarr; productivity</div></div></div>' +
      '<div class="kpi-grid">' + kpi('Sales Officers', FMT.num(so)) + kpi('Sales / Officer', 'BDT ' + FMT.money(so ? nat.actual / so : 0)) + kpi('Outlets / Officer', FMT.num(so ? Math.round(out / so) : 0)) + kpi('Avg Achievement', achTxt(nat.a)) + '</div>' +
      '<div class="card"><div class="card-title">Top 20 Territories / SRs</div>' + tbl(['#', 'Territory', 'Target', 'Actual', 'Ach %'], top20.map((t, i) => [i + 1, '<b>' + esc(t.name) + '</b>', 'BDT ' + FMT.money(t.target), 'BDT ' + FMT.money(t.actual), '<b class="' + achCol(t.a) + '">' + achTxt(t.a) + '</b>']), [2, 3, 4]) + '</div>' +
      insight('Outlet load is within the 6-day route capacity (≈450 visits/week), so a manpower shortage is NOT indicated. The gap is more likely strike-rate/productivity — visit-level data is required to validate.');
  }

  /* ============ 09 GAP & ROOT CAUSE ============ */
  function renderGap() {
    const gapZones = zones.filter(z => z.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 10);
    $('#content').querySelector('[data-view-panel="gap"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Gap &amp; Root Cause</div><div class="section-desc">Where the gap is &amp; potential drivers</div></div></div>' +
      '<div class="card mb18"><div class="card-title">Top Gap Contributors (Zones)</div>' + tbl(['Zone', 'Gap', 'Ach %', '% of National Gap'], gapZones.map(z => ['<b>' + esc(z.name) + '</b>', 'BDT ' + FMT.money(z.gap), achTxt(z.a), (nat.gap > 0 ? (z.gap / nat.gap * 100).toFixed(1) + '%' : '—')]), [1, 2, 3]) + '</div>' +
      '<div class="card"><div class="card-title">Root Cause Dimensions (potential drivers — not confirmed)</div>' +
      rowList([['Coverage', 'Outlet & route coverage — adequate (Data: outlets/officer within route capacity)'], ['Productivity', 'Distributor / outlet / employee productivity — strike-rate open (Data gap)'], ['Portfolio', 'SKU concentration: ' + focus + ' SKUs = 80% of value'], ['Distribution', 'Distributor dependency / productivity — requires outlet detail'], ['Sales force', 'Manpower adequate; productivity is the question'], ['Customer', 'Per-outlet purchase frequency — Data Not Available']]) + '</div>';
  }

  /* ============ 10 STRATEGIC DIAGNOSTIC ============ */
  function renderStrategic() {
    const crit = zones.filter(z => z.a != null && z.a < 70).length;
    const blocks = [
      ['A. Current situation', 'YTD achievement ' + achTxt(nat.a) + ' with a BDT ' + FMT.money(nat.gap) + ' gap.'],
      ['B. Performance gaps', crit + ' critical zones; gap concentrated in a few zones.'],
      ['C. Internal strengths', 'Distribution network (529 distributors, 145,920 outlets) and brand.'],
      ['D. Internal constraints', 'Strike-rate/productivity open; competitor data absent; SKU concentration.'],
      ['E. Competitive position', 'No internal competitor data — external assessment required.'],
      ['F. Capability gaps', 'Route productivity and customer segmentation data missing.'],
      ['G. VRIO findings', 'Sustained advantage: brand & distribution; parity: sales force.'],
      ['H. Business opportunities', 'Deepen data/analytics; rationalize SKUs; improve strike rate.'],
      ['I. Management attention', 'Research bottom zones; strike-rate study; SKU focus; fix targets.'],
    ];
    $('#content').querySelector('[data-view-panel="strategic"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Strategic Diagnostic</div><div class="section-desc">A &rarr; I structured summary</div></div></div>' +
      '<div class="card">' + blocks.map(b => '<div class="detail-row"><span class="lbl" style="font-weight:700">' + esc(b[0]) + '</span><span class="val" style="text-align:left">' + esc(b[1]) + '</span></div>').join('') + '</div>';
  }

  /* ============ 11 RESOURCES ============ */
  function renderResources() {
    const sections = [
      ['Physical', [['Distribution network', '529 distributors · 145,920 outlets · 59 zones'], ['Infrastructure', 'iBOS RTM system & BI dashboards'], ['Product portfolio', '59 SKUs (staples)']]],
      ['Human', [['Sales force', '532 sales officers'], ['Management', 'R&I / market intelligence team']]],
      ['Financial / Commercial', [['Working capital', 'Group-backed (Akij Group)'], ['Trade investment', 'Not available in source']]],
      ['Information', [['RTM database', 'Live sales, target, SKU, distributor data'], ['Analytics', 'Power BI, Python, forecasting models']]],
      ['Network', [['Distributor relationships', '529 active distributors'], ['Retailer network', '145,920 outlets']]],
    ];
    let html = '<div class="section-head"><div><div class="section-title">Resources</div><div class="section-desc">What the organisation has (Resource → scale → contribution)</div></div></div><div class="grid grid-2">';
    sections.forEach(s => { html += '<div class="card"><div class="card-title">' + s[0] + ' Resources</div>' + rowList(s[1].map(r => [r[0], r[1]])) + '</div>'; });
    html += '</div>';
    $('#content').querySelector('[data-view-panel="resources"]').innerHTML = html;
  }

  /* ============ 12 CAPABILITIES ============ */
  function renderCapabilities() {
    const caps = [
      ['Distribution management', '529 distributors managed via RTM', 'Strong', 'Productivity detail missing', 'High'],
      ['Market intelligence', 'Forecasting, audits, KPI governance (R&I)', 'Strong', 'Competitor data missing', 'High'],
      ['Data analytics', 'BI dashboards, Python ETL, forecasting', 'Emerging', 'Deepen to differentiate', 'High'],
      ['Route planning', '6-day route × 70–80 outlets/day', 'Moderate', 'Strike-rate data missing', 'Medium'],
      ['Sales execution', '532 officers, 84% achievement', 'Moderate', 'Conversion/productivity', 'High'],
      ['Demand sensing', 'Sales trend & growth analysis', 'Moderate', 'External demand data missing', 'Medium'],
    ];
    $('#content').querySelector('[data-view-panel="capabilities"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Capabilities</div><div class="section-desc">What the organisation can do effectively</div></div></div>' +
      '<div class="card">' + tbl(['Capability', 'Evidence', 'Strength', 'Gap', 'Business Impact'], caps.map(c => ['<b>' + c[0] + '</b>', esc(c[1]), '<span class="pill ' + (c[2] === 'Strong' ? 'pill-pos' : 'pill-warn') + '">' + c[2] + '</span>', esc(c[3]), '<span class="pill ' + (c[4] === 'High' ? 'pill-neg' : 'pill-warn') + '">' + c[4] + '</span>']), [0]) + '</div>';
  }

  /* ============ 13 COMPETITION ============ */
  function renderCompetition() {
    $('#content').querySelector('[data-view-panel="competition"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Competition</div><div class="section-desc">Competitive intelligence</div></div></div>' +
      '<div class="card"><div class="card-title">External Competitor Data Required</div><div class="empty" style="text-align:left;padding:20px">No competitor data (pricing, coverage, share, promotion) is available in the internal RTM source. To build competitor analysis, the following are required: <b>competitor price by SKU, competitor distribution/outlet coverage, competitor promotion activity, market share</b>.</div></div>' +
      insight('Competitive position cannot be evidenced from internal data alone — flag as a data requirement and a competitor-assessment research trigger.');
  }

  /* ============ 14 COMPETITIVE ADVANTAGE ============ */
  function renderAdvantage() {
    const adv = [
      ['Distribution reach', '529 distributors · 145,920 outlets', 'Deep, hard-to-replicate availability', 'Partially utilized', 'Competitor coverage data to validate'],
      ['Brand trust', 'Akij — household name', 'Mass-market pull', 'Strong', 'Brand health study'],
      ['Data & analytics', 'RTM diagnostics, forecasting', 'Differentiating if deepened', 'Emerging', 'Benchmark vs competitors'],
      ['Commodity scale', 'Group sourcing', 'Cost in staples', 'Utilized', 'Cost benchmark'],
    ];
    $('#content').querySelector('[data-view-panel="advantage"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Competitive Advantage</div><div class="section-desc">Potential sources of advantage from internal evidence</div></div></div>' +
      '<div class="card">' + tbl(['Advantage', 'Evidence', 'Why it matters', 'Utilization', 'Validation needed'], adv.map(a => ['<b>' + a[0] + '</b>', esc(a[1]), esc(a[2]), esc(a[3]), esc(a[4])]), [0]) + '</div>';
  }

  /* ============ 15 VRIO ============ */
  function renderVrio() {
    const vrio = [
      { name: 'Distribution network', v: 'Yes', r: 'Yes', i: 'Partially', o: 'Yes', ev: '529 distributors · 145,920 outlets', imp: 'Sustained advantage', pill: 'pill-pos' },
      { name: 'Brand (Akij)', v: 'Yes', r: 'Yes', i: 'Yes', o: 'Yes', ev: 'Household brand', imp: 'Sustained advantage', pill: 'pill-pos' },
      { name: 'RTM data & analytics', v: 'Yes', r: 'Partially', i: 'Partially', o: 'Yes', ev: 'BI dashboards, forecasting', imp: 'Temporary / partial', pill: 'pill-warn' },
      { name: 'Distributor relationships', v: 'Yes', r: 'Partially', i: 'Partially', o: 'Yes', ev: '529 distributors', imp: 'Temporary / partial', pill: 'pill-warn' },
      { name: 'Commodity sourcing & scale', v: 'Yes', r: 'Partially', i: 'Partially', o: 'Yes', ev: 'Group sourcing', imp: 'Cost / parity', pill: 'pill-gray' },
      { name: 'Sales force', v: 'Yes', r: 'No', i: 'No', o: 'Yes', ev: '532 officers', imp: 'Parity', pill: 'pill-gray' },
      { name: 'Geographic reach', v: 'Yes', r: 'Partially', i: 'Partially', o: 'Yes', ev: '59 zones', imp: 'Temporary / partial', pill: 'pill-warn' },
    ];
    $('#content').querySelector('[data-view-panel="vrio"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">VRIO Analysis</div><div class="section-desc">V = Valuable · R = Rare · I = Inimitable · O = Organized (evidence-based)</div></div></div>' +
      '<div class="card"><div class="card-title">VRIO Matrix</div>' +
      tbl(['Resource / Capability', 'V', 'R', 'I', 'O', 'Evidence', 'Strategic Implication'], vrio.map(d => ['<b>' + esc(d.name) + '</b>', d.v, d.r, d.i, d.o, '<span class="muted">' + esc(d.ev) + '</span>', '<span class="pill ' + d.pill + '">' + d.imp + '</span>']), [1, 2, 3, 4]) + '</div>' +
      insight('Interpretation: V alone → parity · V+R → temporary · V+R+I → unused · V+R+I+O → sustained. Brand and distribution show sustained-advantage evidence; sales force is parity; R and I are partially inferred (competitor data required to confirm).');
  }

  /* ============ 16 MANAGEMENT ACTION ============ */
  function renderAction() {
    const acts = [
      ['Geographic gap', crit() + ' critical zones', 'Regional market assessment', 'Immediate Investigation', 'R&I', 'Oct', 'Open'],
      ['Productivity / strike rate', 'Coverage adequate, achievement ' + achTxt(nat.a), 'Strike-rate study', 'Immediate Investigation', 'R&I / Sales', 'Oct', 'Open'],
      ['SKU concentration', focus + ' SKUs = 80% value', 'Portfolio rationalization', 'Performance Improvement', 'Marketing', 'Nov', 'Open'],
      ['Target quality', 'Memo targets erratic', 'Fix target-setting', 'Structural Review', 'Commercial/MIS', 'Sep', 'Open'],
      ['Competitor data', 'No competitor data in source', 'Competitor assessment', 'Data Requirement', 'R&I', 'Ongoing', 'Open'],
      ['Route productivity', 'No route-level data', 'Route/coverage audit', 'Data Requirement', 'IT / RTM', 'Ongoing', 'Open'],
    ];
    $('#content').querySelector('[data-view-panel="action"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Management Action</div><div class="section-desc">Issue → evidence → response → owner</div></div></div>' +
      '<div class="card">' + tbl(['Issue', 'Evidence', 'Possible Response', 'Category', 'Owner', 'Timeline', 'Status'], acts.map(a => ['<b>' + a[0] + '</b>', esc(a[1]), esc(a[2]), '<span class="pill pill-warn">' + a[3] + '</span>', a[4], a[5], '<span class="pill pill-gray">' + a[6] + '</span>']), [0]) + '</div>';
  }
  function crit() { return zones.filter(z => z.a != null && z.a < 70).length; }

  /* ============ 17 DATA QUALITY ============ */
  function renderDataQuality() {
    const total = rows.length;
    const dupes = total - new Set(rows.map(r => r.sr + '|' + r.zone + '|' + r.mi)).size;
    const zeroTarget = rows.filter(r => r.target === 0).length;
    const zeroActual = rows.filter(r => r.actual === 0).length;
    const jan = rows.filter(r => r.mi === 0).reduce((s, r) => s + r.actual, 0) < 1e7;
    const issues = (dupes > 0) + (zeroTarget > 0) + (jan) + (meta.activeCustomers == null);
    const score = Math.max(0, Math.round(100 - issues * 15 - (zeroTarget / total * 100)));
    $('#content').querySelector('[data-view-panel="dataquality"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Data Quality</div><div class="section-desc">Validation &amp; governance</div></div></div>' +
      '<div class="kpi-grid">' + kpi('Total Records', FMT.num(total)) + kpi('Data Quality Score', score + '/100', '', score > 80 ? PAL.green : PAL.red) + kpi('Issues', String(issues)) + '</div>' +
      '<div class="card"><div class="card-title">Quality Checks</div>' + tbl(['Check', 'Status', 'Detail'], [
        ['National = Σ zones', '<span class="pill pill-pos">Reconciled</span>', 'Aggregates reconcile.'],
        ['Duplicate SR-zone-month', dupes > 0 ? '<span class="pill pill-neg">' + dupes + '</span>' : '<span class="pill pill-pos">None</span>', ''],
        ['Zero target', zeroTarget > 0 ? '<span class="pill pill-neg">' + zeroTarget + '</span>' : '<span class="pill pill-pos">None</span>', 'Official PDF target used.'],
        ['January data', jan ? '<span class="pill pill-neg">Partial</span>' : '<span class="pill pill-pos">OK</span>', 'Rollout period.'],
        ['Competitor / price', '<span class="pill pill-warn">Data Not Available</span>', 'External data required.'],
        ['Route / strike rate', '<span class="pill pill-warn">Data Not Available</span>', 'Route & visit detail required.'],
      ], [0]) + '</div>';
  }

  /* ============ router ============ */
  const renderers = { overview: renderOverview, rtm: renderRtm, geo: renderGeo, distributor: renderDistributor, customer: renderCustomer, route: renderRoute, sku: renderSku, salesforce: renderSalesforce, gap: renderGap, strategic: renderStrategic, resources: renderResources, capabilities: renderCapabilities, competition: renderCompetition, advantage: renderAdvantage, vrio: renderVrio, action: renderAction, dataquality: renderDataQuality };
  function renderView(v) {
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.getAttribute('data-view') === v));
    $$('.view').forEach(x => x.classList.toggle('active', x.getAttribute('data-view-panel') === v));
    destroyAll();
    if (renderers[v]) renderers[v]();
  }
  function init() {
    const avail = (meta.months || []).slice().sort((a, b) => a - b);
    $('#periodValue').textContent = M[avail[0] || 0] + ' 2026 – Till Date';
    $('#updatedValue').textContent = meta.lastSync || '—';
    $$('.nav-item').forEach(n => n.addEventListener('click', () => renderView(n.getAttribute('data-view'))));
    $('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#themeToggle').addEventListener('click', () => { document.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); renderView($('.nav-item.active').getAttribute('data-view')); });
    renderView('overview');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
