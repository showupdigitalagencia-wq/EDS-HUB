// Use global fetch

async function testHubspotReconcile() {
  const url = 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/hubspot-reconcile';
  const adminKey = 'eds_internal_course_materials_mgmt_2026';

  console.log('Calling hubspot-reconcile with lookback_days: 30...');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminKey}`,
      'x-admin-key': adminKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      lookback_days: 30
    })
  });

  console.log('HTTP Status:', res.status);
  const text = await res.text();
  console.log('Response:', text);
}

testHubspotReconcile().catch(console.error);
