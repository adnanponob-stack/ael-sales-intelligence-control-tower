/* ============================================================
   AEL Control Tower — map.js
   Schematic Bangladesh map with zone health markers (SVG)
   ============================================================ */
const ZoneMap = (function () {
  const W = 380, H = 470, PAD = 20;
  const lngMin = 88.0, lngMax = 92.7, latMin = 20.55, latMax = 26.75;

  // approximate Bangladesh outline (lng, lat)
  const outline = [
    [88.05, 26.55], [88.55, 26.30], [89.05, 26.05], [89.55, 26.30], [90.10, 26.55],
    [91.20, 26.20], [92.05, 25.75], [92.45, 25.30], [92.30, 24.90], [92.05, 24.55],
    [92.45, 24.10], [92.60, 23.50], [92.55, 22.80], [92.35, 22.30], [92.00, 21.85],
    [92.05, 21.30], [91.60, 21.70], [91.15, 22.15], [90.70, 22.35], [90.30, 22.30],
    [89.80, 21.95], [89.40, 21.85], [89.00, 22.10], [88.90, 22.60], [89.05, 23.10],
    [89.30, 23.70], [89.20, 24.30], [88.75, 24.60], [88.55, 25.00], [88.40, 25.60], [88.10, 26.10]
  ];

  function px(lng) { return PAD + ((lng - lngMin) / (lngMax - lngMin)) * (W - PAD * 2); }
  function py(lat) { return PAD + ((latMax - lat) / (latMax - latMin)) * (H - PAD * 2); }

  let svg = null, markerLayer = null, tooltip = null, onClickCb = null, currentContainer = null;

  const metricColor = {
    health: h => Charts.PAL.health[h.band] || '#A9B4C0',
    achievement: h => {
      const a = h.subscores.achievement;
      if (a == null) return '#A9B4C0';
      if (a >= 100) return '#16845B'; if (a >= 90) return '#D99A00';
      if (a >= 70) return '#E07B2C'; return '#C83E4D';
    },
    gap: h => {
      const g = h.gapLakh || 0;
      if (g <= 0) return '#16845B'; if (g < 40) return '#D99A00';
      if (g < 150) return '#E07B2C'; return '#C83E4D';
    },
    signals: h => {
      const n = h.sigCount || 0;
      if (n === 0) return '#16845B'; if (n <= 2) return '#D99A00';
      if (n <= 4) return '#E07B2C'; return '#C83E4D';
    }
  };

  function build(containerId) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '';
    c.style.position = 'relative';

    const ns = 'http://www.w3.org/2000/svg';
    svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.width = '100%'; svg.style.height = '100%'; svg.style.display = 'block';

    const dark = () => document.documentElement.getAttribute('data-theme') === 'dark';
    const land = document.createElementNS(ns, 'path');
    land.setAttribute('d', pathD());
    land.setAttribute('fill', dark() ? '#16283A' : '#EAF1F7');
    land.setAttribute('stroke', dark() ? '#2C4256' : '#C7D6E4');
    land.setAttribute('stroke-width', '1.5');
    land.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(land);

    // subtle water label
    const bay = document.createElementNS(ns, 'text');
    bay.setAttribute('x', px(90.6)); bay.setAttribute('y', py(21.7));
    bay.setAttribute('fill', dark() ? '#3A5268' : '#B9CBD9');
    bay.setAttribute('font-size', '9'); bay.setAttribute('font-family', "'Inter',sans-serif");
    bay.textContent = 'Bay of Bengal';
    svg.appendChild(bay);

    markerLayer = document.createElementNS(ns, 'g');
    svg.appendChild(markerLayer);
    c.appendChild(svg);

    tooltip = document.createElement('div');
    tooltip.className = 'map-tip';
    c.appendChild(tooltip);
    currentContainer = containerId;
  }

  function pathD() {
    return outline.map((p, i) => (i === 0 ? 'M' : 'L') + px(p[0]).toFixed(1) + ' ' + py(p[1]).toFixed(1)).join(' ') + ' Z';
  }

  function render(containerId, metric, stats, onZoneClick) {
    if (!svg || currentContainer !== containerId) build(containerId);
    onClickCb = onZoneClick;
    if (!markerLayer) return;
    markerLayer.innerHTML = '';
    const colorFn = metricColor[metric] || metricColor.health;
    const ns = 'http://www.w3.org/2000/svg';

    Object.keys(stats).forEach(z => {
      const coord = AEL_DATA.zoneCoord[z];
      if (!coord) return;
      const st = stats[z];
      const cx = px(coord[1]), cy = py(coord[0]);
      const sales = st.series.reduce((s, m) => s + m.a, 0);
      const r = Math.min(11, 4.5 + Math.sqrt(sales) / 900);
      const color = colorFn(st.health);

      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'map-zone');
      g.style.cursor = 'pointer';

      if (st.health.band === 'critical') {
        const halo = document.createElementNS(ns, 'circle');
        halo.setAttribute('cx', cx); halo.setAttribute('cy', cy); halo.setAttribute('r', r + 5);
        halo.setAttribute('fill', color); halo.setAttribute('opacity', '.15');
        g.appendChild(halo);
      }
      const c1 = document.createElementNS(ns, 'circle');
      c1.setAttribute('cx', cx); c1.setAttribute('cy', cy); c1.setAttribute('r', r);
      c1.setAttribute('fill', color);
      c1.setAttribute('stroke', '#FFFFFF'); c1.setAttribute('stroke-width', '1.2');
      g.appendChild(c1);

      g.addEventListener('mousemove', e => showTip(e, z, st, metric));
      g.addEventListener('mouseleave', () => { if (tooltip) tooltip.style.display = 'none'; });
      g.addEventListener('click', () => { if (onClickCb) onClickCb(z); });
      markerLayer.appendChild(g);
    });
  }

  function showTip(e, z, st, metric) {
    if (!tooltip) return;
    const rect = svg.getBoundingClientRect();
    const h = st.health;
    const metricLabel = { health: 'Signal Health', achievement: 'Achievement', gap: 'Sales Gap', signals: 'Critical Signals' }[metric] || 'Health';
    tooltip.innerHTML =
      '<div class="mt-name">' + z + '</div>' +
      '<div class="mt-row"><span>Health</span><b class="h-' + h.band + '">' + Health.label(h.band) + '</b></div>' +
      '<div class="mt-row"><span>' + metricLabel + '</span><b>' + metricTipValue(h, metric) + '</b></div>' +
      '<div class="mt-row"><span>Achievement</span><b>' + (h.subscores.achievement != null ? h.subscores.achievement.toFixed(0) + '%' : '—') + '</b></div>';
    tooltip.style.display = 'block';
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    tooltip.style.left = (x + 14) + 'px';
    tooltip.style.top = (y + 10) + 'px';
  }

  function metricTipValue(h, metric) {
    if (metric === 'achievement') return h.subscores.achievement != null ? h.subscores.achievement.toFixed(0) + '%' : '—';
    if (metric === 'gap') return 'BDT ' + FMT.money(h.gapLakh * 100000);
    if (metric === 'signals') return (h.sigCount || 0) + ' critical';
    return Health.label(h.band);
  }

  return { build, render };
})();
