import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TermsOfServicePage } from '../features/public/TermsOfServicePage';
import { DataDeletionPage } from '../features/public/DataDeletionPage';

describe('Public Legal Pages for Meta Compliance', () => {
  it('renders Terms of Service page without authentication and includes required content', () => {
    render(
      <MemoryRouter>
        <TermsOfServicePage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: /terms of service/i })).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('These Terms of Service govern the use of'))).toBeInTheDocument();
    expect(screen.getByText(/we do not sell personal information to third parties/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /https:\/\/expdentalsolutions\.com/i })).toBeInTheDocument();
  });

  it('renders Data Deletion page without authentication and includes deletion instructions', () => {
    render(
      <MemoryRouter>
        <DataDeletionPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: /data deletion instructions/i })).toBeInTheDocument();
    expect(screen.getByText(/request deletion of your personal data/i)).toBeInTheDocument();
    expect(screen.getByText(/full name;/i)).toBeInTheDocument();
    expect(screen.getByText(/email address used when submitting the form;/i)).toBeInTheDocument();
    expect(screen.getByText(/phone number used when submitting the form\./i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /https:\/\/expdentalsolutions\.com/i })).toBeInTheDocument();
  });
});
