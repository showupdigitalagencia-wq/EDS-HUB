/**
 * scripts/upload-real-local-pdfs.cjs
 * Reads the REAL approved course PDF files from C:\Users\luisa\Documents\Downloads
 * and uploads them to Supabase Storage and associates them with template attachments.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const dir = 'C:\\Users\\luisa\\Documents\\Downloads';
const adminKey = 'process.env.INTERNAL_ADMIN_SECRET || ""';
const url = 'https://xogcexclqiornuscsdmn.supabase.co';

const uploads = [
  {
    fileName: '_Perio and Peri-implant Plastic Surgery.pdf',
    courseCode: 'PST-01',
    storagePath: 'courses/PST-01/_Perio and Peri-implant Plastic Surgery.pdf',
    templateKey: 'periodontal_course_details',
  },
  {
    fileName: 'Endodontics course.pdf',
    courseCode: 'ET-01',
    storagePath: 'courses/ET-01/Endodontics course.pdf',
    templateKey: 'endodontic_course_details',
  },
  {
    fileName: 'Intensive implant .pdf',
    courseCode: 'IDIT-01',
    storagePath: 'courses/IDIT-01/Intensive implant .pdf',
    templateKey: 'implant_course_details',
  },
  {
    fileName: 'Advanced implant course (1).pdf',
    courseCode: 'IDIT-01',
    storagePath: 'courses/IDIT-01/Advanced implant course (1).pdf',
    templateKey: 'implant_course_details',
  },
  {
    fileName: 'Third molar course.pdf',
    courseCode: 'WTT-01',
    storagePath: 'courses/WTT-01/Third molar course.pdf',
    templateKey: 'wisdom_course_details',
  },
  {
    fileName: 'Oral Rehabilitation Course.pdf',
    courseCode: 'AIRE-01',
    storagePath: 'courses/AIRE-01/Oral Rehabilitation Course.pdf',
    templateKey: 'rehabilitation_course_details',
  },
];

async function uploadFile(item) {
  const filePath = path.join(dir, item.fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  const buffer = fs.readFileSync(filePath);

  console.log(`Uploading ${item.fileName} (${stat.size} bytes) -> ${item.storagePath}...`);

  return new Promise((resolve, reject) => {
    const req = https.request(`${url}/functions/v1/manage-course-materials`, {
      method: 'POST',
      headers: {
        'x-admin-key': adminKey,
        'Content-Type': 'application/pdf',
        'x-file-name': encodeURIComponent(item.fileName),
        'x-course-code': item.courseCode,
        'x-storage-path': item.storagePath,
        'x-template-key': item.templateKey,
        'x-is-required': 'true',
        'Content-Length': buffer.length,
      }
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(b));
          } catch {
            resolve(b);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${b}`));
        }
      });
    });

    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

async function main() {
  console.log('====================================================');
  console.log('UPLOADING REAL LOCAL APPROVED PDF BROCHURES');
  console.log('====================================================\n');

  for (const item of uploads) {
    try {
      const res = await uploadFile(item);
      console.log(`✓ SUCCESS for ${item.fileName}:`, res.material?.file_size_bytes, 'bytes, server retrieval:', res.server_retrieval);
    } catch (err) {
      console.error(`✗ FAILED for ${item.fileName}:`, err.message);
      process.exit(1);
    }
  }

  console.log('\nAll 6 real approved course PDFs uploaded and associated successfully!');
}

main();
