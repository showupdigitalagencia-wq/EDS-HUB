const https = require('https');

async function testMultipartRegister() {
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

  // Build multipart form data with dummy pdf files
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  let parts = [];

  function addField(name, val) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`);
  }

  function addFile(name, filename, content) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n${content}\r\n`);
  }

  addField('_token', csrfToken);
  addField('name', 'Dr. Controlled Test');
  addField('email', 'controlled.web.test@expdentalsolutions.com');
  addField('email_confirmation', 'controlled.web.test@expdentalsolutions.com');
  addField('phone', '(305) 555-0199');
  addField('emergency_phone', '(305) 555-0199');
  addField('specialty', 'General Practitioner');
  addField('years_in_practice', '5-9 years');
  addField('surgical_experience', 'Moderate surgical experience');
  addField('coat_size', 'L');
  addField('heard_from', 'Google');
  addField('course', 'Dental Implant Intensive Course - November 11-14, 2026 | Tuition: $9,400');
  addField('terms_accepted', '1');
  addField('date', '2026-09-29');
  addField('signature', 'Dr. Controlled Test');
  addFile('passport', 'passport_sample.pdf', '%PDF-1.4 test sample content');
  addFile('dental_license', 'license_sample.pdf', '%PDF-1.4 test sample content');

  parts.push(`--${boundary}--\r\n`);
  const body = Buffer.from(parts.join(''));

  console.log('2. Sending multipart POST to https://www.expdentalsolutions.com/register...');
  const postRes = await new Promise((resolve, reject) => {
    const req = https.request('https://www.expdentalsolutions.com/register', {
      method: 'POST',
      headers: {
        'Cookie': cookieHeader,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json',
        'X-CSRF-TOKEN': csrfToken,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  console.log('Response Status:', postRes.status);
  console.log('Response Body:', postRes.body);
}

testMultipartRegister().catch(err => {
  console.error('ERROR:', err);
});
