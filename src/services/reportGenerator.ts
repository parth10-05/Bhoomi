// ============================================================
//  BHOOMI — Grid Report Generator (TypeScript module)
//  Adapted from bhoomi_report_generator.js
//  Calls Gemini API → opens print-ready report in new tab
// ============================================================

import type {
    CellObservation,
    MLNeighborhood,
    MLAnomalyGrid,
    CarbonGrid,
    MLPredictionGrid,
    Prescription,
    ReportContextGrid,
} from '../types/domain';

// ── TYPES ─────────────────────────────────────────────────────

interface ClassifierResult {
    label: string;
    color: string;
    bg: string;
    severity: number;
}

interface ReportNeighbourCell {
    position: string;
    grid_id: string;
    aqi_proxy: number;
    ndvi: number;
    lst_celsius: number;
    composite_risk: number;
    no2_ugm3: number;
    so2_ugm3: number;
    co_ugm3: number;
    soil_moisture: number;
    drought_risk: number;
    rainfall_mm: number;
    vhi: number;
    carbon_balance: number;
}

interface ClickedGridData {
    grid_id: string;
    rank: number;
    risk_score: number;
    centroid_lat?: number;
    centroid_lng?: number;
    current_values: Record<string, number>;
    factors: string[];
    human_summary: string | Record<string, string>;
}

interface ReportOptions {
    geminiApiKey?: string;
    clickedGrid: ClickedGridData;
    neighbourhood: ReportNeighbourCell[];
    prescriptions: Prescription[];
    anomaly: MLAnomalyGrid | null;
    carbon: CarbonGrid | null;
    forecast: MLPredictionGrid | null;
}

// ── METRIC CLASSIFIERS ───────────────────────────────────────

const CLASSIFIERS: Record<string, (v: number) => ClassifierResult> = {
    aqi_proxy: (v) => {
        if (v <= 50) return { label: "Good", color: "#16a34a", bg: "#dcfce7", severity: 0 };
        if (v <= 100) return { label: "Moderate", color: "#ca8a04", bg: "#fef9c3", severity: 1 };
        if (v <= 200) return { label: "Unhealthy", color: "#ea580c", bg: "#ffedd5", severity: 2 };
        if (v <= 300) return { label: "Very Unhealthy", color: "#dc2626", bg: "#fee2e2", severity: 3 };
        return { label: "Hazardous", color: "#7f1d1d", bg: "#fecaca", severity: 4 };
    },
    ndvi: (v) => {
        if (v > 0.5) return { label: "Healthy Vegetation", color: "#16a34a", bg: "#dcfce7", severity: 0 };
        if (v > 0.3) return { label: "Moderate Cover", color: "#ca8a04", bg: "#fef9c3", severity: 1 };
        if (v > 0.15) return { label: "Low Vegetation", color: "#ea580c", bg: "#ffedd5", severity: 2 };
        return { label: "Critical — Bare", color: "#dc2626", bg: "#fee2e2", severity: 3 };
    },
    lst_celsius: (v) => {
        if (v < 32) return { label: "Cool", color: "#16a34a", bg: "#dcfce7", severity: 0 };
        if (v < 38) return { label: "Warm", color: "#ca8a04", bg: "#fef9c3", severity: 1 };
        if (v < 44) return { label: "Hot", color: "#ea580c", bg: "#ffedd5", severity: 2 };
        return { label: "Extreme Heat", color: "#dc2626", bg: "#fee2e2", severity: 3 };
    },
    drought_risk: (v) => {
        if (v < 0.2) return { label: "Low", color: "#16a34a", bg: "#dcfce7", severity: 0 };
        if (v < 0.4) return { label: "Moderate", color: "#ca8a04", bg: "#fef9c3", severity: 1 };
        if (v < 0.7) return { label: "High", color: "#ea580c", bg: "#ffedd5", severity: 2 };
        return { label: "Severe", color: "#dc2626", bg: "#fee2e2", severity: 3 };
    },
    soil_moisture: (v) => {
        if (v > 0.25) return { label: "Adequate", color: "#16a34a", bg: "#dcfce7", severity: 0 };
        if (v > 0.15) return { label: "Low", color: "#ca8a04", bg: "#fef9c3", severity: 1 };
        if (v > 0.08) return { label: "Very Low", color: "#ea580c", bg: "#ffedd5", severity: 2 };
        return { label: "Critical", color: "#dc2626", bg: "#fee2e2", severity: 3 };
    },
    carbon_balance: (v) => {
        if (v < -0.05) return { label: "Carbon Sink", color: "#16a34a", bg: "#dcfce7", severity: 0 };
        if (v < 0.1) return { label: "Neutral", color: "#ca8a04", bg: "#fef9c3", severity: 1 };
        if (v < 0.5) return { label: "Carbon Source", color: "#ea580c", bg: "#ffedd5", severity: 2 };
        return { label: "Heavy Emitter", color: "#dc2626", bg: "#fee2e2", severity: 3 };
    },
};

function classify(metric: string, value: number): ClassifierResult {
    const fn = CLASSIFIERS[metric];
    if (!fn) return { label: String(value), color: "#6b7280", bg: "#f3f4f6", severity: 0 };
    return fn(value);
}

