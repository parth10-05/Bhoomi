/**
 * BHOOMI Prescription Rules Engine
 * City: Ahmedabad | Grid Size: 3km × 3km
 *
 * Evaluates 5 prescriptive rules against a grid's observation data
 * and its spatial neighbourhood to generate actionable interventions.
 */
import type { CellObservation } from '../types/domain';

/* ── Output types ─────────────────────────────────────────── */

export interface EvidenceItem {
    label: string;
    value: string;
    status: 'critical' | 'high' | 'moderate' | 'normal';
}

export interface GridPrescription {
    ruleId: string;
    ruleNumber: number;
    ruleName: string;
    priority: 1 | 2 | 3 | 4;
    priorityLabel: 'Critical' | 'High' | 'Medium' | 'Low';
    triggerSummary: string;
    meaning: string;
    recommendedAction: string;
    interventionGrid: string;
    sourceGrid?: string;
    responsibleBody: string;
    timeline: string;
    expectedImpact: string;
    evidence: EvidenceItem[];
}

/* ── Helpers ──────────────────────────────────────────────── */

function parseGridId(id: string): { prefix: string; row: number; col: number } | null {
    const match = id.match(/^(.+?)_R(\d+)_C(\d+)$/);
    if (!match) return null;
    return { prefix: match[1], row: parseInt(match[2], 10), col: parseInt(match[3], 10) };
}

function buildGridId(prefix: string, row: number, col: number): string {
    return `${prefix}_R${String(row).padStart(3, '0')}_C${String(col).padStart(3, '0')}`;
}

function shortId(cellId: string): string {
    return cellId.split('_').slice(-2).join('_');
}

/** Returns observations for all grids within ±range rows/cols of the target. */
function getNeighbors(
    cellId: string,
    obsMap: Map<string, CellObservation>,
    range = 1,
): CellObservation[] {
    const parsed = parseGridId(cellId);
    if (!parsed) return [];

    const out: CellObservation[] = [];
    for (let dr = -range; dr <= range; dr++) {
        for (let dc = -range; dc <= range; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nId = buildGridId(parsed.prefix, parsed.row + dr, parsed.col + dc);
            const obs = obsMap.get(nId);
            if (obs) out.push(obs);
        }
    }
    return out;
}

/** Build an observation lookup map once (called from evaluatePrescriptions). */
function buildObsMap(allObs: CellObservation[]): Map<string, CellObservation> {
    const map = new Map<string, CellObservation>();
    for (const o of allObs) map.set(o.cell_id, o);
    return map;
}

/** Get built-up percentage — prefer built_pct, fall back to urban_fraction×100. */
function builtPct(obs: CellObservation): number {
    if (obs.built_pct != null) return obs.built_pct;
    return (obs.urban_fraction ?? 0) * 100;
}

/** Convert NO₂ ppb → µg/m³ (at 25 °C, 1 atm: 1 ppb ≈ 1.88 µg/m³). */
function no2PpbToUgm3(ppb: number): number {
    return ppb * 1.88;
}

/* ── Rule evaluators ─────────────────────────────────────── */

function evalRule1(cellId: string, obs: CellObservation): GridPrescription | null {
    const ndvi = obs.ndvi_mean;
    const built = builtPct(obs);
    if (ndvi >= 0.15 || built >= 50) return null;

    const priority: 1 | 2 = ndvi < 0.08 ? 1 : 2;

    return {
        ruleId: 'R1',
        ruleNumber: 1,
        ruleName: 'Plantation Patch',
        priority,
        priorityLabel: priority === 1 ? 'Critical' : 'High',
        triggerSummary: `NDVI ${ndvi.toFixed(3)} < 0.15 and built-up ${built.toFixed(0)}% < 50%`,
        meaning:
            'The grid has critically low vegetation and enough open land to plant.',
        recommendedAction:
            'Plant native species — Neem, Peepal, Banyan. Target density 400 trees per hectare. Expected timeline to establishment: 18–24 months.',
        interventionGrid: cellId,
        responsibleBody: 'AMC Parks Department',
        timeline: '18–24 months',
        expectedImpact:
            'Significant NDVI improvement (+0.08–0.15) and local cooling (−1.5–3.0 °C) over 2–3 years.',
        evidence: [
            { label: 'NDVI', value: ndvi.toFixed(3), status: ndvi < 0.08 ? 'critical' : 'high' },
            { label: 'Built-up Area', value: `${built.toFixed(0)}%`, status: built > 40 ? 'moderate' : 'normal' },
            { label: 'Bare Ground', value: `${(obs.bare_pct ?? 0).toFixed(0)}%`, status: (obs.bare_pct ?? 0) > 30 ? 'high' : 'normal' },
            { label: 'LST', value: `${(obs.lst_mean ?? 0).toFixed(1)} °C`, status: (obs.lst_mean ?? 0) > 42 ? 'critical' : (obs.lst_mean ?? 0) > 35 ? 'high' : 'normal' },
        ],
    };
}

