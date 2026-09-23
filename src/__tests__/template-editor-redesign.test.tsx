import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TemplateEditorModal } from '../features/templates/components/TemplateEditorModal';
import { CategorySelect } from '../features/templates/components/CategorySelect';

// Mock Supabase
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    })),
  },
}));

// Mock template-usage-service
vi.mock('../features/templates/services/template-usage-service', () => ({
  getTemplateUsage: vi.fn().mockResolvedValue({
    totalCount: 0,
    campaigns: [],
    automations: [],
    sequences: [],
  }),
}));

describe('EDS HUB — Template Editor Premium Redesign: Component & UX Tests', () => {
  // ---------------------------------------------------------------------------
  // 1. CategorySelect Popover Component
  // ---------------------------------------------------------------------------
  describe('CategorySelect Popover', () => {
    it('renders selected category label and opens floating menu on click', () => {
      const handleChange = vi.fn();
      render(
        <CategorySelect
          value="general"
          onChange={handleChange}
          label="Categoria"
        />
      );

      // Trigger button shows current selection
      const trigger = screen.getByRole('button', { name: /geral/i });
      expect(trigger).toBeDefined();

      // Open popover
      fireEvent.click(trigger);

      // Popover options are rendered
      expect(screen.getByRole('option', { name: /boas-vindas/i })).toBeDefined();
      expect(screen.getByRole('option', { name: /promocional/i })).toBeDefined();
      expect(screen.getByRole('option', { name: /follow-up/i })).toBeDefined();

      // Select an option
      fireEvent.click(screen.getByRole('option', { name: /promocional/i }));
      expect(handleChange).toHaveBeenCalledWith('promotional');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. TemplateEditorModal: Default Email Experience & Mode Switching
  // ---------------------------------------------------------------------------
  describe('TemplateEditorModal: Email Composer', () => {
    it('renders in Compor mode by default with Gmail-inspired structure', () => {
      render(
        <TemplateEditorModal
          isOpen={true}
          onClose={vi.fn()}
          editingTemplate={null}
          onSaveSuccess={vi.fn()}
        />
      );

      // Sticky Header
      expect(screen.getByText('Novo Template')).toBeDefined();
      expect(
        screen.getByText('Crie uma mensagem profissional para seus leads.')
      ).toBeDefined();

      // Mode Navigation
      expect(screen.getByRole('button', { name: /^compor$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^blocos$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^prévia$/i })).toBeDefined();

      // Personalização section
      expect(screen.getByText('Personalização')).toBeDefined();
      expect(screen.getByText('{{salutation}}')).toBeDefined();
      expect(screen.getByText('{{first_name}}')).toBeDefined();
      // Ensure {{last_name}} is NOT globally exposed
      expect(screen.queryByText('{{last_name}}')).toBeNull();

      // Gmail Envelope & Subject
      expect(screen.getByLabelText(/assunto:/i)).toBeDefined();
      expect(screen.getByPlaceholderText(/atualização importante/i)).toBeDefined();

      // Quick Block Buttons
      expect(screen.getByRole('button', { name: /\+ título/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /\+ texto/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /\+ botão/i })).toBeDefined();

      // Sticky Bottom Action Bar
      expect(screen.getByRole('button', { name: /cancelar/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /salvar template/i })).toBeDefined();
    });

    it('switches seamlessly to Blocos mode with localized block controls', async () => {
      render(
        <TemplateEditorModal
          isOpen={true}
          onClose={vi.fn()}
          editingTemplate={null}
          onSaveSuccess={vi.fn()}
        />
      );

      // Click Blocos tab
      const blocosTab = screen.getByRole('button', { name: /^blocos$/i });
      fireEvent.click(blocosTab);

      // Block organizer header
      expect(screen.getByText('Organizador Estrutural de Blocos')).toBeDefined();

      // Localized Add Block buttons
      expect(screen.getByRole('button', { name: /^título$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^texto$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^botão$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^imagem$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^divisor$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^espaço$/i })).toBeDefined();

      // Block cards with grip handles and Portuguese labels
      expect(screen.getByText('Bloco de Título')).toBeDefined();
      expect(screen.getByText('Bloco de Texto')).toBeDefined();
      expect(screen.getByText('Bloco de Botão')).toBeDefined();
    });

    it('switches seamlessly to Prévia mode with Desktop and Mobile toggle', async () => {
      render(
        <TemplateEditorModal
          isOpen={true}
          onClose={vi.fn()}
          editingTemplate={null}
          onSaveSuccess={vi.fn()}
        />
      );

      // Click Prévia tab
      const previaTab = screen.getByRole('button', { name: /prévia/i });
      fireEvent.click(previaTab);

      // Static Sample Data Disclaimer Badge
      expect(
        screen.getByText('DADOS DE EXEMPLO — PRÉ-VISUALIZAÇÃO ESTÁTICA')
      ).toBeDefined();
      expect(
        screen.getByText(/nenhum lead real consultado/i)
      ).toBeDefined();

      // Desktop and Mobile toggle buttons
      expect(screen.getByRole('button', { name: /desktop/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /mobile/i })).toBeDefined();

      // Toggle to Mobile
      const mobileBtn = screen.getByRole('button', { name: /mobile/i });
      fireEvent.click(mobileBtn);
      expect(screen.getByText(/cliente de email \(mobile\)/i)).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. TemplateEditorModal: SMS Experience & Channel Switch
  // ---------------------------------------------------------------------------
  describe('TemplateEditorModal: SMS Channel', () => {
    it('switches to SMS channel and isolates from Email block builder', async () => {
      render(
        <TemplateEditorModal
          isOpen={true}
          onClose={vi.fn()}
          editingTemplate={null}
          onSaveSuccess={vi.fn()}
        />
      );

      // Select SMS channel card
      const smsCard = screen.getByRole('button', { name: /sms/i });
      fireEvent.click(smsCard);

      // SMS title in textarea
      expect(screen.getByText(/mensagem de texto \(sms\)/i)).toBeDefined();

      // Mode Navigation: Only Compor and Prévia exist (Blocos is removed for SMS!)
      expect(screen.getByRole('button', { name: /^compor$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^prévia$/i })).toBeDefined();
      expect(screen.queryByRole('button', { name: /^blocos$/i })).toBeNull();

      // Subject field must NOT be present in SMS mode
      expect(screen.queryByLabelText(/assunto:/i)).toBeNull();

      // Live metrics meter is visible
      expect(screen.getAllByText(/segmento\(s\)/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/codificação detectada:/i)).toBeDefined();
    });

    it('renders smartphone preview for SMS in Prévia mode without fake read receipts', () => {
      render(
        <TemplateEditorModal
          isOpen={true}
          onClose={vi.fn()}
          editingTemplate={null}
          onSaveSuccess={vi.fn()}
        />
      );

      // Switch to SMS
      fireEvent.click(screen.getByRole('button', { name: /sms/i }));

      // Type some SMS text
      const textarea = screen.getByPlaceholderText(/olá {{salutation}}/i);
      fireEvent.change(textarea, { target: { value: 'Olá {{first_name}}, lembrete importante!' } });

      // Click Prévia
      fireEvent.click(screen.getByRole('button', { name: /prévia/i }));

      // Phone preview header
      expect(screen.getByText(/dispositivo móvel • sms/i)).toBeDefined();
      expect(screen.getByText(/maria silva/i)).toBeDefined();

      // Substituted sample text inside bubble
      expect(screen.getByText(/olá maria, lembrete importante!/i)).toBeDefined();

      // No fake delivery status
      expect(screen.queryByText(/delivered/i)).toBeNull();
      expect(screen.queryByText(/read/i)).toBeNull();
    });
  });
});