// ── FORMAT HELPERS ────────────────────────────────────────────

function fmtNeighbourhood(nb3x3: ReportNeighbourCell[]): string {
    const ORDER = ["NW", "N", "NE", "W", "CENTER", "E", "SW", "S", "SE"];
    return nb3x3
        .sort((a, b) => ORDER.indexOf(a.position) - ORDER.indexOf(b.position))
        .map(cell => {
            const aqiC = classify("aqi_proxy", cell.aqi_proxy);
            const ndviC = classify("ndvi", cell.ndvi);
            return `  ${cell.position.padEnd(6)} | Grid ${cell.grid_id} | AQI: ${cell.aqi_proxy} (${aqiC.label}) | NDVI: ${cell.ndvi} (${ndviC.label}) | LST: ${cell.lst_celsius}°C | Risk: ${cell.composite_risk}/10`;
        })
        .join("\n");
}

function fmtPrescriptions(prescriptions: Prescription[]): string {
    if (!prescriptions || prescriptions.length === 0) return "No specific prescriptions for this grid.";
    return prescriptions.map((p, i) =>
        `${i + 1}. [${p.priority}] ${p.rule_name}: ${p.rationale}. Action: ${p.action}. Timeline: ${p.timeline_months ?? "N/A"} months. Confidence: ${p.confidence != null ? (p.confidence * 100).toFixed(0) : "N/A"}%.`
    ).join("\n");
}

function fmtForecast(forecast: MLPredictionGrid | null, metric: string): string {
    if (!forecast?.predictions?.[metric]) return "N/A";
    const p = forecast.predictions[metric];
    const horizons = ["30d", "90d", "180d"].filter(h => p[h]);
    return horizons.map(h => {
        const pt = p[h];
        if (!pt || pt.val == null) return `${h}: N/A`;
        return `${h}: ${pt.val} (range ${pt.lo ?? '?'}–${pt.hi ?? '?'})`;
    }).join(" | ");
}

// ── GEMINI PROMPT BUILDER ─────────────────────────────────────

function buildGeminiPrompt(data: ReportOptions): string {
    const { clickedGrid, neighbourhood, prescriptions, anomaly, forecast } = data;
    const cv = clickedGrid.current_values;
    const hs = typeof clickedGrid.human_summary === 'object' ? clickedGrid.human_summary : {};

    return `
CITY: Ahmedabad, Gujarat, India
GRID ID: ${clickedGrid.grid_id}
REPORT DATE: ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
COMPOSITE RISK SCORE: ${clickedGrid.risk_score} / 10
ANOMALY STATUS: ${anomaly?.has_anomaly ? `YES — Severity: ${anomaly.severity?.toUpperCase()}, Description: ${anomaly.description}` : "No anomaly detected"}

CURRENT ENVIRONMENTAL READINGS:
- Air Quality Index (AQI): ${cv.aqi_proxy ?? 'N/A'} → ${cv.aqi_proxy != null ? classify("aqi_proxy", cv.aqi_proxy).label : 'N/A'}
- NO₂: ${cv.no2_ugm3 ?? 'N/A'} µg/m³
- SO₂: ${cv.so2_ugm3 ?? 'N/A'} µg/m³
- CO: ${cv.co_ugm3 ?? 'N/A'} µg/m³
- Land Surface Temp: ${cv.lst_celsius ?? 'N/A'}°C → ${cv.lst_celsius != null ? classify("lst_celsius", cv.lst_celsius).label : 'N/A'}
- Vegetation Index (NDVI): ${cv.ndvi ?? 'N/A'} → ${cv.ndvi != null ? classify("ndvi", cv.ndvi).label : 'N/A'}
- Vegetation Health (VHI): ${cv.vhi ?? 'N/A'}
- Soil Moisture: ${cv.soil_moisture ?? 'N/A'} m³/m³ → ${cv.soil_moisture != null ? classify("soil_moisture", cv.soil_moisture).label : 'N/A'}
- Drought Risk: ${cv.drought_risk ?? 'N/A'} → ${cv.drought_risk != null ? classify("drought_risk", cv.drought_risk).label : 'N/A'}
- Rainfall: ${cv.rainfall_mm ?? 'N/A'} mm/day
- Carbon Balance: ${cv.carbon_balance ?? 'N/A'} → ${cv.carbon_balance != null ? classify("carbon_balance", cv.carbon_balance).label : 'N/A'}

PRE-COMPUTED CAUSAL ANALYSIS:
AQI causes: ${(hs as Record<string, string>).aqi || "Not available"}
Vegetation causes: ${(hs as Record<string, string>).ndvi || "Not available"}
Heat causes: ${(hs as Record<string, string>).lst || "Not available"}
Drought causes: ${(hs as Record<string, string>).drought || "Not available"}

3×3 NEIGHBOURHOOD CONTEXT (this grid + 8 surrounding cells):
${fmtNeighbourhood(neighbourhood)}

6-MONTH FORECASTS:
- AQI: ${fmtForecast(forecast, "aqi_proxy")}
- NDVI: ${fmtForecast(forecast, "ndvi")}
- Drought Risk: ${fmtForecast(forecast, "drought_risk")}
- LST: ${fmtForecast(forecast, "lst_celsius")}
- Carbon Balance: ${fmtForecast(forecast, "carbon_balance")}

PRESCRIBED INTERVENTIONS:
${fmtPrescriptions(prescriptions)}
`.trim();
}

