import React, { useState, useMemo } from 'react';
import {
    ChevronDown,
    ChevronRight,
    TreePine,
    Shield,
    Snowflake,
    Droplets,
    Wind,
    Clock,
    Building2,
    MapPin,
    ArrowRight,
    AlertTriangle,
    CheckCircle2,
} from 'lucide-react';
import type { CellObservation } from '../types/domain';
import {
    evaluatePrescriptions,
    PRIORITY_COLORS,
    RULE_ICONS,
    type GridPrescription,
} from '../services/prescriptionEngine';

/* ── Icon map for rules ──────────────────────────────────── */

const RULE_ICON_COMPONENTS: Record<string, React.ElementType> = {
    R1: TreePine,
    R2: Shield,
    R3: Snowflake,
    R4: Droplets,
    R5: Wind,
};

/* ── Evidence row ────────────────────────────────────────── */

function EvidenceRow({
    label,
    value,
    status,
}: {
    label: string;
    value: string;
    status: 'critical' | 'high' | 'moderate' | 'normal';
}) {
    const statusColors: Record<string, string> = {
        critical: 'text-red-400',
        high: 'text-orange-400',
        moderate: 'text-yellow-400',
        normal: 'text-emerald-400',
    };
    const dotColors: Record<string, string> = {
        critical: 'bg-red-400',
        high: 'bg-orange-400',
        moderate: 'bg-yellow-400',
        normal: 'bg-emerald-400',
    };

    return (
        <div className="flex items-center gap-2 py-0.5">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColors[status]}`} />
            <span className="text-[10px] text-white/50 flex-1">{label}</span>
            <span className={`text-[10px] font-mono font-medium ${statusColors[status]}`}>
                {value}
            </span>
        </div>
    );
}

/* ── Single prescription card ────────────────────────────── */

function PrescriptionCard({
    rx,
    isExpanded,
    onToggle,
}: {
    rx: GridPrescription;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const Icon = RULE_ICON_COMPONENTS[rx.ruleId] || Shield;
    const colors = PRIORITY_COLORS[rx.priority] || PRIORITY_COLORS[2];
    const shortIntervention = rx.interventionGrid.split('_').slice(-2).join('_');
    const shortSource = rx.sourceGrid?.split('_').slice(-2).join('_');

    return (
        <div
            className={`rounded-xl border backdrop-blur-md transition-all duration-200 ${isExpanded ? `${colors.border} ${colors.bg}` : 'border-white/10 bg-white/5'
                }`}
        >
            {/* Header — always visible */}
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left group"
            >
                <Icon
                    size={14}
                    className={`flex-shrink-0 ${colors.text} group-hover:scale-110 transition-transform`}
                />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-mono font-bold ${colors.text}`}>
                            P{rx.priority}
                        </span>
                        <span className="text-[11px] text-white/80 font-medium truncate">
                            {rx.ruleName}
                        </span>
                    </div>
                    <p className="text-[9px] text-white/40 leading-snug mt-0.5 line-clamp-1">
                        {rx.triggerSummary}
                    </p>
                </div>
                {isExpanded ? (
                    <ChevronDown size={14} className="text-white/30 flex-shrink-0" />
                ) : (
                    <ChevronRight size={14} className="text-white/30 flex-shrink-0" />
                )}
            </button>

            {/* Expanded detail */}
            {isExpanded && (
                <div className="px-3 pb-3 space-y-2.5 border-t border-white/5 pt-2.5">
                    {/* Meaning */}
                    <div>
                        <div className="text-[9px] uppercase tracking-wider text-white/30 mb-1">
                            What This Means
                        </div>
                        <p className="text-[10px] text-white/60 leading-relaxed">{rx.meaning}</p>
                    </div>

                    {/* Evidence */}
                    <div>
                        <div className="text-[9px] uppercase tracking-wider text-white/30 mb-1">
                            Trigger Evidence
                        </div>
                        <div className="bg-black/20 rounded-lg px-2 py-1.5">
                            {rx.evidence.map((ev, i) => (
                                <EvidenceRow key={i} {...ev} />
                            ))}
                        </div>
                    </div>

                    {/* Intervention flow */}
                    <div>
                        <div className="text-[9px] uppercase tracking-wider text-white/30 mb-1">
                            Intervention Zone
                        </div>
                        <div className="flex items-center gap-1.5 text-[9px] font-mono">
                            {shortSource && (
                                <>
                                    <span className="px-1.5 py-0.5 bg-red-500/15 rounded text-red-400 border border-red-500/20">
                                        {shortSource}
                                    </span>
                                    <ArrowRight size={10} className="text-white/20" />
                                </>
                            )}
                            <span className="px-1.5 py-0.5 bg-cyan-500/15 rounded text-cyan-400 border border-cyan-500/20">
                                <MapPin size={8} className="inline mr-0.5 -mt-0.5" />
                                {shortIntervention}
                            </span>
                            {shortSource && (
                                <>
                                    <ArrowRight size={10} className="text-white/20" />
                                    <span className="px-1.5 py-0.5 bg-emerald-500/15 rounded text-emerald-400 border border-emerald-500/20">
                                        {rx.interventionGrid.split('_').slice(-2).join('_')}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Recommended action */}
                    <div>
                        <div className="text-[9px] uppercase tracking-wider text-white/30 mb-1">
                            Recommended Action
                        </div>
                        <p className="text-[10px] text-white/70 leading-relaxed">{rx.recommendedAction}</p>
                    </div>

                    {/* Expected impact */}
                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-2.5 py-2">
                        <div className="text-[9px] uppercase tracking-wider text-emerald-400/60 mb-0.5">
                            Expected Impact
                        </div>
                        <p className="text-[10px] text-emerald-300/80 leading-relaxed">{rx.expectedImpact}</p>
                    </div>

                    {/* Footer: timeline + responsible body */}
                    <div className="flex items-center gap-3 pt-1">
                        <div className="flex items-center gap-1 text-[9px] text-white/40">
                            <Clock size={10} />
                            <span>{rx.timeline}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[9px] text-white/40">
                            <Building2 size={10} />
                            <span>{rx.responsibleBody}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ── Priority summary bar ────────────────────────────────── */

function PrioritySummary({ prescriptions }: { prescriptions: GridPrescription[] }) {
    const critical = prescriptions.filter((p) => p.priority === 1).length;
    const high = prescriptions.filter((p) => p.priority === 2).length;

    return (
        <div className="flex items-center gap-2">
            {critical > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-medium">
                    {critical} Critical
                </span>
            )}
            {high > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 font-medium">
                    {high} High
                </span>
            )}
        </div>
    );
}

/* ── Main component ──────────────────────────────────────── */

interface PrescriptiveAnalysisProps {
    cellId: string;
    observation: CellObservation;
    allObservations: CellObservation[];
}

export function PrescriptiveAnalysis({
    cellId,
    observation,
    allObservations,
}: PrescriptiveAnalysisProps) {
    const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());

    const prescriptions = useMemo(
        () => evaluatePrescriptions(cellId, observation, allObservations),
        [cellId, observation, allObservations],
    );

    const toggleRule = (ruleId: string) => {
        setExpandedRules((prev) => {
            const next = new Set(prev);
            if (next.has(ruleId)) {
                next.delete(ruleId);
            } else {
                next.add(ruleId);
            }
            return next;
        });
    };

    // Auto-expand the first prescription on mount / change
    React.useEffect(() => {
        if (prescriptions.length > 0) {
            setExpandedRules(new Set([prescriptions[0].ruleId]));
        } else {
            setExpandedRules(new Set());
        }
    }, [cellId]); // eslint-disable-line react-hooks/exhaustive-deps

    if (prescriptions.length === 0) {
        return (
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={16} className="text-white/50" />
                    <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
                        Prescriptive Analysis
                    </div>
                </div>
                <div className="flex items-center gap-2 py-3">
                    <CheckCircle2 size={16} className="text-emerald-400/60" />
                    <p className="text-[11px] text-white/50">
                        No BHOOMI prescription rules triggered for this grid. All environmental thresholds
                        within acceptable limits.
                    </p>
                </div>

                {/* Rule checklist */}
                <div className="space-y-1 mt-2">
                    {[
                        { id: 'R1', name: 'Plantation Patch', check: 'NDVI ≥ 0.15 or built ≥ 50%' },
                        { id: 'R2', name: 'Green Buffer', check: 'AQI ≤ 150 or no upwind source' },
                        { id: 'R3', name: 'Cooling Corridor', check: 'No hot neighbor > 42 °C' },
                        { id: 'R4', name: 'Drought Recharge', check: 'VHI ≥ 0.25 with < 4 stressed neighbors' },
                        { id: 'R5', name: 'Windbreak', check: 'AQI ≤ 120 or wind ≤ 4 m/s or bare ≤ 30%' },
                    ].map((rule) => (
                        <div key={rule.id} className="flex items-center gap-2 text-[9px]">
                            <CheckCircle2 size={10} className="text-emerald-400/40 flex-shrink-0" />
                            <span className="text-white/40 font-medium">{rule.name}</span>
                            <span className="text-white/25 ml-auto">{rule.check}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4">
            {/* Header */}
            <div className="flex items-center gap-2 mb-1">
                <AlertTriangle size={16} className="text-amber-400/70" />
                <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
                    Prescriptive Analysis
                </div>
                <span className="ml-auto text-[10px] text-white/30">
                    {prescriptions.length} rule{prescriptions.length !== 1 ? 's' : ''} triggered
                </span>
            </div>

            {/* Priority summary */}
            <div className="mb-3">
                <PrioritySummary prescriptions={prescriptions} />
            </div>

            {/* Prescription cards */}
            <div className="space-y-2">
                {prescriptions.map((rx) => (
                    <PrescriptionCard
                        key={rx.ruleId}
                        rx={rx}
                        isExpanded={expandedRules.has(rx.ruleId)}
                        onToggle={() => toggleRule(rx.ruleId)}
                    />
                ))}
            </div>

            {/* Footer legend */}
            <div className="mt-3 pt-2 border-t border-white/5">
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-red-400/60" />
                        <span className="text-[8px] text-white/30">P1 · Immediate</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-orange-400/60" />
                        <span className="text-[8px] text-white/30">P2 · Within 3 mo</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-yellow-400/60" />
                        <span className="text-[8px] text-white/30">P3 · Within 6 mo</span>
                    </div>
                </div>
                <p className="text-[8px] text-white/20 mt-1 italic">
                    BHOOMI Prescription Rules · Ahmedabad · 3 km × 3 km grid
                </p>
            </div>
        </div>
    );
}
