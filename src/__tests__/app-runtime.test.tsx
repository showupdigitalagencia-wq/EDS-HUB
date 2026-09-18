import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';

describe('App Root Runtime Test', () => {
  it('mounts App without crashing or triggering ErrorBoundary', async () => {
    render(<App />);
    
    // Wait for the app to settle
    await waitFor(() => {
      const errorHeading = screen.queryByText('Algo deu errado');
      expect(errorHeading).toBeNull();
    }, { timeout: 4000 });
  });
});