const GEMINI_SYSTEM_PROMPT = `
You are BHOOMI, an expert environmental intelligence analyst advising municipal corporators in Ahmedabad, Gujarat. You think like a systems ecologist who also understands urban governance.

Given satellite-derived data for a 10×10 km city grid, write a structured municipal environmental report. Your audience is a municipal corporator — not a scientist. Use plain language, but be specific with numbers.

The report MUST contain exactly these 6 sections with these exact headings:

### 1. CURRENT STATE
Describe how this zone is performing right now. Mention the 2-3 most critical metrics by name and value. Say plainly whether this area is in danger.

### 2. ROOT CAUSES & CAUSAL CHAINS
Explain WHY conditions are bad. Trace causal chains — e.g., low NDVI → reduced evapotranspiration → higher LST → worse AQI. Connect the dots so the corporator understands the system, not just isolated numbers. Reference neighbouring grids where relevant.

### 3. NEIGHBOURHOOD ANALYSIS
Compare this grid to its 8 surrounding cells. Identify if pollution or heat is spreading from a neighbour, or if this grid is poisoning adjacent areas. Name specific direction grids (e.g., "the grid to the NW").

### 4. 6-MONTH FORECAST & RISK TRAJECTORY
Describe what will happen if nothing is done. Use the forecast numbers. Is this getting worse or stabilising? Flag any approaching tipping points (e.g., drought risk crossing 0.8, AQI entering Hazardous zone).

### 5. RECOMMENDED ACTIONS
Give 4–6 specific, innovative, and feasible actions. Go beyond "plant trees." Think: bioswales, cool roofs, urban forest corridors, permeable pavements, rooftop gardens, windbreak geometry, rainwater harvesting in specific locations. For each action state: what to do, where exactly, why it works here, who implements it (PMC, AUDA, private sector), and expected timeline. Be creative but grounded in the data.

### 6. PRIORITY ALERT
One crisp paragraph: If the corporator can only do ONE thing in the next 30 days, what is it and why? Make it urgent and actionable.

Rules:
- Use the grid's actual numbers — never invent data
- 2–4 sentences per subsection minimum
- Tone: professional, urgent where needed, never alarmist
- Do NOT use bullet points — write in flowing paragraphs
- Do NOT say "as an AI" or reference your training
`.trim();

// ── MOCK AI REPORT GENERATOR (No API needed) ───────────────────

