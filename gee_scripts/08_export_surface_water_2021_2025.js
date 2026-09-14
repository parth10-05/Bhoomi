/** BHOOMI -- Script 08: 15-day Sentinel-2 water presence plus JRC static water history. */

var START = ee.Date('2021-01-01'), END = ee.Date('2026-01-01');
var WINDOW_DAYS = 15, GRID_METERS = 3000, UTM = ee.Projection('EPSG:32643'), CITY_ID = 'GJ_AHM';
var studyArea = ee.Geometry.Rectangle([72.057, 22.544, 73.084, 23.502], null, false);

function buildGrid() {
  var b = studyArea.bounds(1, UTM), ring = ee.List(b.coordinates().get(0)), ll = ee.List(ring.get(0)), ur = ee.List(ring.get(2));
  var x = ee.Number(ll.get(0)), y = ee.Number(ll.get(1)), nc = ee.Number(ur.get(0)).subtract(x).divide(GRID_METERS).ceil(), nr = ee.Number(ur.get(1)).subtract(y).divide(GRID_METERS).ceil();
  return ee.FeatureCollection(ee.List.sequence(0, nr.subtract(1)).map(function(row) {
    return ee.List.sequence(0, nc.subtract(1)).map(function(col) {
      row = ee.Number(row); col = ee.Number(col);
      var g = ee.Geometry.Rectangle([x.add(col.multiply(GRID_METERS)), y.add(row.multiply(GRID_METERS)), x.add(col.add(1).multiply(GRID_METERS)), y.add(row.add(1).multiply(GRID_METERS))], UTM, false).intersection(studyArea, 1);
      var c = g.centroid(1).transform('EPSG:4326', 1).coordinates();
      return ee.Feature(g, {grid_id: ee.String(CITY_ID).cat('_R').cat(row.format('%03d')).cat('_C').cat(col.format('%03d')), row_idx: row, col_idx: col, centroid_lat: ee.Number(c.get(1)), centroid_lng: ee.Number(c.get(0))});
    });
  }).flatten());
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
