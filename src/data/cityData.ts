export interface CityData {
  center: [number, number];
  zoom: number;
}

export const cities: Record<'AHM', CityData> = {
  AHM: {
    center: [23.0225, 72.5714],
    zoom: 11,
  },
};