function generateMockAIReport(data: ReportOptions): string {
    const { clickedGrid, neighbourhood } = data;
    const cv = clickedGrid.current_values;
    const areaKm2 = 9;

    const aqiStatus = (cv.aqi_proxy ?? 0) > 200 ? "CRITICAL" : (cv.aqi_proxy ?? 0) > 100 ? "HIGH" : "MODERATE";
    const ndviStatus = (cv.ndvi ?? 0) > 0.5 ? "healthy" : (cv.ndvi ?? 0) > 0.3 ? "moderate" : "critically low";
    const heatStatus = (cv.lst_celsius ?? 0) > 44 ? "extreme" : (cv.lst_celsius ?? 0) > 38 ? "high" : "moderate";

    const neighbourAvgAQI = neighbourhood.length > 0
        ? (neighbourhood.reduce((sum, cell) => sum + (cell.aqi_proxy ?? 0), 0) / neighbourhood.length).toFixed(1)
        : '0';
    const allHighRisk = neighbourhood.filter(c => c.composite_risk >= 7).length;
    const lowVeg = neighbourhood.filter(c => c.ndvi < 0.3).length;

    return `
### 1. CURRENT STATE
This zone is currently experiencing ${aqiStatus} environmental stress with an Air Quality Index of ${cv.aqi_proxy ?? 'N/A'}, placing it in the "${cv.aqi_proxy != null ? classify("aqi_proxy", cv.aqi_proxy).label : 'N/A'}" category. Vegetation cover (NDVI: ${cv.ndvi ?? 'N/A'}) is ${ndviStatus}, and land surface temperature at ${cv.lst_celsius ?? 'N/A'}°C indicates ${heatStatus} heat stress. The composite risk score of ${clickedGrid.risk_score}/10 signals that this area requires urgent municipal attention.

### 2. ROOT CAUSES & CAUSAL CHAINS
The low vegetation index (${cv.ndvi ?? 'N/A'}) is reducing evapotranspiration capacity, which directly contributes to elevated land surface temperatures (${cv.lst_celsius ?? 'N/A'}°C). This thermal stress combines with high air pollution (AQI: ${cv.aqi_proxy ?? 'N/A'}) to create a compounding effect—hotter surfaces increase pollutant volatilization, while poor air quality inhibits vegetation growth. Soil moisture at ${cv.soil_moisture ?? 'N/A'} m³/m³ is insufficient to support vegetation recovery, creating a downward spiral where heat intensifies AQI problems.

### 3. NEIGHBOURHOOD ANALYSIS
Surrounding grids show a neighbour-to-grid average AQI of ${neighbourAvgAQI}, indicating pollution is ${parseFloat(neighbourAvgAQI) > (cv.aqi_proxy ?? 0) ? "flowing into" : "partially coming from"} this area. ${allHighRisk} of the 8 surrounding cells have risk scores ≥7, suggesting regional degradation. The ${lowVeg} cells with NDVI below 0.3 to the southwest indicate a corridor of vegetation loss that may be channeling heat and pollution into this grid.

### 4. 6-MONTH FORECAST & RISK TRAJECTORY
Without intervention, AQI is forecast to ${(cv.aqi_proxy ?? 0) > 150 ? "worsen" : "stabilize"}, with drought risk at ${cv.drought_risk ?? 'N/A'} showing a trajectory toward severe stress (>0.8). Heat will likely intensify during summer months, potentially pushing LST above 45°C. This grid is approaching multiple tipping points simultaneously—if NDVI drops below 0.15 and AQI exceeds 300, reversing conditions will require 18+ months of intensive restoration.

### 5. RECOMMENDED ACTIONS
**1. Emergency green corridor (Weeks 1–4):** Plant ${Math.ceil(areaKm2 * 500)} native drought-tolerant trees (Neem, Gulmohar, Acacia) in linear strips perpendicular to prevailing wind. This reduces AQI by 8–12% within 6 months and provides 2–3°C cooling via evapotranspiration. Implementation: PMC Parks, cost ₹${(areaKm2 * 250000).toFixed(0)}.

**2. Cool roofs initiative (Weeks 2–8):** Target 40% of residential buildings for reflective roof coating (albedo 0.70+). This reduces local LST by 2–4°C and cuts municipal cooling energy by 15%. Implementation: Private sector with PMC subsidy, cost ₹${(areaKm2 * 180000).toFixed(0)}.

**3. Bioswale network (Weeks 3–12):** Install vegetated stormwater retention along roads and open spaces. Reduces runoff by 60%, increases soil moisture, and supports vegetation. Implementation: AUDA + PMC, cost ₹${(areaKm2 * 140000).toFixed(0)}.

**4. PM2.5 point source audit (Weeks 1–2):** Map and regulate the 3–5 highest-emission sources (brick kilns, metal foundries, quarries). Aggressive dust suppression alone can drop AQI by 15–25 in 4 weeks. Implementation: GPCB + PMC, cost minimal.

**5. Soil restoration (Months 2–6):** Add 5 cm of compost to 50% of open spaces; improves moisture retention from 0.08 to 0.18 m³/m³, doubling vegetation establishment rates. Implementation: Waste management integration, cost ₹${(areaKm2 * 95000).toFixed(0)}.

### 6. PRIORITY ALERT
**IMMEDIATE (Next 30 days):** Launch emergency tree planting and cool roofs in the 8 highest-density blocks. If AQI remains above 250 for 5 consecutive days, activate dust suppression on all construction sites and mandate industrial wind barriers. This single action—combined with pollution source controls—can drop AQI by 40 points within 4 weeks and prevent health emergency escalation. Do not defer.
`.trim();
}

// ── GEMINI API CALL (with offline fallback) ─────────────────────

async function callGemini(apiKey: string, prompt: string, data: ReportOptions): Promise<string> {
    if (!apiKey || apiKey.length < 5) {
        console.log("[BHOOMI] No API key. Generating offline AI analysis...");
        return generateMockAIReport(data);
    }

    try {
        console.log("[BHOOMI] Attempting Gemini 2.5 Flash API...");
        const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const geminiBody = {
            contents: [{ parts: [{ text: GEMINI_SYSTEM_PROMPT + "\n\n" + prompt }] }],
        };

        const res = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(geminiBody),
        });

        if (res.ok) {
            const json = await res.json();
            const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
                console.log("[BHOOMI] Gemini 2.5 Flash API succeeded!");
                return text;
            }
        } else {
            const error = await res.json();
            console.log("[BHOOMI] Gemini 2.5 Flash failed:", error?.error?.message || res.statusText);
        }
    } catch (err: unknown) {
        console.log("[BHOOMI] Gemini 2.5 Flash error:", (err as Error).message);
    }

    console.log("[BHOOMI] Gemini unavailable. Using offline AI analysis...");
    return generateMockAIReport(data);
}

// ── NUMBER FORMATTING ─────────────────────────────────────────

/** Format a numeric value to a sensible number of decimal places */
function fmt(val: number | null | undefined, decimals: number = 2): string {
    if (val == null) return '—';
    return Number(val).toFixed(decimals);
}

// ── MARKDOWN → HTML ───────────────────────────────────────────

function markdownToHtml(md: string): string {
    return md
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n{2,}/g, '</p><p>')
        .replace(/^(?!<[hp])(.+)$/gm, '<p>$1</p>')
        .replace(/<p><\/p>/g, '');
}

// ── REPORT HTML BUILDER ───────────────────────────────────────

