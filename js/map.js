/* ============================================================
   AEL Control Tower — map.js
   Full Bangladesh choropleth map (zone-wise colour), Leaflet
   ============================================================ */
const ZoneMap = (function () {
  let map = null, geoLayer = null, currentContainer = null, onClickCb = null;
  const BD_BOUNDS = [[20.4, 87.8], [26.9, 92.9]];

  // AEL zone -> GADM district (NAME_2)
  const ZONE_TO_DISTRICT = {
    "Agrabad Zone": "Chittagong", "Bagerhat Zone": "Bagerhat", "Barishal Zone": "Barisal",
    "Bhola Zone": "Bhola", "Bogura Zone": "Bogra", "Brahmanbaria Zone": "Brahamanbaria",
    "Chakbazar Zone": "Dhaka", "Chandpur Zone": "Chandpur", "Chokoria Zone": "Cox'SBazar",
    "Cox's Bazar Zone": "Cox'SBazar", "Cumilla North Zone": "Comilla", "Cumilla South Zone": "Comilla",
    "Dhanmondi Zone": "Dhaka", "Dinajpur Zone": "Dinajpur", "Faridpur Zone": "Faridpur",
    "Feni Zone": "Feni", "Gazipur Zone": "Gazipur", "Gulshan Zone": "Dhaka",
    "Hobiganj Zone": "Habiganj", "Jamalpur Zone": "Jamalpur", "Jatrabari Zone": "Dhaka",
    "Jessore Zone": "Jessore", "Jhalokathi Zone": "Jhalokati", "Jhenaidah Zone": "Jhenaidah",
    "Keraniganj Zone": "Dhaka", "Khagrachori Zone": "Khagrachhari", "Khulna Zone": "Khulna",
    "Kishoreganj Zone": "Kishoreganj", "Kustia Zone": "Kushtia", "Lakshmipur Zone": "Lakshmipur",
    "Madaripur Zone": "Madaripur", "Malibag Zone": "Dhaka", "Manikganj Zone": "Manikganj",
    "Mawna Zone": "Gazipur", "Mirpur Zone": "Dhaka", "Moulvibazar Zone": "Maulvibazar",
    "Munshiganj Zone": "Munshiganj", "Mymensingh Zone": "Mymensingh", "Naogaon Zone": "Naogaon",
    "Narayanganj Zone": "Narayanganj", "Narsingdi Zone": "Narsingdi", "Netrokona Zone": "Netrakona",
    "Noakhali Zone": "Noakhali", "Pabna Zone": "Pabna", "Panchagarh Zone": "Panchagarh",
    "Patuakhali Zone": "Patuakhali", "Rajshahi Zone": "Rajshahi", "Rangpur Zone": "Rangpur",
    "Satkania Zone": "Chittagong", "Satkhira Zone": "Satkhira", "Savar Zone": "Dhaka",
    "Shitakunda Zone": "Chittagong", "Sirajganj Zone": "Sirajganj", "Sonargaon Zone": "Narayanganj",
    "Sunamganj Zone": "Sunamganj", "Sylhet Zone": "Sylhet", "Tangail Zone": "Tangail",
    "Tongi Zone": "Gazipur", "Uttara Zone": "Dhaka"
  };

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
    },
    competitor: (st, z) => {
      const c = (typeof REF !== 'undefined' && REF.compZone && REF.compZone[z]) ? REF.compZone[z] : null;
      if (!c) return '#C9D2DC';
      let s = 0;
      if (c.priceGap < -6) s += 3; else if (c.priceGap < -3) s += 2; else if (c.priceGap < 0) s += 1;
      if (c.availability > 0.85) s += 3; else if (c.availability > 0.7) s += 2; else if (c.availability > 0.5) s += 1;
      if (c.distribution > 0.85) s += 2; else if (c.distribution > 0.7) s += 1;
      if (c.promo) s += 1;
      if (s >= 7) return '#C83E4D'; if (s >= 5) return '#E07B2C'; if (s >= 3) return '#D99A00'; return '#16845B';
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
    map = L.map(el, {
      center: [23.685, 90.356], zoom: 7, zoomControl: true, scrollWheelZoom: false,
      minZoom: 7, maxZoom: 12, maxBounds: BD_BOUNDS, maxBoundsViscosity: 1.0
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 18
    }).addTo(map);
    geoLayer = L.layerGroup().addTo(map);
    currentContainer = containerId;
    setTimeout(() => { if (map) map.invalidateSize(); }, 80);
  }

  function tipHtml(z, st, metric) {
    const h = st.health;
    const metricLabel = { health: 'Signal Health', achievement: 'Achievement', gap: 'Sales Gap', signals: 'Critical Signals', competitor: 'Competitor Risk' }[metric] || 'Health';
    let mv = '—';
    if (metric === 'achievement') mv = h.subscores.achievement != null ? h.subscores.achievement.toFixed(0) + '%' : '—';
    else if (metric === 'gap') mv = 'BDT ' + FMT.money((st.gapLakh || 0) * 100000);
    else if (metric === 'signals') mv = (st.sigCount || 0) + ' critical';
    else if (metric === 'competitor') {
      const c = (typeof REF !== 'undefined' && REF.compZone && REF.compZone[z]) ? REF.compZone[z] : null;
      mv = c ? (c.priceGap >= 0 ? '+' : '') + c.priceGap.toFixed(1) + '% price gap' : 'No data';
    } else mv = Health.label(h.band);
    return '<div style="font-family:Inter,sans-serif;min-width:160px">' +
      '<div style="font-weight:700;margin-bottom:4px">' + z + '</div>' +
      '<div>Health: <b style="color:' + (Charts.PAL.health[h.band] || '#999') + '">' + Health.label(h.band) + '</b></div>' +
      '<div>' + metricLabel + ': <b>' + mv + '</b></div>' +
      '<div>Achievement: <b>' + (h.subscores.achievement != null ? h.subscores.achievement.toFixed(0) + '%' : '—') + '</b></div>' +
      '</div>';
  }

  function render(containerId, metric, stats, onZoneClick) {
    const el = document.getElementById(containerId);
    const needBuild = !map || currentContainer !== containerId || !el || !el.contains(map.getContainer());
    if (needBuild) build(containerId);
    onClickCb = onZoneClick;
    if (!map || !geoLayer || !window.BD_GEO) return;
    geoLayer.clearLayers();
    const colorFn = metricColor[metric] || metricColor.health;

    // district -> [zones]
    const dz = {};
    Object.keys(stats).forEach(z => {
      const d = ZONE_TO_DISTRICT[z];
      if (d) { (dz[d] = dz[d] || []).push(z); }
    });
    const best = zones => {
      let b = zones[0], bs = -1;
      zones.forEach(z => { const s = stats[z].series.reduce((x, m) => x + m.a, 0); if (s > bs) { bs = s; b = z; } });
      return b;
    };

    L.geoJSON(window.BD_GEO, {
      style: f => {
        const zones = dz[f.properties.d];
        if (!zones) return { color: '#ffffff', weight: 0.6, fillColor: '#C9D2DC', fillOpacity: 0.55 };
        const b = best(zones);
        return { color: '#ffffff', weight: 0.9, fillColor: colorFn(stats[b], b), fillOpacity: 0.85 };
      },
      onEachFeature: (f, layer) => {
        const zones = dz[f.properties.d];
        if (!zones) return;
        const b = best(zones);
        layer.bindTooltip(tipHtml(b, stats[b], metric), { sticky: true });
        layer.on('click', () => { if (onClickCb) onClickCb(b); });
      }
    }).addTo(geoLayer);
  }

  return { build, render };
})();