function evalRule2(
    cellId: string,
    obs: CellObservation,
    obsMap: Map<string, CellObservation>,
): GridPrescription | null {
    const aqi = obs.aqi_proxy ?? 0;
    if (aqi <= 150) return null;

    // Search grids within 5 cells (~15 km) for pollution sources
    const parsed = parseGridId(cellId);
    if (!parsed) return null;

    const candidates = getNeighbors(cellId, obsMap, 5);

    for (const src of candidates) {
        const so2 = src.so2_ugm3 ?? 0;
        const no2Ugm3 = no2PpbToUgm3(src.no2_ppb ?? 0);

        if (so2 <= 60 && no2Ugm3 <= 80) continue;

        // Found a pollution source — compute intervention (boundary) grid
        const sParsed = parseGridId(src.cell_id);
        if (!sParsed) continue;

        const midRow = Math.round((parsed.row + sParsed.row) / 2);
        const midCol = Math.round((parsed.col + sParsed.col) / 2);
        let interventionId = buildGridId(parsed.prefix, midRow, midCol);

        // If source and receiver are adjacent, intervention defaults to receiver
        if (interventionId === cellId || interventionId === src.cell_id) {
            interventionId = cellId;
        }

        const pollutant =
            so2 > 60
                ? `SO₂ ${so2.toFixed(0)} µg/m³ (> 60)`
                : `NO₂ ${no2Ugm3.toFixed(0)} µg/m³ (> 80)`;

        return {
            ruleId: 'R2',
            ruleNumber: 2,
            ruleName: 'Green Buffer',
            priority: 1,
            priorityLabel: 'Critical',
            triggerSummary: `AQI ${aqi.toFixed(0)} > 150; upwind source ${shortId(src.cell_id)} has ${pollutant}`,
            meaning:
                'The grid is being hit by industrial pollution carried by wind from a nearby source grid.',
            recommendedAction:
                'Three-row dense tree barrier — outer: Eucalyptus, middle: Neem, inner: Casuarina or Bamboo. Minimum width 15–20 m. Expected AQI reduction at receiver: 20–35% once established.',
            interventionGrid: interventionId,
            sourceGrid: src.cell_id,
            responsibleBody: 'GPCB + AMC jointly',
            timeline: '18 months',
            expectedImpact: '20–35% AQI reduction at receiver grid once barrier is established.',
            evidence: [
                { label: 'Receiver AQI', value: aqi.toFixed(0), status: aqi > 200 ? 'critical' : 'high' },
                { label: 'Source SO₂', value: `${so2.toFixed(0)} µg/m³`, status: so2 > 60 ? 'critical' : 'normal' },
                { label: 'Source NO₂', value: `${no2Ugm3.toFixed(0)} µg/m³`, status: no2Ugm3 > 80 ? 'critical' : 'normal' },
                { label: 'Wind Speed', value: `${(obs.wind_speed_ms ?? 0).toFixed(1)} m/s`, status: 'normal' },
                { label: 'Wind Dir', value: `${(obs.wind_dir_deg ?? 0).toFixed(0)}°`, status: 'normal' },
            ],
        };
    }

    return null;
}

