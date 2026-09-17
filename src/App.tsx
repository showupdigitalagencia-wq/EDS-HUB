import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './features/auth/AuthProvider';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './features/auth/LoginPage';
import { FoundationStatusPage } from './features/dashboard/FoundationStatusPage';
import { SystemSetupPage } from './features/settings/SystemSetupPage';
import { LeadsListPage } from './features/leads/LeadsListPage';
import { LeadDetailPage } from './features/leads/LeadDetailPage';
import { PipelineKanbanPage } from './features/pipeline/PipelineKanbanPage';
import { CampaignsListPage } from './features/campaigns/CampaignsListPage';
import { CampaignDetailPage } from './features/campaigns/CampaignDetailPage';
import { TemplatesListPage } from './features/templates/TemplatesListPage';
import { FormsListPage } from './features/forms/FormsListPage';
import { FormBuilderPage } from './features/forms/FormBuilderPage';
import { FormSubmissionsPage } from './features/forms/FormSubmissionsPage';
import { PublicFormPage } from './features/forms/public/PublicFormPage';
import { AutomationsListPage } from './features/automations/AutomationsListPage';
import { AutomationBuilderPage } from './features/automations/AutomationBuilderPage';
import { AutomationRunsPage } from './features/automations/AutomationRunsPage';
import { SequencesListPage } from './features/sequences/SequencesListPage';
import { SequenceBuilderPage } from './features/sequences/SequenceBuilderPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/f/:slug" element={<PublicFormPage />} />

          {/* Protected routes */}
          <Route
            path="/"
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

          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
