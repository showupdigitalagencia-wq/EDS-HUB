# EDS HUB — Architecture Overview (Phase 1)

## System Architecture

EDS HUB is a single-user Intelligent Deliverability CRM for Expert Dental Solutions.

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React + TypeScript)             │
│                    TailwindCSS • Vite • SPA                  │
│  ┌──────────┐  ┌───────────────┐  ┌──────────────────────┐  │
│  │  Login   │  │  Foundation   │  │   System Setup       │  │
│  │  Page    │  │  Status Page  │  │   Page               │  │
│  └──────────┘  └───────────────┘  └──────────────────────┘  │
│            │            │                    │               │
│            └────────────┼────────────────────┘               │
│                         │                                    │
│              Supabase Client (anon key only)                 │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS
┌─────────────────────────┴───────────────────────────────────┐
│                        Supabase                              │
│  ┌──────────────┐  ┌─────────────────────────────────────┐  │
│  │  Supabase    │  │         Edge Functions               │  │
│  │  Auth        │  │  ┌─────────────────────────────┐    │  │
│  │              │  │  │  process-lead-intake         │    │  │
│  └──────────────┘  │  │  (Resend + Twilio adapters)  │    │  │
│                    │  └─────────────────────────────┘    │  │
│  ┌──────────────┐  │  ┌─────────────────────────────┐    │  │
│  │  PostgreSQL  │  │  │  check-domain-status         │    │  │
│  │  + RLS       │  │  └─────────────────────────────┘    │  │
│  │  (12 tables) │  │  ┌─────────────────────────────┐    │  │
│  │              │  │  │  system-status               │    │  │
│  └──────────────┘  │  └─────────────────────────────┘    │  │
│                    └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                    │                       │
         ┌──────────┘                       └──────────┐
         ▼                                             ▼
   ┌──────────┐                                 ┌──────────┐
   │  Resend  │                                 │  Twilio  │
   │  (Email) │                                 │  (SMS)   │
   └──────────┘                                 └──────────┘
```

### Security Model

- **Frontend** uses only the Supabase **anon key** (safe for browsers)
- **Edge Functions** use the **service_role key** for server-side operations
- **RLS** is enabled on ALL public tables
- The `is_active_app_user()` function checks that `auth.uid()` matches an active `app_user`
- Provider secrets (Resend, Twilio) exist **only** in Edge Functions environment variables

### Database Schema

12 tables in the `public` schema:

| Table | Purpose |
|-------|---------|
| `app_user` | Single application user (singleton) |
| `app_settings` | System configuration (singleton) |
| `pipeline_stages` | 7 pipeline stages |
| `leads` | Lead records |
| `lead_intake_events` | Intake event log with idempotency |
| `transactional_templates` | Email/SMS templates |
| `outbound_messages` | Sent message records |
| `tasks` | Call and data review tasks |
| `lead_activities` | Append-only activity audit log |
| `lead_stage_history` | Pipeline stage change history |
| `email_domain_status` | Email domain verification status |

### Lead Intake Flow

1. Receive normalized payload (provider-agnostic)
2. Authenticate the caller
3. Check idempotency key
4. Find or create lead → assign to Captura
5. Resolve salutation (last name → first name → "Doc")
6. Execute based on `contact_preference`:
   - **email**: validate, deduplicate, send via Resend
   - **sms**: verify E.164, send via Twilio
   - **call**: create call task
7. If successful → advance to Qualificação
8. If failed → keep in Captura, create data_review task if applicable
9. Log all activities
