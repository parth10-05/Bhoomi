/** BHOOMI -- Script 05: 15-day soil moisture, rainfall anomaly, and drought risk. */

var START = ee.Date('2021-01-01'), END = ee.Date('2026-01-01');
var WINDOW_DAYS = 15, CELL_SIZE_M = 3000, CITY_CODE = 'GJ_AHM', CENTER_LON = 72.5714, CENTER_LAT = 23.0225, BUFFER_M = 50000;
var UTM_43N = ee.Projection('EPSG:32643');
var studyArea = ee.Geometry.Point([CENTER_LON, CENTER_LAT]).buffer(BUFFER_M).bounds();

function buildGrid() {
  var rawGrid = studyArea.coveringGrid(UTM_43N, CELL_SIZE_M), a = studyArea.transform(UTM_43N, 1);
  var sw = ee.List(a.coordinates().get(0)).get(0), ox = ee.Number(ee.List(sw).get(0)), oy = ee.Number(ee.List(sw).get(1));
  return rawGrid.map(function(cell) {
      var c = cell.geometry().centroid(1), p = c.transform(UTM_43N, 1).coordinates();
      var col = ee.Number(p.get(0)).subtract(ox).divide(CELL_SIZE_M).floor().int(), row = ee.Number(p.get(1)).subtract(oy).divide(CELL_SIZE_M).floor().int();
      var id = ee.String(CITY_CODE).cat('_R').cat(ee.String('00').cat(row.format('%d')).slice(-3)).cat('_C').cat(ee.String('00').cat(col.format('%d')).slice(-3));
      return cell.set({grid_id: id, row_idx: row, col_idx: col, centroid_lat: c.coordinates().get(1), centroid_lng: c.coordinates().get(0)});
    });
}
var grids = buildGrid();

function soilMoisture(image) {
  return image.select('soil_moisture_am').rename('soil_moisture').copyProperties(image, ['system:time_start']);
}
function lstCelsius(image) {
  var raw = image.select('LST_Day_1km');
  return raw.updateMask(raw.gte(7500).and(raw.lte(20000))).multiply(0.02).subtract(273.15).rename('lst_celsius').copyProperties(image, ['system:time_start']);
}
var smapV005 = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/005').filterBounds(studyArea).filterDate(START, '2023-12-04').map(soilMoisture);
var smapV006 = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/006').filterBounds(studyArea).filterDate('2023-12-04', END).map(soilMoisture);
var smap = smapV005.merge(smapV006);
var chirps = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY').filterBounds(studyArea).filterDate(START.advance(-30, 'day'), END).select('precipitation');
var lst = ee.ImageCollection('MODIS/061/MOD11A1').filterBounds(studyArea).filterDate(START, END).map(lstCelsius);
var smapP05 = smap.reduce(ee.Reducer.percentile([5])).rename('sm_p05');
var smapP95 = smap.reduce(ee.Reducer.percentile([95])).rename('sm_p95');
var lstP05 = lst.reduce(ee.Reducer.percentile([5])).rename('lst_p05');
var lstP95 = lst.reduce(ee.Reducer.percentile([95])).rename('lst_p95');
var offsets = ee.List.sequence(0, END.difference(START, 'day').divide(WINDOW_DAYS).ceil().subtract(1));

var precipitationWindows = ee.ImageCollection.fromImages(offsets.map(function(offset) {
  var begin = START.advance(ee.Number(offset).multiply(WINDOW_DAYS), 'day');
  var finish = ee.Date(ee.Number(begin.advance(WINDOW_DAYS, 'day').millis()).min(END.millis()));
  return chirps.filterDate(finish.advance(-30, 'day'), finish).sum().rename('rainfall_30d_mm').set('window_start', begin.millis());
}));
var rainMean = precipitationWindows.mean().rename('rain_mean');
var rainStd = precipitationWindows.reduce(ee.Reducer.stdDev()).rename('rain_std');

var records = ee.FeatureCollection(offsets.map(function(offset) {
  var begin = START.advance(ee.Number(offset).multiply(WINDOW_DAYS), 'day');
  var finish = ee.Date(ee.Number(begin.advance(WINDOW_DAYS, 'day').millis()).min(END.millis()));
  var smWindow = smap.filterDate(begin, finish);
  var sm = smWindow.mean().rename('soil_moisture');
  var rain15 = chirps.filterDate(begin, finish).sum().rename('rainfall_mm');
  var rain30 = chirps.filterDate(finish.advance(-30, 'day'), finish).sum().rename('rainfall_30d_mm');
  // This follows the supplied report's z-score formula; it is not a fitted-gamma SPI.
  var spi = rain30.subtract(rainMean).divide(rainStd).rename('spi_30d');
  var temperature = lst.filterDate(begin, finish).mean().rename('lst_celsius');
  var moistureDeficit = smapP95.subtract(sm).divide(smapP95.subtract(smapP05)).clamp(0, 1).rename('soil_moisture_deficit');
  var heatStress = temperature.subtract(lstP05).divide(lstP95.subtract(lstP05)).clamp(0, 1).rename('heat_stress');
  var rainfallStress = spi.multiply(-1).divide(2).clamp(0, 1);
  var droughtRisk = moistureDeficit.multiply(0.35).add(heatStress.multiply(0.35)).add(rainfallStress.multiply(0.30)).multiply(100).rename('drought_risk');
  var values = sm.addBands(moistureDeficit).addBands(rain15).addBands(rain30).addBands(spi).addBands(heatStress).addBands(droughtRisk);
  return values.reduceRegions({collection: grids, reducer: ee.Reducer.mean(), scale: 9000, crs: 'EPSG:4326', tileScale: 4}).map(function(row) {
    return ee.Feature(null, {
      grid_id: row.get('grid_id'), row_idx: row.get('row_idx'), col_idx: row.get('col_idx'), centroid_lat: row.get('centroid_lat'), centroid_lng: row.get('centroid_lng'),
      captured_at: begin.format('YYYY-MM-dd'), window_end: finish.format('YYYY-MM-dd'), year: begin.get('year'),
      soil_moisture: row.get('soil_moisture'), soil_moisture_deficit: row.get('soil_moisture_deficit'), rainfall_mm: row.get('rainfall_mm'), rainfall_30d_mm: row.get('rainfall_30d_mm'),
      spi_30d: row.get('spi_30d'), heat_stress: row.get('heat_stress'), drought_risk: row.get('drought_risk'), smap_scene_count: smWindow.size(),
      source: 'NASA/SMAP/SPL3SMP_E/005;NASA/SMAP/SPL3SMP_E/006;UCSB-CHG/CHIRPS/DAILY;MODIS/061/MOD11A1'
    });
  });
})).flatten();

print('SMAP v005 scenes', smapV005.size(), 'SMAP v006 scenes', smapV006.size());
print('Drought sample', records.first());
var selectors = ['grid_id', 'row_idx', 'col_idx', 'centroid_lat', 'centroid_lng', 'captured_at', 'window_end', 'year', 'soil_moisture', 'soil_moisture_deficit', 'rainfall_mm', 'rainfall_30d_mm', 'spi_30d', 'heat_stress', 'drought_risk', 'smap_scene_count', 'source'];
for (var year = 2021; year <= 2025; year++) {
  Export.table.toDrive({collection: records.filter(ee.Filter.eq('year', year)), description: 'bhoomi_drought_ahmedabad_' + year, fileNamePrefix: 'bhoomi_drought_ahmedabad_' + year, fileFormat: 'CSV', selectors: selectors});
}
