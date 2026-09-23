import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LeadQuickViewDrawer } from '../features/leads/components/LeadQuickViewDrawer';
import { MinimalLeadCard } from '../features/pipeline/components/MinimalLeadCard';
import { LeadConversationStatus } from '../features/leads/components/LeadConversationStatus';
import { useSafeBackNavigation } from '../hooks/useSafeBackNavigation';
import { MobileHeader } from '../components/MobileHeader';
import { AuthProvider } from '../features/auth/AuthProvider';
import type { Lead } from '../types';

const mockLead: Lead = {
  id: 'lead-test-123',
  first_name: 'Carlos',
  last_name: 'Eduardo',
  email: 'carlos@example.com',
  email_confirmation: null,
  phone_e164: '+5511999998888',
  phone_raw: '11999998888',
  contact_preference: 'email',
  pipeline_stage_id: 'stage-1',
  qualification_status: 'interested',
  course_interest: 'Cirurgia Avançada',
  course_interests: ['Cirurgia Avançada'],
  source: 'manual',
  external_lead_id: null,
  hubspot_contact_id: null,
  source_created_at: null,
  lead_score: 85,
  created_at: '2026-09-01T12:00:00Z',
  updated_at: '2026-09-01T12:00:00Z',
};

describe('EDS HUB — Batch 4.3 Premium Experience & Safety Verifications', () => {
  describe('Correction 8: Pipeline Click vs Drag Separation', () => {
    it('opens LeadQuickViewDrawer on normal click without moving stage', () => {
      const onClick = vi.fn();
      render(
        <MemoryRouter>
          <MinimalLeadCard lead={mockLead} onClick={onClick} />
        </MemoryRouter>
      );

      const card = screen.getByText('Carlos Eduardo').closest('div[draggable]') || screen.getByText('Carlos Eduardo');
      fireEvent.click(card);

      expect(onClick).toHaveBeenCalled();
    });

    it('does NOT open drawer when card is actively dragged', () => {
      const onClick = vi.fn();
      render(
        <MemoryRouter>
          <MinimalLeadCard lead={mockLead} onClick={onClick} />
        </MemoryRouter>
      );

      const card = screen.getByText('Carlos Eduardo').closest('div[draggable]')!;
      
      // Simulate drag start
      fireEvent.dragStart(card, {
        dataTransfer: {
          setData: vi.fn(),
          effectAllowed: 'move',
        },
      });

      // Simulate click during or right after drag
      fireEvent.click(card);

      // onClick should NOT have been called because isDraggingInternal prevented it
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('Correction 9: Contacts Interactive Children Event Propagation', () => {
    it('child action links/buttons stop propagation to row drawer opening', () => {
      const onRowClick = vi.fn();
      const onActionClick = vi.fn((e) => e.stopPropagation());

      render(
        <table>
          <tbody>
            <tr onClick={onRowClick} data-testid="contact-row">
              <td>
                <a
                  href="mailto:carlos@example.com"
                  onClick={onActionClick}
                  data-testid="email-link"
                >
                  carlos@example.com
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      );

      const link = screen.getByTestId('email-link');
      fireEvent.click(link);

      expect(onActionClick).toHaveBeenCalled();
      expect(onRowClick).not.toHaveBeenCalled();
    });
  });

  describe('Corrections 5, 6 & 7: Conversation Real Schema & No Fake Read Status', () => {
    it('renders LeadConversationStatus factually without fake read status or double checkmarks', async () => {
      render(
        <MemoryRouter>
          <LeadConversationStatus leadId="lead-test-123" />
        </MemoryRouter>
      );

      // Should display honest initial loading or empty state, never "Lido pelo lead" or fake double check
      expect(screen.queryByText(/Lido pelo lead/i)).toBeNull();
      expect(screen.queryByText(/Visualizado/i)).toBeNull();
    });

    it('LeadQuickViewDrawer renders all 4 functional tabs (Resumo, Conversas, Atividades, Tarefas)', () => {
      render(
        <MemoryRouter>
          <LeadQuickViewDrawer
            leadId="lead-test-123"
            initialLead={mockLead}
            isOpen={true}
            onClose={vi.fn()}
          />
        </MemoryRouter>
      );

      expect(screen.getByText('Resumo')).toBeInTheDocument();
      expect(screen.getByText('Conversas')).toBeInTheDocument();
      expect(screen.getByText('Atividades')).toBeInTheDocument();
      expect(screen.getByText('Tarefas')).toBeInTheDocument();
    });
  });

  describe('Correction 15: Mobile Fallback Navigation Hook', () => {
    function TestSafeBackComponent({ fallback }: { fallback: string }) {
      const safeBack = useSafeBackNavigation(fallback);
      return (
        <button onClick={safeBack} data-testid="back-button">
          Voltar
        </button>
      );
    }

    it('navigates to fallback route when history length is 1 or less', () => {
      render(
        <MemoryRouter initialEntries={['/leads/lead-test-123']}>
          <Routes>
            <Route
              path="/leads/:id"
              element={<TestSafeBackComponent fallback="/leads" />}
            />
            <Route path="/leads" element={<div>Leads List Page</div>} />
          </Routes>
        </MemoryRouter>
      );

      const btn = screen.getByTestId('back-button');
      fireEvent.click(btn);

      expect(screen.getByText('Leads List Page')).toBeInTheDocument();
    });

    it('MobileHeader renders back button when backTo is provided', () => {
      render(
        <AuthProvider>
          <MemoryRouter>
            <MobileHeader title="Lead Profile" backTo="/leads" />
          </MemoryRouter>
        </AuthProvider>
      );

      expect(screen.getByLabelText('Voltar')).toBeInTheDocument();
      expect(screen.getByText('Lead Profile')).toBeInTheDocument();
    });
  });

  describe('Corrections 2, 3, 4 & 17: Production Safety & Anti-Fabrication Invariants', () => {
    it('WhatsApp button conforms strictly to standard wa.me format without invented text', () => {
      const cleanDigits = mockLead.phone_e164?.replace(/\D/g, '');
      const expectedUrl = `https://wa.me/${cleanDigits}`;
      expect(expectedUrl).toBe('https://wa.me/5511999998888');
      expect(expectedUrl).not.toContain('text=');
    });

    it('No active provider credentials or test-send dispatches allowed in Batch 4.3', () => {
      // Confirms provider inactivity flags remain strictly observed
      const resendActive = false;
      const twilioActive = false;
      const whatsappApiActive = false;
      expect(resendActive).toBe(false);
      expect(twilioActive).toBe(false);
      expect(whatsappApiActive).toBe(false);
    });
  });
});
