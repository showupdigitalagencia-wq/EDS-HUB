const fs = require('fs');
const html = fs.readFileSync('scripts/live-register.html', 'utf8');

function extractOptions(name) {
  const regex = new RegExp('<select[^>]*name=[\"\']' + name + '[\"\'][^>]*>([\\s\\S]*?)<\\/select>', 'i');
  const match = html.match(regex);
  if (!match) return [];
  const options = [];
  const optMatches = match[1].matchAll(/<option[^>]*value=[\"\'](.*?)[\"\'][^>]*>(.*?)<\/option>/gi);
  for (const m of optMatches) {
    options.push({ value: m[1], text: m[2].trim() });
  }
  return options;
}

['course', 'specialty', 'years_in_practice', 'surgical_experience', 'heard_from'].forEach(field => {
  console.log(`--- ${field} ---`);
  console.log(extractOptions(field));
});
