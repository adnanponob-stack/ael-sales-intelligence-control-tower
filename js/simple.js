/* ============================================================
   AEL Business Intelligence — simple.js (focused management view)
   ============================================================ */
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const M = AEL_DATA.months;
  const meta = AEL_DATA.meta || {};

  // ---- data ----
  const rows = AEL_DATA.rows.map(r => ({ sr: r[0], zone: r[1], point: r[2], zm: r[3], dsm: r[4], mi: r[5], target: r[6], actual: r[7], volume: r[8], tv: r[9] }));
  const maxMonth = rows.length ? Math.max.apply(null, rows.map(r => r.mi)) : 0;
  const Upto = Math.max(0, maxMonth - 1); // 8 complete months
  const ytd = rows.filter(r => r.mi <= Upto);

  const ach = (t, a) => t > 0 ? (a / t) * 100 : null;
  const FMT = {
    money(v) { const a = Math.abs(v || 0); if (a >= 1e7) return (v / 1e7).toFixed(1) + ' Cr'; if (a >= 1e5) return (v / 1e5).toFixed(1) + ' L'; if (a >= 1e3) return (v / 1e3).toFixed(1) + ' K'; return String(Math.round(v || 0)); },
    num(v) { return (v || 0).toLocaleString('en-IN'); }
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function aggBy(rs, keyFn) {
    const m = new Map();
    rs.forEach(r => {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, { name: k, target: 0, actual: 0, volume: 0 });
      const e = m.get(k); e.target += r.target; e.actual += r.actual; e.volume += (r.volume || 0);
    });
    return Array.from(m.values()).map(e => Object.assign(e, { a: ach(e.target, e.actual) }));
  }
  function monthly(rs) { const o = Array.from({ length: 12 }, () => ({ t: 0, a: 0 })); rs.forEach(r => { o[r.mi].t += r.target; o[r.mi].a += r.actual; }); return o; }

  // ---- charts ----
  const charts = {};
  const PAL = { red: '#EE1D24', darkred: '#C8161B', green: '#16845B', amber: '#D99A00', gray: '#A9B4C0', slate: '#475569' };
  function mk(id, cfg) {
    if (typeof Chart === 'undefined') return;
    if (charts[id]) { try { charts[id].destroy(); } catch (e) {} }
    const el = document.getElementById(id); if (!el) return;
    const t = document.documentElement.getAttribute('data-theme') === 'dark';
    const tick = t ? '#8CA3B8' : '#5B6B7E'; const grid = t ? '#243140' : '#E3E8EF';
    const dlFmt = cfg.dlFmt; delete cfg.dlFmt;
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
      plugins: { legend: { labels: { color: tick, font: { size: 11 }, boxWidth: 12, boxHeight: 12, usePointStyle: true } }, tooltip: { backgroundColor: PAL.darkred, titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 8 }, datalabels: { display: true, color: tick, font: { size: 9, weight: 'bold' }, anchor: 'end', align: 'end', formatter: dlFmt || ((v) => v == null ? '' : v) } },
      scales: { x: { grid: { color: grid }, ticks: { color: tick, font: { size: 10 } } }, y: { grid: { color: grid }, ticks: { color: tick, font: { size: 10 } } } } }, cfg.options || {});
    charts[id] = new Chart(el.getContext('2d'), cfg);
  }
  function destroyAll() { Object.keys(charts).forEach(k => { try { charts[k].destroy(); } catch (e) {} delete charts[k]; }); }

  // ---- UI helpers ----
  function kpi(label, value, sub, color) { return '<div class="kpi"><div class="kpi-accent"></div><div class="kpi-label">' + label + '</div><div class="kpi-value" style="color:' + (color || '') + '">' + value + '</div>' + (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>'; }
  function tbl(headers, rows, alignRight) { return '<div class="table-wrap"><table class="tbl"><thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr class="row">' + r.map((c, i) => '<td class="' + (alignRight && alignRight.includes(i) ? 'num mono' : '') + '">' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'; }
  function achPct(a) { return a == null ? '—' : a.toFixed(1) + '%'; }
  function achCol(a) { return a == null ? '' : a >= 100 ? 'h-healthy' : a >= 90 ? 'h-watch' : a >= 70 ? 'h-atrisk' : 'h-critical'; }

  /* ---------- 01 YTD ---------- */
  function renderYtd() {
    const target = ytd.reduce((s, r) => s + r.target, 0), actual = ytd.reduce((s, r) => s + r.actual, 0);
    const a = ach(target, actual); const gap = target - actual;
    const series = monthly(ytd);
    const labels = M.slice(0, Upto + 1);
    const mom = labels.map((_, i) => i > 0 && series[i - 1].a > 0 ? ((series[i].a - series[i - 1].a) / series[i - 1].a) * 100 : null);
    const lastMom = mom[Upto];

    $('#content').querySelector('[data-view-panel="ytd"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">YTD Target vs Achievement</div><div class="section-desc">8 complete months (Jan &ndash; Aug 2026)</div></div></div>' +
      '<div class="kpi-grid">' +
        kpi('YTD Target', 'BDT ' + FMT.money(target)) +
        kpi('YTD Actual', 'BDT ' + FMT.money(actual)) +
        kpi('Achievement %', a.toFixed(1) + '%', '', a < 90 ? PAL.red : PAL.green) +
        kpi('Sales Gap', 'BDT ' + FMT.money(gap), '', PAL.red) +
        kpi('MoM Growth', (lastMom == null ? '—' : (lastMom >= 0 ? '+' : '') + lastMom.toFixed(1) + '%'), M[Upto] + ' vs ' + M[Upto - 1], lastMom == null ? '' : lastMom >= 0 ? PAL.green : PAL.red) +
      '</div>' +
      '<div class="grid grid-2 mb18">' +
        '<div class="card"><div class="card-title">Chart 1 — Monthly Target vs Achievement</div><div class="chart-box md"><canvas id="cYtd"></canvas></div></div>' +
        '<div class="card"><div class="card-title">Chart 2 — Month-over-Month Growth</div><div class="chart-box md"><canvas id="cMom"></canvas></div></div>' +
      '</div>' +
      '<div class="card"><div class="card-title">Month Comparison</div>' +
      tbl(['Month', 'Target', 'Actual', 'Achievement %', 'Gap', 'MoM Change'], labels.map((l, i) => [l, 'BDT ' + FMT.money(series[i].t), 'BDT ' + FMT.money(series[i].a), series[i].t > 0 ? (series[i].a / series[i].t * 100).toFixed(1) + '%' : '—', 'BDT ' + FMT.money(series[i].t - series[i].a), mom[i] == null ? '—' : '<span class="' + (mom[i] >= 0 ? 'h-healthy' : 'h-critical') + '">' + (mom[i] >= 0 ? '+' : '') + mom[i].toFixed(1) + '%</span>']), [1, 2, 3, 4, 5]) + '</div>';

    mk('cYtd', { type: 'bar', data: { labels, datasets: [
      { label: 'Target', data: labels.map((_, i) => series[i].t), backgroundColor: 'rgba(169,180,192,.4)', borderRadius: 3, datalabels: { display: false } },
      { label: 'Actual', data: labels.map((_, i) => series[i].a), backgroundColor: PAL.red, borderRadius: 3 }
    ] }, dlFmt: v => FMT.money(v), options: { scales: { y: { ticks: { callback: v => 'BDT ' + FMT.money(v) } } } } });

    mk('cMom', { type: 'bar', data: { labels, datasets: [{ data: mom, backgroundColor: mom.map(m => m == null ? PAL.gray : m >= 0 ? PAL.green : PAL.red), borderRadius: 3 }] }, dlFmt: v => v == null ? '' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%', options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => v + '%' } } } } });
  }

  /* ---------- 02 ZONE ---------- */
  function renderZone() {
    const zones = aggBy(ytd, r => r.zone).sort((a, b) => (b.a == null ? -1 : b.a) - (a.a == null ? -1 : a.a));
    const top = zones.slice(0, 10), bottom = zones.slice(-20).reverse();
    $('#content').querySelector('[data-view-panel="zone"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Zone Comparison</div><div class="section-desc">Top 10 vs Bottom 20 zones by achievement</div></div></div>' +
      '<div class="grid grid-2">' +
        '<div class="card"><div class="card-title">Top 10 Zones</div>' + tbl(['Zone', 'Target', 'Actual', 'Ach %'], top.map(z => ['<b>' + esc(z.name) + '</b>', 'BDT ' + FMT.money(z.target), 'BDT ' + FMT.money(z.actual), '<b class="' + achCol(z.a) + '">' + achPct(z.a) + '</b>']), [1, 2, 3]) + '</div>' +
        '<div class="card"><div class="card-title">Bottom 20 Zones (attention)</div>' + tbl(['Zone', 'Target', 'Actual', 'Ach %'], bottom.map(z => ['<b>' + esc(z.name) + '</b>', 'BDT ' + FMT.money(z.target), 'BDT ' + FMT.money(z.actual), '<b class="' + achCol(z.a) + '">' + achPct(z.a) + '</b>']), [1, 2, 3]) + '</div>' +
      '</div>';
  }

  /* ---------- 03 TERRITORY ---------- */
  function renderTerritory() {
    const terrs = aggBy(ytd, r => r.sr).sort((a, b) => (b.a == null ? -1 : b.a) - (a.a == null ? -1 : a.a));
    const top = terrs.slice(0, 10), bottom = terrs.slice(-20).reverse();
    $('#content').querySelector('[data-view-panel="territory"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Territory Comparison</div><div class="section-desc">Top 10 vs Bottom 20 territories &mdash; bottom flagged for research initiative</div></div></div>' +
      '<div class="grid grid-2">' +
        '<div class="card"><div class="card-title">Top 10 Territories</div>' + tbl(['Territory', 'Target', 'Actual', 'Ach %'], top.map(t => ['<b>' + esc(t.name) + '</b>', 'BDT ' + FMT.money(t.target), 'BDT ' + FMT.money(t.actual), '<b class="' + achCol(t.a) + '">' + achPct(t.a) + '</b>']), [1, 2, 3]) + '</div>' +
        '<div class="card"><div class="card-title">Bottom 20 Territories &mdash; Research Initiative</div>' + tbl(['Territory', 'Target', 'Actual', 'Ach %', 'Flag'], bottom.map(t => ['<b>' + esc(t.name) + '</b>', 'BDT ' + FMT.money(t.target), 'BDT ' + FMT.money(t.actual), '<b class="' + achCol(t.a) + '">' + achPct(t.a) + '</b>', '<span class="pill pill-warn">Research</span>']), [1, 2, 3]) + '</div>' +
      '</div>';
  }

  /* ---------- 04 MANPOWER ---------- */
  function renderManpower() {
    const so = meta.activeSalesOfficers || 0, out = meta.activeCustomers || 0;
    const nat = aggBy(ytd, () => 'N')[0];
    const srs = aggBy(ytd, r => r.sr).sort((a, b) => b.actual - a.actual);
    const top20 = srs.slice(0, 20);
    const eff = so ? nat.actual / so : 0;
    $('#content').querySelector('[data-view-panel="manpower"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Manpower Efficiency</div><div class="section-desc">Sales-force effectiveness &amp; top 20 performers</div></div></div>' +
      '<div class="kpi-grid">' +
        kpi('Sales Officers', FMT.num(so)) +
        kpi('Sales / Officer', 'BDT ' + FMT.money(eff)) +
        kpi('Outlets / Officer', FMT.num(so ? Math.round(out / so) : 0)) +
        kpi('Avg Achievement', achPct(nat.a), '', nat.a < 90 ? PAL.red : PAL.green) +
      '</div>' +
      '<div class="card"><div class="card-title">Top 20 Sales Officers / Territories</div>' +
      tbl(['#', 'Territory / SR', 'Target', 'Actual', 'Ach %'], top20.map((t, i) => [i + 1, '<b>' + esc(t.name) + '</b>', 'BDT ' + FMT.money(t.target), 'BDT ' + FMT.money(t.actual), '<b class="' + achCol(t.a) + '">' + achPct(t.a) + '</b>']), [2, 3, 4]) + '</div>';
  }

  /* ---------- 05 SKU ---------- */
  function renderSku() {
    const products = (meta.products || []).slice().sort((a, b) => b.amt - a.amt);
    const total = products.reduce((s, p) => s + p.amt, 0);
    const top = products.slice(0, 10), bottom = products.slice(-20).reverse();
    const skuG = {}; (meta.skuGrowth || []).forEach(g => skuG[g.sku] = g);
    $('#content').querySelector('[data-view-panel="sku"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">SKU Analysis</div><div class="section-desc">Top 10 vs Bottom 20 SKUs by value</div></div></div>' +
      '<div class="grid grid-2">' +
        '<div class="card"><div class="card-title">Top 10 SKUs</div>' + tbl(['SKU', 'Value', 'Share %'], top.map(p => ['<b>' + esc(p.sku) + '</b>', 'BDT ' + FMT.money(p.amt), (total ? (p.amt / total * 100).toFixed(1) + '%' : '—')]), [1, 2]) + '</div>' +
        '<div class="card"><div class="card-title">Bottom 20 SKUs</div>' + tbl(['SKU', 'Value', '3M Growth'], bottom.map(p => { const g = skuG[p.sku]; return ['<b>' + esc(p.sku) + '</b>', 'BDT ' + FMT.money(p.amt), g ? '<span class="' + (g.g3 >= 0 ? 'h-healthy' : 'h-critical') + '">' + (g.g3 >= 0 ? '+' : '') + g.g3.toFixed(0) + '%</span>' : '—']; }), [1]) + '</div>' +
      '</div>';
  }

  /* ---------- 06 PAIN POINTS ---------- */
  function renderPainPoints() {
    const zones = aggBy(ytd, r => r.zone);
    const under = zones.filter(z => z.a != null && z.a < 90).length;
    const crit = zones.filter(z => z.a != null && z.a < 70).length;
    const products = (meta.products || []).slice().sort((a, b) => b.amt - a.amt);
    const total = products.reduce((s, p) => s + p.amt, 0);
    let cum = 0, focus = 0; products.forEach(p => { cum += p.amt; if (cum <= total * 0.8) focus++; });
    const so = meta.activeSalesOfficers || 0, out = meta.activeCustomers || 0;
    const natA = aggBy(ytd, () => 'N')[0].a;
    const pain = [
      ['Geographic gap', crit + ' zones critical, ' + under + ' below 90% achievement', 'Regional Market Assessment'],
      ['SKU concentration', focus + ' SKUs drive 80% of value', 'Portfolio rationalization'],
      ['Productivity / strike rate', 'Coverage adequate (6-day route) but achievement ' + achPct(natA) + ' — visits not converting', 'Sales Force Productivity Study'],
      ['Data gap', 'Competitor price & coverage detail not available internally', 'Competitor / retail audit'],
      ['Target quality', 'Memo targets erratic month-to-month', 'Fix target-setting'],
    ];
    $('#content').querySelector('[data-view-panel="painpoints"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Pain Points</div><div class="section-desc">What is behind the performance scenario</div></div></div>' +
      '<div class="card"><div class="card-title">Main Pain Points</div>' +
      tbl(['#', 'Pain Point', 'Evidence', 'Research / Action'], pain.map((p, i) => [i + 1, '<b>' + p[0] + '</b>', esc(p[1]), '<span class="pill pill-warn">' + esc(p[2]) + '</span>']), [0]) + '</div>';
  }

  /* ---------- 07 INITIATIVES ---------- */
  function renderInitiatives() {
    const init = [
      ['Fix target-setting', 'Set monthly BDT targets per territory (replace erratic memo targets).', 'Commercial / MIS'],
      ['Research bottom zones', 'Field research in bottom 20 zones — demand, coverage, competition.', 'R&I'],
      ['Strike-rate study', 'Measure productive visits vs orders; fix conversion.', 'R&I / Sales'],
      ['SKU focus', 'Protect top 10 SKUs; rationalize or re-launch bottom SKUs.', 'Marketing'],
      ['Competitive response', 'Price & availability audit + counter-promotion in high-risk zones.', 'Trade Marketing'],
      ['Data quality', 'Resolve January gap, test-data SR and unmapped territories.', 'IT / Data'],
    ];
    $('#content').querySelector('[data-view-panel="initiatives"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Initiatives</div><div class="section-desc">Recommended actions to resolve the pain points</div></div></div>' +
      '<div class="card"><div class="card-title">Recommended Initiatives</div>' +
      tbl(['#', 'Initiative', 'Detail', 'Owner'], init.map((i, k) => [k + 1, '<b>' + i[0] + '</b>', esc(i[1]), esc(i[2])]), [0]) + '</div>';
  }

  /* ---------- 08 RESOURCES & ADVANTAGE ---------- */
  function renderStrategy() {
    const list = (items) => items.map(i => '<div class="detail-row"><span class="lbl">' + esc(i[0]) + '</span><span class="val" style="text-align:left;font-weight:400">' + esc(i[1]) + '</span></div>').join('');
    const tangible = [['Distribution network','529 distributors · 145,920 outlets · 59 zones · 551 territories'],['Sales force','532 officers · 6-day route × 70–80 outlets/day'],['Product portfolio','59 SKUs — rice, atta, maida, salt, oil, suji'],['Manufacturing & supply','Akij Group production & commodity sourcing'],['Financial backing','Akij Group — diversified conglomerate']];
    const intangible = [['Brand','Akij — trusted household name'],['Data & RTM infrastructure','iBOS RTM, BI dashboards, data pipelines'],['Market intelligence','R&I team — forecasting, audits, KPI governance'],['Human capital','Experienced research professionals']];
    const cap = ['Route-to-Market execution','Data-driven market intelligence','Commodity price forecasting','KPI & performance governance','Distribution & channel management','Staple-food portfolio management'];
    const adv = [['Distribution reach','deep, hard-to-replicate outlet network'],['Brand trust','household name, mass-market pull'],['Data-driven decisions','RTM analytics → diagnostic → research'],['Commodity scale','cost & supply-chain advantage'],['Group diversification','financial resilience']];
    $('#content').querySelector('[data-view-panel="strategy"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">Resources, Capabilities &amp; Competitive Advantage</div></div></div>' +
      '<div class="grid grid-2 mb18"><div class="card"><div class="card-title">Resources — Tangible</div>' + list(tangible) + '</div><div class="card"><div class="card-title">Resources — Intangible</div>' + list(intangible) + '</div></div>' +
      '<div class="grid grid-2">' +
        '<div class="card"><div class="card-title">Capabilities</div>' + cap.map(c => '<div class="detail-row"><span class="lbl">' + esc(c) + '</span></div>').join('') + '</div>' +
        '<div class="card"><div class="card-title">Competitive Advantage</div>' + list(adv) + '</div>' +
      '</div>';
  }

  /* ---------- 09 VRIO ---------- */
  function renderVrio() {
    const vrio = [
      { name: 'Brand (Akij)', v: 9, r: 8, i: 9, o: 8 },
      { name: 'Distribution network', v: 9, r: 8, i: 7, o: 9 },
      { name: 'Group diversification', v: 8, r: 8, i: 7, o: 8 },
      { name: 'RTM data & analytics', v: 8, r: 6, i: 6, o: 8 },
      { name: 'Commodity sourcing & scale', v: 8, r: 6, i: 6, o: 7 },
      { name: 'Sales force', v: 7, r: 3, i: 3, o: 7 },
    ];
    const vs = d => (d.v * 0.30 + d.r * 0.25 + d.i * 0.25 + d.o * 0.20) * 10;
    const ranked = vrio.map(d => Object.assign({}, d, { s: vs(d) })).sort((a, b) => b.s - a.s);
    const rate = s => s >= 80 ? ['Sustained Advantage', 'pill-pos'] : s >= 60 ? ['Temporary Advantage', 'pill-warn'] : ['Competitive Parity', 'pill-gray'];
    $('#content').querySelector('[data-view-panel="vrio"]').innerHTML =
      '<div class="section-head"><div><div class="section-title">VRIO Analysis</div><div class="section-desc">Advantage Score = (0.30×V + 0.25×R + 0.25×I + 0.20×O) × 10</div></div></div>' +
      '<div class="card mb18"><div class="card-title">Chart 3 — VRIO Advantage Score (0–100)</div><div class="chart-box md"><canvas id="cVrio"></canvas></div></div>' +
      '<div class="card"><div class="card-title">VRIO Scorecard</div>' +
      tbl(['Resource / Capability', 'V', 'R', 'I', 'O', 'Score', 'Rating'], ranked.map(d => { const rt = rate(d.s); return ['<b>' + esc(d.name) + '</b>', d.v, d.r, d.i, d.o, '<b>' + d.s.toFixed(1) + '</b>', '<span class="pill ' + rt[1] + '">' + rt[0] + '</span>']; }), [1, 2, 3, 4, 5]) + '</div>';
    mk('cVrio', { type: 'bar', data: { labels: ranked.map(d => d.name), datasets: [{ data: ranked.map(d => +d.s.toFixed(1)), backgroundColor: ranked.map(d => d.s >= 80 ? PAL.green : d.s >= 60 ? PAL.amber : PAL.gray), borderRadius: 4 }] }, dlFmt: v => v.toFixed(1), options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100, ticks: { callback: v => v } } } } });
  }

  /* ---------- router ---------- */
  const renderers = { ytd: renderYtd, zone: renderZone, territory: renderTerritory, manpower: renderManpower, sku: renderSku, painpoints: renderPainPoints, initiatives: renderInitiatives, strategy: renderStrategy, vrio: renderVrio };
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
    renderView('ytd');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
