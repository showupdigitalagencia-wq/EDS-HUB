const fs = require('fs');

async function testLiveRegister() {
  console.log('Fetching live register page for fresh CSRF token...');
  const getRes = await fetch('https://www.expdentalsolutions.com/register');
  const html = await getRes.text();
  const rawCookies = typeof getRes.headers.getSetCookie === 'function' ? getRes.headers.getSetCookie() : [getRes.headers.get('set-cookie')];
  const cookieHeader = rawCookies.map(c => c.split(';')[0]).join('; ');
  console.log('Cookie header:', cookieHeader);

  const tokenMatch = html.match(/name="csrf-token" content="([^"]+)"/i) || html.match(/name="_token" value="([^"]+)"/i);
  const token = tokenMatch ? tokenMatch[1] : null;
  console.log('CSRF token:', token);

  // Attempt POST to https://www.expdentalsolutions.com/register
  const formData = new FormData();
  formData.append('_token', token || '');
  formData.append('name', 'Audit Test Doctor');
  formData.append('email', 'audit.doctor.test@example.com');
  formData.append('email_confirmation', 'audit.doctor.test@example.com');
  formData.append('phone', '+1 (941) 555-0199');
  formData.append('course', 'Wisdom Teeth Training');
  formData.append('specialty', 'General Dentist');
  formData.append('years_in_practice', '5-10');
  formData.append('surgical_experience', 'Intermediate');
  formData.append('terms_accepted', '1');
  formData.append('signature', 'Audit Test Doctor');
  formData.append('date', '09/29/2026');

  console.log('Posting form to https://www.expdentalsolutions.com/register...');
  const postRes = await fetch('https://www.expdentalsolutions.com/register', {
    method: 'POST',
    body: formData,
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json',
      'X-CSRF-TOKEN': token || '',
      'Cookie': cookieHeader,
    }
  });

  console.log('HTTP Status:', postRes.status);
  const text = await postRes.text();
  try {
    const json = JSON.parse(text);
    console.log('Exception Message:', json.message);
    if (json.errors) {
      console.log('Validation Errors:', JSON.stringify(json.errors, null, 2));
    }
  } catch (e) {
    console.log('Response body:', text.slice(0, 500));
  }
}

testLiveRegister().catch(console.error);