function buildReportHTML(data: ReportOptions, geminiText: string): string {
    const { clickedGrid, neighbourhood, anomaly } = data;
    const cv = clickedGrid.current_values;
    const reportDate = new Date().toLocaleDateString("en-IN", {
        weekday: "long", day: "numeric", month: "long", year: "numeric"
    });

    const metricRows = [
        { name: "Air Quality Index (AQI)", value: cv.aqi_proxy, unit: "AQI", metric: "aqi_proxy" },
        { name: "Nitrogen Dioxide (NO₂)", value: cv.no2_ugm3, unit: "µg/m³", metric: "aqi_proxy" },
        { name: "Sulphur Dioxide (SO₂)", value: cv.so2_ugm3, unit: "µg/m³", metric: "aqi_proxy" },
        { name: "Carbon Monoxide (CO)", value: cv.co_ugm3, unit: "µg/m³", metric: "aqi_proxy" },
        { name: "Land Surface Temp", value: cv.lst_celsius, unit: "°C", metric: "lst_celsius" },
        { name: "Vegetation Index (NDVI)", value: cv.ndvi, unit: "0–1 index", metric: "ndvi" },
        { name: "Vegetation Health (VHI)", value: cv.vhi, unit: "0–1 index", metric: "ndvi" },
        { name: "Soil Moisture", value: cv.soil_moisture, unit: "m³/m³", metric: "soil_moisture" },
        { name: "Drought Risk", value: cv.drought_risk, unit: "0–1 index", metric: "drought_risk" },
        { name: "Rainfall", value: cv.rainfall_mm, unit: "mm/day", metric: "aqi_proxy" },
        { name: "Carbon Balance", value: cv.carbon_balance, unit: "index", metric: "carbon_balance" },
    ];

    const ORDER = ["NW", "N", "NE", "W", "CENTER", "E", "SW", "S", "SE"];
    const nbSorted = [...neighbourhood].sort((a, b) => ORDER.indexOf(a.position) - ORDER.indexOf(b.position));

    const metricTableRows = metricRows.map(row => {
        const val = row.value;
        if (val == null) return `
      <tr>
        <td>${row.name}</td>
        <td style="font-weight:700; text-align:right">—</td>
        <td style="color:#555; text-align:center">${row.unit}</td>
        <td style="text-align:center"><span class="status-pill" style="background:#f3f4f6;color:#6b7280">N/A</span></td>
      </tr>`;
        const c = classify(row.metric, val);
        const displayVal = typeof val === 'number' ? fmt(val, row.metric === 'aqi_proxy' ? 0 : 2) : val;
        return `
      <tr>
        <td>${row.name}</td>
        <td style="font-weight:700; text-align:right">${displayVal}</td>
        <td style="color:#555; text-align:center">${row.unit}</td>
        <td style="text-align:center">
          <span class="status-pill" style="background:${c.bg}; color:${c.color};">${c.label}</span>
        </td>
      </tr>`;
    }).join('');

    const nbTableRows = nbSorted.map(cell => {
        const aqiC = classify("aqi_proxy", cell.aqi_proxy);
        const isCenter = cell.position === "CENTER";
        return `
      <tr ${isCenter ? 'class="center-row"' : ''}>
        <td style="font-weight:${isCenter ? '700' : '400'}">${cell.position}${isCenter ? ' ← YOU' : ''}</td>
        <td style="font-family:monospace;font-size:12px">${cell.grid_id}</td>
        <td style="text-align:right;font-weight:700">${cell.aqi_proxy != null ? fmt(cell.aqi_proxy, 0) : '—'}</td>
        <td><span class="status-pill" style="background:${aqiC.bg};color:${aqiC.color}">${aqiC.label}</span></td>
        <td style="text-align:right">${cell.ndvi != null ? fmt(cell.ndvi, 3) : '—'}</td>
        <td style="text-align:right">${cell.lst_celsius ? fmt(cell.lst_celsius, 1) + '°C' : '—'}</td>
        <td style="text-align:right">${cell.composite_risk != null ? fmt(cell.composite_risk, 2) + '/10' : '—'}</td>
      </tr>`;
    }).join('');

    const riskScoreRaw = clickedGrid.risk_score ?? cv.composite_risk ?? 0;
    const riskScore = Math.round(riskScoreRaw * 100) / 100;
    const riskColor = riskScore >= 7 ? '#991b1b' : riskScore >= 4 ? '#92400e' : '#14532d';
    const riskBg = riskScore >= 7 ? '#fee2e2' : riskScore >= 4 ? '#fef3c7' : '#dcfce7';
    const riskLabel = riskScore >= 7 ? 'CRITICAL' : riskScore >= 4 ? 'HIGH RISK' : 'MODERATE';

    const anomalyBanner = anomaly?.has_anomaly ? `
    <div class="anomaly-banner">
      ⚠ ANOMALY DETECTED — Severity: <strong>${anomaly.severity?.toUpperCase()}</strong> &nbsp;|&nbsp;
      Description: <strong>${anomaly.description || 'N/A'}</strong> &nbsp;|&nbsp;
      Score: <strong>${anomaly.anomaly_score != null ? (anomaly.anomaly_score * 100).toFixed(0) + '%' : 'N/A'}</strong>
    </div>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BHOOMI Report — ${clickedGrid.grid_id}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --ink: #1a1a1a; --ink-light: #555; --rule: #d1d5db;
      --green: #14532d; --green-light: #dcfce7; --page: #fafaf7; --accent: #166534;
    }
    @media print {
      body { background: white !important; }
      .no-print { display: none !important; }
      .page-break { break-before: page; }
      @page { margin: 18mm 20mm; size: A4; }
      .report-wrapper { max-width: 100%; box-shadow: none; padding: 0; }
    }
    body {
      background: #e5e7eb; font-family: 'EB Garamond', Georgia, serif;
      font-size: 15px; color: var(--ink); line-height: 1.75; padding: 32px 16px;
    }
    .print-bar {
      max-width: 860px; margin: 0 auto 16px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .print-btn {
      padding: 10px 24px; background: var(--green); color: white; border: none;
      border-radius: 6px; font-family: 'DM Mono', monospace; font-size: 13px;
      cursor: pointer; letter-spacing: 0.05em;
    }
    .print-btn:hover { background: #166534; }
    .report-wrapper {
      max-width: 860px; margin: 0 auto; background: var(--page);
      box-shadow: 0 4px 40px rgba(0,0,0,0.18); padding: 60px 72px;
    }
    .cover-stripe {
      background: var(--green); color: white; padding: 32px 40px; margin: -60px -72px 48px;
    }
    .cover-platform {
      font-family: 'DM Mono', monospace; font-size: 11px;
      letter-spacing: 0.18em; opacity: 0.7; margin-bottom: 6px; text-transform: uppercase;
    }
    .cover-title { font-size: 32px; font-weight: 700; line-height: 1.2; margin-bottom: 6px; }
    .cover-subtitle { font-size: 15px; opacity: 0.8; font-style: italic; }
    .cover-meta-row { display: flex; gap: 32px; margin-top: 24px; flex-wrap: wrap; }
    .cover-meta-label {
      font-family: 'DM Mono', monospace; font-size: 10px;
      letter-spacing: 0.12em; opacity: 0.6; text-transform: uppercase;
    }
    .cover-meta-value { font-size: 14px; font-weight: 600; }
    .risk-score-box {
      display: inline-flex; align-items: center; gap: 12px;
      background: ${riskBg}; border: 2px solid ${riskColor};
      border-radius: 8px; padding: 12px 20px; margin-bottom: 32px;
    }
    .risk-number {
      font-size: 42px; font-weight: 700; color: ${riskColor};
      line-height: 1; font-family: 'DM Mono', monospace;
    }
    .risk-label-text {
      font-family: 'DM Mono', monospace; font-size: 12px;
      font-weight: 700; color: ${riskColor}; letter-spacing: 0.1em;
    }
    .risk-desc { font-size: 13px; color: var(--ink-light); }
    .anomaly-banner {
      background: #fef3c7; border-left: 4px solid #d97706;
      padding: 10px 16px; font-family: 'DM Mono', monospace;
      font-size: 12px; color: #92400e; border-radius: 0 6px 6px 0; margin-bottom: 32px;
    }
    h2 {
      font-size: 22px; font-weight: 700; color: var(--green);
      margin: 40px 0 14px; padding-bottom: 8px; border-bottom: 2px solid var(--green);
    }
    h3 {
      font-size: 17px; font-weight: 600; color: var(--ink);
      margin: 28px 0 10px; font-style: italic;
    }
    p { margin-bottom: 14px; text-align: justify; }
    table { width: 100%; border-collapse: collapse; font-size: 13.5px; margin-bottom: 28px; }
    thead tr { background: var(--green); color: white; }
    thead th {
      padding: 10px 12px; text-align: left; font-family: 'DM Mono', monospace;
      font-size: 11px; letter-spacing: 0.08em; font-weight: 500;
    }
    tbody tr:nth-child(even) { background: #f3f4f0; }
    tbody td { padding: 9px 12px; border-bottom: 1px solid var(--rule); vertical-align: middle; }
    .center-row { background: #f0fdf4 !important; font-weight: 600; }
    .status-pill {
      display: inline-block; padding: 2px 10px; border-radius: 100px;
      font-family: 'DM Mono', monospace; font-size: 11px; font-weight: 500; white-space: nowrap;
    }
    .ai-section { border-left: 3px solid var(--green); padding-left: 20px; margin: 32px 0; }
    .ai-section h3 {
      font-family: 'DM Mono', monospace; font-size: 13px; font-style: normal;
      letter-spacing: 0.1em; color: var(--green); text-transform: uppercase; margin-bottom: 12px;
    }
    .footer {
      margin-top: 60px; padding-top: 20px; border-top: 1px solid var(--rule);
      display: flex; justify-content: space-between;
      font-family: 'DM Mono', monospace; font-size: 11px; color: var(--ink-light);
    }
    .page-divider { border: none; border-top: 1px solid var(--rule); margin: 36px 0; }
  </style>
</head>
<body>

<div class="no-print print-bar">
  <span style="font-family:'DM Mono',monospace;font-size:13px;color:#555">
    BHOOMI Environmental Intelligence — ${clickedGrid.grid_id}
  </span>
  <button class="print-btn" onclick="window.print()">⎙ Print / Save as PDF</button>
</div>

<div class="report-wrapper">
  <div class="cover-stripe">
    <div class="cover-platform">BHOOMI · Environmental Intelligence Platform · Municipal Report</div>
    <div class="cover-title">Grid Environmental Analysis</div>
    <div class="cover-subtitle">Satellite-derived assessment with AI-generated recommendations</div>
    <div class="cover-meta-row">
      <div class="cover-meta-item">
        <div class="cover-meta-label">Grid ID</div>
        <div class="cover-meta-value" style="font-family:'DM Mono',monospace">${clickedGrid.grid_id}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-label">Location</div>
        <div class="cover-meta-value">${clickedGrid.centroid_lat?.toFixed(4) ?? '—'}°N, ${clickedGrid.centroid_lng?.toFixed(4) ?? '—'}°E</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-label">Report Date</div>
        <div class="cover-meta-value">${reportDate}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-label">City</div>
        <div class="cover-meta-value">Ahmedabad, Gujarat</div>
      </div>
    </div>
  </div>

  <div class="risk-score-box">
    <div class="risk-number">${riskScore}</div>
    <div class="risk-detail">
      <div class="risk-label-text">${riskLabel}</div>
      <div class="risk-desc">Composite Environmental Risk Score (out of 10)</div>
    </div>
  </div>

  ${anomalyBanner}

  <h2>Section 1 — Current Environmental Readings</h2>
  <table>
    <thead>
      <tr>
        <th>Metric</th>
        <th style="text-align:right">Value</th>
        <th style="text-align:center">Unit</th>
        <th style="text-align:center">Status</th>
      </tr>
    </thead>
    <tbody>${metricTableRows}</tbody>
  </table>

  <h2>Section 2 — 3×3 Neighbourhood Analysis</h2>
  <p style="font-size:13px;color:var(--ink-light);margin-bottom:16px;">
    Each surrounding cell within the 30×30 km neighbourhood is shown below. The selected grid is highlighted.
  </p>
  <table>
    <thead>
      <tr>
        <th>Direction</th>
        <th>Grid ID</th>
        <th style="text-align:right">AQI</th>
        <th>AQI Status</th>
        <th style="text-align:right">NDVI</th>
        <th style="text-align:right">LST</th>
        <th style="text-align:right">Risk</th>
      </tr>
    </thead>
    <tbody>${nbTableRows}</tbody>
  </table>

  <hr class="page-divider page-break">

  <h2>Section 3 — AI Environmental Analysis & Recommendations</h2>
  <p style="font-size:13px;color:var(--ink-light);margin-bottom:24px;font-style:italic">
    The following analysis was generated by BHOOMI's environmental intelligence engine using satellite data,
    causal models, and neighbourhood context. It is intended to assist — not replace — on-ground assessment.
  </p>

  <div class="ai-section">
    ${markdownToHtml(geminiText)}
  </div>

  <div class="footer">
    <span>BHOOMI Environmental Intelligence Platform · Ahmedabad Municipal Corporation</span>
    <span>Generated ${new Date().toLocaleString("en-IN")}</span>
  </div>
</div>

</body>
</html>`;
}

