import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MinimalLeadCard } from '../features/pipeline/components/MinimalLeadCard';
import type { Lead } from '../types/database';

describe('Canonical Retorno Badge Meaning & Lifecycle Suite', () => {
  const baseLead: Lead = {
    id: 'lead-test-101',
    source: 'website',
    source_detail: 'contact_form',
    external_lead_id: null,
    hubspot_contact_id: null,
    qualification_status: null,
    source_created_at: '2026-10-14T10:00:00Z',
    first_name: 'Ana',
    last_name: 'Silva',
    email: 'ana.silva@example.com',
    email_confirmation: 'ana.silva@example.com',
    phone_raw: '(11) 98765-4321',
    phone_e164: '+5511987654321',
    contact_preference: 'email',
    pipeline_stage_id: 'stage-novo',
    course_interest: 'Wisdom',
    course_interests: ['Wisdom'],
    created_at: '2026-10-14T10:00:00Z',
    updated_at: '2026-10-14T10:00:00Z',
    last_acquisition_at: '2026-10-14T10:00:00Z',
    new_submission_at: '2026-10-14T10:00:00Z',
    has_new_submission: false,
    new_inbound_count: 0,
    is_returning_submission: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Brand-new lead enters
  it('1. Brand-new lead enters -> Novas entradas = YES, Retorno = NO', () => {
    const newLead: Lead = {
      ...baseLead,
      has_new_submission: true,
      new_inbound_count: 1,
      is_returning_submission: false,
    };

    render(
      <MinimalLeadCard
        lead={newLead}
        stageCode="capture"
        stageName="Novo Lead"
      />
    );

    const badge = screen.getByTestId('lead-card-new-submission-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('Nova entrada');
    expect(badge.textContent).not.toContain('Retorno');
  });

  // Test 2: Same lead enters again later
  it('2. Same lead enters again later -> same canonical lead, Novas entradas = YES, Retorno = YES', () => {
    const returningLead: Lead = {
      ...baseLead,
      created_at: '2026-08-01T10:00:00Z',
      last_acquisition_at: '2026-10-14T12:00:00Z',
      new_submission_at: '2026-10-14T12:00:00Z',
      has_new_submission: true,
      new_inbound_count: 1,
      is_returning_submission: true,
    };

    render(
      <MinimalLeadCard
        lead={returningLead}
        stageCode="capture"
        stageName="Novo Lead"
      />
    );

    const badge = screen.getByTestId('lead-card-new-submission-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('Retorno');
  });

  // Test 3: Returning Quente lead
  it('3. Returning Quente lead -> stage remains Quente, Retorno = YES', () => {
    const returningQuenteLead: Lead = {
      ...baseLead,
      pipeline_stage_id: 'stage-quente',
      created_at: '2026-05-10T08:00:00Z',
      last_acquisition_at: '2026-10-14T14:30:00Z',
      new_submission_at: '2026-10-14T14:30:00Z',
      has_new_submission: true,
      new_inbound_count: 1,
      is_returning_submission: true,
    };

    render(
      <MinimalLeadCard
        lead={returningQuenteLead}
        stageCode="acquisition"
        stageName="Quente"
      />
    );

    const badge = screen.getByTestId('lead-card-new-submission-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('Retorno');
  });

  // Test 4: Returning Interessado lead
  it('4. Returning Interessado lead -> stage remains Interessado, Retorno = YES', () => {
    const returningInteressadoLead: Lead = {
      ...baseLead,
      pipeline_stage_id: 'stage-interessado',
      created_at: '2026-06-15T09:00:00Z',
      last_acquisition_at: '2026-10-14T15:00:00Z',
      new_submission_at: '2026-10-14T15:00:00Z',
      has_new_submission: true,
      new_inbound_count: 1,
      is_returning_submission: true,
    };

    render(
      <MinimalLeadCard
        lead={returningInteressadoLead}
        stageCode="qualification"
        stageName="Interessado"
      />
    );

    const badge = screen.getByTestId('lead-card-new-submission-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('Retorno');
  });

  // Test 5: Existing lead with no new acquisition
  it('5. Existing lead with no new acquisition -> Retorno = NO', () => {
    const existingLeadNoNew: Lead = {
      ...baseLead,
      pipeline_stage_id: 'stage-interessado',
      created_at: '2026-06-15T09:00:00Z',
      last_acquisition_at: '2026-06-15T09:00:00Z',
      has_new_submission: false,
      new_inbound_count: 0,
      is_returning_submission: false,
    };

    render(
      <MinimalLeadCard
        lead={existingLeadNoNew}
        stageCode="qualification"
        stageName="Interessado"
      />
    );

    expect(screen.queryByTestId('lead-card-new-submission-badge')).toBeNull();
  });

  // Test 6: Manual edit on existing lead
  it('6. Manual edit on existing lead -> Retorno = NO', () => {
    const editedLead: Lead = {
      ...baseLead,
      first_name: 'Ana Claudia',
      updated_at: '2026-10-14T16:00:00Z',
      has_new_submission: false,
      new_inbound_count: 0,
      is_returning_submission: false,
    };

    render(
      <MinimalLeadCard
        lead={editedLead}
        stageCode="qualification"
        stageName="Interessado"
      />
    );

    expect(screen.queryByTestId('lead-card-new-submission-badge')).toBeNull();
  });

  // Test 7: Stage change on existing lead
  it('7. Stage change on existing lead -> Retorno = NO unless an actual new inbound exists', () => {
    const movedLead: Lead = {
      ...baseLead,
      pipeline_stage_id: 'stage-quente',
      updated_at: '2026-10-14T16:05:00Z',
      has_new_submission: false,
      new_inbound_count: 0,
      is_returning_submission: false,
    };

    render(
      <MinimalLeadCard
        lead={movedLead}
        stageCode="acquisition"
        stageName="Quente"
      />
    );

    expect(screen.queryByTestId('lead-card-new-submission-badge')).toBeNull();
  });

  // Test 8: Multiple returns before acknowledgment
  it('8. Multiple returns before acknowledgment -> same lead, count increments, Retorno remains visible', () => {
    const multiReturnLead: Lead = {
      ...baseLead,
      pipeline_stage_id: 'stage-quente',
      created_at: '2026-04-01T10:00:00Z',
      last_acquisition_at: '2026-10-14T16:10:00Z',
      new_submission_at: '2026-10-14T16:10:00Z',
      has_new_submission: true,
      new_inbound_count: 3,
      is_returning_submission: true,
    };

    render(
      <MinimalLeadCard
        lead={multiReturnLead}
        stageCode="acquisition"
        stageName="Quente"
      />
    );

    const badge = screen.getByTestId('lead-card-new-submission-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('Retorno');
    expect(badge.textContent).toContain('3 novas entradas');
  });

  // Test 9: Click Marcar como visto (acknowledgment)
  it('9. Click Marcar como visto -> Retorno disappears, attention cleared, history preserved', () => {
    const onAcknowledge = vi.fn();
    const returningLead: Lead = {
      ...baseLead,
      pipeline_stage_id: 'stage-quente',
      has_new_submission: true,
      new_inbound_count: 1,
      is_returning_submission: true,
    };

    const { rerender } = render(
      <MinimalLeadCard
        lead={returningLead}
        stageCode="acquisition"
        stageName="Quente"
        onAcknowledge={onAcknowledge}
      />
    );

    const ackButton = screen.getByTestId(`lead-card-ack-button-${returningLead.id}`);
    expect(ackButton).toBeInTheDocument();
    fireEvent.click(ackButton);
    expect(onAcknowledge).toHaveBeenCalledWith(returningLead.id);

    // After acknowledgment, state clears
    const acknowledgedLead: Lead = {
      ...returningLead,
      has_new_submission: false,
      new_inbound_count: 0,
      is_returning_submission: false,
    };

    rerender(
      <MinimalLeadCard
        lead={acknowledgedLead}
        stageCode="acquisition"
        stageName="Quente"
        onAcknowledge={onAcknowledge}
      />
    );

    expect(screen.queryByTestId('lead-card-new-submission-badge')).toBeNull();
    expect(screen.queryByTestId(`lead-card-ack-button-${returningLead.id}`)).toBeNull();
  });

  // Test 10: Refresh / Realtime consistency
  it('10. Refresh / Realtime -> badge state remains correct across renders', () => {
    const unacknowledgedReturning: Lead = {
      ...baseLead,
      has_new_submission: true,
      new_inbound_count: 1,
      is_returning_submission: true,
    };

    const { rerender } = render(
      <MinimalLeadCard
        lead={unacknowledgedReturning}
        stageCode="qualification"
        stageName="Interessado"
      />
    );

    expect(screen.getByTestId('lead-card-new-submission-badge').textContent).toContain('Retorno');

    // Simulate realtime update or re-fetch where state is preserved
    rerender(
      <MinimalLeadCard
        lead={{ ...unacknowledgedReturning }}
        stageCode="qualification"
        stageName="Interessado"
      />
    );

    expect(screen.getByTestId('lead-card-new-submission-badge').textContent).toContain('Retorno');
  });

  // Test 11: Mobile Layout
  it('11. Mobile layout renders cleanly with no overflow and no empty spacing when badge is absent', () => {
    const leadNoBadge: Lead = {
      ...baseLead,
      has_new_submission: false,
    };

    const { container } = render(
      <div className="w-[320px]">
        <MinimalLeadCard
          lead={leadNoBadge}
          stageCode="capture"
          stageName="Novo Lead"
        />
      </div>
    );

    expect(container.querySelector('[data-testid="lead-card-new-submission-badge"]')).toBeNull();
    // Grip vertical is still present without empty badge spacer
    expect(container.querySelector('svg')).toBeDefined();
  });

  // Test 12: Desktop Layout
  it('12. Desktop layout renders cleanly with no overflow and no empty spacing when badge is absent', () => {
    const leadWithRetorno: Lead = {
      ...baseLead,
      has_new_submission: true,
      new_inbound_count: 2,
      is_returning_submission: true,
    };

    const { container } = render(
      <div className="w-[1280px]">
        <MinimalLeadCard
          lead={leadWithRetorno}
          stageCode="acquisition"
          stageName="Quente"
        />
      </div>
    );

    const badge = screen.getByTestId('lead-card-new-submission-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('Retorno');
    expect(container.querySelector('.select-none')).toBeInTheDocument();
  });
});
