import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import {
  Calendar,
  Users,
  MapPin,
  User,
  ArrowLeft,
  Download,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Award,
} from 'lucide-react';
import {
  fetchCourseSessionDetail,
  exportRosterToCsv,
} from './services/course-operations-service';
import { AttendanceCompletionModal } from './components/AttendanceCompletionModal';
import { ChecklistManagerModal } from './components/ChecklistManagerModal';
import { AssignSessionModal } from './components/AssignSessionModal';
import { SessionModal } from './components/SessionModal';
import type {
  CourseSessionDetailData,
  SessionRosterStudent,
  AttendanceStatus,
  CompletionStatus,
} from '../../types/database';

export const SessionDetailPage: React.FC = () => {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<CourseSessionDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Modals
  const [selectedStudentForAttendance, setSelectedStudentForAttendance] =
    useState<SessionRosterStudent | null>(null);
  const [selectedStudentForChecklist, setSelectedStudentForChecklist] =
    useState<SessionRosterStudent | null>(null);
  const [selectedStudentForTransfer, setSelectedStudentForTransfer] =
    useState<SessionRosterStudent | null>(null);
  const [isEditSessionOpen, setIsEditSessionOpen] = useState(false);

  useEffect(() => {
    if (sessionId) {
      loadSessionDetail();
    }
  }, [sessionId]);

  const loadSessionDetail = async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCourseSessionDetail(sessionId);
      setData(res);
    } catch (err: any) {
      console.error('Error loading session detail:', err);
      setError(err.message || 'Failed to load session details.');
    } finally {
      setLoading(false);
    }
  };

  const handleExportCsv = () => {
    if (!data) return;
    exportRosterToCsv(
      {
        code: data.session.code,
        title: data.session.title,
        start_date: data.session.start_date,
      },
      data.roster
    );
  };

  const filteredRoster = (data?.roster || []).filter((st) => {
    const q = searchTerm.toLowerCase();
    return (
      st.student_name.toLowerCase().includes(q) ||
      (st.student_email || '').toLowerCase().includes(q) ||
      (st.student_phone || '').toLowerCase().includes(q)
    );
  });

  const getAttendanceBadge = (status: AttendanceStatus) => {
    switch (status) {
      case 'attended':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">Attended</span>;
      case 'no_show':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800">No Show</span>;
      case 'cancelled':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700">Cancelled</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800">Expected</span>;
    }
  };

  const getCompletionBadge = (status: CompletionStatus) => {
    switch (status) {
      case 'completed':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">Completed</span>;
      case 'incomplete':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800">Incomplete</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">Not Started</span>;
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-600">Carregando detalhes da turma...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button
          onClick={() => navigate('/courses/operations')}
          className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar para Course Operations</span>
        </button>
        <div className="p-6 rounded-xl bg-rose-50 border border-rose-200 text-rose-700">
          <p className="font-semibold">{error || 'Session not found.'}</p>
        </div>
      </div>
    );
  }

  const { session, course, roster } = data;

  return (
    <Layout
      backTo="/courses/operations"
      eyebrow="OPERAÇÕES ACADÊMICAS"
      title={`${session.code} — ${course.name}`}
      subtitle="Gestão da turma, lista de alunos confirmados, presença e certificação"
    >
      <div className="space-y-6">

      {/* Session Hero Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <Link
                to="/courses/operations"
                className="p-1.5 rounded-lg border border-slate-200/80 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors shadow-2xs shrink-0"
                title="Voltar para Turmas"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <span className="px-2.5 py-0.5 rounded-md font-mono text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200">
                {session.code}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-blue-100 text-blue-800">
                {session.status}
              </span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs font-semibold text-slate-600">{course.name}</span>
            </div>

            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{session.title}</h1>

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 pt-1">
              <div className="flex items-center gap-1.5 font-medium">
                <Calendar className="w-4 h-4 text-slate-400" />
                <span>{session.start_date} até {session.end_date}</span>
                <span className="text-slate-400 font-mono">({session.timezone})</span>
              </div>

              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-slate-400" />
                <span>{session.location || 'Orlando, FL'}</span>
              </div>

              {session.instructor_name && (
                <div className="flex items-center gap-1.5">
                  <User className="w-4 h-4 text-slate-400" />
                  <span>{session.instructor_name}</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsEditSessionOpen(true)}
              className="px-3 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg shadow-xs transition-colors"
            >
              Edit Session
            </button>
            <button
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg shadow-xs transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Export Roster CSV</span>
            </button>
          </div>
        </div>

        {/* Capacity & Operational Stat Bar */}
        <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              Enrolled Students
            </span>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-xl font-bold text-slate-900">{session.confirmed_students_count}</span>
              <span className="text-xs text-slate-500">
                / {session.capacity === null ? '∞' : session.capacity}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              Available Seats
            </span>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-xl font-bold text-slate-900">
                {session.capacity === null ? 'Unlimited' : session.available_seats ?? 0}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              Capacity Status
            </span>
            <div className="mt-1">
              {session.is_over_capacity ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-800">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  OVER CAPACITY
                </span>
              ) : session.is_at_capacity ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800">
                  <AlertCircle className="w-3.5 h-3.5" />
                  AT CAPACITY
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  SEATS AVAILABLE
                </span>
              )}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              Total Booked Value
            </span>
            <div className="mt-1">
              <span className="text-xl font-bold text-slate-900">
                $
                {roster
                  .reduce((sum, s) => sum + s.agreed_amount, 0)
                  .toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Roster Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Table Header / Search */}
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50/50">
          <div>
            <h2 className="text-base font-bold text-slate-900">Student Roster</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Lista oficial de participantes, conferência financeira, checklist e presença
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar aluno no roster..."
              className="w-full text-xs rounded-lg border border-slate-300 py-1.5 pl-3 pr-8 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {filteredRoster.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Users className="w-10 h-10 mx-auto mb-2 text-slate-300 stroke-[1.5]" />
            <p className="text-sm font-medium text-slate-600">Nenhum aluno neste roster</p>
            <p className="text-xs text-slate-400 mt-1">
              Atribua matrículas confirmadas a esta turma a partir de Course Operations.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                <tr>
                  <th className="py-3 px-6">Student</th>
                  <th className="py-3 px-4">Financials & Balance</th>
                  <th className="py-3 px-4">Pre-Course Checklist</th>
                  <th className="py-3 px-4">Attendance</th>
                  <th className="py-3 px-4">Completion</th>
                  <th className="py-3 px-4">Attention</th>
                  <th className="py-3 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRoster.map((st) => {
                  const checklistPct =
                    st.checklist_total > 0
                      ? Math.round((st.checklist_completed / st.checklist_total) * 100)
                      : 0;

                  return (
                    <tr key={st.enrollment_id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Student Info */}
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => navigate(`/leads/${st.lead_id}`)}
                            className="font-bold text-slate-900 hover:text-blue-600 transition-colors text-left"
                          >
                            {st.student_name}
                          </button>
                          {st.repeat_student && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200" title="Student with 2+ confirmed enrollments">
                              <Award className="w-3 h-3 text-amber-600" />
                              <span>Repeat</span>
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {st.student_email} {st.student_phone ? `• ${st.student_phone}` : ''}
                        </div>
                      </td>

                      {/* Financials & Balance */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <div className="text-xs font-semibold text-slate-900">
                          ${st.agreed_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>
                        <div className="text-[11px] mt-0.5">
                          {st.outstanding_balance <= 0 ? (
                            <span className="text-emerald-700 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Paid Full
                            </span>
                          ) : (
                            <span className="text-amber-700 font-medium">
                              Bal: ${st.outstanding_balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Checklist Progress */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <button
                          onClick={() => setSelectedStudentForChecklist(st)}
                          className="text-left group cursor-pointer"
                        >
                          <div className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1">
                            <span className="group-hover:text-blue-600 transition-colors">
                              {st.checklist_completed}/{st.checklist_total}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">{checklistPct}%</span>
                          </div>
                          <div className="w-24 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-full ${
                                checklistPct === 100 ? 'bg-emerald-500' : 'bg-blue-600'
                              }`}
                              style={{ width: `${checklistPct}%` }}
                            />
                          </div>
                        </button>
                      </td>

                      {/* Attendance */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <button
                          onClick={() => setSelectedStudentForAttendance(st)}
                          className="hover:opacity-80 transition-opacity"
                        >
                          {getAttendanceBadge(st.attendance_status)}
                        </button>
                      </td>

                      {/* Completion */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <button
                          onClick={() => setSelectedStudentForAttendance(st)}
                          className="hover:opacity-80 transition-opacity"
                        >
                          {getCompletionBadge(st.completion_status)}
                        </button>
                      </td>

                      {/* Attention */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        {st.needs_attention_reasons && st.needs_attention_reasons.length > 0 ? (
                          <div className="flex items-center gap-1 flex-wrap max-w-[150px]">
                            {st.needs_attention_reasons.map((r) => (
                              <span
                                key={r}
                                className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 text-rose-800"
                                title={r}
                              >
                                {r.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 font-medium">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-6 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedStudentForAttendance(st)}
                            className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                            title="Record Attendance & Completion"
                          >
                            Presença
                          </button>

                          <button
                            onClick={() => setSelectedStudentForChecklist(st)}
                            className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                            title="Manage Pre-Course Checklist"
                          >
                            Checklist
                          </button>

                          <button
                            onClick={() => setSelectedStudentForTransfer(st)}
                            className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded transition-colors"
                            title="Transfer student to another session"
                          >
                            Transfer
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedStudentForAttendance && (
        <AttendanceCompletionModal
          isOpen={!!selectedStudentForAttendance}
          onClose={() => setSelectedStudentForAttendance(null)}
          onSuccess={loadSessionDetail}
          enrollmentId={selectedStudentForAttendance.enrollment_id}
          studentName={selectedStudentForAttendance.student_name}
          currentAttendance={selectedStudentForAttendance.attendance_status}
          currentCompletion={selectedStudentForAttendance.completion_status}
        />
      )}

      {selectedStudentForChecklist && (
        <ChecklistManagerModal
          isOpen={!!selectedStudentForChecklist}
          onClose={() => setSelectedStudentForChecklist(null)}
          onSuccess={loadSessionDetail}
          studentName={selectedStudentForChecklist.student_name}
          items={selectedStudentForChecklist.checklist_items}
        />
      )}

      {selectedStudentForTransfer && (
        <AssignSessionModal
          isOpen={!!selectedStudentForTransfer}
          onClose={() => setSelectedStudentForTransfer(null)}
          onSuccess={loadSessionDetail}
          enrollmentId={selectedStudentForTransfer.enrollment_id}
          leadId={selectedStudentForTransfer.lead_id}
          studentName={selectedStudentForTransfer.student_name}
          courseId={course.id}
          currentSessionId={session.id}
        />
      )}

      <SessionModal
        isOpen={isEditSessionOpen}
        onClose={() => setIsEditSessionOpen(false)}
        onSuccess={loadSessionDetail}
        sessionToEdit={{
          id: session.id,
          code: session.code,
          title: session.title,
          status: session.status,
          start_date: session.start_date,
          end_date: session.end_date,
          timezone: session.timezone,
          capacity: session.capacity,
          location: session.location,
          instructor_name: session.instructor_name,
          course_id: course.id,
          course_name: course.name,
          course_code: course.code,
          confirmed_students_count: session.confirmed_students_count,
          available_seats: session.available_seats,
          unready_students_count: 0,
        }}
      />
      </div>
    </Layout>
  );
};
