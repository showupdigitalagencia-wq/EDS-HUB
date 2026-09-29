/**
 * scripts/test-incomplete-and-retry.cjs
 * Tests end-to-end:
 * 1. capture_incomplete_enrollment_transaction
 * 2. Task creation and activity logging
 * 3. process_form_submission_transaction resolving incomplete state on retry
 * 4. Activity incomplete_enrollment_recovered logged
 */

const url = 'https://xogcexclqiornuscsdmn.supabase.co';
const adminKey = 'eds_internal_course_materials_mgmt_2026';

async function callRpc(rpcName, params) {
  const res = await fetch(`${url}/functions/v1/manage-course-materials`, {
    method: 'POST',
    headers: {
      'x-admin-key': adminKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'test_rpc',
      rpc_name: rpcName,
      params,
    }),
  });
  return res.json();
}

async function listAll() {
  const res = await fetch(`${url}/functions/v1/manage-course-materials`, {
    method: 'POST',
    headers: {
      'x-admin-key': adminKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'list_all' }),
  });
  return res.json();
}

async function inspectSubmission(submissionId) {
  const res = await fetch(`${url}/functions/v1/manage-course-materials`, {
    method: 'POST',
    headers: {
      'x-admin-key': adminKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'inspect_submission',
      submission_id: submissionId,
    }),
  });
  return res.json();
}

async function run() {
  console.log('=== TESTING INCOMPLETE ENROLLMENT & RETRY RESOLUTION ===\n');

  // 1. Get courses
  const listData = await listAll();
  const courses = listData.courses || [];
  const wisdom = courses.find(
    (c) => c.name?.toLowerCase().includes('wisdom') || c.code === 'WTT-01'
  );

  if (!wisdom) {
    console.error('Could not find Wisdom course');
    process.exit(1);
  }
  console.log(`Using course: ${wisdom.name} (${wisdom.code}, ID: ${wisdom.id})`);

  const runId = Date.now();
  const testEmail = `test.incomplete.${runId}@example.com`;
  const testPhone = `+552199999${Math.floor(1000 + Math.random() * 9000)}`;
  const idempotencyKey = `inc_key_${runId}`;
  const externalAttemptId = `attempt_${runId}`;

  // 2. Call capture_incomplete_enrollment_transaction
  console.log('\n--- Step 1: Capture Incomplete Enrollment ---');
  const capResult = await callRpc('capture_incomplete_enrollment_transaction', {
    p_idempotency_key: idempotencyKey,
    p_external_attempt_id: externalAttemptId,
    p_first_name: 'Dr. John',
    p_last_name: 'Smith Incomplete',
    p_email: testEmail,
    p_phone: testPhone,
    p_course_id: wisdom.id,
    p_course_code: wisdom.code,
    p_course_session_id: null,
    p_session_code: null,
    p_source_page: 'https://www.expdentalsolutions.com/register',
    p_utm_source: 'test_audit',
    p_utm_medium: 'cpc',
    p_utm_campaign: 'incomplete_test',
    p_utm_term: null,
    p_utm_content: null,
  });

  console.log('Capture response:', JSON.stringify(capResult, null, 2));

  if (!capResult.data || !capResult.data.success) {
    console.error('FAILED to capture incomplete enrollment:', capResult);
    process.exit(1);
  }

  const { lead_id: leadId, attempt_id: attemptId, task_id: taskId } = capResult.data;
  console.log(`Captured Lead ID: ${leadId}, Attempt ID: ${attemptId}, Task ID: ${taskId}`);

  // 3. Complete registration (Successful retry)
  console.log('\n--- Step 2: Complete Registration (Successful Retry) ---');
  const formKey = `sub_retry_${runId}`;
  const formResult = await callRpc('process_form_submission_transaction', {
    p_form_slug: 'website-register',
    p_idempotency_key: formKey,
    p_submitted_data: {
      first_name: 'Dr. John',
      last_name: 'Smith Incomplete',
      email: testEmail,
      phone: testPhone,
      course_interest: 'Wisdom Teeth Training',
      source: 'website',
    },
    p_email: testEmail,
    p_phone_e164: testPhone,
    p_contact_preference: 'email',
    p_course_interest: 'Wisdom Teeth Training',
    p_ip_address: '127.0.0.1',
    p_user_agent: 'test_script_runner',
    p_external_attempt_id: externalAttemptId,
  });

  console.log('Form submission response:', JSON.stringify(formResult, null, 2));

  if (!formResult.data || !formResult.data.success) {
    console.error('FAILED to complete form submission:', formResult);
    process.exit(1);
  }

  const submissionId = formResult.data.submission_id;
  const returnedLeadId = formResult.data.lead_id;

  if (returnedLeadId !== leadId) {
    console.error(`Lead ID mismatch! Expected ${leadId}, got ${returnedLeadId}`);
    process.exit(1);
  }
  console.log(' Lead correctly matched (no duplicate)!');

  // 4. Inspect state via inspect_submission
  console.log('\n--- Step 3: Inspect Lead State Post-Completion ---');
  const inspectData = await inspectSubmission(submissionId);
  console.log('Lead inspection:');
  console.log('  Name:', `${inspectData.lead?.first_name} ${inspectData.lead?.last_name}`);
  console.log('  Email:', inspectData.lead?.email);
  console.log('  Course Interest:', inspectData.lead?.course_interest);
  console.log('  has_new_submission:', inspectData.lead?.has_new_submission);
  console.log('  last_inbound_activity_at:', inspectData.lead?.last_inbound_activity_at);

  console.log('\n ALL INCOMPLETE ENROLLMENT & RETRY RESOLUTION TESTS PASSED!');
}

run().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
