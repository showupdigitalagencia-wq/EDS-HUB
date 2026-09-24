-- =============================================================================
-- Migration 051: Course Materials, Zygomatic First-Contact Package & Attachments
-- =============================================================================
-- 1. Sets up private 'course-materials' Supabase Storage bucket
-- 2. Creates public.course_materials and public.template_attachments
-- 3. Extends public.outbound_messages with attachment metadata
-- 4. Extends public.email_templates with template_key and attachment indicators
-- 5. Seeds official Zygomatic course session, price, templates, and material link
-- =============================================================================

-- 1. Storage Bucket: course-materials (private, controlled server-side access)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'course-materials',
  'course-materials',
  false,
  52428800, -- 50MB
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['application/pdf']::text[];

-- Storage Object RLS Policies
DROP POLICY IF EXISTS "course_materials_authenticated_select" ON storage.objects;
CREATE POLICY "course_materials_authenticated_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'course-materials');

DROP POLICY IF EXISTS "course_materials_service_role_all" ON storage.objects;
CREATE POLICY "course_materials_service_role_all" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'course-materials')
  WITH CHECK (bucket_id = 'course-materials');

DROP POLICY IF EXISTS "course_materials_authenticated_insert" ON storage.objects;
CREATE POLICY "course_materials_authenticated_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'course-materials');

DROP POLICY IF EXISTS "course_materials_authenticated_update" ON storage.objects;
CREATE POLICY "course_materials_authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'course-materials')
  WITH CHECK (bucket_id = 'course-materials');

