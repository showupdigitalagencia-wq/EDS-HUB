const https = require('https');

async function testWebsiteRegister() {
  console.log('1. Fetching /register to get cookies and CSRF token...');
  
  const getRes = await new Promise((resolve, reject) => {
    https.get('https://www.expdentalsolutions.com/register', res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ headers: res.headers, html: b }));
    }).on('error', reject);
  });

  const cookies = getRes.headers['set-cookie'] || [];
  const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');
  const match = getRes.html.match(/name="csrf-token"\s+content="([^"]+)"/);
  const csrfToken = match ? match[1] : '';

  console.log('CSRF Token:', csrfToken);
  console.log('Cookies:', cookieHeader);

  console.log('\n2. Testing POST submission with sample valid fields...');
  const postData = new URLSearchParams({
    name: 'Dr. Controlled Test',
    email: 'controlled.web.test@expdentalsolutions.com',
    email_confirmation: 'controlled.web.test@expdentalsolutions.com',
    phone: '(305) 555-0199',
    emergency_phone: '(305) 555-0199',
    specialty: 'General Practitioner',
    years_in_practice: '5-9 years',
    surgical_experience: 'Moderate surgical experience',
    coat_size: 'L',
    heard_from: 'Google',
    course: 'Dental Implant Intensive Course - November 11-14, 2026 | Tuition: $9,400',
    terms_accepted: '1',
    date: '2026-09-29',
    signature: 'Dr. Controlled Test'
  }).toString();

  const postRes = await new Promise((resolve, reject) => {
    const req = https.request('https://www.expdentalsolutions.com/register', {
      method: 'POST',
      headers: {
        'Cookie': cookieHeader,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json',
        'X-CSRF-TOKEN': csrfToken,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  console.log('Response Status:', postRes.status);
  console.log('Response Body:', postRes.body);
}

testWebsiteRegister().catch(err => {
  console.error('ERROR:', err);
});
