// ================================================================
// BHOOMI -- Script 1: Grid Generation for Ahmedabad
//
// PURPOSE:
//   Creates the canonical 3 km x 3 km grid used by every BHOOMI
//   extraction script. Grid IDs are stable and use the form
//   GJ_AHM_R###_C###.
//
// OUTPUT:
//   bhoomi_grids_ahmedabad.csv
//   bhoomi_grids_ahmedabad_geojson.geojson
// ================================================================

// -- SECTION 1: CONSTANTS -----------------------------------------
var CITY_CODE = 'GJ_AHM';
var CITY_NAME = 'Ahmedabad';
var DISTRICT = 'Ahmedabad';
var STATE = 'Gujarat';
var CENTER_LON = 72.5714;
var CENTER_LAT = 23.0225;
var CELL_SIZE_M = 3000;
var BUFFER_M = 50000;
var DRIVE_FOLDER = 'bhoomi_exports';

// -- SECTION 2: SPATIAL SETUP -------------------------------------
var UTM_43N = ee.Projection('EPSG:32643');
var centerPoint = ee.Geometry.Point([CENTER_LON, CENTER_LAT]);
var studyArea = centerPoint.buffer(BUFFER_M).bounds();
var rawGrid = studyArea.coveringGrid(UTM_43N, CELL_SIZE_M);
var studyAreaUTM = studyArea.transform(UTM_43N, 1);
var swCorner = ee.List(studyAreaUTM.coordinates().get(0)).get(0);
var originX = ee.Number(ee.List(swCorner).get(0));
var originY = ee.Number(ee.List(swCorner).get(1));
var elevation = ee.Image('CGIAR/SRTM90_V4');

var grid = rawGrid.map(function(cell) {
  var centroidWGS = cell.geometry().centroid(1);
  var centroidUTM = centroidWGS.transform(UTM_43N, 1);
  var utmCoords = centroidUTM.coordinates();
  var cellX = ee.Number(utmCoords.get(0));
  var cellY = ee.Number(utmCoords.get(1));
  var colIdx = cellX.subtract(originX).divide(CELL_SIZE_M).floor().int();
  var rowIdx = cellY.subtract(originY).divide(CELL_SIZE_M).floor().int();
  var colStr = ee.String('00').cat(colIdx.format('%d')).slice(-3);
  var rowStr = ee.String('00').cat(rowIdx.format('%d')).slice(-3);
  var gridId = ee.String(CITY_CODE).cat('_R').cat(rowStr).cat('_C').cat(colStr);
  var altitude = elevation.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: cell.geometry(),
    scale: 90,
    maxPixels: 1e8
  }).get('elevation');

  return cell.set({
    grid_id: gridId,
    city_id: CITY_CODE,
    city_name: CITY_NAME,
    district: DISTRICT,
    state: STATE,
    row_idx: rowIdx,
    col_idx: colIdx,
    centroid_lat: centroidWGS.coordinates().get(1),
    centroid_lng: centroidWGS.coordinates().get(0),
    altitude_m: altitude,
    dominant_lulc: null
  });
});

print('Grid cell count:', grid.size());
print('Sample grid cell:', grid.first());
Map.centerObject(studyArea, 9);
Map.addLayer(studyArea, {color: 'white'}, 'Study area');
Map.addLayer(grid.style({color: '00FFFF', fillColor: '00000000', width: 1}), {}, '3 km grid');

// -- SECTION 3: EXPORTS -------------------------------------------
var csvSelectors = [
  'grid_id', 'city_id', 'city_name', 'district', 'state',
  'row_idx', 'col_idx', 'centroid_lat', 'centroid_lng',
  'altitude_m', 'dominant_lulc'
];

Export.table.toDrive({
  collection: grid,
  description: 'bhoomi_grids_ahmedabad',
  folder: DRIVE_FOLDER,
  fileNamePrefix: 'bhoomi_grids_ahmedabad',
  fileFormat: 'CSV',
  selectors: csvSelectors
});

Export.table.toDrive({
  collection: grid,
  description: 'bhoomi_grids_ahmedabad_geojson',
  folder: DRIVE_FOLDER,
  fileNamePrefix: 'bhoomi_grids_ahmedabad_geojson',
  fileFormat: 'GeoJSON'
});
