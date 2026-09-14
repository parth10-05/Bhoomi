/**
 * BHOOMI -- Script 01: Ahmedabad 3 km reference grid.
 *
 * Run in the Google Earth Engine Code Editor.  This script creates the
 * canonical grid shared by scripts 02-08 and exports both tabular and spatial
 * reference files.  It does not write an Earth Engine asset.
 */

var CITY_ID = 'GJ_AHM';
var CITY_NAME = 'Ahmedabad';
var DISTRICT = 'Ahmedabad';
var STATE = 'Gujarat';
var GRID_METERS = 3000;
var UTM = ee.Projection('EPSG:32643');

// Bounding box from BHOOMI_GEE_Technical_Report.docx.
var studyArea = ee.Geometry.Rectangle([72.057, 22.544, 73.084, 23.502], null, false);
var projectedBounds = studyArea.bounds(1, UTM);
var ring = ee.List(projectedBounds.coordinates().get(0));
var lowerLeft = ee.List(ring.get(0));
var upperRight = ee.List(ring.get(2));
var xMin = ee.Number(lowerLeft.get(0));
var yMin = ee.Number(lowerLeft.get(1));
var xMax = ee.Number(upperRight.get(0));
var yMax = ee.Number(upperRight.get(1));
var rowCount = yMax.subtract(yMin).divide(GRID_METERS).ceil();
var colCount = xMax.subtract(xMin).divide(GRID_METERS).ceil();

var elevation = ee.Image('CGIAR/SRTM90_V4');

var rows = ee.List.sequence(0, rowCount.subtract(1));
var cells = ee.FeatureCollection(rows.map(function(row) {
  row = ee.Number(row);
  var cols = ee.List.sequence(0, colCount.subtract(1));
  return cols.map(function(col) {
    col = ee.Number(col);
    var x0 = xMin.add(col.multiply(GRID_METERS));
    var y0 = yMin.add(row.multiply(GRID_METERS));
    var square = ee.Geometry.Rectangle(
      [x0, y0, x0.add(GRID_METERS), y0.add(GRID_METERS)], UTM, false
    );
    var cell = square.intersection(studyArea, 1);
    var centroid = cell.centroid(1).transform('EPSG:4326', 1).coordinates();
    var altitude = elevation.reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: cell,
      scale: 90,
      maxPixels: 1e8,
      bestEffort: true
    }).get('elevation');

    return ee.Feature(cell, {
      grid_id: ee.String(CITY_ID).cat('_R').cat(row.format('%03d')).cat('_C').cat(col.format('%03d')),
      city_id: CITY_ID,
      city_name: CITY_NAME,
      district: DISTRICT,
      state: STATE,
      row_idx: row,
      col_idx: col,
      centroid_lat: ee.Number(centroid.get(1)),
      centroid_lng: ee.Number(centroid.get(0)),
      altitude_m: altitude,
      dominant_lulc: null
    });
  });
}).flatten());

print('BHOOMI 3 km grid cell count (verify after export)', cells.size());
print('First reference cell', cells.first());
Map.centerObject(studyArea, 9);
Map.addLayer(studyArea, {color: 'white'}, 'Study area');
Map.addLayer(cells.style({color: '00FFFF', fillColor: '00000000', width: 1}), {}, '3 km grid');

var csvSelectors = [
  'grid_id', 'city_id', 'city_name', 'district', 'state',
  'row_idx', 'col_idx', 'centroid_lat', 'centroid_lng',
  'altitude_m', 'dominant_lulc'
];

Export.table.toDrive({
  collection: cells,
  description: 'bhoomi_ahmedabad_grid_3km_csv',
  fileNamePrefix: 'bhoomi_ahmedabad_grid_3km',
  fileFormat: 'CSV',
  selectors: csvSelectors
});

Export.table.toDrive({
  collection: cells,
  description: 'bhoomi_ahmedabad_grid_3km_geojson',
  fileNamePrefix: 'bhoomi_ahmedabad_grid_3km',
  fileFormat: 'GeoJSON'
});
