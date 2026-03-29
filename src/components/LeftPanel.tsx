import React from 'react';
import { Thermometer, Wind, Leaf, TreePine } from 'lucide-react';
import { useDashboard, ActiveLayer } from '../store/dashboardStore';
import { METRIC_META } from '../data/metricConfig';

export function LeftPanel() {
  const { state, setActiveLayer } = useDashboard();

  const handleLayerToggle = (layer: ActiveLayer) => {
    if (state.activeLayer === layer) {
      setActiveLayer(null);
    } else {
      setActiveLayer(layer);
    }
  };

  const getColorRampDisplay = (metric: 'lst_mean' | 'no2_ppb' | 'ndvi_mean') => {
    const meta = METRIC_META[metric];
    const colors = meta.colorRamp.slice(0, 7); // Show 7 color samples

    return colors;
  };

  return (
    <div className="h-full w-72 flex-shrink-0 flex flex-col bg-black/40 backdrop-blur-xl p-4 overflow-y-auto border-r border-white/10">
      {/* MAP LAYERS SECTION */}
      <div className="mb-6">
        <div className="text-xs uppercase tracking-widest text-white/50 mb-4 font-semibold">
          Map Layers
        </div>

        {/* Heat Map Button */}
        <button
          onClick={() => handleLayerToggle('heat')}
          className={`w-full mb-3 rounded-2xl p-4 transition-all ${state.activeLayer === 'heat'
            ? 'bg-white/15 backdrop-blur-md border border-white/30'
            : 'bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/10 hover:scale-105'
            } transform transition-transform`}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <Thermometer size={20} className="text-white/70" />
            </div>
            <div className="text-left flex-1">
              <div className="text-sm font-medium text-white">Heat Map</div>
              <div className="text-xs text-white/50">Land Surface Temperature · MODIS MOD11A2</div>
            </div>
          </div>

          {state.activeLayer === 'heat' && (
            <div className="mt-3">
              <div className="flex gap-1 mb-2">
                {getColorRampDisplay('lst_mean').map((color, i) => (
                  <div
                    key={i}
                    className="h-2.5 flex-1 rounded-sm"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-xs text-white/40">
                <span>20°C</span>
                <span>52°C</span>
              </div>
            </div>
          )}
        </button>

        {/* Pollution Index Button */}
        <button
          onClick={() => handleLayerToggle('pollution')}
          className={`w-full mb-3 rounded-2xl p-4 transition-all ${state.activeLayer === 'pollution'
            ? 'bg-white/15 backdrop-blur-md border border-white/30'
            : 'bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/10 hover:scale-105'
            } transform transition-transform`}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <Wind size={20} className="text-white/70" />
            </div>
            <div className="text-left flex-1">
              <div className="text-sm font-medium text-white">Pollution Index</div>
              <div className="text-xs text-white/50">Nitrogen Dioxide · Sentinel-5P TROPOMI</div>
            </div>
          </div>

          {state.activeLayer === 'pollution' && (
            <div className="mt-3">
              <div className="flex gap-1 mb-2">
                {getColorRampDisplay('no2_ppb').map((color, i) => (
                  <div
                    key={i}
                    className="h-2.5 flex-1 rounded-sm"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-xs text-white/40">
                <span>500 µg/m³</span>
                <span>5000 µg/m³</span>
              </div>
            </div>
          )}
        </button>

        {/* Vegetation Cover Button */}
        <button
          onClick={() => handleLayerToggle('vegetation')}
          className={`w-full mb-3 rounded-2xl p-4 transition-all ${state.activeLayer === 'vegetation'
            ? 'bg-white/15 backdrop-blur-md border border-white/30'
            : 'bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/10 hover:scale-105'
            } transform transition-transform`}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <Leaf size={20} className="text-white/70" />
            </div>
            <div className="text-left flex-1">
              <div className="text-sm font-medium text-white">Vegetation Cover</div>
              <div className="text-xs text-white/50">NDVI · Sentinel-2 SR</div>
            </div>
          </div>

          {state.activeLayer === 'vegetation' && (
            <div className="mt-3">
              <div className="flex gap-1 mb-2">
                {getColorRampDisplay('ndvi_mean').map((color, i) => (
                  <div
                    key={i}
                    className="h-2.5 flex-1 rounded-sm"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-xs text-white/40">
                <span>0.05</span>
                <span>0.7</span>
              </div>
            </div>
          )}
        </button>

        {/* Carbon Balance Button */}
        <button
          onClick={() => handleLayerToggle('carbon')}
          className={`w-full rounded-2xl p-4 transition-all ${state.activeLayer === 'carbon'
            ? 'bg-white/15 backdrop-blur-md border border-white/30'
            : 'bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/10 hover:scale-105'
            } transform transition-transform`}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <TreePine size={20} className="text-white/70" />
            </div>
            <div className="text-left flex-1">
              <div className="text-sm font-medium text-white">Carbon Balance</div>
              <div className="text-xs text-white/50">ML Model · Sink / Source Analysis</div>
            </div>
          </div>

          {state.activeLayer === 'carbon' && (
            <div className="mt-3">
              <div className="flex gap-1 mb-2">
                {['#d73027', '#f46d43', '#fdae61', '#fee08b', '#a6d96a', '#66bd63', '#1a9850'].map((color, i) => (
                  <div
                    key={i}
                    className="h-2.5 flex-1 rounded-sm"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-xs text-white/40">
                <span>Sink</span>
                <span>Source</span>
              </div>
            </div>
          )}
        </button>
      </div>

      {/* DATA SOURCES */}
      <div className="mt-auto pt-4">
        <div className="text-xs uppercase tracking-widest text-white/50 mb-3 font-semibold">
          Data Sources
        </div>
        <div className="space-y-1.5">
          {[
            { name: 'MODIS MOD11A2', desc: 'Land Surface Temperature' },
            { name: 'Sentinel-5P', desc: 'NO₂, SO₂, CO' },
            { name: 'Sentinel-2 SR', desc: 'NDVI, VCI, TCI' },
            { name: 'ESA WorldCover', desc: 'Land Use Classification' },
            { name: 'SMAP L4', desc: 'Soil Moisture' },
            { name: 'CHIRPS', desc: 'Rainfall / SPI' },
          ].map((src) => (
            <div key={src.name} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-500/40" />
              <span className="text-[10px] text-white/40">{src.name}</span>
              <span className="text-[10px] text-white/25 ml-auto">{src.desc}</span>
            </div>
          ))}
        </div>
        <div className="text-[9px] text-white/20 mt-3 italic">
          1,183 grid cells · 60 months · 30+ metrics
        </div>
      </div>

    </div>
  );
}
