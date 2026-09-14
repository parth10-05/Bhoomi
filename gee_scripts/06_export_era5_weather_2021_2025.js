/** BHOOMI -- Script 06: 15-day ERA5-Land temperature and vector-mean wind. */

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
var era5 = ee.ImageCollection('ECMWF/ERA5_LAND/HOURLY').filterBounds(studyArea).filterDate(START, END)
  .select(['u_component_of_wind_10m', 'v_component_of_wind_10m', 'temperature_2m']);
var offsets = ee.List.sequence(0, END.difference(START, 'day').divide(WINDOW_DAYS).ceil().subtract(1));

var records = ee.FeatureCollection(offsets.map(function(offset) {
  var begin = START.advance(ee.Number(offset).multiply(WINDOW_DAYS), 'day');
  var finish = ee.Date(ee.Number(begin.advance(WINDOW_DAYS, 'day').millis()).min(END.millis()));
  var hourly = era5.filterDate(begin, finish);
  var mean = hourly.mean();
  var values = mean.select('u_component_of_wind_10m').rename('u_ms')
    .addBands(mean.select('v_component_of_wind_10m').rename('v_ms'))
    .addBands(mean.select('temperature_2m').subtract(273.15).rename('temp_celsius'));
  return values.reduceRegions({collection: grids, reducer: ee.Reducer.mean(), scale: 11132, crs: 'EPSG:4326', tileScale: 4}).map(function(row) {
    var u = ee.Number(row.get('u_ms')), v = ee.Number(row.get('v_ms'));
    var speed = u.pow(2).add(v.pow(2)).sqrt();
    // Meteorological direction: direction from which the vector is blowing.
    var direction = u.atan2(v).multiply(180 / Math.PI).add(180).mod(360);
    return ee.Feature(null, {
      grid_id: row.get('grid_id'), row_idx: row.get('row_idx'), col_idx: row.get('col_idx'), centroid_lat: row.get('centroid_lat'), centroid_lng: row.get('centroid_lng'),
      captured_at: begin.format('YYYY-MM-dd'), window_end: finish.format('YYYY-MM-dd'), year: begin.get('year'),
      u_ms: u, v_ms: v, wind_speed_ms: speed, wind_dir_deg: ee.Algorithms.If(speed.lt(0.01), null, direction),
      temp_celsius: row.get('temp_celsius'), hourly_observation_count: hourly.size(),
      source: 'ECMWF/ERA5_LAND/HOURLY'
    });
  });
})).flatten();

print('ERA5 hourly observations', era5.size());
print('Weather sample', records.first());
var selectors = ['grid_id', 'row_idx', 'col_idx', 'centroid_lat', 'centroid_lng', 'captured_at', 'window_end', 'year', 'u_ms', 'v_ms', 'wind_speed_ms', 'wind_dir_deg', 'temp_celsius', 'hourly_observation_count', 'source'];
for (var year = 2021; year <= 2025; year++) {
  Export.table.toDrive({collection: records.filter(ee.Filter.eq('year', year)), description: 'bhoomi_weather_ahmedabad_' + year, fileNamePrefix: 'bhoomi_weather_ahmedabad_' + year, fileFormat: 'CSV', selectors: selectors});
}
