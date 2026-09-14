// ================================================================
// BHOOMI -- Script 2: MODIS LST Daily Time Series (Fixed)
//
// PURPOSE:
//   Extracts daily daytime land-surface temperature from MODIS
//   MOD11A1 for each 3 km grid cell over Ahmedabad, 2020-2023.
//   lst_anomaly_c is deliberately not computed here; it is derived
//   later from the raw data after ingestion.
//
// OUTPUT:
//   bhoomi_lst_ahmedabad_2020.csv through 2023.csv
//   Columns: grid_id, captured_at, lst_celsius, pixel_count,
//            data_quality
// ================================================================

// -- SECTION 1: CONSTANTS -----------------------------------------
var CITY_CODE = 'GJ_AHM';
var CENTER_LON = 72.5714;
var CENTER_LAT = 23.0225;
var CELL_SIZE_M = 3000;
var BUFFER_M = 50000;
var DRIVE_FOLDER = 'bhoomi_exports';
var YEAR_START = 2020;
var YEAR_END = 2023;

// -- SECTION 2: SPATIAL SETUP -------------------------------------
// Identical to Script 1. The grid IDs must match exactly.
var UTM_43N = ee.Projection('EPSG:32643');
var centerPoint = ee.Geometry.Point([CENTER_LON, CENTER_LAT]);
var studyArea = centerPoint.buffer(BUFFER_M).bounds();
var rawGrid = studyArea.coveringGrid(UTM_43N, CELL_SIZE_M);
var studyAreaUTM = studyArea.transform(UTM_43N, 1);
var swCorner = ee.List(studyAreaUTM.coordinates().get(0)).get(0);
var originX = ee.Number(ee.List(swCorner).get(0));
var originY = ee.Number(ee.List(swCorner).get(1));

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
  return cell.set('grid_id', gridId);
});
print('Grid cell count (must match Script 1):', grid.size());

// -- SECTION 3: QUALITY MASKING -----------------------------------
// This is the final physical-range mask from the shared Claude chat.
// It replaced the QC_Day bitmask after that mask exported empty LST rows.
function maskLSTQuality(image) {
  var lst = image.select('LST_Day_1km');
  var validMask = lst.gt(7500).and(lst.lt(20000));
  return image.updateMask(validMask);
}

// -- SECTION 4: CELSIUS CONVERSION --------------------------------
function convertToCelsius(image) {
  var lstCelsius = image.select('LST_Day_1km')
    .multiply(0.02)
    .subtract(273.15)
    .rename('lst_celsius');
  var physicalMask = lstCelsius.gt(-10).and(lstCelsius.lt(75));
  return lstCelsius.updateMask(physicalMask)
    .copyProperties(image, ['system:time_start'])
    .set('date', image.date().format('YYYY-MM-dd'));
}

// -- SECTION 5: LOAD THE DAILY COLLECTION -------------------------
var fullCollection = ee.ImageCollection('MODIS/061/MOD11A1')
  .filterDate(ee.Date.fromYMD(YEAR_START, 1, 1), ee.Date.fromYMD(YEAR_END + 1, 1, 1))
  .filterBounds(studyArea)
  .map(maskLSTQuality)
  .map(convertToCelsius);

print('Total LST images after physical masking:', fullCollection.size());
var firstImage = ee.Image(fullCollection.first());
print('First image date:', firstImage.get('date'));
print('Valid pixel count in first image (must be > 0):', firstImage.reduceRegion({
  reducer: ee.Reducer.count(),
  geometry: studyArea,
  scale: 1000,
  maxPixels: 1e6
}));

// -- SECTION 6: ZONAL STATISTICS ----------------------------------
// Explicit output names fix the final CSV issue from the shared chat.
function computeZonalStats(imageCollection) {
  return imageCollection.map(function(image) {
    var date = image.get('date');
    var stats = image.select('lst_celsius').reduceRegions({
      collection: grid,
      reducer: ee.Reducer.mean().setOutputs(['lst_celsius']).combine(
        ee.Reducer.count().setOutputs(['pixel_count']),
        null,
        true
      ),
      scale: 1000,
      crs: 'EPSG:4326'
    });
    return stats.map(function(feature) {
      var pixelCount = ee.Number(feature.get('pixel_count'));
      return feature.set({
        captured_at: date,
        year: ee.Date(image.get('system:time_start')).get('year'),
        data_quality: pixelCount.divide(9).min(1.0)
      });
    });
  }).flatten();
}

var zonalStats = computeZonalStats(fullCollection);
var testStats = computeZonalStats(ee.ImageCollection([firstImage]));
var testSample = testStats.filter(ee.Filter.notNull(['lst_celsius'])).first();
print('Test feature (lst_celsius must have a value):', testSample);

// -- SECTION 7: YEARLY EXPORTS ------------------------------------
var selectors = ['grid_id', 'captured_at', 'lst_celsius', 'pixel_count', 'data_quality'];
for (var year = YEAR_START; year <= YEAR_END; year++) {
  Export.table.toDrive({
    collection: zonalStats.filter(ee.Filter.eq('year', year)),
    description: 'bhoomi_lst_ahmedabad_' + year,
    folder: DRIVE_FOLDER,
    fileNamePrefix: 'bhoomi_lst_ahmedabad_' + year,
    fileFormat: 'CSV',
    selectors: selectors
  });
}
