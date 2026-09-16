// =============================================================================
// EDS HUB — Application Constants
// =============================================================================

/** Pipeline stage codes — must match the seed data in migrations */
export const PIPELINE_STAGES = {
  CAPTURE: 'capture',
  QUALIFICATION: 'qualification',
  ACQUISITION: 'acquisition',
  APPROVAL: 'approval',
  ENROLLMENT: 'enrollment',
  POST_COURSE: 'post_course',
  ALUMNI: 'alumni',
} as const;

/** Default salutation when no name is available */
export const DEFAULT_SALUTATION = 'Doc';

/** App name */
export const APP_NAME = 'EDS HUB';
