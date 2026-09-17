import React, { useState, useEffect, useCallback } from 'react';
import {
  Award,
  RefreshCw,
  Download,
  AlertCircle,
  Clock,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  fetchPostCourseDashboard,
  exportFollowupsCSV,
  exportTestimonialOpportunitiesCSV,
  exportNextCourseOpportunitiesCSV,
  exportAlumniDirectoryCSV,
  downloadCSV,
} from './services/post-course-service';
import type { PostCourseDashboardData } from '../../types/database';
import { PostCourseKpisWidget } from './components/PostCourseKpisWidget';
import { FollowUpQueueWidget } from './components/FollowUpQueueWidget';
import { TestimonialOpportunitiesWidget } from './components/TestimonialOpportunitiesWidget';
import { NextCourseOpportunitiesWidget } from './components/NextCourseOpportunitiesWidget';
import { AlumniDirectoryWidget } from './components/AlumniDirectoryWidget';
import { PostCourseEngagementModal, type ModalMode } from './components/PostCourseEngagementModal';

export const PostCoursePage: React.FC = () => {
  const [data, setData] = useState<PostCourseDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'followups' | 'feedback_testimonials' | 'next_course' | 'alumni'
  >('overview');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalEngagementId, setModalEngagementId] = useState('');
  const [modalMode, setModalMode] = useState<ModalMode>('followup');
  const [modalLeadId, setModalLeadId] = useState<string | undefined>(undefined);
  const [modalStudentName, setModalStudentName] = useState<string | undefined>(undefined);
  const [modalCourseName, setModalCourseName] = useState<string | undefined>(undefined);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchPostCourseDashboard();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar dados do pós-curso.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenEngagementModal = (
    engagementId: string,
    initialMode: ModalMode = 'followup'
  ) => {
    setModalEngagementId(engagementId);
    setModalMode(initialMode);

    // Find student name and course if in followup queue or testimonials
    const found =
      data?.followup_queue.find((f) => f.engagement_id === engagementId) ||
      data?.testimonial_opportunities.find((t) => t.engagement_id === engagementId);

    if (found) {
      setModalLeadId(found.lead_id);
      setModalStudentName(found.student_name);
      setModalCourseName(found.course_name);
    } else {
      setModalLeadId(undefined);
      setModalStudentName(undefined);
      setModalCourseName(undefined);
    }

    setIsModalOpen(true);
  };

  const handleExport = (type: 'followups' | 'testimonials' | 'next_course' | 'alumni') => {
    if (!data) return;
    const dateStr = new Date().toISOString().slice(0, 10);
    switch (type) {
      case 'followups':
        downloadCSV(exportFollowupsCSV(data.followup_queue), `eds_post_course_followups_${dateStr}.csv`);
        break;
      case 'testimonials':
        downloadCSV(
          exportTestimonialOpportunitiesCSV(data.testimonial_opportunities),
          `eds_testimonial_opportunities_${dateStr}.csv`
        );
        break;
      case 'next_course':
        downloadCSV(
          exportNextCourseOpportunitiesCSV(data.next_course_opportunities),
          `eds_next_course_opportunities_${dateStr}.csv`
        );
        break;
      case 'alumni':
        downloadCSV(exportAlumniDirectoryCSV(data.alumni_directory), `eds_alumni_directory_${dateStr}.csv`);
        break;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 font-heading flex items-center gap-2.5">
            <Award className="w-6 h-6 text-[#125e95]" />
            Pós-Curso & Alumni
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Acompanhamento de satisfação, coleta de depoimentos, oportunidades de próximo curso e comunidade Alumni
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Export Menu */}
          <div className="relative group">
            <button className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 shadow-xs">
              <Download className="w-3.5 h-3.5 text-slate-500" />
              Exportar CSV
            </button>
            <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-lg p-1 hidden group-hover:block z-20 animate-in fade-in duration-100">
              <button
                onClick={() => handleExport('followups')}
                className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 rounded-lg font-medium"
              >
                Fila de Follow-Ups
              </button>
              <button
                onClick={() => handleExport('testimonials')}
                className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 rounded-lg font-medium"
              >
                Depoimentos & Feedback
              </button>
              <button
                onClick={() => handleExport('next_course')}
                className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 rounded-lg font-medium"
              >
                Oportunidades Próximo Curso
              </button>
              <button
                onClick={() => handleExport('alumni')}
                className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 rounded-lg font-medium"
              >
                Diretório Alumni
              </button>
            </div>
          </div>

          {/* Refresh Button */}
          <button
            onClick={loadData}
            disabled={isLoading}
            className="p-2 text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-xs"
            title="Atualizar Dados"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#125e95]' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPIs Widget */}
      {data && <PostCourseKpisWidget kpis={data.kpis} />}

      {/* Navigation Tabs */}
      <div className="border-b border-slate-200 flex gap-2">
        <button
          onClick={() => setActiveTab('overview')}
          className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'overview'
              ? 'border-[#125e95] text-[#125e95]'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Visão Geral
        </button>
        <button
          onClick={() => setActiveTab('followups')}
          className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'followups'
              ? 'border-[#125e95] text-[#125e95]'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          Fila de Follow-Up
          {data && data.kpis.followups_due_count > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 text-blue-800">
              {data.kpis.followups_due_count}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('feedback_testimonials')}
          className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'feedback_testimonials'
              ? 'border-[#125e95] text-[#125e95]'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Award className="w-3.5 h-3.5" />
          Depoimentos & Feedback
          {data && data.kpis.testimonial_opportunities_count > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 text-amber-800">
              {data.kpis.testimonial_opportunities_count}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('next_course')}
          className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'next_course'
              ? 'border-[#125e95] text-[#125e95]'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          Próximo Curso
          {data && data.kpis.next_course_opportunities_count > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-800">
              {data.kpis.next_course_opportunities_count}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('alumni')}
          className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'alumni'
              ? 'border-[#125e95] text-[#125e95]'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          Comunidade Alumni
          {data && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 text-slate-800">
              {data.kpis.alumni_students_count}
            </span>
          )}
        </button>
      </div>

      {/* TAB CONTENT */}
      {data && (
        <>
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Needs Attention Alert List */}
              {data.needs_attention && data.needs_attention.length > 0 && (
                <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle className="w-4 h-4 text-amber-700" />
                    <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                      Itens de Atenção Pós-Curso ({data.needs_attention.length})
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {data.needs_attention.map((item, idx) => (
                      <div
                        key={`${item.reason_code}-${idx}`}
                        className="bg-white p-3 rounded-lg border border-amber-200/80 text-xs shadow-2xs flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-slate-800">{item.student_name}</span>
                            <span
                              className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                                item.severity === 'warning'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {item.reason_code.replace('POST_COURSE_', '')}
                            </span>
                          </div>
                          <p className="text-slate-600 text-[11px] mb-2">{item.message}</p>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Curso: {item.course_name}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Two Column Layout: Follow-ups Due & Next Course Opportunities */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <FollowUpQueueWidget
                  items={data.followup_queue.slice(0, 10)}
                  onOpenEngagementModal={handleOpenEngagementModal}
                />
                <TestimonialOpportunitiesWidget
                  items={data.testimonial_opportunities.slice(0, 10)}
                  onOpenEngagementModal={handleOpenEngagementModal}
                />
              </div>

              {/* Next Course Opportunities Snippet */}
              <NextCourseOpportunitiesWidget
                items={data.next_course_opportunities.slice(0, 10)}
              />
            </div>
          )}

          {activeTab === 'followups' && (
            <FollowUpQueueWidget
              items={data.followup_queue}
              onOpenEngagementModal={handleOpenEngagementModal}
            />
          )}

          {activeTab === 'feedback_testimonials' && (
            <TestimonialOpportunitiesWidget
              items={data.testimonial_opportunities}
              onOpenEngagementModal={handleOpenEngagementModal}
            />
          )}

          {activeTab === 'next_course' && (
            <NextCourseOpportunitiesWidget
              items={data.next_course_opportunities}
            />
          )}

          {activeTab === 'alumni' && (
            <AlumniDirectoryWidget items={data.alumni_directory} />
          )}
        </>
      )}

      {/* Engagement Modal */}
      <PostCourseEngagementModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={loadData}
        engagementId={modalEngagementId}
        initialMode={modalMode}
        leadId={modalLeadId}
        studentName={modalStudentName}
        courseName={modalCourseName}
      />
    </div>
  );
};
