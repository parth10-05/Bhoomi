import { SpatialDataSource } from '../types/domain';
import { staticAdapter } from './staticAdapter';
import { apiAdapter } from './apiAdapter';

const useApi = String(import.meta.env.VITE_USE_API ?? 'true').trim() !== 'false';

export const activeAdapter: SpatialDataSource = useApi
  ? apiAdapter
  : staticAdapter;
