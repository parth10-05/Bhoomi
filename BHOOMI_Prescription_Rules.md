# BHOOMI — Prescription Rules
**City: Ahmedabad | Grid Size: 3km × 3km**

---

## Rule 1 — Plantation Patch

**Trigger condition:**
- Vegetation index (NDVI) of the grid is below 0.15
- AND the grid has less than 50% built-up area

**What it means:**
The grid has critically low vegetation and enough open land to plant.

**Where the action happens:**
The grid itself.

**Priority:**
- Critical (1) if NDVI is below 0.08
- High (2) if NDVI is between 0.08 and 0.15

**Recommended action:**
Plant native species. Suggested: Neem, Peepal, Banyan.
Target density 400 trees per hectare.
Expected timeline to establishment: 18–24 months.

---

## Rule 2 — Green Buffer

**Trigger condition:**
- AQI of the receiving grid is above 150
- AND at least one grid within 15km in the upwind direction has SO2 above 60 µg/m³ or NO2 above 80 µg/m³

**What it means:**
A grid is being hit by industrial pollution carried by the wind from a nearby source grid.

**Where the action happens:**
The boundary grid between the source and the receiving grid — not in either of them.
This is where a tree wall physically blocks the pollution transport path.

**Priority:**
Always Critical (1).

**Recommended action:**
Three-row dense tree barrier: fast-growing outer row (Eucalyptus), middle row (Neem), inner row (Casuarina or Bamboo).
Minimum width 15–20 metres.
Expected AQI reduction at receiver: 20–35% once established.
Timeline: 18 months.

---

## Rule 3 — Cooling Corridor

**Trigger condition:**
- At least one neighbouring grid (within 4.5km) has a land surface temperature above 42°C
- AND the current grid has NDVI below 0.20
- AND the current grid has less than 55% built-up area

**What it means:**
A nearby grid is suffering from urban heat island effect. The current grid has available land and can host tree planting that will cool the hot neighbour through shade and evapotranspiration.

**Where the action happens:**
The current grid — planting here cools the neighbouring hot grid.

**Priority:**
High (2).

**Recommended action:**
Tree-lined corridor along road edges and open plots.
Suggested species: Gulmohar (fast shade, flowering), Banyan (wide canopy).
Tree spacing: 8 metres.
Expected LST reduction in neighbouring grid: 1.2–1.8°C within 3 years.

---

## Rule 4 — Drought Recharge

**Trigger condition (either one):**
- The grid's own Vegetation Health Index (VHI) is below 0.25
- OR 4 or more of the 8 surrounding grids have VHI below 0.25

**What it means:**
Either the grid is already in drought stress, or it is surrounded by drought-stressed grids and at high risk of drought spreading into it within weeks.

**Where the action happens:**
The grid itself.

**Priority:**
- Critical (1) if own VHI is below 0.15
- High (2) if triggered by surrounding grids only

**Recommended action:**
Check dam construction at low-lying points within the grid.
Percolation pits every 500 sqm of open space.
Rooftop rainwater harvesting for buildings above 200 sqm.
Timeline: 6 months to see measurable soil moisture improvement.

---

## Rule 5 — Windbreak

**Trigger condition:**
- AQI is above 120
- AND wind speed is above 4.0 m/s
- AND bare or exposed soil covers more than 30% of the grid

**What it means:**
High-speed wind blowing over bare land is picking up dust and raising air pollution levels. A physical barrier is needed to break the wind before it reaches exposed soil.

**Where the action happens:**
The grid itself. The barrier is oriented perpendicular to the prevailing wind direction.

**Priority:**
High (2).

**Recommended action:**
Linear row of hardy species suited to arid soil: Casuarina or Prosopis.
Minimum barrier width: 5 metres.
Combine with ground cover seeding to fix the soil surface.
Timeline: 18 months.

---

## How Intervention Location Is Determined

For Rules 1, 3, 4, and 5 — the action always happens inside the grid that triggered the rule.

For Rule 2 (Green Buffer) — the action happens in a third grid that sits between the pollution source and the receiving grid. This boundary grid is found by looking at all grids whose centre point falls between the two. If no such grid exists (the source and receiver are directly adjacent), the action defaults to the receiving grid itself.

---

## Deduplication

If two different grids both independently trigger the same rule type at the same intervention location, only one prescription is kept — the one with the higher priority (lower priority number).

---

## Priority Scale

| Priority | Label | Meaning |
|---|---|---|
| 1 | Critical | Immediate action required |
| 2 | High | Action within 3 months |
| 3 | Medium | Action within 6 months |
| 4 | Low | Plan for next annual cycle |

---

## Implementer Reference

| Rule | Responsible Body |
|---|---|
| Plantation Patch | AMC Parks Department |
| Green Buffer | GPCB + AMC jointly |
| Cooling Corridor | AMC Roads Department |
| Drought Recharge | GWRDC + AMC jointly |
| Windbreak | Gujarat Forest Department |
