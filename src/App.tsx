import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './features/auth/AuthProvider';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingScreen } from './components/LoadingScreen';

// Critical initial pages loaded synchronously for instant zero-latency paint
import { LoginPage } from './features/auth/LoginPage';
import { PublicFormPage } from './features/forms/public/PublicFormPage';

// Helper for lazy loading named exports (with fallback to default export)
function lazyNamed<T extends Record<string, any>, K extends keyof T>(
  factory: () => Promise<T>,
  name: K
) {
  return lazy(() =>
    factory().then((module) => {
      const Component = module[name] || (module as any).default;
      if (!Component) {
        throw new Error(`Lazy route component "${String(name)}" was not found in module.`);
      }
      return {
        default: Component,
      };
    })
  );
}

// Protected route pages loaded on demand via route-level code splitting
const SalesDashboardPage = lazyNamed(
  () => import('./features/dashboard/SalesDashboardPage'),
  'SalesDashboardPage'
);
const RevenueDashboardPage = lazyNamed(
  () => import('./features/revenue/RevenueDashboardPage'),
  'RevenueDashboardPage'
);
const FoundationStatusPage = lazyNamed(
  () => import('./features/dashboard/FoundationStatusPage'),
  'FoundationStatusPage'
);
const SystemSetupPage = lazyNamed(
  () => import('./features/settings/SystemSetupPage'),
  'SystemSetupPage'
);
const LeadsListPage = lazyNamed(
  () => import('./features/leads/LeadsListPage'),
  'LeadsListPage'
);
const LeadDetailPage = lazyNamed(
  () => import('./features/leads/LeadDetailPage'),
  'LeadDetailPage'
);
const PipelineKanbanPage = lazyNamed(
  () => import('./features/pipeline/PipelineKanbanPage'),
  'PipelineKanbanPage'
);
const CampaignsListPage = lazyNamed(
  () => import('./features/campaigns/CampaignsListPage'),
  'CampaignsListPage'
);
const CampaignDetailPage = lazyNamed(
  () => import('./features/campaigns/CampaignDetailPage'),
  'CampaignDetailPage'
);
const TemplatesListPage = lazyNamed(
  () => import('./features/templates/TemplatesListPage'),
  'TemplatesListPage'
);
const FormsListPage = lazyNamed(
  () => import('./features/forms/FormsListPage'),
  'FormsListPage'
);
const FormBuilderPage = lazyNamed(
  () => import('./features/forms/FormBuilderPage'),
  'FormBuilderPage'
);
const FormSubmissionsPage = lazyNamed(
  () => import('./features/forms/FormSubmissionsPage'),
  'FormSubmissionsPage'
);
const AutomationsListPage = lazyNamed(
  () => import('./features/automations/AutomationsListPage'),
  'AutomationsListPage'
);
const AutomationBuilderPage = lazyNamed(
  () => import('./features/automations/AutomationBuilderPage'),
  'AutomationBuilderPage'
);
const AutomationRunsPage = lazyNamed(
  () => import('./features/automations/AutomationRunsPage'),
  'AutomationRunsPage'
);
const SequencesListPage = lazyNamed(
  () => import('./features/sequences/SequencesListPage'),
  'SequencesListPage'
);
const SequenceBuilderPage = lazyNamed(
  () => import('./features/sequences/SequenceBuilderPage'),
  'SequenceBuilderPage'
);
const InboxPage = lazyNamed(
  () => import('./features/inbox/InboxPage'),
  'InboxPage'
);
const LeadScoringSettingsPage = lazyNamed(
  () => import('./features/scoring/LeadScoringSettingsPage'),
  'LeadScoringSettingsPage'
);
const CourseOperationsPage = lazyNamed(
  () => import('./features/courses/CourseOperationsPage'),
  'CourseOperationsPage'
);
const SessionDetailPage = lazyNamed(
  () => import('./features/courses/SessionDetailPage'),
  'SessionDetailPage'
);
const PostCoursePage = lazyNamed(
  () => import('./features/courses/PostCoursePage'),
  'PostCoursePage'
);
const WorkDashboardPage = lazyNamed(
  () => import('./features/work/WorkDashboardPage'),
  'WorkDashboardPage'
);
const ReportsPage = lazyNamed(
  () => import('./features/reports/ReportsPage'),
  'ReportsPage'
);

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/f/:slug" element={<PublicFormPage />} />

              {/* Protected routes */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <SalesDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <SalesDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/reports"
                element={
                  <ProtectedRoute>
                    <ReportsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/work"
                element={
                  <ProtectedRoute>
                    <WorkDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/tasks/work"
                element={
                  <ProtectedRoute>
                    <WorkDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/tasks"
                element={
                  <ProtectedRoute>
                    <WorkDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard/revenue"
                element={
                  <ProtectedRoute>
                    <RevenueDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/revenue"
                element={
                  <ProtectedRoute>
                    <RevenueDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/courses/operations"
                element={
                  <ProtectedRoute>
                    <CourseOperationsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/courses/sessions/:id"
                element={
                  <ProtectedRoute>
                    <SessionDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/courses/post-course"
                element={
                  <ProtectedRoute>
                    <PostCoursePage />
                  </ProtectedRoute>
                }
              />
              <Route path="/courses" element={<Navigate to="/courses/operations" replace />} />
              <Route path="/course-operations" element={<Navigate to="/courses/operations" replace />} />
              <Route path="/post-course" element={<Navigate to="/courses/post-course" replace />} />
              <Route path="/alumni" element={<Navigate to="/courses/post-course" replace />} />
              <Route
                path="/foundation"
                element={
                  <ProtectedRoute>
                    <FoundationStatusPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/leads"
                element={
                  <ProtectedRoute>
                    <LeadsListPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/leads/:id"
                element={
                  <ProtectedRoute>
                    <LeadDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/inbox"
                element={
                  <ProtectedRoute>
                    <InboxPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/pipeline"
                element={
                  <ProtectedRoute>
                    <PipelineKanbanPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/forms"
                element={
                  <ProtectedRoute>
                    <FormsListPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/forms/new"
                element={
                  <ProtectedRoute>
                    <FormBuilderPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/forms/:id"
                element={
                  <ProtectedRoute>
                    <FormBuilderPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/forms/:id/submissions"
                element={
                  <ProtectedRoute>
                    <FormSubmissionsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/automations"
                element={
                  <ProtectedRoute>
                    <AutomationsListPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/automations/new"
                element={
                  <ProtectedRoute>
                    <AutomationBuilderPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/automations/:id"
                element={
                  <ProtectedRoute>
                    <AutomationBuilderPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/automations/:id/runs"
                element={
                  <ProtectedRoute>
                    <AutomationRunsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/sequences"
                element={
                  <ProtectedRoute>
                    <SequencesListPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/sequences/new"
                element={
                  <ProtectedRoute>
                    <SequenceBuilderPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/sequences/:id"
                element={
                  <ProtectedRoute>
                    <SequenceBuilderPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/sequences/:id/runs"
                element={
                  <ProtectedRoute>
                    <AutomationRunsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/campaigns"
                element={
                  <ProtectedRoute>
                    <CampaignsListPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/campaigns/:id"
                element={
                  <ProtectedRoute>
                    <CampaignDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/templates"
                element={
                  <ProtectedRoute>
                    <TemplatesListPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <SystemSetupPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/scoring"
                element={
                  <ProtectedRoute>
                    <LeadScoringSettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings/lead-scoring"
                element={
                  <ProtectedRoute>
                    <LeadScoringSettingsPage />
                  </ProtectedRoute>
                }
              />

              {/* Catch-all redirect */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
