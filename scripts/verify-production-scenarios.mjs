// Production Verification Suite: Tests A through I
const SUPABASE_URL = 'https://xogcexclqiornuscsdmn.supabase.co';
const ADMIN_SECRET = 'eds_internal_course_materials_mgmt_2026';

async function callManager(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-course-materials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': ADMIN_SECRET,
      'Authorization': `Bearer ${ADMIN_SECRET}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Manager call failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function callSubmitPublicForm(formSlug, { idempotency_key, ...fields }) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-public-form`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      slug: formSlug,
      idempotency_key,
      fields,
    }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function callProcessLeadIntake(payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/process-lead-intake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_SECRET}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return { status: res.status, data };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isFactualOutbound = (status) => ['sent', 'bounced', 'delivered'].includes(status);

async function main() {
  console.log('=== STARTING PRODUCTION VERIFICATION SUITE (TESTS A-I) ===\n');
  const results = {};
  const testEmails = [];
  const testLeadIds = [];

  const timestamp = Date.now();
  const seed = (timestamp % 10000000).toString().padStart(7, '0');

  // Pre-cleanup old test leads
  console.log('Running pre-test cleanup...');
  try {
    await callManager({ action: 'cleanup_test_leads', pattern: 'test.' });
  } catch (e) {
    console.warn('Pre-cleanup notice:', e.message);
  }

  try {
    // -------------------------------------------------------------------------
    // TEST A: NEW LEAD / EMAIL PREFERENCE
    // -------------------------------------------------------------------------
    console.log('\n--- TEST A: NEW LEAD / EMAIL PREFERENCE ---');
    const emailA = `test.a.email.${timestamp}@expdentalsolutions.com`;
    const phoneA = `+1551${seed}`;
    testEmails.push(emailA);

    const resA = await callProcessLeadIntake({
      source: 'meta',
      source_detail: 'meta_lead_ad',
      first_name: 'Dr. Arthur',
      last_name: 'Dent',
      email: emailA,
      phone: phoneA,
      contact_preference: 'email',
      course_interest: 'Zygomatic',
      course_title: 'Zygomatic Implant Training',
      idempotency_key: `test_a_${timestamp}`,
    });

    console.log('resA response:', JSON.stringify(resA));
    if (resA.data?.lead_id) testLeadIds.push(resA.data.lead_id);

    await sleep(2500);

    const leadAData = await callManager({ action: 'inspect_lead', lead_id: resA.data.lead_id });
    const leadA = leadAData.lead;
    const msgsA = leadAData.outbound_messages;
    const tasksA = leadAData.tasks;

    const testAPassed =
      leadA &&
      msgsA.length === 1 &&
      isFactualOutbound(msgsA[0].status) &&
      msgsA[0].template_key === 'zygomatic_course_details' &&
      msgsA[0].recipient === emailA &&
      msgsA[0].attachment_included === true &&
      tasksA.filter((t) => t.title.includes('SMS')).length === 0;

    results['TEST_A'] = {
      status: testAPassed ? 'PASS' : 'FAIL',
      leadId: leadA?.id,
      messagesSent: msgsA.length,
      outboundStatus: msgsA[0]?.status,
      templateKey: msgsA[0]?.template_key,
      attachmentIncluded: msgsA[0]?.attachment_included,
      attachmentFilename: msgsA[0]?.attachment_filename,
      smsTasksCount: tasksA.filter((t) => t.title.includes('SMS')).length,
    };
    console.log('Test A Result:', results['TEST_A']);

    // -------------------------------------------------------------------------
    // TEST B: NEW LEAD / SMS PREFERENCE
    // -------------------------------------------------------------------------
    console.log('\n--- TEST B: NEW LEAD / SMS PREFERENCE ---');
    const emailB = `test.b.sms.${timestamp}@expdentalsolutions.com`;
    const phoneB = `+1552${seed}`;
    testEmails.push(emailB);

    const resB = await callProcessLeadIntake({
      source: 'meta',
      source_detail: 'meta_lead_ad',
      first_name: 'Dr. Beatrice',
      last_name: 'Smith',
      email: emailB,
      phone: phoneB,
      contact_preference: 'sms',
      course_interest: 'Zygomatic',
      course_title: 'Zygomatic Implant Training',
      idempotency_key: `test_b_${timestamp}`,
    });

    console.log('resB response:', JSON.stringify(resB));
    if (resB.data?.lead_id) testLeadIds.push(resB.data.lead_id);

    await sleep(2500);

    const leadBData = await callManager({ action: 'inspect_lead', lead_id: resB.data.lead_id });
    const leadB = leadBData.lead;
    const msgsB = leadBData.outbound_messages;
    const tasksB = leadBData.tasks;

    const emailSentB = msgsB.length === 1 && isFactualOutbound(msgsB[0].status);
    const smsTaskB = tasksB.find((t) => t.title.includes('SMS Manual'));
    const noAutoSmsB = msgsB.every((m) => m.channel === 'email');

    const testBPassed = leadB && emailSentB && Boolean(smsTaskB) && noAutoSmsB;

    results['TEST_B'] = {
      status: testBPassed ? 'PASS' : 'FAIL',
      leadId: leadB?.id,
      emailSent: emailSentB,
      outboundStatus: msgsB[0]?.status,
      smsTaskCreated: Boolean(smsTaskB),
      smsTaskTitle: smsTaskB?.title,
      noAutomaticSms: noAutoSmsB,
    };
    console.log('Test B Result:', results['TEST_B']);

    // -------------------------------------------------------------------------
    // TEST C: TWO DIFFERENT EMAILS
    // -------------------------------------------------------------------------
    console.log('\n--- TEST C: TWO DIFFERENT EMAILS ---');
    const emailC1 = `test.c1.primary.${timestamp}@expdentalsolutions.com`;
    const emailC2 = `test.c2.confirm.${timestamp}@expdentalsolutions.com`;
    const phoneC = `+1553${seed}`;
    testEmails.push(emailC1, emailC2);

    const resC = await callProcessLeadIntake({
      source: 'form',
      source_detail: 'website',
      first_name: 'Dr. Clara',
      last_name: 'Oswald',
      email: emailC1,
      email_confirmation: emailC2,
      phone: phoneC,
      contact_preference: 'email',
      course_interest: 'Zygomatic',
      course_title: 'Zygomatic Implant Training',
      idempotency_key: `test_c_${timestamp}`,
    });

    console.log('resC response:', JSON.stringify(resC));
    if (resC.data?.lead_id) testLeadIds.push(resC.data.lead_id);

    await sleep(3000);

    const leadCData = await callManager({ action: 'inspect_lead', lead_id: resC.data.lead_id });
    const leadC = leadCData.lead;
    const msgsC = leadCData.outbound_messages;

    const recipientsC = msgsC.map((m) => m.recipient).sort();
    const expectedRecipientsC = [emailC1, emailC2].sort();

    const testCPassed =
      leadC &&
      leadC.email === emailC1 &&
      leadC.email_confirmation === emailC2 &&
      leadC.email_mismatch === true &&
      msgsC.length === 2 &&
      msgsC.every((m) => isFactualOutbound(m.status)) &&
      JSON.stringify(recipientsC) === JSON.stringify(expectedRecipientsC);

    results['TEST_C'] = {
      status: testCPassed ? 'PASS' : 'FAIL',
      leadId: leadC?.id,
      primaryEmail: leadC?.email,
      confirmEmail: leadC?.email_confirmation,
      emailMismatch: leadC?.email_mismatch,
      recipientsSent: recipientsC,
      statuses: msgsC.map((m) => `${m.recipient}: ${m.status}`),
    };
    console.log('Test C Result:', results['TEST_C']);

    // -------------------------------------------------------------------------
    // TEST D: SAME EMAIL NORMALIZED
    // -------------------------------------------------------------------------
    console.log('\n--- TEST D: SAME EMAIL NORMALIZED ---');
    const rawEmailD1 = `  Test.D.Normalized.${timestamp}@ExpDentalSolutions.com  `;
    const rawEmailD2 = `test.d.normalized.${timestamp}@expdentalsolutions.com`;
    const normEmailD = `test.d.normalized.${timestamp}@expdentalsolutions.com`;
    const phoneD = `+1554${seed}`;
    testEmails.push(normEmailD);

    const resD = await callProcessLeadIntake({
      source: 'form',
      source_detail: 'website',
      first_name: 'Dr. David',
      last_name: 'Tennant',
      email: rawEmailD1,
      email_confirmation: rawEmailD2,
      phone: phoneD,
      contact_preference: 'email',
      course_interest: 'Wisdom',
      course_title: 'Wisdom Teeth Training',
      idempotency_key: `test_d_${timestamp}`,
    });

    console.log('resD response:', JSON.stringify(resD));
    if (resD.data?.lead_id) testLeadIds.push(resD.data.lead_id);

    await sleep(2500);

    const leadDData = await callManager({ action: 'inspect_lead', lead_id: resD.data.lead_id });
    const leadD = leadDData.lead;
    const msgsD = leadDData.outbound_messages;

    const testDPassed =
      leadD &&
      msgsD.length === 1 &&
      msgsD[0].recipient === normEmailD &&
      isFactualOutbound(msgsD[0].status);

    results['TEST_D'] = {
      status: testDPassed ? 'PASS' : 'FAIL',
      leadId: leadD?.id,
      outboundCount: msgsD.length,
      recipient: msgsD[0]?.recipient,
      statusMsg: msgsD[0]?.status,
    };
    console.log('Test D Result:', results['TEST_D']);

    // -------------------------------------------------------------------------
    // TEST E: SECOND EMAIL SUPPRESSED
    // -------------------------------------------------------------------------
    console.log('\n--- TEST E: SECOND EMAIL SUPPRESSED ---');
    const emailE1 = `test.e1.eligible.${timestamp}@expdentalsolutions.com`;
    const emailE2 = `test.e2.suppressed.${timestamp}@expdentalsolutions.com`;
    const phoneE = `+1555${seed}`;
    testEmails.push(emailE1, emailE2);

    // Suppress emailE2
    await callManager({
      action: 'manage_suppression',
      op: 'add',
      email: emailE2,
      reason: 'hard_bounce',
    });

    const resE = await callProcessLeadIntake({
      source: 'form',
      source_detail: 'website',
      first_name: 'Dr. Eric',
      last_name: 'Foreman',
      email: emailE1,
      email_confirmation: emailE2,
      phone: phoneE,
      contact_preference: 'email',
      course_interest: 'Endodontics',
      course_title: 'Endodontics Training',
      idempotency_key: `test_e_${timestamp}`,
    });

    console.log('resE response:', JSON.stringify(resE));
    if (resE.data?.lead_id) testLeadIds.push(resE.data.lead_id);

    await sleep(3000);

    const leadEData = await callManager({ action: 'inspect_lead', lead_id: resE.data.lead_id });
    const leadE = leadEData.lead;
    const msgsE = leadEData.outbound_messages;

    const msgE1 = msgsE.find((m) => m.recipient === emailE1);
    const msgE2 = msgsE.find((m) => m.recipient === emailE2);

    const testEPassed =
      leadE &&
      msgE1 &&
      isFactualOutbound(msgE1.status) &&
      msgE2 &&
      msgE2.status === 'failed' &&
      msgE2.error_code === 'EMAIL_SUPPRESSED';

    // Clean up suppression
    await callManager({ action: 'manage_suppression', op: 'remove', email: emailE2 });

    results['TEST_E'] = {
      status: testEPassed ? 'PASS' : 'FAIL',
      leadId: leadE?.id,
      primaryRecipientStatus: msgE1?.status,
      suppressedRecipientStatus: msgE2?.status,
      suppressedErrorCode: msgE2?.error_code,
    };
    console.log('Test E Result:', results['TEST_E']);

    // -------------------------------------------------------------------------
    // TEST F: EXISTING LEAD + NEW FORM (RESURFACING)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST F: EXISTING LEAD + NEW FORM ---');
    const originalLeadAId = leadA.id;
    const originalCreatedAtA = leadA.created_at;
    const originalStageA = leadA.pipeline_stage_id;
    const originalMsgCountA = msgsA.length;

    await sleep(1500);

    // Lead A submits a second form with same course via website-register
    const resF = await callSubmitPublicForm('website-register', {
      email: emailA,
      phone: phoneA,
      first_name: 'Dr. Arthur',
      last_name: 'Dent',
      course_interest: 'Zygomatic',
      idempotency_key: `test_f_sub_${timestamp}`,
    });

    console.log('resF response:', JSON.stringify(resF));

    await sleep(2500);

    const leadAAfterFData = await callManager({ action: 'inspect_lead', lead_id: originalLeadAId });
    const leadAAfterF = leadAAfterFData.lead;
    const msgsAAfterF = leadAAfterFData.outbound_messages;

    const recencyUpdated = new Date(leadAAfterF.last_inbound_activity_at).getTime() > new Date(originalCreatedAtA).getTime();
    const createdAtPreserved = leadAAfterF.created_at === originalCreatedAtA;
    const stagePreserved = leadAAfterF.pipeline_stage_id === originalStageA;
    const noDuplicateLead = leadAAfterF.id === originalLeadAId;
    const noResend = msgsAAfterF.length === originalMsgCountA;

    const testFPassed =
      noDuplicateLead &&
      createdAtPreserved &&
      stagePreserved &&
      recencyUpdated &&
      noResend &&
      leadAAfterF.has_new_submission === true;

    results['TEST_F'] = {
      status: testFPassed ? 'PASS' : 'FAIL',
      sameLeadId: noDuplicateLead,
      createdAtPreserved,
      stagePreserved,
      inboundRecencyUpdated: recencyUpdated,
      originalEmailNotResent: noResend,
      hasNewSubmission: leadAAfterF.has_new_submission,
    };
    console.log('Test F Result:', results['TEST_F']);

    // -------------------------------------------------------------------------
    // TEST G: DIFFERENT COURSE APPENDED
    // -------------------------------------------------------------------------
    console.log('\n--- TEST G: DIFFERENT COURSE APPENDED ---');
    await sleep(1000);

    // Lead A submits for Endodontics
    const resG = await callSubmitPublicForm('website-register', {
      email: emailA,
      phone: phoneA,
      first_name: 'Dr. Arthur',
      last_name: 'Dent',
      course_interest: 'Endodontics',
      idempotency_key: `test_g_sub_${timestamp}`,
    });
    console.log('resG response:', JSON.stringify(resG));

    await sleep(2500);

    const leadAAfterGData = await callManager({ action: 'inspect_lead', lead_id: originalLeadAId });
    const leadAAfterG = leadAAfterGData.lead;

    const hasZygo = leadAAfterG.course_interests.some((c) => c.toLowerCase().includes('zygo'));
    const hasEndo = leadAAfterG.course_interests.some((c) => c.toLowerCase().includes('endo'));
    const testGPassed =
      leadAAfterG.id === originalLeadAId &&
      hasZygo &&
      hasEndo &&
      leadAAfterG.course_interests.length >= 2;

    results['TEST_G'] = {
      status: testGPassed ? 'PASS' : 'FAIL',
      sameLead: leadAAfterG.id === originalLeadAId,
      courseInterests: leadAAfterG.course_interests,
      courseInterestString: leadAAfterG.course_interest,
    };
    console.log('Test G Result:', results['TEST_G']);

    // -------------------------------------------------------------------------
    // TEST H: SAME COURSE SUBMITTED AGAIN (DEDUPED)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST H: SAME COURSE SUBMITTED AGAIN ---');
    const courseCountBefore = leadAAfterG.course_interests.length;

    const resH = await callSubmitPublicForm('website-register', {
      email: emailA,
      phone: phoneA,
      first_name: 'Dr. Arthur',
      last_name: 'Dent',
      course_interest: 'Endodontics',
      idempotency_key: `test_h_sub_${timestamp}`,
    });
    console.log('resH response:', JSON.stringify(resH));

    await sleep(2000);

    const leadAAfterHData = await callManager({ action: 'inspect_lead', lead_id: originalLeadAId });
    const leadAAfterH = leadAAfterHData.lead;

    const courseCountAfter = leadAAfterH.course_interests.length;
    const testHPassed =
      leadAAfterH.id === originalLeadAId &&
      courseCountAfter === courseCountBefore;

    results['TEST_H'] = {
      status: testHPassed ? 'PASS' : 'FAIL',
      sameLead: leadAAfterH.id === originalLeadAId,
      courseCountBefore,
      courseCountAfter,
      deduped: courseCountAfter === courseCountBefore,
    };
    console.log('Test H Result:', results['TEST_H']);

    // -------------------------------------------------------------------------
    // TEST I: WEBHOOK RETRY / RECONCILIATION IDEMPOTENCY
    // -------------------------------------------------------------------------
    console.log('\n--- TEST I: WEBHOOK RETRY / RECONCILIATION IDEMPOTENCY ---');
    const emailI = `test.i.idempotency.${timestamp}@expdentalsolutions.com`;
    const phoneI = `+1556${seed}`;
    testEmails.push(emailI);
    const keyI = `idempotent_event_${timestamp}`;

    // Send attempt 1
    const resI1 = await callProcessLeadIntake({
      source: 'meta',
      source_detail: 'meta_lead_ad',
      first_name: 'Dr. Ian',
      last_name: 'Malcolm',
      email: emailI,
      phone: phoneI,
      contact_preference: 'sms',
      course_interest: 'Zygomatic',
      course_title: 'Zygomatic Implant Training',
      idempotency_key: keyI,
    });
    if (resI1.data?.lead_id) testLeadIds.push(resI1.data.lead_id);

    await sleep(2500);

    // Send attempt 2 (exact duplicate retry / reconciliation replay)
    const resI2 = await callProcessLeadIntake({
      source: 'meta',
      source_detail: 'meta_lead_ad',
      first_name: 'Dr. Ian',
      last_name: 'Malcolm',
      email: emailI,
      phone: phoneI,
      contact_preference: 'sms',
      course_interest: 'Zygomatic',
      course_title: 'Zygomatic Implant Training',
      idempotency_key: keyI,
    });

    await sleep(2500);

    const leadIData = await callManager({ action: 'inspect_lead', lead_id: resI1.data.lead_id });
    const leadI = leadIData.lead;
    const msgsI = leadIData.outbound_messages;
    const tasksI = leadIData.tasks;

    const emailCountI = msgsI.length;
    const smsTaskCountI = tasksI.filter((t) => t.title.includes('SMS Manual')).length;

    const testIPassed =
      leadI &&
      emailCountI === 1 &&
      smsTaskCountI === 1;

    results['TEST_I'] = {
      status: testIPassed ? 'PASS' : 'FAIL',
      leadId: leadI?.id,
      emailSentCount: emailCountI,
      smsTaskCount: smsTaskCountI,
      duplicatePrevented: emailCountI === 1 && smsTaskCountI === 1,
    };
    console.log('Test I Result:', results['TEST_I']);

    console.log('\n========================================');
    console.log('FINAL RESULTS SUMMARY (TESTS A-I)');
    console.log('========================================');
    console.log(JSON.stringify(results, null, 2));

  } catch (err) {
    console.error('Test Suite Error:', err);
  } finally {
    // Cleanup test records
    console.log('\nCleaning up test records from database...');
    try {
      const cleanRes = await callManager({
        action: 'cleanup_test_leads',
        lead_ids: testLeadIds,
        pattern: 'test.',
      });
      console.log('Cleanup completed:', cleanRes);
    } catch (cleanErr) {
      console.warn('Cleanup warning:', cleanErr.message);
    }
  }
}

main();
