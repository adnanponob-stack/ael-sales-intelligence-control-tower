# AEL Sales Intelligence Control Tower

A management intelligence & decision-support dashboard for **Akij Essential Limited (AEL)**, built from real distributor SR monthly sales data (Jan – Sep 2026).

It connects the full intelligence cycle:

**Sales Performance → Sales Signals → Root Cause → Intelligence Research → Business Impact → Management Action → Impact Monitoring**

---

## Features

- **14 intelligence modules** — Executive Overview, Sales Performance, Geographic, Manpower, Customer, Competitor, Market Intelligence, Signal Center, Root Cause, CI Research Queue, Business Impact, Management Action, Impact Monitoring, Data Quality
- **Bangladesh Zone Health Map** — 59 zones with a configurable health model (achievement, trend, persistence, recovery, volatility, coverage), 4 view-by modes, and click-through intelligence drawers
- **Sales Signal Engine** — auto-generated signals across performance, manpower, customer, competitor & market categories with severity, persistence, and estimated impact
- **CI Research Queue & Action Tracker** — signals converted into research assignments and management actions with owners and deadlines
- **Executive storytelling** — a generated Management Intelligence Summary that reads the live data
- Global filters (month, scope, DSM, zone, SR), global search, notification center, CSV export, light/dark mode

---

## Run locally

The dashboard is a static site. Open `index.html` in a browser (needs internet for the Chart.js + Inter font CDNs), or serve it:

```bash
python -m http.server 8000
# open http://localhost:8000
```

---

## Project structure

```
index.html
css/style.css            # corporate theme (light/dark, responsive)
js/data.js               # data layer — replace to integrate CSV/Excel/API
js/utils.js              # calculations, configurable health engine, reference data
js/signals.js            # signal engine + research program + actions + monitoring
js/charts.js             # Chart.js builders
js/map.js                # Bangladesh SVG zone health map
js/app.js                # router, filters, drawers, search, notifications, export
```

---

## Data

- `js/data.js` currently contains the **real** AEL Distributor SR Monthly dataset (3,888 SR-month records, 59 zones, 323 points, 425 SRs, 6 DSMs), extracted from the Jan–Sep 2026 report.
- Customer, distributor, competitor, and market reference data is seeded deterministically and can be replaced with live RTM/ERP data without changing the UI.

## Brand

Akij Essential brand colors (extracted from the official presentation template):

- Red `#EE1D24`
- Deep navy `#0D1F4E`
- White `#FFFFFF`

## Tech

HTML5 · CSS3 · Vanilla JS · Chart.js (CDN). No build step.
