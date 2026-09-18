import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock auth
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    session: { user: { id: 'test-user-id' } },
    user: { id: 'test-user-id' },
    appUser: {
      id: 'app-user-1',
      display_name: 'Dr. Test Coordinator',
      email: 'coordinator@example.com',
      is_active: true,
      role: 'admin',
    },
    isLoading: false,
    isAuthorized: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

describe('All Route Pages Render Test', () => {
  const routes = [
    { name: 'SalesDashboardPage', loader: () => import('../features/dashboard/SalesDashboardPage') },
    { name: 'RevenueDashboardPage', loader: () => import('../features/revenue/RevenueDashboardPage') },
    { name: 'FoundationStatusPage', loader: () => import('../features/dashboard/FoundationStatusPage') },
    { name: 'SystemSetupPage', loader: () => import('../features/settings/SystemSetupPage') },
    { name: 'LeadsListPage', loader: () => import('../features/leads/LeadsListPage') },
    { name: 'LeadDetailPage', loader: () => import('../features/leads/LeadDetailPage') },
    { name: 'PipelineKanbanPage', loader: () => import('../features/pipeline/PipelineKanbanPage') },
    { name: 'CampaignsListPage', loader: () => import('../features/campaigns/CampaignsListPage') },
    { name: 'CampaignDetailPage', loader: () => import('../features/campaigns/CampaignDetailPage') },
    { name: 'TemplatesListPage', loader: () => import('../features/templates/TemplatesListPage') },
    { name: 'FormsListPage', loader: () => import('../features/forms/FormsListPage') },
    { name: 'FormBuilderPage', loader: () => import('../features/forms/FormBuilderPage') },
    { name: 'FormSubmissionsPage', loader: () => import('../features/forms/FormSubmissionsPage') },
    { name: 'AutomationsListPage', loader: () => import('../features/automations/AutomationsListPage') },
    { name: 'AutomationBuilderPage', loader: () => import('../features/automations/AutomationBuilderPage') },
    { name: 'AutomationRunsPage', loader: () => import('../features/automations/AutomationRunsPage') },
    { name: 'SequencesListPage', loader: () => import('../features/sequences/SequencesListPage') },
    { name: 'SequenceBuilderPage', loader: () => import('../features/sequences/SequenceBuilderPage') },
    { name: 'InboxPage', loader: () => import('../features/inbox/InboxPage') },
    { name: 'LeadScoringSettingsPage', loader: () => import('../features/scoring/LeadScoringSettingsPage') },
    { name: 'CourseOperationsPage', loader: () => import('../features/courses/CourseOperationsPage') },
    { name: 'SessionDetailPage', loader: () => import('../features/courses/SessionDetailPage') },
    { name: 'PostCoursePage', loader: () => import('../features/courses/PostCoursePage') },
    { name: 'WorkDashboardPage', loader: () => import('../features/work/WorkDashboardPage') },
    { name: 'ReportsPage', loader: () => import('../features/reports/ReportsPage') },
  ];

  for (const route of routes) {
    it(`imports and renders ${route.name} without crashing`, async () => {
      const mod = await route.loader();
      const Component = (mod as any)[route.name] || (mod as any).default;
      expect(Component).toBeDefined();
      expect(typeof Component).toBe('function');

      const { container } = render(
        <MemoryRouter>
          <Component />
        </MemoryRouter>
      );
      expect(container).toBeDefined();
    });
  }
});
