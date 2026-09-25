import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import {
  Plus,
  RefreshCw,
  AlertTriangle,
  UserCheck,
  Clock,
  Layers,
  Award,
} from 'lucide-react';
import {
  fetchCourseOperationsDashboard,
  fetchAllCourseSessions,
} from './services/course-operations-service';
import { CourseOperationsKpisWidget } from './components/CourseOperationsKpisWidget';
import { UpcomingSessionsWidget } from './components/UpcomingSessionsWidget';
import { OperationalNeedsAttentionWidget } from './components/OperationalNeedsAttentionWidget';
import { UnassignedStudentsWidget } from './components/UnassignedStudentsWidget';
import { CourseCatalogOverviewWidget } from './components/CourseCatalogOverviewWidget';
import { SessionModal } from './components/SessionModal';
import { AssignSessionModal } from './components/AssignSessionModal';
import type {
  CourseOperationsDashboardData,
  UpcomingSessionSummary,
  CourseSession,
} from '../../types/database';

export const CourseOperationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<CourseOperationsDashboardData | null>(null);
  const [allSessions, setAllSessions] = useState<CourseSession[]>([]);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'attention' | 'unassigned' | 'all'>('upcoming');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal States
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [sessionToEdit, setSessionToEdit] = useState<UpcomingSessionSummary | null>(null);

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignStudentData, setAssignStudentData] = useState<{
    enrollmentId: string;
    leadId: string;
    studentName: string;
    courseId: string;
  } | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCourseOperationsDashboard();
      setData(res);
    } catch (err: any) {
      console.error('Error loading course operations dashboard:', err);
      setError(err.message || 'Erro ao carregar painel de operações de cursos.');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetchCourseOperationsDashboard();
      setData(res);
      if (activeTab === 'all') {
        const sess = await fetchAllCourseSessions();
        setAllSessions(sess);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  const handleTabChange = async (tab: 'upcoming' | 'attention' | 'unassigned' | 'all') => {
    setActiveTab(tab);
    if (tab === 'all' && allSessions.length === 0) {
      try {
        const sess = await fetchAllCourseSessions();
        setAllSessions(sess);
      } catch (err) {
        console.error('Error fetching all sessions:', err);
      }
    }
  };

  const handleOpenAssignModal = (enrollmentId: string, leadId: string, studentName: string) => {
    const found =
      data?.unassigned_students.find((s) => s.enrollment_id === enrollmentId) ||
      data?.needs_attention.find((i) => i.enrollment_id === enrollmentId);

    setAssignStudentData({
      enrollmentId,
      leadId,
      studentName,
      courseId: (found as any)?.course_id || '',
    });
    setIsAssignModalOpen(true);
  };

  const handleEditSession = (session: UpcomingSessionSummary) => {
    setSessionToEdit(session);
    setIsSessionModalOpen(true);
  };

  const handleCreateSession = () => {
    setSessionToEdit(null);
    setIsSessionModalOpen(true);
  };

  return (
    <Layout
      eyebrow="OPERAÇÕES ACADÊMICAS"
      title="Cursos & Turmas"
      subtitle="Gestão de cursos oficiais, turmas presenciais, alocação de estudantes e materiais"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn-secondary text-xs p-2"
            title="Atualizar dados"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-[#08254f]' : ''}`} />
          </button>

          <Link
            to="/courses/post-course"
            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <Award className="w-3.5 h-3.5 text-amber-500" />
            <span>Pós-Curso & Alumni</span>
          </Link>

          <button
            onClick={handleCreateSession}
            className="btn-crimson text-xs px-3 py-1.5 flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nova Turma</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={loadDashboard}
            className="text-xs font-semibold text-rose-800 underline hover:no-underline"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-24 text-center">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600">Carregando Cursos & Operações...</p>
        </div>
      ) : data ? (
        <>
          {/* Official Courses Catalog Overview */}
          <CourseCatalogOverviewWidget />

          {/* Operational KPIs */}
          <CourseOperationsKpisWidget
            kpis={data.kpis}
            onFilterNeedsAttention={() => setActiveTab('attention')}
            onFilterUnassigned={() => setActiveTab('unassigned')}
          />

          {/* Tab Navigation */}
          <div className="flex border-b border-slate-200 space-x-6">
            <button
              onClick={() => handleTabChange('upcoming')}
              className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-all ${
                activeTab === 'upcoming'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>Turmas Agendadas ({data.upcoming_sessions.length})</span>
            </button>

            <button
              onClick={() => handleTabChange('attention')}
              className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-all ${
                activeTab === 'attention'
                  ? 'border-rose-600 text-rose-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
              <span>Atenção Operacional ({data.needs_attention.length})</span>
            </button>

            <button
              onClick={() => handleTabChange('unassigned')}
              className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-all ${
                activeTab === 'unassigned'
                  ? 'border-amber-600 text-amber-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>Aguardando Turma ({data.unassigned_students.length})</span>
            </button>

            <button
              onClick={() => handleTabChange('all')}
              className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-all ${
                activeTab === 'all'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Todas as Turmas</span>
            </button>
          </div>

          {/* Tab Content */}
          <div>
            {activeTab === 'upcoming' && (
              <UpcomingSessionsWidget
                sessions={data.upcoming_sessions}
                onEditSession={handleEditSession}
              />
            )}

            {activeTab === 'attention' && (
              <OperationalNeedsAttentionWidget
                items={data.needs_attention}
                onAssignStudent={handleOpenAssignModal}
              />
            )}

            {activeTab === 'unassigned' && (
              <UnassignedStudentsWidget
                students={data.unassigned_students}
                onAssignStudent={handleOpenAssignModal}
              />
            )}

            {activeTab === 'all' && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-900">Todas as Turmas</h3>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-100 text-slate-600">
                    {allSessions.length} no total
                  </span>
                </div>
                <div className="divide-y divide-slate-100 overflow-x-auto">
                  <table className="w-full text-left text-sm text-slate-600">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500 tracking-wider">
                      <tr>
                        <th className="py-3 px-6">Turma & Curso</th>
                        <th className="py-3 px-4">Período</th>
                        <th className="py-3 px-4">Local</th>
                        <th className="py-3 px-4">Capacidade</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-6 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {allSessions.map((s) => (
                        <tr
                          key={s.id}
                          className="hover:bg-slate-50 cursor-pointer"
                          onClick={() => navigate(`/courses/sessions/${s.id}`)}
                        >
                          <td className="py-3.5 px-6 font-semibold text-slate-900">
                            <div>{s.title}</div>
                            <div className="text-xs font-mono text-slate-500">{s.code}</div>
                          </td>
                          <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                            {s.start_date} até {s.end_date}
                          </td>
                          <td className="py-3.5 px-4 text-xs">{s.location || 'Orlando, FL'}</td>
                          <td className="py-3.5 px-4 text-xs font-semibold">
                            {s.capacity === null ? 'Ilimitada' : s.capacity}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="px-2 py-0.5 rounded text-xs font-semibold uppercase bg-slate-100 text-slate-700">
                              {s.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-6 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/courses/sessions/${s.id}`);
                              }}
                              className="px-3 py-1 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded"
                            >
                              Ver Turma
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      ) : null}

      {/* Modals */}
      <SessionModal
        isOpen={isSessionModalOpen}
        onClose={() => setIsSessionModalOpen(false)}
        onSuccess={handleRefresh}
        sessionToEdit={sessionToEdit}
      />

      {assignStudentData && (
        <AssignSessionModal
          isOpen={isAssignModalOpen}
          onClose={() => {
            setIsAssignModalOpen(false);
            setAssignStudentData(null);
          }}
          onSuccess={handleRefresh}
          enrollmentId={assignStudentData.enrollmentId}
          leadId={assignStudentData.leadId}
          studentName={assignStudentData.studentName}
          courseId={assignStudentData.courseId}
        />
      )}
      </div>
    </Layout>
  );
};
