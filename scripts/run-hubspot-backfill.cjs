async function runBackfill() {
  const url = 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/hubspot-properties-discovery';
  const adminKey = 'eds_internal_course_materials_mgmt_2026';

  console.log('Initiating controlled production HubSpot backfill...');
  const startTime = Date.now();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-admin-key': adminKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'backfill_all_missing_hubspot_leads', max_pages: 10 })
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Backfill finished in ${duration}s. HTTP Status: ${res.status}`);

  const data = await res.json();
  console.log('Backfill Result:');
  console.log(JSON.stringify(data, null, 2));
}

runBackfill().catch(console.error);
