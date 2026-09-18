# AEL RTM Data Dictionary & Analytical Dataset Documentation

**Prepared for:** Market Intelligence / Research & Insights (R&I) function
**Source:** iBOS RTM (iBOSDDD) via RTM MCP endpoint
**Business unit:** Akij Essential (Distributor) — BU `144`, hierarchy `L1 = 22600`
**Data period:** 2026-01-01 → Till Date (extraction date 2026-09-19)

---

## 1. Data Inventory

| Dataset | Records | Columns | Date Range | Purpose |
| ------- | ------: | ------: | ---------- | ------- |
| `rtm.tblOutletDeliveryHeader` | 1,673,782 | 48 | 2023-10-12 – 2026-09-19 | Secondary-sales delivery fact (territory, distributor, outlet, route, beat, amount) |
| `rtm.tblOutletDeliveryRow` | 2,807,662 | 37 | via header | Delivery line items (SKU, quantity, value, discount) |
| `rtm.tblMemoTargetSetup` | 12,351 | 24 | 2025 – 2026 | Memo (order) target by territory / month |
| `rtm.tblTerritoryInfoSetup` | 13,434 | 44 | — | Territory hierarchy L1–L15 (company → division → zone → point → SO) |
| `rtm.tblSalesForceDetails` | 94 | 17 | — | Employee ↔ territory assignment (sparse) |
| `rtm.tblEmployeeTerritory` | 34 | 16 | — | Employee ↔ territory (alternative, sparse) |

**Distinct counts (2026, BU 144):** 551 territories · 64 zones (L7) · 437 points (L8) · 529 distributors · 145,920 outlets · 59 SKUs · 532 sales officers.

---

## 2. Standard Master Hierarchy

```
NATIONAL
   ↓
DIVISION  (hierarchy NL5 / NL6)
   ↓
ZONE      (hierarchy NL7)
   ↓
POINT     (hierarchy NL8)
   ↓
TERRITORY (hierarchy NL9 = "SO" sales-officer territory)
   ↓
DISTRIBUTOR  (strBusinessPartnerName)
   ↓
OUTLET       (intOutletId / strOutletName)
```

Product hierarchy:

```
SKU  (strProductName)   ← 59 SKUs (no category/brand fields available in source)
```

**Note:** `region` and `area` fields exist in `tblMemoTargetSetup` (`strRegionName`, `strAreaName`) but use a *different* taxonomy (East / West / Section) than the delivery hierarchy. They are kept separate and not merged into the sales fact table to avoid mixing inconsistent hierarchies.

---

## 3. Data Dictionary (source → standard)

### Sales fact (`tblOutletDeliveryHeader` / `tblOutletDeliveryRow`)

| Original Field | Standard Field | Type | Definition |
| -------------- | -------------- | ---- | ---------- |
| `dteDeliveryDate` | `date` | date | Delivery date (YYYY-MM-DD) |
| `YEAR/MONTH(dteDeliveryDate)` | `year`, `month_num` | int | Time dimensions |
| `intBusinessUnitId` | `business_unit` | int | Filtered to 144 (AEL) |
| `intTerritoryid` (L9) | `territory_id` | int | SO territory |
| `strTerritoryName` | `territory` | text | Territory / SO name |
| `NL5/NL6` (hierarchy) | `division` | text | Division |
| `NL7` (hierarchy) | `zone` | text | Zone |
| `NL8` (hierarchy) | `point` | text | Point |
| `intBusinessPartnerId` | `distributor_id` | int | Distributor id |
| `strBusinessPartnerName` | `distributor` | text | Distributor name |
| `intOutletId` | `outlet_id` | int | Outlet id |
| `intActionBy` | `sales_officer_id` | int | Recording employee |
| `numTotalDeliveryAmount` | `sales_value` | numeric | Gross value (BDT) |
| `numTotalNetAmount` | `net_sales` | numeric | Net value |
| `numTotalDiscountAmount` | `discount` | numeric | Discount |
| `r.strProductName` | `sku` | text | SKU |
| `r.numDeliveryQuantity` | `quantity` | numeric | Units |
| `r.numDeliveryAmount` | `sku_sales_value` | numeric | SKU value |

### Target (`tblMemoTargetSetup`)

