/* ============================================================
   AEL Control Tower — map.js
   Full Bangladesh map (Leaflet) with zone health markers
   ============================================================ */
const ZoneMap = (function () {
  let map = null, layerGroup = null, currentContainer = null, onClickCb = null;

  const metricColor = {
    health: st => Charts.PAL.health[st.health.band] || '#A9B4C0',
    achievement: st => {
      const a = st.health.subscores.achievement;
      if (a == null) return '#A9B4C0';
      if (a >= 100) return '#16845B'; if (a >= 90) return '#D99A00';
      if (a >= 70) return '#E07B2C'; return '#C83E4D';
    },
    gap: st => {
      const g = st.gapLakh || 0;
      if (g <= 0) return '#16845B'; if (g < 40) return '#D99A00';
      if (g < 150) return '#E07B2C'; return '#C83E4D';
    },
    signals: st => {
      const n = st.sigCount || 0;
      if (n === 0) return '#16845B'; if (n <= 2) return '#D99A00';
      if (n <= 4) return '#E07B2C'; return '#C83E4D';
    }
  };

  function build(containerId) {
    if (typeof L === 'undefined') {
      const el = document.getElementById(containerId);
      if (el) el.innerHTML = '<div class="empty">Map library unavailable (offline)</div>';
      return;
    }
    if (map) { map.remove(); map = null; }
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    el.style.height = el.getAttribute('data-h') || '480px';
    map = L.map(el, { center: [23.685, 90.356], zoom: 7, zoomControl: true, scrollWheelZoom: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 18
    }).addTo(map);
    layerGroup = L.layerGroup().addTo(map);
    currentContainer = containerId;
    setTimeout(() => { if (map) map.invalidateSize(); }, 80);
  }

  function tipHtml(z, st, metric) {
    const h = st.health;
    const metricLabel = { health: 'Signal Health', achievement: 'Achievement', gap: 'Sales Gap', signals: 'Critical Signals' }[metric] || 'Health';
    let mv = '—';
    if (metric === 'achievement') mv = h.subscores.achievement != null ? h.subscores.achievement.toFixed(0) + '%' : '—';
    else if (metric === 'gap') mv = 'BDT ' + FMT.money((st.gapLakh || 0) * 100000);
    else if (metric === 'signals') mv = (st.sigCount || 0) + ' critical';
    else mv = Health.label(h.band);
    return '<div style="font-family:Inter,sans-serif;min-width:150px">' +
      '<div style="font-weight:700;margin-bottom:4px">' + z + '</div>' +
      '<div>Health: <b class="h-' + h.band + '" style="color:' + (Charts.PAL.health[h.band] || '#999') + '">' + Health.label(h.band) + '</b></div>' +
      '<div>' + metricLabel + ': <b>' + mv + '</b></div>' +
      '<div>Achievement: <b>' + (h.subscores.achievement != null ? h.subscores.achievement.toFixed(0) + '%' : '—') + '</b></div>' +
      '</div>';
  }

  function render(containerId, metric, stats, onZoneClick) {
    if (!map || currentContainer !== containerId) build(containerId);
    onClickCb = onZoneClick;
    if (!map || !layerGroup) return;
    layerGroup.clearLayers();
    const colorFn = metricColor[metric] || metricColor.health;

    Object.keys(stats).forEach(z => {
      const coord = AEL_DATA.zoneCoord[z];
      if (!coord) return;
      const st = stats[z];
      const sales = st.series.reduce((s, m) => s + m.a, 0);
      const r = Math.min(14, 6 + Math.sqrt(sales) / 700);
      const color = colorFn(st);

      const m = L.circleMarker([coord[0], coord[1]], {
        radius: r, color: '#ffffff', weight: 1.4, fillColor: color, fillOpacity: 0.9
      }).addTo(layerGroup);
      m.bindTooltip(tipHtml(z, st, metric), { sticky: true, direction: 'top' });
      m.on('click', () => { if (onClickCb) onClickCb(z); });
    });
  }

  return { build, render };
})();