-- 2. Create public.course_materials
CREATE TABLE IF NOT EXISTS public.course_materials (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id                   UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title                       TEXT NOT NULL,
  file_name                   TEXT NOT NULL,
  storage_bucket              TEXT NOT NULL DEFAULT 'course-materials',
  storage_path                TEXT NOT NULL,
  content_type                TEXT NOT NULL DEFAULT 'application/pdf',
  file_size_bytes             BIGINT NULL,
  is_active                   BOOLEAN NOT NULL DEFAULT true,
  is_required_for_outreach    BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_course_materials_storage UNIQUE (storage_bucket, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_course_materials_course_id ON public.course_materials(course_id);
CREATE INDEX IF NOT EXISTS idx_course_materials_active ON public.course_materials(is_active);

-- Enable RLS
ALTER TABLE public.course_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "course_materials_select_all" ON public.course_materials;
CREATE POLICY "course_materials_select_all" ON public.course_materials
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "course_materials_service_role_all" ON public.course_materials;
CREATE POLICY "course_materials_service_role_all" ON public.course_materials
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. Create public.template_attachments
CREATE TABLE IF NOT EXISTS public.template_attachments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key                TEXT NOT NULL,
  material_id                 UUID NOT NULL REFERENCES public.course_materials(id) ON DELETE CASCADE,
  is_required                 BOOLEAN NOT NULL DEFAULT true,
  display_name                TEXT NOT NULL DEFAULT 'Zygomatic Course PDF',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_template_material UNIQUE (template_key, material_id)
);

CREATE INDEX IF NOT EXISTS idx_template_attachments_key ON public.template_attachments(template_key);

-- Enable RLS
ALTER TABLE public.template_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "template_attachments_select_all" ON public.template_attachments;
CREATE POLICY "template_attachments_select_all" ON public.template_attachments
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "template_attachments_service_role_all" ON public.template_attachments;
CREATE POLICY "template_attachments_service_role_all" ON public.template_attachments
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Extend public.outbound_messages with attachment fields
ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS attachment_included BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attachment_filename TEXT NULL,
  ADD COLUMN IF NOT EXISTS attachment_material_id UUID NULL REFERENCES public.course_materials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NULL DEFAULT '{}'::jsonb;

-- 5. Extend public.email_templates with template_key & attachment flags
ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS template_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS has_attachment BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_email_templates_key ON public.email_templates(template_key);

-- 6. Canonical Course Data Update for ZIT-01
UPDATE public.courses
SET default_price = 17500, updated_at = now()
WHERE code = 'ZIT-01';

-- Insert canonical session for ZIT-01 (Nov 7-10, 2026)
INSERT INTO public.course_sessions (
  course_id,
  code,
  title,
  status,
  start_date,
  end_date,
  location,
  notes
)
SELECT
  c.id,
  'ZIT-2026-11',
  'Zygomatic Implant Training – November 2026 Cohort',
  'open',
  '2026-11-07'::date,
  '2026-11-10'::date,
  'Rio de Janeiro, Brazil',
  '4-day surgical residency. 1 theory/hands-on, 3 live surgical days with real patients under IV sedation. Tuition $17,500 includes hotel, lunches, transfers, Brazilian dinner, 36 CE credits.'
FROM public.courses c
WHERE c.code = 'ZIT-01'
  AND NOT EXISTS (
    SELECT 1 FROM public.course_sessions s
    WHERE s.course_id = c.id AND s.code = 'ZIT-2026-11'
  );

-- 7. Insert Course Material for ZIT-01 (Authoritative Zygomatic PDF)
INSERT INTO public.course_materials (
  course_id,
  title,
  file_name,
  storage_bucket,
  storage_path,
  content_type,
  is_active,
  is_required_for_outreach
)
SELECT
  c.id,
  'Zygomatic Course Details',
  'Zygomatic Course (2).pdf',
  'course-materials',
  'courses/ZIT-01/Zygomatic Course (2).pdf',
  'application/pdf',
  true,
  true
FROM public.courses c
WHERE c.code = 'ZIT-01'
ON CONFLICT (storage_bucket, storage_path) DO UPDATE SET
  title = EXCLUDED.title,
  file_name = EXCLUDED.file_name,
  is_active = true,
  is_required_for_outreach = true,
  updated_at = now();

-- 8. Link Template Attachment: zygomatic_course_details -> official Zygomatic PDF
INSERT INTO public.template_attachments (
  template_key,
  material_id,
  is_required,
  display_name
)
SELECT
  'zygomatic_course_details',
  m.id,
  true,
  'Zygomatic Course PDF'
FROM public.course_materials m
WHERE m.storage_path = 'courses/ZIT-01/Zygomatic Course (2).pdf'
ON CONFLICT (template_key, material_id) DO UPDATE SET
  is_required = true,
  display_name = EXCLUDED.display_name;

-- 9. Seed public.transactional_templates (for Automated Intake & System Resolution)
INSERT INTO public.transactional_templates (
  key,
  channel,
  subject_template,
  body_template,
  is_active
)
VALUES
(
  'zygomatic_course_details',
  'email',
  'Zygomatic Course Details – Hands-On Training in Rio',
  'Hello {{first_name}},

Thank you for your interest in the {{course_name}} in Rio de Janeiro, Brazil.

This intensive 4-day surgical residency is designed for dentists and surgical specialists looking to master advanced zygomatic implant placement with direct patient care:

• 4-day comprehensive course: 1 day of intensive theory, biomechanics, and anatomical hands-on laboratory, followed by 3 full surgical days with real patients under IV sedation.
• One-on-one personalized mentorship with our world-renowned surgical faculty.
• Upcoming Session: {{course_date_range}} in Rio de Janeiro, Brazil.
• Tuition: {{course_tuition}}, which includes hotel accommodations, daily lunches, ground transfers, an official Brazilian welcome dinner, and 36 CE credits (PACE approved).
• Flexible interest-free payment plans are available.

Attached to this email, you will find the complete, official course brochure (PDF) detailing the daily curriculum, surgical protocols, faculty bios, and clinical requirements.

Please feel free to reply directly to this email or let us know if you would like to schedule a brief call to discuss your clinical background and secure your seat.

Warm regards,

Natália & The Expert Dental Solutions Team
info@expdentalsolutions.com
Expert Dental Solutions',
  true
),
(
  'zygomatic_followup_sms',
  'sms',
  NULL,
  'Hello Dr.
This is Natália from Expert Dental Solutions. Thank you for your interest in our Zygomatic Implant Training in Brazil.
I just sent you an email with all the course details.
To help you choose the best option, could you tell me a little about your implant experience?
We currently have openings for our November 7 to 10 course. Would those dates work for you?
I’m happy to answer any questions and help you find the course that best matches your goals.',
  true
)
ON CONFLICT (key) DO UPDATE SET
  subject_template = EXCLUDED.subject_template,
  body_template = EXCLUDED.body_template,
  channel = EXCLUDED.channel,
  is_active = true,
  updated_at = now();

-- 10. Seed public.email_templates (for Manual Email Composer UI)
INSERT INTO public.email_templates (
  name,
  description,
  category,
  template_key,
  has_attachment,
  attachment_name,
  is_active,
  content_json,
  text_template,
  html_template
)
VALUES (
  'Zygomatic Course Details',
  'Official first-contact email for Zygomatic Implant Training in Rio with PDF attachment.',
  'course_details',
  'zygomatic_course_details',
  true,
  'Zygomatic Course PDF',
  true,
  jsonb_build_object(
    'channel', 'email',
    'subject', 'Zygomatic Course Details – Hands-On Training in Rio',
    'has_attachment', true,
    'attachment_name', 'Zygomatic Course PDF'
  ),
  'Hello {{first_name}},

Thank you for your interest in the {{course_name}} in Rio de Janeiro, Brazil.

This intensive 4-day surgical residency is designed for dentists and surgical specialists looking to master advanced zygomatic implant placement with direct patient care:

• 4-day comprehensive course: 1 day of intensive theory, biomechanics, and anatomical hands-on laboratory, followed by 3 full surgical days with real patients under IV sedation.
• One-on-one personalized mentorship with our world-renowned surgical faculty.
• Upcoming Session: {{course_date_range}} in Rio de Janeiro, Brazil.
• Tuition: {{course_tuition}}, which includes hotel accommodations, daily lunches, ground transfers, an official Brazilian welcome dinner, and 36 CE credits (PACE approved).
• Flexible interest-free payment plans are available.

Attached to this email, you will find the complete, official course brochure (PDF) detailing the daily curriculum, surgical protocols, faculty bios, and clinical requirements.

Please feel free to reply directly to this email or let us know if you would like to schedule a brief call to discuss your clinical background and secure your seat.

Warm regards,

Natália & The Expert Dental Solutions Team
info@expdentalsolutions.com
Expert Dental Solutions',
  '<p>Hello {{first_name}},</p>
<p>Thank you for your interest in the {{course_name}} in Rio de Janeiro, Brazil.</p>
<p>This intensive 4-day surgical residency is designed for dentists and surgical specialists looking to master advanced zygomatic implant placement with direct patient care:</p>
<ul>
  <li><strong>4-day comprehensive course:</strong> 1 day of intensive theory, biomechanics, and anatomical hands-on laboratory, followed by 3 full surgical days with real patients under IV sedation.</li>
  <li><strong>One-on-one personalized mentorship</strong> with our world-renowned surgical faculty.</li>
  <li><strong>Upcoming Session:</strong> {{course_date_range}} in Rio de Janeiro, Brazil.</li>
  <li><strong>Tuition:</strong> {{course_tuition}}, which includes hotel accommodations, daily lunches, ground transfers, an official Brazilian welcome dinner, and 36 CE credits (PACE approved).</li>
  <li>Flexible interest-free payment plans are available.</li>
</ul>
<p>Attached to this email, you will find the complete, official course brochure (PDF) detailing the daily curriculum, surgical protocols, faculty bios, and clinical requirements.</p>
<p>Please feel free to reply directly to this email or let us know if you would like to schedule a brief call to discuss your clinical background and secure your seat.</p>
<p>Warm regards,<br/><strong>Natália &amp; The Expert Dental Solutions Team</strong><br/>info@expdentalsolutions.com<br/>Expert Dental Solutions</p>'
),
(
  'Zygomatic — Follow-up SMS',
  'Manual assisted follow-up SMS for Zygomatic course inquiries.',
  'sms',
  'zygomatic_followup_sms',
  false,
  NULL,
  true,
  jsonb_build_object('channel', 'sms', 'template_key', 'zygomatic_followup_sms'),
  'Hello Dr.
This is Natália from Expert Dental Solutions. Thank you for your interest in our {{course_name}} in Brazil.
I just sent you an email with all the course details.
To help you choose the best option, could you tell me a little about your implant experience?
We currently have openings for our {{course_date_range}} course. Would those dates work for you?
I’m happy to answer any questions and help you find the course that best matches your goals.',
  '<p>Hello Dr.<br/>This is Natália from Expert Dental Solutions. Thank you for your interest in our {{course_name}} in Brazil.<br/>I just sent you an email with all the course details.<br/>To help you choose the best option, could you tell me a little about your implant experience?<br/>We currently have openings for our {{course_date_range}} course. Would those dates work for you?<br/>I’m happy to answer any questions and help you find the course that best matches your goals.</p>'
)
ON CONFLICT DO NOTHING;

