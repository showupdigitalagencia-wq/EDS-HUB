async function run() {
  const url = 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/hubspot-properties-discovery';
  const adminKey = 'process.env.INTERNAL_ADMIN_SECRET || ""';

  console.log('Calling hubspot-properties-discovery with action: audit_hubspot_missing_leads...');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-admin-key': adminKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'audit_hubspot_missing_leads' })
  });

  console.log('HTTP Status:', res.status);
  const data = await res.json();
  console.log('Response summary:', {
    success: data.success,
    total_scanned: data.total_scanned,
    matched_count: data.matched_count,
    missing_count: data.missing_count
  });

  if (data.missing_contacts && data.missing_contacts.length > 0) {
    console.log(`\n--- ALL MISSING CONTACTS (${data.missing_contacts.length}) ---`);
    // Sort by createdate descending
    const sorted = [...data.missing_contacts].sort((a, b) => new Date(b.createdate).getTime() - new Date(a.createdate).getTime());
    console.log('Top 15 most recent missing contacts:');
    console.log(JSON.stringify(sorted.slice(0, 15), null, 2));

    // Distribution by month:
    const byMonth = {};
    for (const c of sorted) {
      const m = (c.createdate || 'unknown').slice(0, 7);
      byMonth[m] = (byMonth[m] || 0) + 1;
    }
    console.log('\nMissing contacts by month:', byMonth);
  } else {
    console.log('\nNO MISSING CONTACTS FOUND!');
  }
}

run().catch(console.error);
