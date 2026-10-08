import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LeadQuickActionBar } from '../features/leads/components/LeadQuickActionBar';
import type { Lead } from '../types';

// Mock Supabase
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
  isTransientNetworkError: vi.fn().mockReturnValue(false),
}));

const mockLeadWithAllContacts: Lead = {
  id: 'lead-test-comm-123',
  first_name: 'Dr. Roberto',
  last_name: 'Almeida',
  email: 'roberto.almeida@example.com',
  phone_raw: '(11) 98765-4321',
  phone_e164: '+5511987654321',
  contact_preference: 'whatsapp',
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
} as Lead;

describe('Desktop Communication Buttons Clickability & Layout Integrity', () => {
  let onOpenTaskModal: () => void;
  let onOpenPaymentModal: () => void;
  let onOpenEmailComposer: () => void;
  let onOpenSmsComposer: () => void;
  let onOpenWhatsappComposer: () => void;
  let onOpenRegisterActivity: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    onOpenTaskModal = vi.fn();
    onOpenPaymentModal = vi.fn();
    onOpenEmailComposer = vi.fn();
    onOpenSmsComposer = vi.fn();
    onOpenWhatsappComposer = vi.fn();
    onOpenRegisterActivity = vi.fn();
  });

  it('1. Renders Comunicação section with Phone, SMS, Email, and WhatsApp buttons', () => {
    render(
      <LeadQuickActionBar
        lead={mockLeadWithAllContacts}
        onOpenTaskModal={onOpenTaskModal}
        onOpenPaymentModal={onOpenPaymentModal}
        onOpenEmailComposer={onOpenEmailComposer}
        onOpenSmsComposer={onOpenSmsComposer}
        onOpenWhatsappComposer={onOpenWhatsappComposer}
        onOpenRegisterActivity={onOpenRegisterActivity}
      />
    );

    expect(screen.getByText('Comunicação')).toBeDefined();
    expect(screen.getByTestId('quick-action-call')).toBeDefined();
    expect(screen.getByTestId('quick-action-sms')).toBeDefined();
    expect(screen.getByTestId('quick-action-email')).toBeDefined();
    expect(screen.getByTestId('quick-action-whatsapp')).toBeDefined();
  });

  it('2. Phone shortcut is clickable and has valid tel: URI without disabled state', () => {
    render(
      <LeadQuickActionBar
        lead={mockLeadWithAllContacts}
        onOpenTaskModal={onOpenTaskModal}
        onOpenPaymentModal={onOpenPaymentModal}
        onOpenEmailComposer={onOpenEmailComposer}
        onOpenSmsComposer={onOpenSmsComposer}
        onOpenWhatsappComposer={onOpenWhatsappComposer}
      />
    );

    const callBtn = screen.getByTestId('quick-action-call');
    expect(callBtn.getAttribute('href')).toBe('tel:+5511987654321');
    expect(callBtn.getAttribute('role')).toBe('button');
    expect(callBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(callBtn);
    // Non-blocking logger called without throwing
  });

  it('3. SMS shortcut is clickable and opens SMS Manual Assistido composer', () => {
    render(
      <LeadQuickActionBar
        lead={mockLeadWithAllContacts}
        onOpenTaskModal={onOpenTaskModal}
        onOpenPaymentModal={onOpenPaymentModal}
        onOpenEmailComposer={onOpenEmailComposer}
        onOpenSmsComposer={onOpenSmsComposer}
        onOpenWhatsappComposer={onOpenWhatsappComposer}
      />
    );

    const smsBtn = screen.getByTestId('quick-action-sms');
    expect(smsBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(smsBtn);
    expect(onOpenSmsComposer).toHaveBeenCalledTimes(1);
  });

  it('4. Email shortcut is clickable and opens internal manual email composer', () => {
    render(
      <LeadQuickActionBar
        lead={mockLeadWithAllContacts}
        onOpenTaskModal={onOpenTaskModal}
        onOpenPaymentModal={onOpenPaymentModal}
        onOpenEmailComposer={onOpenEmailComposer}
        onOpenSmsComposer={onOpenSmsComposer}
        onOpenWhatsappComposer={onOpenWhatsappComposer}
      />
    );

    const emailBtn = screen.getByTestId('quick-action-email');
    expect(emailBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(emailBtn);
    expect(onOpenEmailComposer).toHaveBeenCalledTimes(1);
  });

  it('5. WhatsApp shortcut is clickable and opens WhatsApp manual assisted composer', () => {
    render(
      <LeadQuickActionBar
        lead={mockLeadWithAllContacts}
        onOpenTaskModal={onOpenTaskModal}
        onOpenPaymentModal={onOpenPaymentModal}
        onOpenEmailComposer={onOpenEmailComposer}
        onOpenSmsComposer={onOpenSmsComposer}
        onOpenWhatsappComposer={onOpenWhatsappComposer}
      />
    );

    const waBtn = screen.getByTestId('quick-action-whatsapp');
    expect(waBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(waBtn);
    expect(onOpenWhatsappComposer).toHaveBeenCalledTimes(1);
  });

  it('6. Operational section renders Adicionar Tarefa, Pagamento, and Registrar Atividade and all are clickable', () => {
    render(
      <LeadQuickActionBar
        lead={mockLeadWithAllContacts}
        onOpenTaskModal={onOpenTaskModal}
        onOpenPaymentModal={onOpenPaymentModal}
        onOpenEmailComposer={onOpenEmailComposer}
        onOpenSmsComposer={onOpenSmsComposer}
        onOpenWhatsappComposer={onOpenWhatsappComposer}
        onOpenRegisterActivity={onOpenRegisterActivity}
      />
    );

    expect(screen.getByText('Operacional')).toBeDefined();

    const taskBtn = screen.getByTestId('quick-action-add-task');
    fireEvent.click(taskBtn);
    expect(onOpenTaskModal).toHaveBeenCalledTimes(1);

    const paymentBtn = screen.getByTestId('quick-action-payment');
    fireEvent.click(paymentBtn);
    expect(onOpenPaymentModal).toHaveBeenCalledTimes(1);

    const activityBtn = screen.getByTestId('quick-action-register-activity');
    fireEvent.click(activityBtn);
    expect(onOpenRegisterActivity).toHaveBeenCalledTimes(1);
  });

  it('7. Layout integrity: Comunicação and Operacional occupy independent full-width containers without crushing flex-row', () => {
    const { container } = render(
      <LeadQuickActionBar
        lead={mockLeadWithAllContacts}
        onOpenTaskModal={onOpenTaskModal}
        onOpenPaymentModal={onOpenPaymentModal}
        onOpenEmailComposer={onOpenEmailComposer}
        onOpenSmsComposer={onOpenSmsComposer}
        onOpenWhatsappComposer={onOpenWhatsappComposer}
      />
    );

    // Verify container uses stacked layout (space-y-3, no lg:flex-row)
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('space-y-3');
    expect(card.className).not.toContain('lg:flex-row');

    // Verify all buttons have w-full and relative for hit target integrity
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => {
      expect(btn.className).toContain('w-full');
      expect(btn.className).toContain('relative');
    });
  });
});
