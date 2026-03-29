import React, { createContext, useContext, useReducer, useCallback, ReactNode } from 'react';
import { DashboardState, MetricKey } from '../types/domain';

export type ActiveLayer = 'heat' | 'pollution' | 'vegetation' | 'carbon' | null;

type Action =
  | { type: 'SET_METRIC'; payload: MetricKey }
  | { type: 'SELECT_CELL'; payload: string | null }
  | { type: 'SET_DATE'; payload: string }
  | { type: 'SET_BASEMAP'; payload: 'satellite' | 'dark' | 'light' }
  | { type: 'SET_ACTIVE_LAYER'; payload: ActiveLayer };

const initialState: DashboardState = {
  activeMetric: 'lst_mean',
  selectedCellId: null,
  selectedDate: '2025-06',   // Default to a month with data
  basemap: 'dark',
  activeLayer: 'heat',
};

function dashboardReducer(state: DashboardState, action: Action): DashboardState {
  switch (action.type) {
    case 'SET_METRIC':
      return { ...state, activeMetric: action.payload };
    case 'SELECT_CELL':
      return { ...state, selectedCellId: action.payload };
    case 'SET_DATE':
      return { ...state, selectedDate: action.payload };
    case 'SET_BASEMAP':
      return { ...state, basemap: action.payload };
    case 'SET_ACTIVE_LAYER':
      return { ...state, activeLayer: action.payload };
    default:
      return state;
  }
}

interface DashboardContextType {
  state: DashboardState;
  setMetric: (metric: MetricKey) => void;
  selectCell: (cellId: string | null) => void;
  setDate: (date: string) => void;
  setBasemap: (basemap: 'satellite' | 'dark' | 'light') => void;
  setActiveLayer: (layer: ActiveLayer) => void;
}

const DashboardContext = createContext<DashboardContextType | undefined>(
  undefined
);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(dashboardReducer, initialState);

  const setMetric = useCallback((metric: MetricKey) => {
    dispatch({ type: 'SET_METRIC', payload: metric });
  }, []);

  const selectCell = useCallback((cellId: string | null) => {
    dispatch({ type: 'SELECT_CELL', payload: cellId });
  }, []);

  const setDate = useCallback((date: string) => {
    dispatch({ type: 'SET_DATE', payload: date });
  }, []);

  const setBasemap = useCallback((basemap: 'satellite' | 'dark' | 'light') => {
    dispatch({ type: 'SET_BASEMAP', payload: basemap });
  }, []);

  const setActiveLayer = useCallback((layer: ActiveLayer) => {
    dispatch({ type: 'SET_ACTIVE_LAYER', payload: layer });
  }, []);

  const contextValue = React.useMemo(
    () => ({ state, setMetric, selectCell, setDate, setBasemap, setActiveLayer }),
    [state, setMetric, selectCell, setDate, setBasemap, setActiveLayer]
  );

  return (
    <DashboardContext.Provider value={contextValue}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardContextType {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
}
