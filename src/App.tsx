import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { Download, Zap, FileText } from 'lucide-react';
import { DashboardProvider } from './store/dashboardStore';
import { DashboardPage } from './pages/DashboardPage';

const VIDEO_URL =
    'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260315_073750_51473149-4350-4920-ae24-c8214286f323.mp4';

const FONT_LINK =
    'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&family=Source+Serif+4:ital,wght@1,400&display=swap';

const BloomMark = ({ size = 32 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
        <g fill="rgba(255,255,255,1)">
            <ellipse cx="50" cy="22" rx="11" ry="22" />
            <ellipse cx="74" cy="36" rx="11" ry="22" transform="rotate(60 74 36)" />
            <ellipse cx="74" cy="64" rx="11" ry="22" transform="rotate(120 74 64)" />
            <ellipse cx="50" cy="78" rx="11" ry="22" transform="rotate(180 50 78)" />
            <ellipse cx="26" cy="64" rx="11" ry="22" transform="rotate(240 26 64)" />
            <ellipse cx="26" cy="36" rx="11" ry="22" transform="rotate(300 26 36)" />
            <circle cx="50" cy="50" r="9" fill="rgba(255,255,255,0.9)" />
        </g>
    </svg>
);

const HeatmapThumbnail = () => {
    const opacities = [
        0.15, 0.22, 0.34, 0.49, 0.72, 0.66, 0.4, 0.22, 0.2, 0.28, 0.41, 0.68, 0.84, 0.77, 0.52,
        0.3, 0.25, 0.36, 0.57, 0.9, 0.86, 0.61, 0.42, 0.27, 0.18, 0.31, 0.52, 0.73, 0.8, 0.69,
        0.47, 0.24, 0.16, 0.23, 0.37, 0.51, 0.64, 0.59, 0.38, 0.2
    ];

    return (
        <svg width="96" height="64" viewBox="0 0 96 64" fill="none" aria-label="Satellite heatmap grid">
            <rect x="0" y="0" width="96" height="64" rx="12" fill="rgba(255,255,255,0.06)" />
            {opacities.map((opacity, index) => {
                const col = index % 8;
                const row = Math.floor(index / 8);
                return (
                    <rect
                        key={`h-${index}`}
                        x={6 + col * 10.5}
                        y={6 + row * 10.5}
                        width="8"
                        height="8"
                        rx="2"
                        fill={`rgba(255,255,255,${opacity})`}
                    />
                );
            })}
        </svg>
    );
};

class MapErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { hasError: boolean }
> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('[EcoAlert] Map error:', error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="w-screen h-screen flex items-center justify-center bg-eco-bg">
                    <div className="text-center">
                        <h2 className="text-eco-green font-heading text-xl mb-2">Map Loading...</h2>
                        <p className="text-eco-muted text-sm max-w-md">
                            Unable to initialize the map. Please verify your Mapbox token and try refreshing the
                            page.
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-4 bg-eco-green/20 text-eco-green px-4 py-2 rounded-lg text-sm hover:bg-eco-green/30 transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

const DataSourcesPopup: React.FC = () => {
    const [open, setOpen] = useState(false);

    return (
        <div className="fixed bottom-14 right-4 z-50">
            {open && (
                <div className="mb-2 bg-gray-900 border border-white/10 rounded-xl p-4 w-64 fade-in shadow-2xl">
                    <h4 className="text-xs font-heading font-semibold text-eco-text mb-3 uppercase tracking-wider">
                        Satellite Data Sources
                    </h4>
                    <ul className="space-y-2">
                        <li className="flex items-center gap-2 text-xs">
                            <span className="text-eco-green font-semibold">ISRO Bhuvan</span>
                            <span className="text-[9px] bg-green-500/20 text-green-400 px-1.5 rounded ml-auto">
                                Indian Data
                            </span>
                        </li>
                        <li className="flex items-center gap-2 text-xs text-eco-text">NASA MODIS (Terra/Aqua)</li>
                        <li className="flex items-center gap-2 text-xs text-eco-text">Landsat 8/9 (USGS)</li>
                        <li className="flex items-center gap-2 text-xs text-eco-text">ESA Sentinel-2 (MSI)</li>
                        <li className="flex items-center gap-2 text-xs text-eco-text">Sentinel-5P (TROPOMI)</li>
                        <li className="flex items-center gap-2 text-xs text-eco-text">Resourcesat-2 (LISS-III)</li>
                    </ul>
                </div>
            )}
            <button
                onClick={() => setOpen(!open)}
                className="bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/10 px-3 py-2 rounded-lg text-xs text-eco-text transition-all shadow-lg"
            >
                Data Sources
            </button>
        </div>
    );
};

const App = () => {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<HeroPage />} />
                <Route
                    path="/dashboard"
                    element={
                        <DashboardProvider>
                            <DashboardPage />
                        </DashboardProvider>
                    }
                />
            </Routes>
        </BrowserRouter>
    );
};

