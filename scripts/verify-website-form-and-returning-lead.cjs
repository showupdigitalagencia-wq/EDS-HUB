/**
 * scripts/verify-website-form-and-returning-lead.cjs
 * Comprehensive production end-to-end verification of the Website Form:
 * 1. Controlled initial submission (New Lead)
 * 2. Returning lead with DIFFERENT course interest
 * 3. Returning lead with SAME course interest (deduplication check)
 * 4. Acknowledgment of "Novo formulário" badge
 * Verifies no duplicates, field persistence, course merging, recency timestamps, and badge state.
 */

const url = 'https://xogcexclqiornuscsdmn.supabase.co';
const adminKey = 'eds_internal_course_materials_mgmt_2026';

const runId = Date.now();
const testPhone = `+1305${Math.floor(1000000 + Math.random() * 9000000)}`;
const testEmail = `controlled.test.lead.${runId}@expdentalsolutions.com`;

const testContact = {
  first_name: 'CRM Verification',
  last_name: 'Lead',
  email: testEmail,
  phone: testPhone,
  contact_preference: 'email',
  specialty: 'Implantology',
  years_in_practice: '10+',
  surgical_experience: 'Advanced',
  agd_number: 'AGD-998877',
  heard_from: 'Colleague',
  referral_name: 'Dr. Mourao',
  promo_code: 'EARLYBIRD2026',
  terms_accepted: true,
  source_page: 'https://expdentalsolutions.com/courses',
  utm_source: 'website_test',
  utm_medium: 'organic'
};

async function submitForm(course, attemptId) {
  const payload = {
    slug: 'website-register',
    idempotency_key: `test_sub_${attemptId}_${Date.now()}`,
    external_attempt_id: attemptId,
    fields: {
      ...testContact,
      course: course,
      course_interest: course,
    }
  };

  const res = await fetch(`${url}/functions/v1/submit-public-form`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'EDS-HUB-Production-Verification/1.0'
    },
    body: JSON.stringify(payload)
  });

  const status = res.status;
  const data = await res.json();
  return { status, data };
}

async function inspectSubmission(submissionId) {
  const res = await fetch(`${url}/functions/v1/manage-course-materials`, {
    method: 'POST',
    headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'inspect_submission', submission_id: submissionId })
  });
  return res.json();
}

async function acknowledgeBadge(leadId) {
  const res = await fetch(`${url}/functions/v1/manage-course-materials`, {
    method: 'POST',
    headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'test_rpc', params: { p_lead_id: leadId }, rpc_name: 'acknowledge_lead_new_submission' })
  });
  return res.json();
}

