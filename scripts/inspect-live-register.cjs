const fs = require('fs');

async function inspect() {
  const res = await fetch('https://www.expdentalsolutions.com/register');
  const html = await res.text();
  console.log('HTML Length:', html.length);
  fs.writeFileSync('scripts/live-register.html', html);

  const scripts = html.match(/<script[\s\S]*?<\/script>/gi) || [];
  console.log('Found scripts:', scripts.length);
  scripts.forEach((s, i) => {
    const srcMatch = s.match(/src=["'](.*?)["']/i);
    if (srcMatch) console.log(`Script ${i} src:`, srcMatch[1]);
    else console.log(`Script ${i} inline snippet:`, s.slice(0, 200).replace(/\n/g, ' '));
  });

  // Check form attributes
  const formMatch = html.match(/<form[\s\S]*?<\/form>/i);
  if (formMatch) {
    const formOpening = html.match(/<form[^>]*>/i);
    console.log('Form opening tag:', formOpening ? formOpening[0] : null);
    
    // Check all inputs
    const inputs = formMatch[0].match(/<(input|select|textarea)[^>]*>/gi) || [];
    console.log(`Form inputs (${inputs.length}):`);
    inputs.forEach(inp => console.log('  ', inp.slice(0, 100)));
  }
}

inspect().catch(console.error);
