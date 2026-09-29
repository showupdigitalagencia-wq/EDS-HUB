/**
 * scripts/generate-and-upload-course-pdfs.cjs
 * Generates genuine, production-grade PDF course brochures with complete curriculum,
 * dates, tuition, and accreditation, then uploads each to the private 'course-materials'
 * bucket via the manage-course-materials Edge Function.
 */

const fs = require('fs');
const path = require('path');

function createPdfBuffer(title, subtitle, pagesContent) {
  const objects = [];

  function addObject(content) {
    const objNum = objects.length + 1;
    objects.push({ num: objNum, content });
    return objNum;
  }

  // 1: Catalog
  const catalogNum = addObject('<< /Type /Catalog /Pages 2 0 R >>');

  // 4: Font F1 (Helvetica)
  // 5: Font F2 (Helvetica-Bold)
  const fontRegularNum = 4;
  const fontBoldNum = 5;

  const pageObjectNums = [];

  // Generate content streams for each page
  const pageStreamNums = [];
  for (let i = 0; i < pagesContent.length; i++) {
    const lines = pagesContent[i];
    let stream = 'BT\n';
    
    // Header
    stream += `/F2 16 Tf\n50 740 Td\n(${escapePdfText(title)}) Tj\n`;
    stream += `/F1 11 Tf\n0 -22 Td\n(${escapePdfText(subtitle)} - Page ${i + 1} of ${pagesContent.length}) Tj\n`;
    stream += `0 -25 Td\n`;

    // Body lines
    for (const item of lines) {
      if (typeof item === 'string') {
        stream += `/F1 10 Tf\n(${escapePdfText(item)}) Tj\n0 -16 Td\n`;
      } else if (item.heading) {
        stream += `0 -8 Td\n/F2 12 Tf\n(${escapePdfText(item.heading)}) Tj\n0 -18 Td\n`;
      } else if (item.bold) {
        stream += `/F2 10 Tf\n(${escapePdfText(item.bold)}) Tj\n0 -16 Td\n`;
      } else if (item.bullet) {
        stream += `/F1 10 Tf\n(\\\\200  ${escapePdfText(item.bullet)}) Tj\n0 -16 Td\n`;
      }
    }
    
    // Footer
    stream += `0 -25 Td\n/F2 9 Tf\n(Expert Dental Solutions | Rio de Janeiro, Brazil | info@expdentalsolutions.com) Tj\n`;
    stream += 'ET\n';

    const streamLength = Buffer.byteLength(stream, 'latin1');
    const streamObj = `<< /Length ${streamLength} >>\nstream\n${stream}\nendstream`;
    pageStreamNums.push(addObject(streamObj));
  }

  // 2: Pages container
  // We'll update after creating page objects
  const pagesContainerNum = 2;

  // 3: Page objects
  for (let i = 0; i < pagesContent.length; i++) {
    const pageNum = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRegularNum} 0 R /F2 ${fontBoldNum} 0 R >> >> /Contents ${pageStreamNums[i]} 0 R >>`
    );
    pageObjectNums.push(pageNum);
  }

  // Set Page 2 content
  const kidsStr = pageObjectNums.map(n => `${n} 0 R`).join(' ');
  objects[1].content = `<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjectNums.length} >>`;

  // Fonts
  objects.push({ num: fontRegularNum, content: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' });
  objects.push({ num: fontBoldNum, content: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>' });

  // Sort by object number
  objects.sort((a, b) => a.num - b.num);

  // Build binary buffer
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];

  for (const obj of objects) {
    offsets[obj.num] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${obj.num} 0 obj\n${obj.content}\nendobj\n`;
  }

  const startxref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    const off = String(offsets[i] || 0).padStart(10, '0');
    pdf += `${off} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

function escapePdfText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, ' ');
}

// Course Document Definitions
const COURSE_DOCUMENTS = [
  {
    fileName: '_Perio and Peri-implant Plastic Surgery.pdf',
    templateKey: 'periodontal_course_details',
    courseCode: 'PST-01',
    title: 'Periodontal & Peri-implant Plastic Surgery Intensive Training',
    subtitle: 'Comprehensive 4-Day Clinical Hands-On Program with Live Patients',
    pages: [
      [
        { heading: 'Program Overview & Clinical Objectives' },
        'The Periodontal Plastic Surgery Intensive Training is a 4-Day Hands-On Program with Live Patients.',
        'Designed to build your skills and confidence in advanced periodontal and peri-implant techniques.',
        'From connective tissue grafting to root coverage and aesthetic flap designs, work directly on patients.',
        { bold: 'Key Highlights:' },
        { bullet: 'Real patient treatment during all 4 days under expert university faculty mentorship.' },
        { bullet: 'Connective tissue grafts (subepithelial and free gingival graft harvesting).' },
        { bullet: 'Coronally advanced flaps, tunneling techniques, and aesthetic papilla preservation.' },
        { bullet: 'Soft tissue management around dental implants to ensure long-term aesthetic stability.' },
        { bullet: 'Limited to a maximum of 10 doctors per session for an intimate, focused environment.' },
        { heading: 'Tuition & Inclusions' },
        'Tuition: $9,900 USD | Early Bird: $400 OFF available for eligible cohorts.',
        'Accreditation: 36 PACE-Approved CE Credits.',
        'Inclusions: 4-star hotel accommodation with breakfast, daily lunch, private transportation, farewell dinner.',
      ],
      [
        { heading: 'Schedule & Upcoming Dates' },
        'November 7 to 10, 2026 | Rio de Janeiro, Brazil',
        'March 1 to 4, 2027 | Rio de Janeiro, Brazil',
        { heading: 'Post-Course Mentorship & Financing' },
        'After registration, a personalized Zoom orientation call is scheduled with Dr. Mourao.',
        'Post-course case consultation is provided to assist your first surgical cases back in your office.',
        'Flexible interest-free payment plan options are available upon enrollment.'
      ]
    ]
  },
  {
    fileName: 'Endodontics course.pdf',
    templateKey: 'endodontic_course_details',
    courseCode: 'ET-01',
    title: 'Endodontics Intensive Clinical Training',
    subtitle: '4-Day Clinical Immersion on Live Patients in Rio de Janeiro',
    pages: [
      [
        { heading: 'Program Overview & Unique Value' },
        'Designed for dentists seeking high-level clinical immersion in molar endodontics on live patients.',
        'Complete multiple complex molar root canal treatments with direct one-on-one specialist mentorship.',
        { bold: 'What Makes This Training Unique:' },
        { bullet: 'Real patient treatment during all 4 days of the clinical course.' },
        { bullet: 'Direct one-on-one mentorship during all procedures.' },
        { bullet: 'Hands-on experience with multiple rotary and reciprocating systems.' },
        { bullet: 'Practice diverse warm vertical and continuous wave obturation techniques.' },
        { bullet: 'Customized clinical cases selected according to your prior experience level.' },
        { bullet: 'Highly exclusive program strictly limited to 8 doctors.' },
        { bullet: 'Pre-course online lectures delivered via Zoom prior to hands-on arrival in Brazil.' },
        { heading: 'Upcoming Date & Tuition' },
        'Upcoming Cohort: April 26 to 29, 2027 | Rio de Janeiro, Brazil',
        'Tuition: USD 9,600 | Early Bird: USD 500 off if registered by November 30.',
        'Accreditation: 35 CE credits PACE approved.',
      ],
      [
        { heading: 'Curriculum & Experience Details' },
        'Diagnosis, canal location (MB2 detection), glide path management, shaped apical anatomy.',
        'Management of calcified canals, curved roots, and separated instrument prevention.',
        'Package includes: 4-star hotel with breakfast, lunch, airport and university transfers, farewell dinner.',
        'Flexible interest-free payment plans are available.'
      ]
    ]
  },
  {
    fileName: 'Intensive implant .pdf',
    templateKey: 'implant_course_details',
    courseCode: 'IDIT-01',
    title: 'Intensive Dental Implant Course',
    subtitle: 'Live-Patient Surgical Immersion for Beginner & Intermediate Dentists',
    pages: [
      [
        { heading: 'Program Overview & Surgical Target' },
        'Designed for dentists wanting to build unwavering surgical confidence in implant placement.',
        'You are the main surgeon from start to finish throughout every procedure.',
        { bold: 'Key Surgical Deliverables:' },
        { bullet: 'Place at least 20 implants on real patients under 1-on-1 faculty guidance.' },
        { bullet: 'Full surgical autonomy: flap design, osteotomy, bone profiling, and suturing.' },
        { bullet: 'Treatment planning with 3D CBCT imaging and bone density assessment.' },
        { bullet: 'Small class size: maximum 6 participants per cohort.' },
        { heading: 'Upcoming Dates & Tuition' },
        'November 11 to 14, 2026: Tuition $9,400 USD | Rio de Janeiro',
        'February 24 to 27, 2027: Tuition $9,700 USD | Early Bird: $600 OFF through Dec 31, 2026.',
        'Accreditation: 32 CE credits AGD PACE Approved.',
      ],
      [
        { heading: 'Package Inclusions & Mentorship' },
        'Four-star hotel accommodations with breakfast, daily course lunch, airport transfers.',
        'Mentorship does not end when the course ends: ongoing case advisory when returning to your practice.',
        'Flexible interest-free payment plans available.'
      ]
    ]
  },
  {
    fileName: 'Advanced implant course (1).pdf',
    templateKey: 'implant_course_details',
    courseCode: 'ADIE-01',
    title: 'Advanced Dental Implant Experience',
    subtitle: 'Complex Surgical Procedures & Bone Regeneration on Live Patients',
    pages: [
      [
        { heading: 'Program Overview & Scope' },
        'Designed for experienced implantologists seeking mastery in advanced surgical modalities.',
        'Training is 100% customized to your specific clinical and surgical goals.',
        { bold: 'Procedures Covered on Real Patients:' },
        { bullet: 'Lateral window and transcrestal sinus floor elevation.' },
        { bullet: 'Ridge expansion, bone splitting, and guided bone regeneration (GBR).' },
        { bullet: 'Immediate implant placement in extraction sockets with customized provisionalization.' },
        { bullet: 'Full-arch All-on-X immediate loading concepts and angled implantology.' },
        { bullet: 'One-on-one direct faculty mentorship for all surgical cases.' },
        { heading: 'Upcoming Dates & Tuition' },
        'November 11 to 14, 2026: Tuition $9,900 USD | Rio de Janeiro',
        'February 24 to 27, 2027: Tuition $10,200 USD | Early Bird: $600 OFF through Dec 31, 2026.',
        'Accreditation: 32 CE credits AGD PACE Approved.',
      ],
      [
        { heading: 'Logistics & Extended Mentorship' },
        'Includes 4-star hotel, airport/clinic transit, lunches, and Brazilian celebratory dinner.',
        'Ongoing remote case planning and digital surgical guide review upon returning home.',
        'Flexible interest-free payment plans available.'
      ]
    ]
  },
  {
    fileName: 'Third molar course.pdf',
    templateKey: 'wisdom_course_details',
    courseCode: 'WTT-01',
    title: 'Wisdom Teeth Extraction Clinical Course',
    subtitle: '4-Day Intensive Surgical Program on Real Patients in Rio de Janeiro',
    pages: [
      [
        { heading: 'Program Overview & Surgical Targets' },
        'Extensive surgical immersion with real patients at the Federal University in Rio de Janeiro.',
        'You are the main surgeon from start to finish throughout every case.',
        { bold: 'Clinical Highlights:' },
        { bullet: 'Perform at least 16 wisdom teeth extractions on real patients.' },
        { bullet: 'Manage fully impacted, partially impacted, and soft-tissue impacted third molars.' },
        { bullet: 'Safe coronectomy techniques and nerve proximity management (inferior alveolar nerve).' },
        { bullet: 'Tooth sectioning, bone guttering, flap design, and haemostatic protocols.' },
        { bullet: 'Strictly limited to a maximum of 6 doctors per session for intensive personalized focus.' },
        { heading: 'Next Courses & Tuition' },
        'November 7 to 10, 2026 | Rio de Janeiro, Brazil',
        'March 1 to 4, 2027 | Rio de Janeiro, Brazil',
        'Tuition: USD 8,200 | Accreditation: 36 PACE-approved CE credits.',
      ],
      [
        { heading: 'Inclusions & Continuing Guidance' },
        'Four-star hotel accommodation with breakfast, course lunch, all transfers, Brazilian dinner.',
        'Post-course mentorship: review surgical plans and radiographic cases with faculty coordinators.',
        'Flexible interest-free payment plan options available.'
      ]
    ]
  },
  {
    fileName: 'Oral Rehabilitation Course.pdf',
    templateKey: 'rehabilitation_course_details',
    courseCode: 'AIRE-01',
    title: 'Advanced Implant Rehabilitation Experience',
    subtitle: 'Prosthodontic & Surgical Live-Patient Immersion in Rio de Janeiro',
    pages: [
      [
        { heading: 'Program Overview' },
        'Four-day live-patient course held at Fluminense Federal University School of Dentistry.',
        'Enhance skills in implant prosthodontics from uncovering to definitive analog and digital restoration.',
        { bold: 'Clinical Hands-On Experience With:' },
        { bullet: 'Implant uncovering and peri-implant soft tissue conditioning.' },
        { bullet: 'Conventional open/closed tray implant impressions.' },
        { bullet: 'Digital intraoral scanning and CAD/CAM prosthodontic workflows.' },
        { bullet: 'Single, multiple, and full-arch implant restorations.' },
        { bullet: 'Prosthetic try-in, occlusal adjustment, and definitive restoration delivery.' },
        { bullet: 'Individualized 1-on-1 mentorship with a maximum of 6 doctors per session.' },
        { heading: 'Course Details & Tuition' },
        'Upcoming Cohort: November 7 to 10, 2026 | Rio de Janeiro, Brazil',
        'Tuition: USD 9,600 | Accreditation: 36 CE Credits PACE Approved.',
      ],
      [
        { heading: 'Complete Package & Payment' },
        'Four-star hotel accommodation with breakfast (5 nights included).',
        'Round-trip airport transfers, daily university transportation, course lunch, farewell dinner.',
        'Flexible interest-free payment plan options available.'
      ]
    ]
  }
];

async function main() {
  const url = 'https://xogcexclqiornuscsdmn.supabase.co';
  const adminKey = 'eds_internal_course_materials_mgmt_2026';

  console.log(`Starting generation and upload of ${COURSE_DOCUMENTS.length} official PDF brochures...`);

  for (const doc of COURSE_DOCUMENTS) {
    console.log(`\nGenerating PDF: ${doc.fileName}...`);
    const buffer = createPdfBuffer(doc.title, doc.subtitle, doc.pages);
    console.log(`Generated buffer of size: ${buffer.length} bytes (starts with: ${buffer.subarray(0, 5).toString()})`);

    console.log(`Uploading to manage-course-materials (template_key: ${doc.templateKey}, course_code: ${doc.courseCode})...`);
    const res = await fetch(`${url}/functions/v1/manage-course-materials`, {
      method: 'POST',
      headers: {
        'x-admin-key': adminKey,
        'Content-Type': 'application/pdf',
        'x-file-name': encodeURIComponent(doc.fileName),
        'x-template-key': doc.templateKey,
        'x-course-code': doc.courseCode,
        'x-is-required': 'true'
      },
      body: buffer
    });

    const status = res.status;
    const json = await res.json();
    console.log(`Upload response [${status}]:`, json);

    if (!res.ok || !json.verified) {
      console.error(`FAILED to upload ${doc.fileName}:`, json);
      process.exit(1);
    }
  }

  console.log('\nAll official course PDFs uploaded and verified successfully!');
}

main().catch(err => {
  console.error('Fatal error during PDF generation/upload:', err);
  process.exit(1);
});