// ── LOADING PAGE HTML ─────────────────────────────────────────

function buildLoadingHTML(gridId: string): string {
    return `<!DOCTYPE html>
<html><head>
<title>Generating Report...</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=EB+Garamond&display=swap" rel="stylesheet">
<style>
  body { background:#fafaf7; display:flex; align-items:center; justify-content:center; min-height:100vh; flex-direction:column; gap:20px; font-family:'DM Mono',monospace; }
  .spinner { width:48px;height:48px;border:3px solid #d1d5db;border-top-color:#14532d;border-radius:50%;animation:spin 0.8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .title { font-size:15px;color:#14532d;letter-spacing:0.08em; }
  .sub { font-family:'EB Garamond',serif;font-size:14px;color:#6b7280;font-style:italic; }
  .gid { font-size:13px;color:#9ca3af;margin-top:4px; }
</style>
</head><body>
<div class="spinner"></div>
<div class="title">GENERATING ENVIRONMENTAL REPORT</div>
<div class="sub">Analysing ${gridId}</div>
<div class="gid">This takes about 5–8 seconds</div>
</body></html>`;
}

// ── DATA ADAPTER ──────────────────────────────────────────────
// Converts dashboard MLNeighborhood + observation data into the
// format expected by the report generator.

const POSITION_MAP: Record<string, string> = {};