function evalRule3(
    cellId: string,
    obs: CellObservation,
    obsMap: Map<string, CellObservation>,
): GridPrescription | null {
    const ndvi = obs.ndvi_mean;
    const built = builtPct(obs);
    if (ndvi >= 0.20 || built >= 55) return null;

    // Neighbors within 4.5 km → ~1.5 grids → immediate 8 neighbors
    const neighbors = getNeighbors(cellId, obsMap, 1);
    const hotNeighbors = neighbors.filter((n) => (n.lst_mean ?? 0) > 42);

    if (hotNeighbors.length === 0) return null;

    const hottest = hotNeighbors.reduce((a, b) =>
        (a.lst_mean ?? 0) > (b.lst_mean ?? 0) ? a : b,
    );

    return {
        ruleId: 'R3',
        ruleNumber: 3,
        ruleName: 'Cooling Corridor',
        priority: 2,
        priorityLabel: 'High',
        triggerSummary: `Neighbor ${shortId(hottest.cell_id)} at ${(hottest.lst_mean ?? 0).toFixed(1)} °C > 42 °C; NDVI ${ndvi.toFixed(3)} < 0.20; built ${built.toFixed(0)}% < 55%`,
        meaning:
            'A nearby grid is suffering from urban heat island effect. This grid has available land that can host cooling plantation.',
        recommendedAction:
            'Tree-lined corridor along road edges and open plots. Species: Gulmohar (fast shade), Banyan (wide canopy). Tree spacing: 8 m. Expected LST reduction in neighbour: 1.2–1.8 °C within 3 years.',
        interventionGrid: cellId,
        responsibleBody: 'AMC Roads Department',
        timeline: '36 months',
        expectedImpact: '1.2–1.8 °C LST reduction in the neighbouring hot grid within 3 years.',
        evidence: [
            { label: 'Neighbor LST', value: `${(hottest.lst_mean ?? 0).toFixed(1)} °C`, status: 'critical' },
            { label: 'Hot Neighbors', value: `${hotNeighbors.length}`, status: hotNeighbors.length >= 3 ? 'critical' : 'high' },
            { label: 'Own NDVI', value: ndvi.toFixed(3), status: ndvi < 0.10 ? 'critical' : 'high' },
            { label: 'Own LST', value: `${(obs.lst_mean ?? 0).toFixed(1)} °C`, status: (obs.lst_mean ?? 0) > 42 ? 'critical' : (obs.lst_mean ?? 0) > 35 ? 'high' : 'normal' },
            { label: 'Built-up', value: `${built.toFixed(0)}%`, status: 'normal' },
        ],
    };
}

function evalRule4(
    cellId: string,
    obs: CellObservation,
    obsMap: Map<string, CellObservation>,
): GridPrescription | null {
    const selfVhi = obs.vhi ?? 1; // default high so rule doesn't fire on missing data
    const neighbors = getNeighbors(cellId, obsMap, 1);
    const lowVhiCount = neighbors.filter((n) => (n.vhi ?? 1) < 0.25).length;

    const selfTrigger = selfVhi < 0.25;
    const neighborTrigger = lowVhiCount >= 4;

    if (!selfTrigger && !neighborTrigger) return null;

    const priority: 1 | 2 = selfVhi < 0.15 ? 1 : 2;

    const triggerParts: string[] = [];
    if (selfTrigger) triggerParts.push(`VHI ${selfVhi.toFixed(3)} < 0.25`);
    if (neighborTrigger) triggerParts.push(`${lowVhiCount}/8 neighbors below VHI 0.25`);

    return {
        ruleId: 'R4',
        ruleNumber: 4,
        ruleName: 'Drought Recharge',
        priority,
        priorityLabel: priority === 1 ? 'Critical' : 'High',
        triggerSummary: triggerParts.join(' and '),
        meaning: selfTrigger
            ? 'The grid is already in drought stress with critically low vegetation health.'
            : 'Surrounded by drought-stressed grids — high risk of drought spreading into this grid within weeks.',
        recommendedAction:
            'Check dam construction at low-lying points. Percolation pits every 500 sq m of open space. Rooftop rainwater harvesting for buildings above 200 sq m. Timeline: 6 months for measurable soil moisture improvement.',
        interventionGrid: cellId,
        responsibleBody: 'GWRDC + AMC jointly',
        timeline: '6 months',
        expectedImpact: 'Measurable soil moisture improvement within 6 months; VHI recovery +0.10–0.20 over 18 months.',
        evidence: [
            { label: 'VHI', value: selfVhi.toFixed(3), status: selfVhi < 0.15 ? 'critical' : selfVhi < 0.25 ? 'high' : 'normal' },
            { label: 'Low-VHI Neighbors', value: `${lowVhiCount}/8`, status: lowVhiCount >= 4 ? 'high' : 'normal' },
            { label: 'Soil Moisture', value: `${(obs.soil_moisture_am ?? 0).toFixed(3)}`, status: (obs.soil_moisture_am ?? 0) < 0.07 ? 'critical' : (obs.soil_moisture_am ?? 0) < 0.10 ? 'high' : 'normal' },
            { label: 'Drought Risk', value: obs.drought_risk != null ? `${(obs.drought_risk * 100).toFixed(0)}%` : '—', status: (obs.drought_risk ?? 0) > 0.5 ? 'critical' : (obs.drought_risk ?? 0) > 0.3 ? 'high' : 'normal' },
            { label: 'Rainfall', value: obs.rainfall_mm != null ? `${obs.rainfall_mm.toFixed(1)} mm` : '—', status: (obs.rainfall_mm ?? 100) < 20 ? 'high' : 'normal' },
        ],
    };
}

