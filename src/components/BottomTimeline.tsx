import React, { useMemo } from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
    CartesianGrid,
} from 'recharts';
import type { CityTimeSeriesPoint } from '../types/domain';

interface BottomTimelineProps {
    availableMonths: string[];
    selectedMonth: string;
    onMonthSelect: (month: string) => void;
    cityTimeSeries: CityTimeSeriesPoint[];
    activeLayer: 'heat' | 'pollution' | 'vegetation' | 'carbon' | null;
}

const LAYER_CONFIG: Record<
    string,
    { label: string; color: string; gradientFrom: string; gradientTo: string; unit: string }
> = {
    heat: {
        label: 'Land Surface Temp',
        color: '#f97316',
        gradientFrom: '#f97316',
        gradientTo: 'rgba(249,115,22,0.05)',
        unit: '°C',
    },
    pollution: {
        label: 'NO₂ Concentration',
        color: '#8b5cf6',
        gradientFrom: '#8b5cf6',
        gradientTo: 'rgba(139,92,246,0.05)',
        unit: 'µg/m³',
    },
    vegetation: {
        label: 'Vegetation Index',
        color: '#22c55e',
        gradientFrom: '#22c55e',
        gradientTo: 'rgba(34,197,94,0.05)',
        unit: 'NDVI',
    },
    carbon: {
        label: 'Carbon Balance',
        color: '#10b981',
        gradientFrom: '#10b981',
        gradientTo: 'rgba(16,185,129,0.05)',
        unit: 'index',
    },
};

const DEFAULT_CONFIG = {
    label: 'Composite Risk',
    color: '#06b6d4',
    gradientFrom: '#06b6d4',
    gradientTo: 'rgba(6,182,212,0.05)',
    unit: 'score',
};

function formatMonth(m: string) {
    const [y, mo] = m.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(mo) - 1]} '${y.slice(2)}`;
}

export function BottomTimeline({
    availableMonths,
    selectedMonth,
    onMonthSelect,
    cityTimeSeries,
    activeLayer,
}: BottomTimelineProps) {
    const config = activeLayer ? LAYER_CONFIG[activeLayer] : DEFAULT_CONFIG;

    const chartData = useMemo(() => {
        return cityTimeSeries.map((pt) => ({
            ...pt,
            label: formatMonth(pt.month),
            isSelected: pt.month === selectedMonth,
            band_upper: pt.avg + pt.stddev,
            band_lower: Math.max(0, pt.avg - pt.stddev),
        }));
    }, [cityTimeSeries, selectedMonth]);

    const selectedIdx = chartData.findIndex((d) => d.month === selectedMonth);

    if (chartData.length === 0) {
        return (
            <div className="h-28 bg-black/40 backdrop-blur-xl border-t border-white/10 flex items-center justify-center">
                <p className="text-white/30 text-sm">Loading timeline data...</p>
            </div>
        );
    }

    return (
        <div className="h-32 bg-black/40 backdrop-blur-xl border-t border-white/10 flex flex-col">
            {/* Label row */}
            <div className="flex items-center justify-between px-4 pt-2 pb-0">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: config.color }} />
                    <span className="text-[10px] uppercase tracking-widest text-white/50 font-semibold">
                        {config.label} · City Average
                    </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-white/40">
                    <span>
                        {availableMonths[0] && formatMonth(availableMonths[0])} – {availableMonths.length > 0 && formatMonth(availableMonths[availableMonths.length - 1])}
                    </span>
                    <span className="text-white/60 font-medium">
                        {selectedMonth && formatMonth(selectedMonth)}
                    </span>
                </div>
            </div>

            {/* Chart */}
            <div className="flex-1 px-2">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={chartData}
                        margin={{ top: 4, right: 12, bottom: 0, left: 12 }}
                        onClick={(e: any) => {
                            if (e?.activePayload?.[0]?.payload?.month) {
                                onMonthSelect(e.activePayload[0].payload.month);
                            }
                        }}
                    >
                        <defs>
                            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={config.gradientFrom} stopOpacity={0.35} />
                                <stop offset="100%" stopColor={config.gradientTo} stopOpacity={0.02} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis
                            dataKey="label"
                            tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }}
                            axisLine={false}
                            tickLine={false}
                            interval={Math.max(0, Math.floor(chartData.length / 10))}
                        />
                        <YAxis hide domain={['auto', 'auto']} />
                        <Tooltip
                            contentStyle={{
                                background: 'rgba(0,0,0,0.85)',
                                border: '1px solid rgba(255,255,255,0.15)',
                                borderRadius: '12px',
                                fontSize: '11px',
                                color: '#fff',
                                backdropFilter: 'blur(8px)',
                            }}
                            formatter={(val: number) => [
                                val?.toFixed?.(2) ?? val,
                                config.unit,
                            ]}
                            labelFormatter={(label: string) => label}
                        />
                        {/* Std dev band */}
                        <Area
                            type="monotone"
                            dataKey="band_upper"
                            stroke="none"
                            fill="none"
                            stackId="band"
                        />
                        <Area
                            type="monotone"
                            dataKey="band_lower"
                            stroke="none"
                            fill="rgba(255,255,255,0.03)"
                            stackId="band"
                        />
                        {/* Main area */}
                        <Area
                            type="monotone"
                            dataKey="avg"
                            stroke={config.color}
                            strokeWidth={1.5}
                            fill="url(#areaGrad)"
                            dot={false}
                            activeDot={{ r: 4, fill: config.color, stroke: '#fff', strokeWidth: 1 }}
                        />
                        {/* Selected month reference line */}
                        {selectedIdx >= 0 && (
                            <ReferenceLine
                                x={chartData[selectedIdx]?.label}
                                stroke="rgba(255,255,255,0.5)"
                                strokeDasharray="4 4"
                                strokeWidth={1}
                            />
                        )}
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

export default BottomTimeline;
