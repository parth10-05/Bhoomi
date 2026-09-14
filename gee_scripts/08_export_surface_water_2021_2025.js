/** BHOOMI -- Script 08: 15-day Sentinel-2 water presence plus JRC static water history. */

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

function waterMask(image) {
  var qa = image.select('QA60');
  var clear = qa.bitwiseAnd(1 << 10).eq(0).and(qa.bitwiseAnd(1 << 11).eq(0));
  return image.updateMask(clear).normalizedDifference(['B3', 'B8']).gt(0.1).rename('water_presence').copyProperties(image, ['system:time_start']);
}
var sentinel = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(studyArea).filterDate(START, END).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20)).map(waterMask);
var jrc = ee.Image('JRC/GSW1_4/GlobalSurfaceWater');
var staticOccurrence = jrc.select('occurrence').reduceRegions({collection: grids, reducer: ee.Reducer.mean().setOutputs(['water_occurrence_pct']), scale: 30, crs: 'EPSG:4326', tileScale: 4});
var staticSeasonality = jrc.select('seasonality').reduceRegions({collection: grids, reducer: ee.Reducer.mean().setOutputs(['seasonality_months']), scale: 30, crs: 'EPSG:4326', tileScale: 4});
var staticJoined = ee.FeatureCollection(ee.Join.saveFirst('seasonality_row').apply(staticOccurrence, staticSeasonality, ee.Filter.equals({leftField: 'grid_id', rightField: 'grid_id'}))).map(function(row) {
  return ee.Feature(row).set('seasonality_months', ee.Feature(row.get('seasonality_row')).get('seasonality_months'));
});
var offsets = ee.List.sequence(0, END.difference(START, 'day').divide(WINDOW_DAYS).ceil().subtract(1));

var records = ee.FeatureCollection(offsets.map(function(offset) {
  var begin = START.advance(ee.Number(offset).multiply(WINDOW_DAYS), 'day');
  var finish = ee.Date(ee.Number(begin.advance(WINDOW_DAYS, 'day').millis()).min(END.millis()));
  var sourceWindow = sentinel.filterDate(begin, finish);
  var water = sourceWindow.mean().rename('water_presence');
  // setOutputs prevents reduced values from being emitted under the generic "mean" property.
  var dynamicRows = water.reduceRegions({collection: grids, reducer: ee.Reducer.mean().setOutputs(['water_presence']), scale: 30, crs: 'EPSG:4326', tileScale: 4});
  var joined = ee.FeatureCollection(ee.Join.saveFirst('static_row').apply(dynamicRows, staticJoined, ee.Filter.equals({leftField: 'grid_id', rightField: 'grid_id'})));
  return joined.map(function(row) {
    var staticRow = ee.Feature(row.get('static_row'));
    return ee.Feature(null, {
      grid_id: row.get('grid_id'), row_idx: row.get('row_idx'), col_idx: row.get('col_idx'), centroid_lat: row.get('centroid_lat'), centroid_lng: row.get('centroid_lng'),
      captured_at: begin.format('YYYY-MM-dd'), window_end: finish.format('YYYY-MM-dd'), year: begin.get('year'),
      water_presence: row.get('water_presence'), water_occurrence_pct: staticRow.get('water_occurrence_pct'), seasonality_months: staticRow.get('seasonality_months'),
      s2_scene_count: sourceWindow.size(), source: 'COPERNICUS/S2_SR_HARMONIZED;JRC/GSW1_4/GlobalSurfaceWater'
    });
  });
})).flatten();

print('Sentinel-2 input scenes after metadata filter', sentinel.size());
print('Surface-water sample', records.first());
var selectors = ['grid_id', 'row_idx', 'col_idx', 'centroid_lat', 'centroid_lng', 'captured_at', 'window_end', 'year', 'water_presence', 'water_occurrence_pct', 'seasonality_months', 's2_scene_count', 'source'];
for (var year = 2021; year <= 2025; year++) {
  Export.table.toDrive({collection: records.filter(ee.Filter.eq('year', year)), description: 'bhoomi_surface_water_ahmedabad_' + year, fileNamePrefix: 'bhoomi_surface_water_ahmedabad_' + year, fileFormat: 'CSV', selectors: selectors});
}
