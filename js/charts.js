/* ============================================================
   AEL Control Tower — charts.js  (Chart.js builders)
   ============================================================ */
const Charts = (function () {
  const registry = {};
  const PAL = {
    navy: '#C8161B', darkblue: '#EE1D24', slate: '#475569',
    pos: '#16845B', warn: '#D99A00', neg: '#C83E4D', crit: '#8B1E2D', info: '#3B82C4',
    health: { healthy: '#16845B', watch: '#D99A00', risk: '#E07B2C', critical: '#C83E4D', nodata: '#A9B4C0' }
  };

  function cssVar(name) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return v ? v.trim() : null;
  }

  function theme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      grid: cssVar('--border') || (dark ? '#243140' : '#E3E8EF'),
      text: cssVar('--muted') || (dark ? '#8CA3B8' : '#5B6B7E'),
      tick: dark ? '#8CA3B8' : '#5B6B7E'
    };
  }

  function base(extra) {
    const t = theme();
    const cfg = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: {
        legend: { labels: { color: t.tick, font: { family: "'Inter', sans-serif", size: 11 }, boxWidth: 12, boxHeight: 12, usePointStyle: true } },
        tooltip: {
          backgroundColor: PAL.navy, titleColor: '#fff', bodyColor: '#EAF2F9',
          padding: 10, cornerRadius: 8, boxPadding: 4
        }
      },
      scales: {
        x: { grid: { color: t.grid, drawBorder: false }, ticks: { color: t.tick, font: { size: 10.5 } } },
        y: { grid: { color: t.grid }, ticks: { color: t.tick, font: { size: 10.5 } } }
      }
    };
    return deepMerge(cfg, extra || {});
  }

  function deepMerge(a, b) {
    const o = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    Object.keys(b || {}).forEach(k => {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') o[k] = deepMerge(a[k], b[k]);
      else o[k] = b[k];
    });
    return o;
  }

  function make(id, config) {
    if (typeof Chart === 'undefined') return null;
    if (registry[id]) { try { registry[id].destroy(); } catch (e) {} }
    const el = document.getElementById(id);
    if (!el) return null;
    registry[id] = new Chart(el.getContext('2d'), config);
    return registry[id];
  }

  function moneyLabel(v) { return v == null ? '—' : Math.round(v).toLocaleString('en-IN'); }

  return {
    PAL,
    destroy(id) { if (registry[id]) { registry[id].destroy(); delete registry[id]; } },
    destroyAll() { Object.keys(registry).forEach(k => { try { registry[k].destroy(); } catch (e) {} }); Object.keys(registry).forEach(k => delete registry[k]); },

    /* National trend: target + actual (bars/lines) + achievement % */
    trend(id, labels, target, actual, ach) {
      return make(id, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'line', label: 'Target', data: target, borderColor: PAL.slate, backgroundColor: PAL.slate, pointRadius: 2, borderWidth: 2, tension: .3, yAxisID: 'y' },
            { type: 'line', label: 'Actual', data: actual, borderColor: PAL.darkblue, backgroundColor: PAL.darkblue, pointRadius: 3, borderWidth: 2.5, tension: .3, fill: false, yAxisID: 'y' },
            { type: 'line', label: 'Achievement %', data: ach, borderColor: PAL.pos, backgroundColor: PAL.pos, pointRadius: 2, borderWidth: 1.5, borderDash: [5, 4], yAxisID: 'y1' }
          ]
        },
        options: base({
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { grid: { color: theme().grid, drawBorder: false }, ticks: { color: theme().tick, font: { size: 10.5 } } },
            y: { position: 'left', title: { display: true, text: 'BDT', color: theme().tick, font: { size: 10 } }, grid: { color: theme().grid }, ticks: { color: theme().tick, font: { size: 10.5 }, callback: v => 'BDT ' + FMT.money(v) } },
            y1: { position: 'right', title: { display: true, text: 'Achievement %', color: PAL.pos, font: { size: 10 } }, grid: { drawOnChartArea: false }, ticks: { color: PAL.pos, font: { size: 10.5 }, callback: v => v + '%' } }
          }
        })
      });
    },

    /* Grouped bar: target vs actual */
    targetActual(id, labels, target, actual) {
      return make(id, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Target', data: target, backgroundColor: 'rgba(71,85,105,.25)', borderRadius: 4, barPercentage: .6, categoryPercentage: .7 },
            { label: 'Actual', data: actual, backgroundColor: PAL.darkblue, borderRadius: 4, barPercentage: .6, categoryPercentage: .7 }
          ]
        },
        options: base({
          scales: { x: { grid: { drawOnChartArea: false }, ticks: { color: theme().tick } }, y: { title: { display: true, text: 'BDT', color: theme().tick, font: { size: 10 } }, ticks: { callback: v => 'BDT ' + FMT.money(v) } } }
        })
      });
    },

    /* Performance: value (BDT) + volume (orders) + share % */
    perf(id, labels, target, actual, volume, share) {
      const t = theme();
      return make(id, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar', label: 'Target (BDT)', data: target, backgroundColor: 'rgba(71,85,105,.22)', yAxisID: 'y', borderRadius: 3, barPercentage: .65, categoryPercentage: .7, order: 3 },
            { type: 'bar', label: 'Actual (BDT)', data: actual, backgroundColor: PAL.darkblue, yAxisID: 'y', borderRadius: 3, barPercentage: .65, categoryPercentage: .7, order: 2 },
            { type: 'line', label: 'Volume (orders)', data: volume, borderColor: PAL.info, backgroundColor: PAL.info, yAxisID: 'y1', pointRadius: 2, borderWidth: 2, tension: .3, order: 0 },
            { type: 'line', label: 'Share %', data: share, borderColor: PAL.warn, backgroundColor: PAL.warn, yAxisID: 'y2', pointRadius: 3, borderWidth: 2, borderDash: [5, 4], tension: .3, order: 1 }
          ]
        },
        options: base({
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { grid: { display: false }, ticks: { color: t.tick } },
            y: { position: 'left', title: { display: true, text: 'BDT', color: t.tick, font: { size: 10 } }, grid: { color: t.grid }, ticks: { color: t.tick, callback: v => 'BDT ' + FMT.money(v) } },
            y1: { position: 'right', title: { display: true, text: 'Volume', color: PAL.info, font: { size: 10 } }, grid: { drawOnChartArea: false }, ticks: { color: PAL.info, callback: v => FMT.money(v) } },
            y2: { position: 'right', offset: true, title: { display: true, text: 'Share %', color: PAL.warn, font: { size: 10 } }, min: 0, grid: { display: false }, ticks: { color: PAL.warn, callback: v => v + '%' } }
          }
        })
      });
    },

    /* Horizontal bar with per-item colors */
    hbar(id, labels, values, colorFn, unit) {
      unit = unit || 'BDT';
      return make(id, {
        type: 'bar',
        data: { labels, datasets: [{ data: values, backgroundColor: values.map((v, i) => colorFn ? colorFn(v, i) : PAL.darkblue), borderRadius: 4, barThickness: 16 }] },
        options: base({
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { title: { display: true, text: unit, color: theme().tick, font: { size: 10 } }, grid: { color: theme().grid }, ticks: { callback: v => (unit === 'BDT' ? 'BDT ' : '') + FMT.money(v) } },
            y: { grid: { display: false }, ticks: { color: theme().tick, font: { size: 10.5 } } }
          }
        })
      });
    },

    /* Scatter (productivity matrix) */
    scatter(id, points, xLabel, yLabel) {
      return make(id, {
        type: 'scatter',
        data: { datasets: [{ label: 'Employees', data: points, backgroundColor: PAL.darkblue, pointRadius: 5, pointHoverRadius: 7 }] },
        options: base({
          plugins: { legend: { display: false } },
          scales: {
            x: { title: { display: true, text: xLabel || 'Target', color: theme().tick, font: { size: 11 } } },
            y: { title: { display: true, text: yLabel || 'Achievement %', color: theme().tick, font: { size: 11 } } }
          }
        })
      });
    },

    /* Pareto: bars + cumulative line */
    pareto(id, labels, values) {
      const sorted = values.map((v, i) => ({ v, l: labels[i] })).sort((a, b) => b.v - a.v);
      const total = sorted.reduce((s, x) => s + x.v, 0) || 1;
      let run = 0;
      const cum = sorted.map(x => { run += x.v; return (run / total) * 100; });
      return make(id, {
        type: 'bar',
        data: {
          labels: sorted.map(x => x.l),
          datasets: [
            { type: 'bar', label: 'Sales', data: sorted.map(x => x.v), backgroundColor: PAL.darkblue, borderRadius: 3, yAxisID: 'y', order: 2 },
            { type: 'line', label: 'Cumulative %', data: cum, borderColor: PAL.warn, backgroundColor: PAL.warn, yAxisID: 'y1', order: 1, pointRadius: 2, tension: .3 }
          ]
        },
        options: base({
          plugins: { legend: { labels: { color: theme().tick } } },
          scales: {
            x: { grid: { display: false }, ticks: { maxRotation: 90, minRotation: 45, font: { size: 9 } } },
            y: { ticks: { callback: v => 'BDT ' + FMT.money(v) } },
            y1: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%', color: PAL.warn } }
          }
        })
      });
    },

    /* Donut */
    donut(id, labels, values, colors) {
      return make(id, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: values, backgroundColor: colors || [PAL.navy, PAL.darkblue, PAL.slate, PAL.info, PAL.warn], borderWidth: 0, hoverOffset: 4 }] },
        options: base({
          cutout: '62%',
          plugins: { legend: { position: 'bottom', labels: { color: theme().tick, font: { size: 10.5 }, usePointStyle: true, boxWidth: 8 } } }
        })
      });
    },

    /* Line (generic) */
    line(id, labels, series, opts) {
      opts = opts || {};
      return make(id, {
        type: 'line',
        data: { labels, datasets: series.map(s => ({ label: s.label, data: s.data, borderColor: s.color || PAL.darkblue, backgroundColor: s.fill ? (s.color || PAL.darkblue) : 'transparent', tension: .3, pointRadius: 2, borderWidth: 2, fill: !!s.fill })) },
        options: base({ scales: { y: { ticks: { callback: opts.pct ? (v => v + '%') : undefined } } } })
      });
    },

    /* Customer activity: customers (bars) + sales officers (line, right axis) */
    custMonthly(id, labels, customers, officers) {
      const t = theme();
      return make(id, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar', label: 'Active Customers', data: customers, backgroundColor: PAL.darkblue, yAxisID: 'y', borderRadius: 3, order: 2 },
            { type: 'line', label: 'Active Sales Officers', data: officers, borderColor: PAL.pos, backgroundColor: PAL.pos, yAxisID: 'y1', pointRadius: 3, borderWidth: 2, tension: .3, order: 1 }
          ]
        },
        options: base({
          scales: {
            x: { grid: { display: false }, ticks: { color: t.tick } },
            y: { title: { display: true, text: 'Customers', color: t.tick, font: { size: 10 } }, ticks: { color: t.tick, callback: v => FMT.money(v) } },
            y1: { position: 'right', title: { display: true, text: 'Sales Officers', color: PAL.pos, font: { size: 10 } }, grid: { drawOnChartArea: false }, ticks: { color: PAL.pos } }
          }
        })
      });
    }
  };
})();