const HeroPage = () => {
    const navigate = useNavigate();

    useEffect(() => {
        if (!document.querySelector(`link[href="${FONT_LINK}"]`)) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = FONT_LINK;
            document.head.appendChild(link);
        }
    }, []);

    const tickerText =
        'Urban Heat Island Intensity  ·  Normalised Difference Vegetation Index  ·  Aerosol Index  ·  Environmental Stress Index  ·  Soil Moisture Morning Pass  ·  Nitrogen Dioxide Column Density      Urban Heat Island Intensity  ·  Normalised Difference Vegetation Index  ·  Aerosol Index  ·  Environmental Stress Index  ·  Soil Moisture Morning Pass  ·  Nitrogen Dioxide Column Density';

    return (
        <>
            <style>{`
                :root {
                    --background: 0 0% 0%;
                    --foreground: 0 0% 100%;
                    --muted-foreground: 0 0% 60%;
                    --radius: 1rem;
                    --glass-light-blur: blur(4px);
                    --glass-strong-blur: blur(50px);
                    --glass-light-shadow: inset 0 1px 1px rgba(255,255,255,0.10);
                    --glass-strong-shadow: 4px 4px 4px rgba(0,0,0,0.05), inset 0 1px 1px rgba(255,255,255,0.15);
                    --text-primary: rgba(255,255,255,1.00);
                    --text-secondary: rgba(255,255,255,0.80);
                    --text-tertiary: rgba(255,255,255,0.60);
                    --text-quaternary: rgba(255,255,255,0.50);
                    --icon-bg: rgba(255,255,255,0.10);
                    --cta-icon-bg: rgba(255,255,255,0.15);
                }

                html, body, #root {
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    background: hsl(var(--background));
                }

                .bloom-root {
                    position: relative;
                    z-index: 10;
                    width: 100vw;
                    height: 100vh;
                    overflow: hidden;
                    display: flex;
                    flex-direction: row;
                    font-family: 'Poppins', sans-serif;
                    color: var(--text-primary);
                }

                .liquid-glass {
                    background: rgba(255, 255, 255, 0.01);
                    background-blend-mode: luminosity;
                    backdrop-filter: blur(4px);
                    -webkit-backdrop-filter: blur(4px);
                    box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.1);
                    position: relative;
                    overflow: hidden;
                }

                .liquid-glass::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    padding: 1.4px;
                    border-radius: inherit;
                    background: linear-gradient(
                        180deg,
                        rgba(255,255,255,0.45) 0%,
                        rgba(255,255,255,0.15) 20%,
                        transparent 40%,
                        transparent 60%,
                        rgba(255,255,255,0.15) 80%,
                        rgba(255,255,255,0.45) 100%
                    );
                    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    -webkit-mask-composite: xor;
                    mask-composite: exclude;
                    pointer-events: none;
                }

                .liquid-glass-strong {
                    background: rgba(255, 255, 255, 0.01);
                    background-blend-mode: luminosity;
                    backdrop-filter: blur(50px);
                    -webkit-backdrop-filter: blur(50px);
                    box-shadow:
                        4px 4px 4px rgba(0, 0, 0, 0.05),
                        inset 0 1px 1px rgba(255, 255, 255, 0.15);
                    position: relative;
                    overflow: hidden;
                }

                .liquid-glass-strong::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    padding: 1.4px;
                    border-radius: inherit;
                    background: linear-gradient(
                        180deg,
                        rgba(255,255,255,0.50) 0%,
                        rgba(255,255,255,0.20) 20%,
                        transparent 40%,
                        transparent 60%,
                        rgba(255,255,255,0.20) 80%,
                        rgba(255,255,255,0.50) 100%
                    );
                    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    -webkit-mask-composite: xor;
                    mask-composite: exclude;
                    pointer-events: none;
                }

                .interactive {
                    transition: transform 0.2s ease;
                }

                .interactive:hover {
                    transform: scale(1.05);
                }

                .cta-press:active {
                    transform: scale(0.95);
                }

                .ticker-wrap {
                    overflow: hidden;
                    white-space: nowrap;
                    width: 100%;
                }

                .ticker-content {
                    display: inline-flex;
                    min-width: 200%;
                    animation: marquee 18s linear infinite;
                }

                .ticker-content span {
                    flex: 0 0 50%;
                    font-size: clamp(0.6rem, 0.8vw, 0.7rem);
                    color: var(--text-quaternary);
                    letter-spacing: 0.05em;
                }

                .serif-accent {
                    font-family: 'Source Serif 4', serif;
                    font-style: italic;
                    color: var(--text-secondary);
                    font-weight: 400;
                }

                .right-card-readable {
                    background: rgba(255, 255, 255, 0.06);
                }

                @keyframes marquee {
                    from { transform: translateX(0); }
                    to { transform: translateX(-50%); }
                }
            `}</style>

            <video
                autoPlay
                loop
                muted
                playsInline
                className="fixed inset-0 h-full w-full object-cover"
                style={{ zIndex: 0 }}
            >
                <source src={VIDEO_URL} type="video/mp4" />
            </video>

            <div className="fixed left-6 top-6 z-50 flex items-center gap-3">
                <BloomMark size={24} />
                <div className="text-xl font-semibold tracking-[-0.05em] text-white">COSMOSAPIENS</div>
            </div>

            <main className="bloom-root">
                <section className="relative flex h-screen w-full flex-col justify-center overflow-hidden p-[clamp(1rem,3vw,3rem)] pt-[clamp(3rem,6vh,5rem)] box-border lg:w-[52%]">
                    <div className="absolute inset-0 rounded-3xl liquid-glass-strong" />
                    <div className="relative z-10 flex h-full w-full flex-col overflow-hidden rounded-3xl p-10 text-left">
                        <div className="flex flex-col items-start text-left">
                            <h1 className="mt-5 max-w-2xl text-left text-[clamp(1.8rem,3.5vw,3.8rem)] font-medium leading-[1.15] tracking-[-0.04em] text-white">
                                <span className="font-semibold text-white">BHOOMI:</span>{' '}
                                <em className="serif-accent">Sensing the Earth,</em>
                            </h1>

                            <p className="mt-4 max-w-[34ch] text-left text-[clamp(0.75rem,1.2vw,0.95rem)] font-normal text-white/60">
                                3km*3km satellite grids. 17 live metrics. Gujarat&apos;s cities, seen from space.
                            </p>

                            <button
                                type="button"
                                onClick={() => navigate('/dashboard')}
                                className="liquid-glass-strong interactive cta-press mt-6 flex items-center gap-3 rounded-full px-6 py-3"
                            >
                                <span className="text-sm font-medium text-white">Explore Dashboard</span>
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15">
                                    <Download size={16} />
                                </span>
                            </button>

                            <div className="mt-5 flex flex-wrap items-center justify-start gap-3">
                                <button
                                    type="button"
                                    title="grid_obs: aqi_proxy, no2_ugm3, so2_ugm3"
                                    className="liquid-glass interactive rounded-full px-4 py-2 text-[clamp(0.65rem,0.9vw,0.8rem)] text-white/80"
                                >
                                    Pollution Mapping
                                </button>
                                <button
                                    type="button"
                                    title="grid_predictions: model_id ARIMA, LSTM"
                                    className="liquid-glass interactive rounded-full px-4 py-2 text-[clamp(0.65rem,0.9vw,0.8rem)] text-white/80"
                                >
                                    AI Forecasting
                                </button>
                                <button
                                    type="button"
                                    title="grid_obs: ndvi, vhi"
                                    className="liquid-glass interactive rounded-full px-4 py-2 text-[clamp(0.65rem,0.9vw,0.8rem)] text-white/80"
                                >
                                    Vegetation Health
                                </button>
                            </div>

                            <div className="mt-6 mb-6 w-full">
                                <div className="liquid-glass rounded-xl px-4 py-2">
                                    <div className="ticker-wrap">
                                        <div className="ticker-content">
                                            <span>{tickerText}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col items-start gap-2 pb-8 text-left">
                                <div className="text-left text-[0.65rem] uppercase tracking-[0.2em] text-white/50">
                                    SATELLITE INTELLIGENCE
                                </div>
                                <p className="text-left text-[0.85rem] text-white/70">
                                    We see what the eye cannot - every city, every grid,{' '}
                                    <em className="serif-accent">every day</em>.
                                </p>
                                <div className="flex items-center gap-3 text-[0.65rem] tracking-[0.1em] text-white/50">
                                    <div className="h-px w-10 bg-white/30" />
                                    <div className="h-px w-10 bg-white/30" />
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* <section className="hidden h-screen w-[48%] flex-col justify-center overflow-hidden p-[clamp(1rem,2.5vw,2.5rem)] box-border lg:flex">
                    <div className="flex h-full w-full flex-col gap-4 overflow-hidden">
                        <div className="liquid-glass right-card-readable flex min-h-0 flex-1 items-center gap-3 overflow-hidden rounded-3xl p-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10">
                                <Zap size={20} />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-[clamp(0.75rem,1vw,0.9rem)] font-medium text-white">Causal Attribution</h3>
                                <p className="text-[clamp(0.65rem,0.9vw,0.8rem)] text-white/60">
                                    Wind transport paths, SO2/NO2 ratios and rainfall washout signals ranked per grid
                                    cell
                                </p>
                            </div>
                            <button
                                type="button"
                                className="liquid-glass interactive flex h-8 w-8 items-center justify-center rounded-full text-[1.2rem] text-white/80"
                                aria-label="Open feature"
                            >
                                +
                            </button>
                        </div>

                        <div className="liquid-glass right-card-readable flex min-h-0 flex-1 items-center gap-3 overflow-hidden rounded-3xl p-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10">
                                <FileText size={20} />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-[clamp(0.75rem,1vw,0.9rem)] font-medium text-white">Commissioner Briefing</h3>
                                <p className="text-[clamp(0.65rem,0.9vw,0.8rem)] text-white/60">
                                    AI-generated PDF reports with ward risk scores, causal reasoning and spatial
                                    prescriptions via Claude API
                                </p>
                            </div>
                            <button
                                type="button"
                                className="liquid-glass interactive flex h-8 w-8 items-center justify-center rounded-full text-[1.2rem] text-white/80"
                                aria-label="Open feature"
                            >
                                +
                            </button>
                        </div>

                        <div className="liquid-glass right-card-readable flex min-h-0 flex-1 items-center gap-3 overflow-hidden rounded-3xl p-4">
                            <div className="shrink-0 overflow-hidden rounded-xl">
                                <HeatmapThumbnail />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-[clamp(0.75rem,1vw,0.9rem)] font-medium text-white">Advanced Plant Sculpting</h3>
                                <p className="text-[clamp(0.65rem,0.9vw,0.8rem)] text-white/60">
                                    NDVI · VHI · Prescription overlays for Gujarat&apos;s grid cells
                                </p>
                            </div>
                            <button
                                type="button"
                                className="liquid-glass interactive flex h-8 w-8 items-center justify-center rounded-full text-[1.2rem] text-white/80"
                                aria-label="Open feature"
                            >
                                +
                            </button>
                        </div>
                    </div>
                </section> */}
            </main>
        </>
    );
};

export default App;
