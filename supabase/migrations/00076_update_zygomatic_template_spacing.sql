-- =============================================================================
-- Migration 00076: Update Zygomatic Template Spacing (Exact Paragraph Separation)
-- =============================================================================

UPDATE public.transactional_templates
SET
  body_template = '{{salutation_line}}

Thank you for your interest in our course!

The goal of our Zygomatic Implant Course is to help you learn or improve your skills in Zygomatic, Pterygoids, Transnasal and Trans-Sinus implants.

This is a four day course:
• One day of theory and hands-on practice
• Three intensive SURGICAL DAYS ON REAL PATIENTS under IV sedation
• One-on-one mentorship throughout the entire course

Each course takes place in a implant center at a University in Rio de Janeiro, Brazil. After registering, we’ll schedule a Zoom meeting with our coordinators to discuss your goals and expectations, ensuring we select the right cases for your training.

Upcoming Course Date:
November 7-10, 2026

Tuition: $17,500

Our course includes:
• Accommodation in a four-star hotel with daily breakfast
• Lunch during the training days
• Transportation between airport, hotel, and university
• A traditional Brazilian dinner on the final evening

Participants will also receive 36 CE credits PACE approved, and we offer flexible interest-free payment plans.

Please see the attached PDF for detailed information of this course.

If you would like to discuss details or have questions, we can schedule a call with our course coordinator at your convenience.

You can also hear directly from dentists who have already trained with us. Visit our website to watch participant testimonials and learn more about their experience with Expert Dental Solutions.

https://www.expdentalsolutions.com/course/zygomatic-implant-training

We look forward to welcoming you to this unique experience.

Sincerely,

Natalia

Expert Dental Solutions',
  updated_at = now()
WHERE key = 'zygomatic_course_details';

UPDATE public.email_templates
SET
  text_template = '{{salutation_line}}

Thank you for your interest in our course!

The goal of our Zygomatic Implant Course is to help you learn or improve your skills in Zygomatic, Pterygoids, Transnasal and Trans-Sinus implants.

This is a four day course:
• One day of theory and hands-on practice
• Three intensive SURGICAL DAYS ON REAL PATIENTS under IV sedation
• One-on-one mentorship throughout the entire course

Each course takes place in a implant center at a University in Rio de Janeiro, Brazil. After registering, we’ll schedule a Zoom meeting with our coordinators to discuss your goals and expectations, ensuring we select the right cases for your training.

Upcoming Course Date:
November 7-10, 2026

Tuition: $17,500

Our course includes:
• Accommodation in a four-star hotel with daily breakfast
• Lunch during the training days
• Transportation between airport, hotel, and university
• A traditional Brazilian dinner on the final evening

Participants will also receive 36 CE credits PACE approved, and we offer flexible interest-free payment plans.

Please see the attached PDF for detailed information of this course.

If you would like to discuss details or have questions, we can schedule a call with our course coordinator at your convenience.

You can also hear directly from dentists who have already trained with us. Visit our website to watch participant testimonials and learn more about their experience with Expert Dental Solutions.

https://www.expdentalsolutions.com/course/zygomatic-implant-training

We look forward to welcoming you to this unique experience.

Sincerely,

Natalia

Expert Dental Solutions',
  updated_at = now()
WHERE name ILIKE '%zygomatic%';
