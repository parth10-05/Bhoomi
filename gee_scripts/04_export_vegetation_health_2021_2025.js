/** BHOOMI -- Script 04: 15-day NDVI, VCI, TCI, and VHI for 2021-2025. */

var START = ee.Date('2021-01-01');
var END = ee.Date('2026-01-01');
var WINDOW_DAYS = 15, GRID_METERS = 3000;
var UTM = ee.Projection('EPSG:32643'), CITY_ID = 'GJ_AHM';
var studyArea = ee.Geometry.Rectangle([72.057, 22.544, 73.084, 23.502], null, false);

function buildGrid() {
  var b = studyArea.bounds(1, UTM), r = ee.List(b.coordinates().get(0)), ll = ee.List(r.get(0)), ur = ee.List(r.get(2));
  var x = ee.Number(ll.get(0)), y = ee.Number(ll.get(1));
  var nc = ee.Number(ur.get(0)).subtract(x).divide(GRID_METERS).ceil(), nr = ee.Number(ur.get(1)).subtract(y).divide(GRID_METERS).ceil();
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

function sentinelNdvi(image) {
  var qa = image.select('QA60');
  var clear = qa.bitwiseAnd(1 << 10).eq(0).and(qa.bitwiseAnd(1 << 11).eq(0));
  return image.updateMask(clear).normalizedDifference(['B8', 'B4']).rename('ndvi').copyProperties(image, ['system:time_start']);
}
function modisLst(image) {
  var raw = image.select('LST_Day_1km');
  return raw.updateMask(raw.gte(7500).and(raw.lte(20000))).multiply(0.02).subtract(273.15).rename('lst_celsius').copyProperties(image, ['system:time_start']);
}

var ndviSource = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(studyArea).filterDate(START, END).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20)).map(sentinelNdvi);
var lstSource = ee.ImageCollection('MODIS/061/MOD11A1').filterBounds(studyArea).filterDate(START, END).map(modisLst);
var ndviP05 = ndviSource.reduce(ee.Reducer.percentile([5])).rename('ndvi_p05');
var ndviP95 = ndviSource.reduce(ee.Reducer.percentile([95])).rename('ndvi_p95');
var lstP05 = lstSource.reduce(ee.Reducer.percentile([5])).rename('lst_p05');
var lstP95 = lstSource.reduce(ee.Reducer.percentile([95])).rename('lst_p95');
var offsets = ee.List.sequence(0, END.difference(START, 'day').divide(WINDOW_DAYS).ceil().subtract(1));

var records = ee.FeatureCollection(offsets.map(function(offset) {
  var begin = START.advance(ee.Number(offset).multiply(WINDOW_DAYS), 'day');
  var finish = ee.Date(ee.Number(begin.advance(WINDOW_DAYS, 'day').millis()).min(END.millis()));
  var ndviWindow = ndviSource.filterDate(begin, finish);
  var ndvi = ndviWindow.median().rename('ndvi');
  var lst = lstSource.filterDate(begin, finish).mean().rename('lst_celsius');
  var vci = ndvi.subtract(ndviP05).divide(ndviP95.subtract(ndviP05)).multiply(100).clamp(0, 100).rename('vci');
  var tci = lstP95.subtract(lst).divide(lstP95.subtract(lstP05)).multiply(100).clamp(0, 100).rename('tci');
  var vhi = vci.add(tci).divide(2).rename('vhi');
  var values = ndvi.addBands(vci).addBands(tci).addBands(vhi).reduceRegions({collection: grids, reducer: ee.Reducer.mean(), scale: 30, crs: 'EPSG:4326', tileScale: 4});
  var counts = ndvi.reduceRegions({collection: grids, reducer: ee.Reducer.count().setOutputs(['valid_pixel_count']), scale: 30, crs: 'EPSG:4326', tileScale: 4});
  var joined = ee.FeatureCollection(ee.Join.saveFirst('count_row').apply(values, counts, ee.Filter.equals({leftField: 'grid_id', rightField: 'grid_id'})));
  return joined.map(function(row) {
    var countRow = ee.Feature(row.get('count_row'));
    return ee.Feature(null, {
      grid_id: row.get('grid_id'), row_idx: row.get('row_idx'), col_idx: row.get('col_idx'), centroid_lat: row.get('centroid_lat'), centroid_lng: row.get('centroid_lng'),
      captured_at: begin.format('YYYY-MM-dd'), window_end: finish.format('YYYY-MM-dd'), year: begin.get('year'),
      ndvi: row.get('ndvi'), vci: row.get('vci'), tci: row.get('tci'), vhi: row.get('vhi'),
      s2_scene_count: ndviWindow.size(), valid_pixel_count: countRow.get('valid_pixel_count'),
      data_quality: ee.Number(ee.Dictionary(countRow.toDictionary()).get('valid_pixel_count', 0)).divide(10000).min(1),
      source: 'COPERNICUS/S2_SR_HARMONIZED;MODIS/061/MOD11A1'
    });
  });
})).flatten();

print('Sentinel-2 input scenes after metadata filter', ndviSource.size());
print('Vegetation-health sample', records.first());
var selectors = ['grid_id', 'row_idx', 'col_idx', 'centroid_lat', 'centroid_lng', 'captured_at', 'window_end', 'year', 'ndvi', 'vci', 'tci', 'vhi', 's2_scene_count', 'valid_pixel_count', 'data_quality', 'source'];
for (var year = 2021; year <= 2025; year++) {
  Export.table.toDrive({collection: records.filter(ee.Filter.eq('year', year)), description: 'bhoomi_vegetation_health_ahmedabad_' + year, fileNamePrefix: 'bhoomi_vegetation_health_ahmedabad_' + year, fileFormat: 'CSV', selectors: selectors});
}