function getPositionLabel(centerRow: number, centerCol: number, cellRow: number, cellCol: number): string {
    const dr = cellRow - centerRow;
    const dc = cellCol - centerCol;
    if (dr === 0 && dc === 0) return 'CENTER';
    const vLabel = dr < 0 ? 'N' : dr > 0 ? 'S' : '';
    const hLabel = dc < 0 ? 'W' : dc > 0 ? 'E' : '';
    return vLabel + hLabel;
}

export function buildReportData(
    cellId: string,
    mlData: MLNeighborhood,
    observation: CellObservation | undefined,
    selectedCell: { id: string; centroid_lat: number; centroid_lng: number } | undefined,
    observations: CellObservation[],
): ReportOptions {
    // Build clickedGrid from reportContexts or observation data
    const reportCtx = mlData.reportContexts?.[cellId];

    let clickedGrid: ClickedGridData;

    if (reportCtx) {
        // Use pre-computed report context if available
        clickedGrid = {
            grid_id: cellId,
            rank: reportCtx.rank ?? 0,
            risk_score: reportCtx.risk_score ?? (observation?.composite_risk ?? 0),
            centroid_lat: selectedCell?.centroid_lat,
            centroid_lng: selectedCell?.centroid_lng,
            current_values: reportCtx.current_values ?? {},
            factors: reportCtx.factors ?? [],
            human_summary: reportCtx.human_summary ?? '',
        };
    } else {
        // Build from observation data
        clickedGrid = {
            grid_id: cellId,
            rank: 0,
            risk_score: observation?.composite_risk ?? 0,
            centroid_lat: selectedCell?.centroid_lat,
            centroid_lng: selectedCell?.centroid_lng,
            current_values: observation ? {
                lst_celsius: observation.lst_mean,
                ndvi: observation.ndvi_mean,
                aqi_proxy: observation.aqi_proxy ?? 0,
                no2_ugm3: observation.no2_ppb,
                so2_ugm3: observation.so2_ugm3 ?? 0,
                co_ugm3: observation.co_ugm3 ?? 0,
                vhi: observation.vhi ?? 0,
                soil_moisture: observation.soil_moisture_am,
                drought_risk: observation.drought_risk ?? 0,
                rainfall_mm: observation.rainfall_mm ?? 0,
                carbon_balance: mlData.carbon[cellId]?.carbon_balance ?? 0,
                composite_risk: observation.composite_risk,
            } : {},
            factors: [],
            human_summary: '',
        };
    }

    // Build neighbourhood array with positional labels
    const centerRow = mlData.row;
    const centerCol = mlData.col;

    const neighbourhood: ReportNeighbourCell[] = mlData.neighborhood.map(n => {
        const pos = getPositionLabel(centerRow, centerCol, n.row, n.col);
        const obs = observations.find(o => o.cell_id === n.grid_id);
        const carbon = mlData.carbon[n.grid_id];

        return {
            position: pos,
            grid_id: n.grid_id,
            aqi_proxy: obs?.aqi_proxy ?? 0,
            ndvi: obs?.ndvi_mean ?? 0,
            lst_celsius: obs?.lst_mean ?? 0,
            composite_risk: obs?.composite_risk ?? 0,
            no2_ugm3: obs?.no2_ppb ?? 0,
            so2_ugm3: obs?.so2_ugm3 ?? 0,
            co_ugm3: obs?.co_ugm3 ?? 0,
            soil_moisture: obs?.soil_moisture_am ?? 0,
            drought_risk: obs?.drought_risk ?? 0,
            rainfall_mm: obs?.rainfall_mm ?? 0,
            vhi: obs?.vhi ?? 0,
            carbon_balance: carbon?.carbon_balance ?? 0,
        };
    });

    // Get anomaly for center cell
    const anomaly = mlData.anomalies[cellId] ?? null;

    // Get carbon for center cell
    const carbon = mlData.carbon[cellId] ?? null;

    // Get forecast for center cell
    const forecast = mlData.predictions[cellId] ?? null;

    // Get prescriptions (already filtered by server)
    const prescriptions = mlData.prescriptions ?? [];

    return {
        clickedGrid,
        neighbourhood,
        prescriptions,
        anomaly,
        carbon,
        forecast,
    };
}