function evalRule5(cellId: string, obs: CellObservation): GridPrescription | null {
    const aqi = obs.aqi_proxy ?? 0;
    const wind = obs.wind_speed_ms ?? 0;
    const bare = obs.bare_pct ?? 0;

    if (aqi <= 120 || wind <= 4.0 || bare <= 30) return null;

    return {
        ruleId: 'R5',
        ruleNumber: 5,
        ruleName: 'Windbreak',
        priority: 2,
        priorityLabel: 'High',
        triggerSummary: `AQI ${aqi.toFixed(0)} > 120; wind ${wind.toFixed(1)} m/s > 4.0; bare soil ${bare.toFixed(0)}% > 30%`,
        meaning:
            'High-speed wind blowing over bare land is picking up dust and raising air pollution. A physical barrier is needed.',
        recommendedAction:
            'Linear row of hardy species suited to arid soil: Casuarina or Prosopis. Minimum barrier width: 5 m. Combine with ground cover seeding to fix the soil surface. Barrier perpendicular to prevailing wind direction.',
        interventionGrid: cellId,
        responsibleBody: 'Gujarat Forest Department',
        timeline: '18 months',
        expectedImpact: 'Significant dust reduction and 20–35% AQI improvement downwind once established.',
        evidence: [
            { label: 'AQI', value: aqi.toFixed(0), status: aqi > 200 ? 'critical' : 'high' },
            { label: 'Wind Speed', value: `${wind.toFixed(1)} m/s`, status: wind > 6 ? 'critical' : 'high' },
            { label: 'Bare Soil', value: `${bare.toFixed(0)}%`, status: bare > 40 ? 'critical' : 'high' },
            { label: 'Wind Dir', value: `${(obs.wind_dir_deg ?? 0).toFixed(0)}°`, status: 'normal' },
        ],
    };
}

/* ── Main entry point ────────────────────────────────────── */

/**
 * Evaluate all 5 BHOOMI prescription rules for a given grid cell.
 *
 * @param cellId        Full grid ID (e.g. "GJ_AHM_R010_C010")
 * @param obs           The observation row for this cell
 * @param allObs        All observations for the month (used to check neighbours)
 * @returns             Array of triggered prescriptions, sorted by priority
 */
export function evaluatePrescriptions(
    cellId: string,
    obs: CellObservation,
    allObs: CellObservation[],
): GridPrescription[] {
    // Build the lookup map ONCE — shared across all rules
    const obsMap = buildObsMap(allObs);
    const results: GridPrescription[] = [];

    const r1 = evalRule1(cellId, obs);
    if (r1) results.push(r1);

    const r2 = evalRule2(cellId, obs, obsMap);
    if (r2) results.push(r2);

    const r3 = evalRule3(cellId, obs, obsMap);
    if (r3) results.push(r3);

    const r4 = evalRule4(cellId, obs, obsMap);
    if (r4) results.push(r4);

    const r5 = evalRule5(cellId, obs);
    if (r5) results.push(r5);

    // Dedup: if two prescriptions target the same intervention grid with the same rule,
    // keep only the highest priority (lowest number).
    const seen = new Map<string, GridPrescription>();
    for (const rx of results) {
        const key = `${rx.ruleId}::${rx.interventionGrid}`;
        const existing = seen.get(key);
        if (!existing || rx.priority < existing.priority) {
            seen.set(key, rx);
        }
    }

    return Array.from(seen.values()).sort((a, b) => a.priority - b.priority);
}

/** Priority colour helpers (re-usable by UI). */
export const PRIORITY_COLORS: Record<number, { text: string; bg: string; border: string }> = {
    1: { text: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/30' },
    2: { text: 'text-orange-400', bg: 'bg-orange-500/15', border: 'border-orange-500/30' },
    3: { text: 'text-yellow-400', bg: 'bg-yellow-500/15', border: 'border-yellow-500/30' },
    4: { text: 'text-blue-400', bg: 'bg-blue-500/15', border: 'border-blue-500/30' },
};

/** Human-readable rule icons mapping. */
export const RULE_ICONS: Record<string, string> = {
    R1: '🌱',
    R2: '🛡️',
    R3: '❄️',
    R4: '💧',
    R5: '🌬️',
};
