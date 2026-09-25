import React, { useState, useEffect } from 'react';
import { BookOpen, Calendar, FileText, Mail, CheckCircle2, Settings, Edit3 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { formatCohortDateRange } from '../../../utils/format';
import type { CourseSession } from '../../../types/database';
import { ManageCourseModal, type CourseData } from './ManageCourseModal';

interface CourseMaterialInfo {
  id: string;
  course_id: string;
  title: string;
  file_name: string;
}

interface CourseTemplateInfo {
  id: string;
  name: string;
  template_key: string;
}

interface CourseItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  sort_order: number;
  default_price?: number | null;
}

interface CourseCatalogOverviewWidgetProps {
  onOpenSessionModal?: (courseId: string) => void;
}

export const CourseCatalogOverviewWidget: React.FC<CourseCatalogOverviewWidgetProps> = ({
  onOpenSessionModal,
}) => {
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [materials, setMaterials] = useState<CourseMaterialInfo[]>([]);
  const [templates, setTemplates] = useState<CourseTemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Manage Course Modal state
  const [selectedCourse, setSelectedCourse] = useState<CourseData | null>(null);
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      // Load courses
      const { data: coursesData } = await supabase
        .from('courses')
        .select('id, code, name, description, active, sort_order, default_price')
        .eq('active', true)
        .order('sort_order', { ascending: true });

      // Load upcoming sessions
      const { data: sessionsData } = await supabase
        .from('course_sessions')
        .select('*')
        .gte('end_date', new Date().toISOString().slice(0, 10))
        .order('start_date', { ascending: true });

      // Load course materials
      const { data: materialsData } = await supabase
        .from('course_materials')
        .select('id, course_id, title, file_name')
        .eq('is_active', true);

      // Load email templates
      const { data: templatesData } = await supabase
        .from('email_templates')
        .select('id, name, template_key')
        .eq('is_active', true);

      setCourses(coursesData || []);
      setSessions(sessionsData || []);
      setMaterials(materialsData || []);
      setTemplates(templatesData || []);
    } catch (err) {
      console.error('Error loading course catalog overview:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenManageModal = (course: CourseItem) => {
    setSelectedCourse(course);
    setIsManageModalOpen(true);
  };

  if (loading && courses.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs animate-pulse">
        <div className="h-6 w-48 bg-slate-100 rounded mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-36 bg-slate-50 rounded-lg border border-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  // Helper to match template to course by code/name conventions
  const getAssociatedTemplate = (courseCode: string): CourseTemplateInfo | null => {
    const codeLower = courseCode.toLowerCase();
    if (codeLower === 'zit-01' || codeLower.includes('zygomatic')) {
      return templates.find((t) => t.template_key === 'zygomatic_course_details' || t.name.toLowerCase().includes('zygomatic')) || null;
    }
    return templates.find((t) => t.name.toLowerCase().includes(courseCode.toLowerCase())) || null;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <span>Cursos Oficiais</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Currículo acadêmico oficial, turmas ativas, materiais e templates associados
          </p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-blue-50 text-blue-700">
          {courses.length} cursos cadastrados
        </span>
      </div>

      <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {courses.map((course) => {
          // Find next upcoming session for this course
          const nextSession = sessions.find((s) => s.course_id === course.id);
          // Find material
          const material = materials.find((m) => m.course_id === course.id);
          // Find template
          const template = getAssociatedTemplate(course.code);

          return (
            <div
              key={course.id}
              className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-blue-300 hover:shadow-sm transition-all flex flex-col justify-between group"
            >
              <div>
                {/* Course Name & Code & Manage Button */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-bold text-slate-900 text-sm leading-snug group-hover:text-blue-900 transition-colors">
                      {course.name}
                    </h4>
                    <span className="inline-block mt-1 text-[10px] font-semibold tracking-wider text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                      {course.code}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenManageModal(course)}
                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50/50 transition-all text-xs font-semibold flex items-center gap-1 shrink-0 shadow-2xs cursor-pointer"
                    title="Gerenciar Curso e Materiais"
                  >
                    <Settings className="w-3.5 h-3.5 text-blue-600" />
                    <span className="hidden sm:inline">Gerenciar</span>
                  </button>
                </div>

                {/* Próxima Turma */}
                <div className="mt-3 pt-3 border-t border-slate-200/60 space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-slate-700">
                    <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
                    {nextSession ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-slate-900">
                          {formatCohortDateRange(nextSession.start_date, nextSession.end_date)}
                        </span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                          Aberta
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-400 italic">Sem turma agendada</span>
                    )}
                  </div>

                  {/* Material Associado */}
                  <div className="flex items-center gap-2 text-slate-600">
                    <FileText className="w-4 h-4 text-amber-500 shrink-0" />
                    {material ? (
                      <span className="font-medium text-slate-800 truncate" title={material.file_name}>
                        {material.file_name}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">Nenhum material configurado</span>
                    )}
                  </div>

                  {/* Template de E-mail */}
                  <div className="flex items-center gap-2 text-slate-600">
                    <Mail className="w-4 h-4 text-purple-500 shrink-0" />
                    {template ? (
                      <span className="font-medium text-slate-800 truncate" title={template.name}>
                        {template.name}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">Nenhum template configurado</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick Indicator & Action Links */}
              <div className="mt-4 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Ativo no catálogo
                </span>
                <button
                  type="button"
                  onClick={() => handleOpenManageModal(course)}
                  className="text-blue-600 font-semibold flex items-center hover:underline cursor-pointer"
                >
                  <Edit3 className="w-3 h-3 mr-1" />
                  Gerenciar Curso
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal de Gestão Completa de Curso */}
      <ManageCourseModal
        course={selectedCourse}
        isOpen={isManageModalOpen}
        onClose={() => {
          setIsManageModalOpen(false);
          setSelectedCourse(null);
        }}
        onCourseUpdated={() => {
          loadData();
        }}
        onOpenSessionModal={onOpenSessionModal}
      />
    </div>
  );
};