| Original Field | Standard Field | Type | Definition |
| -------------- | -------------- | ---- | ---------- |
| `strTerritoryName` | `territory` | text | Territory (Section/SO naming — mixed) |
| `strRegionName` | `region` | text | Region (legacy taxonomy) |
| `strAreaName` | `area` | text | Area (legacy taxonomy) |
| `intYear` / `intMonth` | `year` / `month_num` | int | Target period |
| `intTotalMemoTarget` | `memo_target` | int | Memo/order target (count) |

### Manpower (`tblSalesForceDetails`)

| Original Field | Standard Field | Type | Definition |
| -------------- | -------------- | ---- | ---------- |
| `intTerritoryId` | `territory_id` | int | Territory |
| `strEmployeeName` | `employee` | text | Employee name |
| `strEmployeeCode` | `employee_code` | text | Employee code |

---

## 4. Data Standardization Rules

| Rule | Applied |
| ---- | ------- |
| Dates → `YYYY-MM-DD` | Yes (fact month mapped to `YYYY-MM-01`) |
| Numbers → numeric (strip commas/currency) | Yes |
| Missing → `NULL` (not `0`) | Yes (0 is preserved only when source is 0) |
| Names preserved in `original_*` field | Not applicable (single source naming) |
| Business unit filter | `intBusinessUnitId = 144`, hierarchy `L1 = 22600` |

**Target reconciliation:** `tblMemoTargetSetup` provides *memo (order) counts* and is recorded sporadically (not every month per territory). The **official BDT target** comes from the AEL distributor SR monthly report (zone × month) and is used as the BDT `sales_target` in the fact table. Memo targets are retained separately as `memo_target`.

---

## 5. Derived Fields

| Field | Formula |
| ----- | ------- |
| `achievement_pct` | `actual_sales / sales_target × 100` |
| `sales_gap` | `sales_target − actual_sales` |
| `growth_3m_pct` | `(recent 3 mo − previous 3 mo) / previous 3 mo × 100` |
| `growth_mom_pct` | `(current month − previous month) / previous month × 100` |
| `avg_unit_price` | `sku_sales_value / quantity` |
| `sales_per_officer` | `sales_value / active sales officers` (532) |
| `outlet_load` | `active outlets / active sales officers` = 145,920 / 532 ≈ 274 |

Derived fields are only calculated when the required numerator/denominator is available.

---

## 6. Data Quality Summary

| Check | Result |
| ----- | ------ |
| Completeness | See `QC Completeness` sheet — zero-target and zero-actual records flagged |
| Duplicates (territory × zone × month) | See `QC Reconciliation` — hierarchy aggregates reconcile to national |
| National = Σ zones | Reconciles (difference < 1 BDT) |
| Date coverage | Jan–Sep 2026; January and September are partial |
| Outliers | See `QC Outliers` sheet — top-value and zero-sales records flagged |

---

## 7. Data Not Available (do NOT fabricate)

| Field | Status |
| ----- | ------ |
| Competitor price / share | Not Available — no competitor data in source |
| Outlet coverage / visit frequency | Not Available — only aggregate outlet counts |
| Customer-level segmentation / purchase frequency | Not Available — no per-outlet attributes |
| Distributor-level *sales* before extraction | Added — distributor × month sales now extracted |
| Category / brand (product) | Not Available — SKU name only |
| YoY growth | Not Available — single complete year (2026) |
| Employee workload / attendance | Not Available — only employee↔territory assignment |

---

## 8. Output Files

- `AEL_RTM_Master_Analytical_Dataset.xlsx` — master analytical workbook (9 sheets: Data Inventory, Data Dictionary, Sales Fact, Distributor Fact, SKU Fact, Dim Zone, QC Completeness, QC Reconciliation, QC Outliers)
- `js/data.js` — live analytical snapshot used by the dashboards (regenerated hourly from RTM)

---

## 9. Assumptions & Limitations

1. **Target** = official BDT target (PDF report) joined at zone × month; memo targets are counts and are not treated as BDT.
2. **January** delivery data appears incomplete in RTM (rollout) and is flagged.
3. **Employee mapping** is sparse (94 records) — the fact table uses *territory* as the sales-unit key; `employee` is attached only where a valid territory↔employee link exists.
4. **No estimation** — missing fields remain `NULL`; no values are imputed.
5. **Correlation ≠ causation** — any cross-variable relationship in later analysis must be labelled "associated with", not "caused by".
