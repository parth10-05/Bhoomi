import pg from 'pg';
const { Client } = pg;
const c = new Client({ connectionString: 'postgresql://doadmin:AVNS_jS9ACIF1DnyH9Yj6F3m@bhoomi-db-do-user-33347569-0.e.db.ondigitalocean.com:25060/defaultdb?sslmode=require', ssl: { rejectUnauthorized: false } });

async function main() {
    await c.connect();

    // grid_obs_monthly columns
    const cols = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='grid_obs_monthly' ORDER BY ordinal_position");
    console.log('=== grid_obs_monthly columns ===');
    cols.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type}`));

    // lulc_snapshots columns
    const lcols = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='lulc_snapshots' ORDER BY ordinal_position");
    console.log('\n=== lulc_snapshots columns ===');
    lcols.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type}`));

    // Row counts
    const gc = await c.query('SELECT COUNT(*) as cnt FROM grids');
    const oc = await c.query('SELECT COUNT(*) as cnt FROM grid_obs_monthly');
    const lc = await c.query('SELECT COUNT(*) as cnt FROM lulc_snapshots');
    console.log(`\nRow counts: grids=${gc.rows[0].cnt}, grid_obs_monthly=${oc.rows[0].cnt}, lulc_snapshots=${lc.rows[0].cnt}`);

    // Date range
    const dr = await c.query("SELECT MIN(obs_month) as min_date, MAX(obs_month) as max_date FROM grid_obs_monthly");
    console.log(`\nDate range: ${dr.rows[0].min_date} to ${dr.rows[0].max_date}`);

    // Distinct cities
    const dc = await c.query("SELECT DISTINCT city_id FROM grids ORDER BY city_id");
    console.log(`\nCities: ${dc.rows.map(r => r.city_id).join(', ')}`);

    // Sample grid row
    const sg = await c.query("SELECT * FROM grids LIMIT 1");
    console.log('\n=== Sample grid row ===');
    const gRow = sg.rows[0];
    Object.keys(gRow).forEach(k => { if (k !== 'geometry') console.log(`  ${k}: ${gRow[k]}`); else console.log(`  geometry: [PostGIS]`); });

    // Sample obs row
    const so = await c.query("SELECT * FROM grid_obs_monthly LIMIT 1");
    console.log('\n=== Sample obs row ===');
    Object.entries(so.rows[0]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

    // Distinct months
    const dm = await c.query("SELECT DISTINCT obs_month FROM grid_obs_monthly ORDER BY obs_month");
    console.log(`\nDistinct months (${dm.rows.length}): ${dm.rows.map(r => r.obs_month).join(', ')}`);

    // Sample lulc row
    if (lc.rows[0].cnt > 0) {
        const sl = await c.query("SELECT * FROM lulc_snapshots LIMIT 1");
        console.log('\n=== Sample lulc row ===');
        Object.entries(sl.rows[0]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    }

    // Grids per city
    const gpc = await c.query("SELECT city_id, COUNT(*) as cnt FROM grids GROUP BY city_id");
    console.log('\nGrids per city:');
    gpc.rows.forEach(r => console.log(`  ${r.city_id}: ${r.cnt}`));

    await c.end();
}

main().catch(e => { console.error(e); process.exit(1); });
