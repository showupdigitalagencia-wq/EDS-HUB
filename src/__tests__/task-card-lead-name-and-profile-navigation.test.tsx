import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WorkItemCard } from '../features/work/components/WorkItemCard';
import type { WorkItem } from '../types/database';

describe('FINAL UX ADJUSTMENT — Task Cards Must Show Lead Name and Open Lead Profile', () => {
  const baseItem: WorkItem = {
    id: 'task:task-pedro-123',
    type: 'TASK',
    category: 'today',
    priority: 'normal',
    title: 'Confirmar participação no curso',
    description: 'Dr. Pedro solicitou detalhes das datas práticas.',
    due_at: '2026-10-02T10:00:00.000Z',
    is_overdue: false,
    detected_at: '2026-10-02T09:33:10.000Z',
    lead_id: 'ee80445e-700c-4d24-a4d2-470df37d376e',
    lead_name: 'Pedro Noe Hernandez',
    lead_email: 'pedronoh.dmd@gmail.com',
    lead_phone: '+15551234567',
    contact_preference: 'email',
    lead_score: 85,
    pipeline_stage: 'Respondido',
    reason_code: null,
    context_id: 'task-pedro-123',
    context_type: 'task',
    primary_action: {
      type: 'complete_task',
      label: 'Marcar como concluída',
      task_id: 'task-pedro-123',
    },
  };

  // Requirement 1 & 2: Primary identity is LEAD NAME, secondary is EMAIL below
  it('displays Lead Name as primary identity and email as secondary information below', () => {
    render(
      <MemoryRouter>
        <WorkItemCard
          item={baseItem}
          onCompleteTask={vi.fn()}
          onRescheduleTask={vi.fn()}
          onCreateTaskForLead={vi.fn()}
        />
      </MemoryRouter>
    );

    const primaryName = screen.getByTestId('task-card-lead-name');
    expect(primaryName).toBeInTheDocument();
    expect(primaryName).toHaveTextContent('Pedro Noe Hernandez');

    const secondaryEmail = screen.getByTestId('task-card-lead-email');
    expect(secondaryEmail).toBeInTheDocument();
    expect(secondaryEmail).toHaveTextContent('pedronoh.dmd@gmail.com');

    // Title and due date preserved
    expect(screen.getByTestId('task-card-title')).toHaveTextContent('Confirmar participação no curso');
    expect(screen.getByTestId('task-card-due-at')).toBeInTheDocument();
  });

  // Requirement 5: Fallback to email when name is missing or generic
  it('falls back to showing email as primary label when lead name is missing or generic placeholder', () => {
    const itemWithoutName: WorkItem = {
      ...baseItem,
      lead_name: null,
      lead_email: 'anonymous.dentist@example.com',
    };

    render(
      <MemoryRouter>
        <WorkItemCard
          item={itemWithoutName}
          onCompleteTask={vi.fn()}
          onRescheduleTask={vi.fn()}
          onCreateTaskForLead={vi.fn()}
        />
      </MemoryRouter>
    );

    const primaryLabel = screen.getByTestId('task-card-lead-name');
    expect(primaryLabel).toHaveTextContent('anonymous.dentist@example.com');

    // Secondary email should not be rendered to avoid duplicate label
    expect(screen.queryByTestId('task-card-lead-email')).not.toBeInTheDocument();
  });

  // Requirement 5 (cont.): Fallback when name equals email or is placeholder 'Lead'
  it('falls back to email when lead_name is a generic placeholder like "Lead" or identical to email', () => {
    const itemWithPlaceholder: WorkItem = {
      ...baseItem,
      lead_name: 'Lead',
      lead_email: 'doctor@clinic.com',
    };

    render(
      <MemoryRouter>
        <WorkItemCard
          item={itemWithPlaceholder}
          onCompleteTask={vi.fn()}
          onRescheduleTask={vi.fn()}
          onCreateTaskForLead={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('task-card-lead-name')).toHaveTextContent('doctor@clinic.com');
    expect(screen.queryByTestId('task-card-lead-email')).not.toBeInTheDocument();
  });

  // Requirement 3 & 8: Tapping card opens the corresponding lead profile
  it('opens lead profile when clicking anywhere on the task card body', () => {
    const onSelectLead = vi.fn();

    render(
      <MemoryRouter>
        <WorkItemCard
          item={baseItem}
          onCompleteTask={vi.fn()}
          onRescheduleTask={vi.fn()}
          onCreateTaskForLead={vi.fn()}
          onSelectLead={onSelectLead}
        />
      </MemoryRouter>
    );

    const card = screen.getByTestId('work-item-card-task-pedro-123');
    fireEvent.click(card);

    expect(onSelectLead).toHaveBeenCalledWith('ee80445e-700c-4d24-a4d2-470df37d376e');
  });

  // Requirement 3 & 8 (cont.): Clicking the lead name specifically opens lead profile
  it('opens lead profile when clicking specifically on the lead name button', () => {
    const onSelectLead = vi.fn();

    render(
      <MemoryRouter>
        <WorkItemCard
          item={baseItem}
          onCompleteTask={vi.fn()}
          onRescheduleTask={vi.fn()}
          onCreateTaskForLead={vi.fn()}
          onSelectLead={onSelectLead}
        />
      </MemoryRouter>
    );

    const nameBtn = screen.getByTestId('task-card-lead-name');
    fireEvent.click(nameBtn);

    expect(onSelectLead).toHaveBeenCalledWith('ee80445e-700c-4d24-a4d2-470df37d376e');
  });

  // Requirement 7: Action buttons do NOT trigger card profile navigation
  it('does NOT trigger lead profile navigation when clicking action buttons (Reagendar / Concluir)', () => {
    const onSelectLead = vi.fn();
    const onCompleteTask = vi.fn();
    const onRescheduleTask = vi.fn();

    render(
      <MemoryRouter>
        <WorkItemCard
          item={baseItem}
          onCompleteTask={onCompleteTask}
          onRescheduleTask={onRescheduleTask}
          onCreateTaskForLead={vi.fn()}
          onSelectLead={onSelectLead}
        />
      </MemoryRouter>
    );

    // Click Reagendar
    const rescheduleBtn = screen.getByRole('button', { name: /Reagendar/i });
    fireEvent.click(rescheduleBtn);
    expect(onRescheduleTask).toHaveBeenCalledWith(baseItem);
    expect(onSelectLead).not.toHaveBeenCalled();

    // Click Marcar como concluída
    const completeBtn = screen.getByTestId('complete-task-task-pedro-123');
    fireEvent.click(completeBtn);
    expect(onCompleteTask).toHaveBeenCalledWith('task-pedro-123');
    expect(onSelectLead).not.toHaveBeenCalled();
  });

  // Requirement 4: Metadata preservation (priority, status, score, stage, due date)
  it('preserves all metadata: priority badge, pipeline stage, score, contact preference, and prazo', () => {
    render(
      <MemoryRouter>
        <WorkItemCard
          item={baseItem}
          onCompleteTask={vi.fn()}
          onRescheduleTask={vi.fn()}
          onCreateTaskForLead={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Normal')).toBeInTheDocument();
    expect(screen.getByText('Respondido')).toBeInTheDocument();
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByTestId('task-card-due-at')).toHaveTextContent('Prazo:');
  });

  // Requirement 6: Works across all task categories
  it.each([
    ['today', 'Meu Dia'],
    ['overdue', 'Atrasadas'],
    ['future', 'Futuras'],
    ['needs_reply', 'Aguardando Resposta'],
    ['payments', 'Pagamentos'],
    ['leads', 'Leads'],
    ['courses', 'Cursos'],
    ['completed', 'Concluídas'],
  ])('renders primary lead name and email correctly in %s (%s) category', (category) => {
    const categorizedItem: WorkItem = {
      ...baseItem,
      category: category as any,
      is_overdue: category === 'overdue',
    };

    render(
      <MemoryRouter>
        <WorkItemCard
          item={categorizedItem}
          onCompleteTask={vi.fn()}
          onRescheduleTask={vi.fn()}
          onCreateTaskForLead={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('task-card-lead-name')).toHaveTextContent('Pedro Noe Hernandez');
    expect(screen.getByTestId('task-card-lead-email')).toHaveTextContent('pedronoh.dmd@gmail.com');
  });
});
