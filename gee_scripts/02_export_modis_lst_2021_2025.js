/**
 * BHOOMI -- Script 02: MODIS daytime land-surface temperature, 2021-2025.
 *
 * The physical-range mask and explicit reducer output names are retained from
 * the recovered final chat revision. Exports are daily grid means by year.
 */

var START = ee.Date('2021-01-01');
var END = ee.Date('2026-01-01');
var GRID_METERS = 3000;
var UTM = ee.Projection('EPSG:32643');
var CITY_ID = 'GJ_AHM';
var studyArea = ee.Geometry.Rectangle([72.057, 22.544, 73.084, 23.502], null, false);

function buildGrid() {
  var bounds = studyArea.bounds(1, UTM);
  var ring = ee.List(bounds.coordinates().get(0));
  var lowerLeft = ee.List(ring.get(0));
  var upperRight = ee.List(ring.get(2));
  var xMin = ee.Number(lowerLeft.get(0));
  var yMin = ee.Number(lowerLeft.get(1));
  var cols = ee.Number(upperRight.get(0)).subtract(xMin).divide(GRID_METERS).ceil();
  var rows = ee.Number(upperRight.get(1)).subtract(yMin).divide(GRID_METERS).ceil();
  return ee.FeatureCollection(ee.List.sequence(0, rows.subtract(1)).map(function(row) {
    row = ee.Number(row);
    return ee.List.sequence(0, cols.subtract(1)).map(function(col) {
      col = ee.Number(col);
      var square = ee.Geometry.Rectangle([
        xMin.add(col.multiply(GRID_METERS)), yMin.add(row.multiply(GRID_METERS)),
        xMin.add(col.add(1).multiply(GRID_METERS)), yMin.add(row.add(1).multiply(GRID_METERS))
      ], UTM, false).intersection(studyArea, 1);
      var centroid = square.centroid(1).transform('EPSG:4326', 1).coordinates();
      return ee.Feature(square, {
        grid_id: ee.String(CITY_ID).cat('_R').cat(row.format('%03d')).cat('_C').cat(col.format('%03d')),
        row_idx: row,
        col_idx: col,
        centroid_lat: ee.Number(centroid.get(1)),
        centroid_lng: ee.Number(centroid.get(0))
      });
    });
  }).flatten());
}

var grids = buildGrid();

function toCelsius(image) {
  var raw = image.select('LST_Day_1km');
  // Recovered physical validity check: 150 K to 400 K in MODIS scale units.
  var valid = raw.gte(7500).and(raw.lte(20000));
  return raw.updateMask(valid).multiply(0.02).subtract(273.15)
    .rename('lst_celsius')
    .copyProperties(image, ['system:time_start']);
}

var lst = ee.ImageCollection('MODIS/061/MOD11A1')
  .filterBounds(studyArea)
  .filterDate(START, END)
  .map(toCelsius);
var baseline = lst.mean().rename('lst_baseline_c');
var dates = ee.List.sequence(0, END.difference(START, 'day').subtract(1)).map(function(offset) {
  return START.advance(ee.Number(offset), 'day');
});

function recordsForDay(day) {
  day = ee.Date(day);
  var nextDay = day.advance(1, 'day');
  var imageForDay = ee.Image(lst.filterDate(day, nextDay).first());
  var anomaly = imageForDay.subtract(baseline).rename('lst_anomaly_c');
  var lstRows = imageForDay.reduceRegions({
    collection: grids,
    reducer: ee.Reducer.mean().setOutputs(['lst_celsius'])
      .combine({reducer2: ee.Reducer.count().setOutputs(['pixel_count']), sharedInputs: true}),
    scale: 1000,
    crs: 'EPSG:4326',
    tileScale: 4
  });
  var anomalyRows = anomaly.reduceRegions({
    collection: grids,
    reducer: ee.Reducer.mean().setOutputs(['lst_anomaly_c']),
    scale: 1000,
    crs: 'EPSG:4326',
    tileScale: 4
  });
  var joined = ee.FeatureCollection(ee.Join.saveFirst('anomaly_row').apply(
    lstRows, anomalyRows, ee.Filter.equals({leftField: 'grid_id', rightField: 'grid_id'})
  ));
  return joined.map(function(row) {
    var anomalyRow = ee.Feature(row.get('anomaly_row'));
    var count = ee.Number(ee.Dictionary(row.toDictionary()).get('pixel_count', 0));
    return ee.Feature(null, {
      grid_id: row.get('grid_id'),
      row_idx: row.get('row_idx'),
      col_idx: row.get('col_idx'),
      centroid_lat: row.get('centroid_lat'),
      centroid_lng: row.get('centroid_lng'),
      captured_at: day.format('YYYY-MM-dd'),
      year: day.get('year'),
      lst_celsius: row.get('lst_celsius'),
      lst_anomaly_c: anomalyRow.get('lst_anomaly_c'),
      pixel_count: count,
      data_quality: count.divide(9).min(1),
      source: 'MODIS/061/MOD11A1'
    });
  });
}

var dailyRecords = ee.FeatureCollection(dates.map(recordsForDay)).flatten();
print('Days represented', dailyRecords.aggregate_count_distinct('captured_at'));
print('LST sample', dailyRecords.first());

var selectors = [
  'grid_id', 'row_idx', 'col_idx', 'centroid_lat', 'centroid_lng',
  'captured_at', 'year', 'lst_celsius', 'lst_anomaly_c', 'pixel_count',
  'data_quality', 'source'
];
for (var year = 2021; year <= 2025; year++) {
  Export.table.toDrive({
    collection: dailyRecords.filter(ee.Filter.eq('year', year)),
    description: 'bhoomi_lst_ahmedabad_' + year,
    fileNamePrefix: 'bhoomi_lst_ahmedabad_' + year,
    fileFormat: 'CSV',
    selectors: selectors
  });
}
