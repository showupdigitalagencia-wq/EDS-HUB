// =============================================================================
// Tests: Email Quote Cleaner Utility
// =============================================================================

import { describe, it, expect } from 'vitest';
import { splitEmailQuotes } from '../utils/email-quote-cleaner';

describe('Email Quote Cleaner Utility', () => {
  it('handles null, undefined, or empty string safely', () => {
    expect(splitEmailQuotes(null)).toEqual({ freshText: '', quotedText: null });
    expect(splitEmailQuotes(undefined)).toEqual({ freshText: '', quotedText: null });
    expect(splitEmailQuotes('')).toEqual({ freshText: '', quotedText: null });
  });

  it('leaves clean message without quotes intact', () => {
    const raw = 'Olá equipe,\n\nGostaria de confirmar minha presença na imersão.\n\nObrigado.';
    const result = splitEmailQuotes(raw);
    expect(result.freshText).toBe(raw);
    expect(result.quotedText).toBeNull();
  });

  it('separates fresh reply from inline quotation block (> ...)', () => {
    const raw = `Sim, estou muito interessado na turma de Outubro!

> Em 23 de Setembro de 2026, Expert Dental Solutions escreveu:
> Olá Doutor, temos 2 vagas restantes para o curso.`;

    const result = splitEmailQuotes(raw);
    expect(result.freshText).toBe('Sim, estou muito interessado na turma de Outubro!');
    expect(result.quotedText).toContain('> Em 23 de Setembro');
  });

  it('separates fresh reply from English "On [date], [author] wrote:" delimiter', () => {
    const raw = `Please send me the syllabus and schedule.

On Sep 23, 2026, at 10:30 AM, Expert Dental Solutions <info@expdentalsolutions.com> wrote:
Hello Doctor, thank you for your interest.`;

    const result = splitEmailQuotes(raw);
    expect(result.freshText).toBe('Please send me the syllabus and schedule.');
    expect(result.quotedText).toContain('On Sep 23, 2026');
  });

  it('separates fresh reply from Portuguese "----- Mensagem Original -----" delimiter', () => {
    const raw = `Pode enviar o link de pagamento por gentileza?

----- Mensagem Original -----
De: Expert Dental Solutions
Para: dr.almeida@gmail.com
Assunto: Curso Avançado`;

    const result = splitEmailQuotes(raw);
    expect(result.freshText).toBe('Pode enviar o link de pagamento por gentileza?');
    expect(result.quotedText).toContain('----- Mensagem Original -----');
  });

  it('falls back gracefully when the entire email is a quote', () => {
    const raw = '> Just quoting previous message without new text';
    const result = splitEmailQuotes(raw);
    expect(result.freshText).toBe(raw);
    expect(result.quotedText).toBeNull();
  });
});
