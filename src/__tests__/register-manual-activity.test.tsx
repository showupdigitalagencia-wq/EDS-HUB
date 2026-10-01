import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegisterActivityModal, MANUAL_ACTIVITY_OPTIONS } from '../features/leads/components/RegisterActivityModal';
import { LeadTimeline } from '../features/leads/components/LeadTimeline';
import type { Lead, LeadActivity } from '../types';

// Mock Supabase client
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      mockFrom(table);
      if (table === 'lead_activities') {
        return {
          insert: mockInsert.mockResolvedValue({ data: { id: 'act-1' }, error: null }),
        };
      }
      if (table === 'pipeline_stages') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'stage-qualification-id', name: 'Respondido', code: 'qualification' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'leads') {
        return {
          update: mockUpdate.mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === 'lead_stage_history') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    },
    rpc: (...args: any[]) => mockRpc(...args),
  },
}));

vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    appUser: {
      user_id: 'user-op-1',
      display_name: 'Natalia Silva',
      email: 'natalia@expdentalsolutions.com',
    },
    user: {
      id: 'user-op-1',
      email: 'natalia@expdentalsolutions.com',
    },
  }),
}));

const mockLeadInCapture: Lead = {
  id: 'lead-123',
  first_name: 'John',
  last_name: 'Doe',
  email: 'john@example.com',
  phone_raw: '+44 7833 252393',
  phone_e164: '+447833252393',
  pipeline_stage_id: 'stage-capture',
  pipeline_stage: { id: 'stage-capture', name: 'Novo Lead', code: 'capture' },
  created_at: '2026-09-30T10:00:00Z',
  updated_at: '2026-09-30T10:00:00Z',
  contact_preference: 'sms',
  lead_score: 50,
  course_interest: 'Zygomatic',
  course_interests: ['Zygomatic'],
  source: 'form',
  external_lead_id: null,
  hubspot_contact_id: null,
  email_confirmation: null,
  qualification_status: null,
  source_created_at: null,
};

describe('RegisterActivityModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with all 6 required activity options', () => {
    render(
      <RegisterActivityModal
        isOpen={true}
        onClose={vi.fn()}
        lead={mockLeadInCapture}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Registrar Atividade/i })).toBeInTheDocument();

    expect(MANUAL_ACTIVITY_OPTIONS).toHaveLength(6);
    expect(screen.getByText('E-mail enviado')).toBeInTheDocument();
    expect(screen.getByText('SMS enviado')).toBeInTheDocument();
    expect(screen.getByText('Ligação realizada')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp enviado')).toBeInTheDocument();
    expect(screen.getByText('Contato realizado')).toBeInTheDocument();
    expect(screen.getByText('Observação / Outro')).toBeInTheDocument();
  });

  it('submits manual activity to lead_activities without stage move when checkbox is unchecked', async () => {
    const handleClose = vi.fn();
    const handleRefresh = vi.fn();

    render(
      <RegisterActivityModal
        isOpen={true}
        onClose={handleClose}
        lead={mockLeadInCapture}
        onActivityRegistered={handleRefresh}
      />
    );

    const textarea = screen.getByPlaceholderText(/Lead veio do HubSpot após o contato/i);
    await userEvent.type(textarea, 'Contato inicial realizado por SMS via celular particular.');

    const submitBtn = screen.getByTestId('submit-register-activity');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    const insertedPayload = mockInsert.mock.calls[0][0];
    expect(insertedPayload.lead_id).toBe('lead-123');
    expect(insertedPayload.actor_type).toBe('user');
    expect(insertedPayload.summary).toBe('Contato inicial realizado por SMS via celular particular.');
    expect(insertedPayload.metadata.manual).toBe(true);
    expect(insertedPayload.metadata.created_by_name).toBe('Natalia Silva');
    expect(insertedPayload.metadata.created_by_email).toBe('natalia@expdentalsolutions.com');
    expect(insertedPayload.metadata.advanced_to_respondido).toBe(false);

    // Verify stage was NOT modified
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('submits manual activity AND advances stage to Respondido when checkbox is checked', async () => {
    mockRpc.mockResolvedValue({ error: null });

    render(
      <RegisterActivityModal
        isOpen={true}
        onClose={vi.fn()}
        lead={mockLeadInCapture}
      />
    );

    const checkbox = screen.getByLabelText(/Registrar atividade e mover para Respondido/i);
    fireEvent.click(checkbox);

    const textarea = screen.getByPlaceholderText(/Lead veio do HubSpot após o contato/i);
    await userEvent.type(textarea, 'Conversa por telefone realizada com sucesso.');

    const submitBtn = screen.getByTestId('submit-register-activity');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockRpc).toHaveBeenCalledWith('move_lead_stage', expect.objectContaining({
        p_lead_id: 'lead-123',
        p_new_stage_id: 'stage-qualification-id',
      }));
    });
  });
});

describe('LeadTimeline Component — Manual Activity Presentation', () => {
  it('renders manual activity attribution and badge clearly', () => {
    const manualActivity: LeadActivity = {
      id: 'act-manual-1',
      lead_id: 'lead-123',
      intake_event_id: null,
      activity_type: 'manual_sms_sent',
      channel: 'sms',
      actor_type: 'user',
      summary: 'SMS enviado manualmente com link da grade do curso.',
      created_at: '2026-09-30T11:45:00.000Z',
      metadata: {
        manual: true,
        source: 'manual',
        activity_source: 'manual',
        created_by_name: 'Natalia',
        activity_note: 'SMS enviado manualmente com link da grade do curso.',
      },
    };

    render(<LeadTimeline activities={[manualActivity]} />);

    // Check for Manual badge
    expect(screen.getByText('Manual')).toBeInTheDocument();
    // Check for author attribution
    expect(screen.getByText(/Registrado manualmente por/i)).toBeInTheDocument();
    expect(screen.getByText('Natalia')).toBeInTheDocument();
    // Check note text
    expect(screen.getByText('SMS enviado manualmente com link da grade do curso.')).toBeInTheDocument();
  });
});