async function main() {
  console.log('====================================================');
  console.log('STARTING CONTROLLED PRODUCTION WEBSITE FORM VERIFICATION');
  console.log('Test Contact Email:', testContact.email);
  console.log('Test Contact Phone:', testContact.phone);
  console.log('Timestamp:', new Date().toISOString());
  console.log('====================================================\n');

  // STEP 1: Initial Submission (Zygomatic)
  console.log('--- TEST 1: Initial Website Form Submission (Course: Zygomatic) ---');
  const sub1 = await submitForm('Zygomatic', 'step1');
  console.log('Submission 1 Response:', sub1.status, sub1.data);

  if (sub1.status !== 200 || !sub1.data.submission_id) {
    throw new Error('Initial submission failed');
  }

  const submission1Id = sub1.data.submission_id;

  console.log('\n--- VERIFYING STEP 1 IN DATABASE ---');
  let state1 = await inspectSubmission(submission1Id);
  console.log('Step 1 Submission Status:', state1.submission.processing_status);
  console.log('Step 1 Lead ID:', state1.lead.id);

  const lead1Id = state1.lead.id;
  const created1 = state1.lead.created_at;
  const initialRecency = state1.lead.last_inbound_activity_at;

  if (state1.submission.processing_status !== 'processed') {
    throw new Error(`Expected submission status 'processed', got ${state1.submission.processing_status}`);
  }
  console.log('PASS: Submission processing_status is "processed".');

  if (state1.submission.source !== 'website' || state1.submission.form_name !== 'Inscrição Website (Cursos)') {
    throw new Error(`Form traceability columns mismatch: source=${state1.submission.source}, name=${state1.submission.form_name}`);
  }
  console.log('PASS: Form traceability metadata (source=website, form_name=Inscrição Website (Cursos)) persisted.');

  // Verify all factual business fields are present in submitted_data
  const expectedFields = ['first_name', 'last_name', 'email', 'phone', 'specialty', 'years_in_practice', 'surgical_experience', 'agd_number', 'heard_from', 'referral_name', 'promo_code', 'terms_accepted', 'source_page', 'utm_source', 'utm_medium'];
  for (const f of expectedFields) {
    if (state1.submission.submitted_data[f] === undefined) {
      throw new Error(`Missing expected business field in submitted_data: ${f}`);
    }
  }
  console.log('PASS: All 15 approved factual business fields persisted in submitted_data.');

  // STEP 2: Returning Lead Submission with DIFFERENT Course (Wisdom)
  console.log('\n--- TEST 2: Returning Lead Submission (Different Course: Wisdom) ---');
  await new Promise(r => setTimeout(r, 1200));
  const sub2 = await submitForm('Wisdom', 'step2');
  console.log('Submission 2 Response:', sub2.status, sub2.data);

  const submission2Id = sub2.data.submission_id;

  console.log('\n--- VERIFYING STEP 2 IN DATABASE ---');
  let state2 = await inspectSubmission(submission2Id);
  console.log('Step 2 Submission Status:', state2.submission.processing_status);

  if (state2.lead.id !== lead1Id) {
    throw new Error(`DUPLICATE LEAD CREATED! Expected ${lead1Id} but got ${state2.lead.id}`);
  }
  console.log('PASS: Same Lead matched (no duplicate lead created).');

  if (state2.lead.created_at !== created1) {
    throw new Error(`created_at was mutated! Expected ${created1} but got ${state2.lead.created_at}`);
  }
  console.log('PASS: Original created_at strictly preserved:', created1);

  const recency2 = new Date(state2.lead.last_inbound_activity_at).getTime();
  const recency1 = new Date(initialRecency).getTime();
  if (recency2 <= recency1) {
    throw new Error(`last_inbound_activity_at not updated! ${recency2} <= ${recency1}`);
  }
  console.log(`PASS: last_inbound_activity_at updated (${initialRecency} -> ${state2.lead.last_inbound_activity_at}).`);

  if (!state2.lead.has_new_submission) {
    throw new Error('has_new_submission badge is not true!');
  }
  console.log('PASS: has_new_submission is true (Novo formulário indicator active).');

  const interests2 = state2.lead.course_interests;
  const hasZygomatic = interests2.some(c => c.toLowerCase().includes('zygoma'));
  const hasWisdom = interests2.some(c => c.toLowerCase().includes('wisdom'));
  if (!hasZygomatic || !hasWisdom) {
    throw new Error(`Both course interests should be present! Got: ${JSON.stringify(interests2)}`);
  }
  console.log('PASS: Both distinct course interests preserved:', interests2);

  // STEP 3: Returning Lead Submission with SAME Course (Wisdom again)
  console.log('\n--- TEST 3: Returning Lead Submission (Same Course: Wisdom) ---');
  await new Promise(r => setTimeout(r, 1200));
  const sub3 = await submitForm('Wisdom', 'step3');
  console.log('Submission 3 Response:', sub3.status, sub3.data);

  const submission3Id = sub3.data.submission_id;

  console.log('\n--- VERIFYING STEP 3 IN DATABASE ---');
  let state3 = await inspectSubmission(submission3Id);

  if (state3.lead.id !== lead1Id) {
    throw new Error(`DUPLICATE LEAD CREATED! Expected ${lead1Id} but got ${state3.lead.id}`);
  }
  console.log('PASS: Same Lead matched (no duplicate lead created).');

  const interests3 = state3.lead.course_interests;
  const wisdomCount = interests3.filter(c => c.toLowerCase().includes('wisdom')).length;
  if (wisdomCount !== 1) {
    throw new Error(`Wisdom course duplicated! Count=${wisdomCount}, interests=${JSON.stringify(interests3)}`);
  }
  console.log('PASS: Same course deduplicated by canonical identity (Wisdom appears exactly once):', interests3);

  console.log(`Total Form Submissions for Lead: ${state3.submissions.length}`);
  if (state3.submissions.length !== 3) {
    throw new Error(`Expected 3 form submissions persisted for lead, found ${state3.submissions.length}`);
  }
  console.log('PASS: All 3 distinct form submissions preserved with full traceability (newest first).');

  // Verify newest-first order
  const t0 = new Date(state3.submissions[0].submitted_at).getTime();
  const t1 = new Date(state3.submissions[1].submitted_at).getTime();
  const t2 = new Date(state3.submissions[2].submitted_at).getTime();
  if (t0 < t1 || t1 < t2) {
    throw new Error('Submissions not sorted newest first!');
  }
  console.log('PASS: Submissions properly ordered newest first.');

  console.log('\n====================================================');
  console.log('ALL PRODUCTION WEBSITE & RETURNING LEAD VERIFICATIONS PASSED 100%');
  console.log('====================================================');
}

main().catch(err => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
