/** BHOOMI -- Script 07: annual ESRI 10 m land-cover fractions, 2021-2024. */

var CELL_SIZE_M = 3000, CITY_CODE = 'GJ_AHM', CENTER_LON = 72.5714, CENTER_LAT = 23.0225, BUFFER_M = 50000;
var UTM_43N = ee.Projection('EPSG:32643');
var studyArea = ee.Geometry.Point([CENTER_LON, CENTER_LAT]).buffer(BUFFER_M).bounds();
var esri = ee.ImageCollection('projects/sat-io/open-datasets/landcover/ESRI_Global-LULC_10m_TS');

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

function landCoverForYear(year) {
  // The catalog consists of tiles; mosaic is required to avoid null cells outside one tile.
  return esri.filter(ee.Filter.stringContains('system:index', String(year))).mosaic().select(0).rename('lulc_class');
}
function fraction(image, classCode, outputName) {
  return image.eq(classCode).rename(outputName);
}

var allYears = ee.FeatureCollection([]);
for (var year = 2021; year <= 2024; year++) {
  var lc = landCoverForYear(year);
  var water = fraction(lc, 1, 'water_pct');
  var trees = fraction(lc, 2, 'trees_pct');
  var flooded = fraction(lc, 4, 'flooded_pct');
  var crops = fraction(lc, 5, 'crops_pct');
  var built = fraction(lc, 7, 'built_pct');
  var bare = fraction(lc, 8, 'bare_pct');
  var rangeland = fraction(lc, 9, 'rangeland_pct');
  var snowIce = fraction(lc, 10, 'snow_ice_pct');
  var clouds = fraction(lc, 11, 'clouds_pct');
  var fractions = water.addBands(trees).addBands(flooded).addBands(crops).addBands(built).addBands(bare).addBands(rangeland).addBands(snowIce).addBands(clouds);
  var yearRows = fractions.reduceRegions({collection: grids, reducer: ee.Reducer.mean(), scale: 10, crs: 'EPSG:4326', tileScale: 4}).map(function(row) {
    var values = ee.Dictionary(row.toDictionary());
    var waterValue = ee.Number(values.get('water_pct'));
    var treesValue = ee.Number(values.get('trees_pct'));
    var floodedValue = ee.Number(values.get('flooded_pct'));
    var cropsValue = ee.Number(values.get('crops_pct'));
    var builtValue = ee.Number(values.get('built_pct'));
    var bareValue = ee.Number(values.get('bare_pct'));
    var rangelandValue = ee.Number(values.get('rangeland_pct'));
    var snowIceValue = ee.Number(values.get('snow_ice_pct'));
    var cloudsValue = ee.Number(values.get('clouds_pct'));
    var maxFraction = waterValue.max(treesValue).max(floodedValue).max(cropsValue).max(builtValue).max(bareValue).max(rangelandValue).max(snowIceValue).max(cloudsValue);
    var dominantClass = ee.Number(ee.Algorithms.If(waterValue.eq(maxFraction), 1,
      ee.Algorithms.If(treesValue.eq(maxFraction), 2,
      ee.Algorithms.If(floodedValue.eq(maxFraction), 4,
      ee.Algorithms.If(cropsValue.eq(maxFraction), 5,
      ee.Algorithms.If(builtValue.eq(maxFraction), 7,
      ee.Algorithms.If(bareValue.eq(maxFraction), 8,
      ee.Algorithms.If(rangelandValue.eq(maxFraction), 9,
      ee.Algorithms.If(snowIceValue.eq(maxFraction), 10, 11)))))))));
    return ee.Feature(null, {
      grid_id: row.get('grid_id'), row_idx: row.get('row_idx'), col_idx: row.get('col_idx'), centroid_lat: row.get('centroid_lat'), centroid_lng: row.get('centroid_lng'),
      year: year, dominant_class: dominantClass, dominant_class_pct: maxFraction.multiply(100),
      water_pct: waterValue.multiply(100), trees_pct: treesValue.multiply(100), flooded_pct: floodedValue.multiply(100), crops_pct: cropsValue.multiply(100),
      built_pct: builtValue.multiply(100), bare_pct: bareValue.multiply(100), rangeland_pct: rangelandValue.multiply(100), snow_ice_pct: snowIceValue.multiply(100), clouds_pct: cloudsValue.multiply(100),
      source: 'projects/sat-io/open-datasets/landcover/ESRI_Global-LULC_10m_TS'
    });
  });
  allYears = allYears.merge(yearRows);
}

print('ESRI source tiles', esri.size());
print('LULC sample', allYears.first());
var selectors = ['grid_id', 'row_idx', 'col_idx', 'centroid_lat', 'centroid_lng', 'year', 'dominant_class', 'dominant_class_pct', 'water_pct', 'trees_pct', 'flooded_pct', 'crops_pct', 'built_pct', 'bare_pct', 'rangeland_pct', 'snow_ice_pct', 'clouds_pct', 'source'];
for (var exportYear = 2021; exportYear <= 2024; exportYear++) {
  Export.table.toDrive({collection: allYears.filter(ee.Filter.eq('year', exportYear)), description: 'bhoomi_lulc_ahmedabad_' + exportYear, fileNamePrefix: 'bhoomi_lulc_ahmedabad_' + exportYear, fileFormat: 'CSV', selectors: selectors});
}