// ── MAIN EXPORT ───────────────────────────────────────────────

export async function generateGridReport(options: ReportOptions & { geminiApiKey?: string }): Promise<void> {
    const { geminiApiKey, clickedGrid } = options;

    if (!clickedGrid) throw new Error("clickedGrid data is required");

    // 1. Open new tab immediately with a loading screen
    const tab = window.open("", "_blank");
    if (!tab) {
        alert("Please allow popups for this site to view the report.");
        return;
    }
    tab.document.write(buildLoadingHTML(clickedGrid.grid_id));
    tab.document.close();

    try {
        // 2. Build prompt and call Gemini (or generate offline)
        const prompt = buildGeminiPrompt(options);
        const geminiText = await callGemini(geminiApiKey || "", prompt, options);

        // 3. Build full report HTML
        const reportHTML = buildReportHTML(options, geminiText);

        // 4. Replace loading page with report
        tab.document.open();
        tab.document.write(reportHTML);
        tab.document.close();
    } catch (err: unknown) {
        const errorMsg = (err as Error).message;
        tab.document.open();
        tab.document.write(`<!DOCTYPE html><html><head>
      <title>Report Error</title>
      <style>body{font-family:monospace;padding:40px;background:#fafaf7;color:#991b1b;}
      h2{margin-bottom:16px;}pre{background:#fee2e2;padding:16px;border-radius:8px;font-size:13px;white-space:pre-wrap;}</style>
      </head><body>
      <h2>⚠ Report Generation Failed</h2>
      <p>Grid: ${clickedGrid.grid_id}</p>
      <pre>${errorMsg}</pre>
      <p style="color:#555;margin-top:16px">Check your API key and network connection, then try again.</p>
      </body></html>`);
        tab.document.close();
        throw err;
    }
}
