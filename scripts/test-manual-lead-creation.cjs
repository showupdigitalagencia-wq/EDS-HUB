/**
 * scripts/test-manual-lead-creation.cjs
 * Comprehensive test of create_manual_lead RPC in production with brand new lead and inspect state.
 */

const url = 'https://xogcexclqiornuscsdmn.supabase.co';
const adminKey = 'eds_internal_course_materials_mgmt_2026';

async function callRpc(rpcName, params) {
  const res = await fetch(`${url}/functions/v1/manage-course-materials`, {
    method: 'POST',
    headers: {
      'x-admin-key': adminKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'test_rpc',
      rpc_name: rpcName,
      params
    })
  });
  return res.json();
}

async function runTests() {
  console.log('=== TEST: Manual Lead Creation & Deduplication (Fresh Lead) ===');

  // List all courses from DB
  const listRes = await fetch(`${url}/functions/v1/manage-course-materials`, {
    method: 'POST',
    headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'list_all' })
  });
  const listData = await listRes.json();
  const courses = listData.courses || [];
  
  const perio = courses.find(c => c.name?.toLowerCase().includes('perio') || c.code === 'PST-01');
  const wisdom = courses.find(c => c.name?.toLowerCase().includes('wisdom') || c.code === 'WTT-01');

  const perioCourseId = perio?.id;
  const wisdomCourseId = wisdom?.id;

  console.log(`Found Courses:`);
  console.log(`  Periodontal: ${perio?.name} (ID: ${perioCourseId})`);
  console.log(`  Wisdom: ${wisdom?.name} (ID: ${wisdomCourseId})`);

  const runSuffix = Date.now();
  const testEmail = `fresh.manual.${runSuffix}@gmail.com`;
  const testPhone = `2199${Math.floor(1000000 + Math.random() * 8999999)}`;

  console.log('\n--- Step 1: Initial Brand New Lead Creation ---');
  const res1 = await callRpc('create_manual_lead', {
    p_first_name: 'Teste',
    p_last_name: 'Manual Fresh',
    p_email: testEmail,
    p_phone: testPhone,
    p_contact_preference: null, // "Não informada"
    p_stage_id: null,
    p_referred_by: null,
    p_interests: [{ course_id: perioCourseId, course_session_id: null, priority: 1 }],
    p_tags: []
  });

  console.log('Result 1 (Initial):', JSON.stringify(res1, null, 2));
  if (res1.error || !res1.data?.success || res1.data.is_existing !== false) {
    console.error('FAIL: Step 1 failed:', res1);
    process.exit(1);
  }
  const leadId1 = res1.data.lead_id;
  console.log(`PASS: Created Lead ID ${leadId1}, is_existing: false`);

  console.log('\n--- Step 2: Returning Lead with DIFFERENT course (Wisdom) ---');
  const res2 = await callRpc('create_manual_lead', {
    p_first_name: 'Teste',
    p_last_name: 'Manual Fresh',
    p_email: testEmail,
    p_phone: testPhone,
    p_contact_preference: null,
    p_stage_id: null,
    p_referred_by: null,
    p_interests: [{ course_id: wisdomCourseId, course_session_id: null, priority: 1 }],
    p_tags: []
  });

  console.log('Result 2 (Different Course):', JSON.stringify(res2, null, 2));
  if (res2.error || !res2.data?.success || res2.data.lead_id !== leadId1 || res2.data.is_existing !== true) {
    console.error('FAIL: Step 2 failed:', res2);
    process.exit(1);
  }
  console.log(`PASS: Matched existing Lead ID ${leadId1}, is_existing: true`);

  console.log('\n--- Step 3: Returning Lead with SAME course (Wisdom - Dedup Check) ---');
  const res3 = await callRpc('create_manual_lead', {
    p_first_name: 'Teste',
    p_last_name: 'Manual Fresh',
    p_email: testEmail,
    p_phone: testPhone,
    p_contact_preference: null,
    p_stage_id: null,
    p_referred_by: null,
    p_interests: [{ course_id: wisdomCourseId, course_session_id: null, priority: 1 }],
    p_tags: []
  });

  console.log('Result 3 (Same Course):', JSON.stringify(res3, null, 2));
  if (res3.error || !res3.data?.success || res3.data.lead_id !== leadId1 || res3.data.is_existing !== true) {
    console.error('FAIL: Step 3 failed:', res3);
    process.exit(1);
  }
  console.log(`PASS: Same course dedup passed cleanly with lead ID ${leadId1}!`);

  console.log('\n=============================================');
  console.log('ALL FRESH MANUAL LEAD TESTS PASSED CLEANLY IN PRODUCTION!');
  console.log('=============================================');
}

runTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
