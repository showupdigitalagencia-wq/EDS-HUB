import React from 'react';
import {
  GraduationCap,
  Clock,
  MessageSquare,
  Award,
  Sparkles,
  Users,
  TrendingUp,
} from 'lucide-react';
import type { PostCourseKpis } from '../../../types/database';

interface PostCourseKpisWidgetProps {
  kpis: PostCourseKpis;
}

export const PostCourseKpisWidget: React.FC<PostCourseKpisWidgetProps> = ({ kpis }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
      {/* 1. Completed Students */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs hover:border-blue-300 transition-all">
        <div className="flex items-center justify-between text-slate-500 mb-1.5">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-500">
            Concluídos
          </span>
          <GraduationCap className="w-4 h-4 text-[#125e95]" />
        </div>
        <div className="text-xl font-black text-slate-800 font-heading">
          {kpis.completed_students_count}
        </div>
        <p className="text-[10px] text-slate-400 mt-1 truncate">Alunos que concluíram</p>
      </div>

      {/* 2. Follow-Ups Due */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs hover:border-blue-300 transition-all">
        <div className="flex items-center justify-between text-slate-500 mb-1.5">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-500">
            Follow-Up
          </span>
          <Clock className="w-4 h-4 text-blue-600" />
        </div>
        <div className="text-xl font-black text-slate-800 font-heading">
          {kpis.followups_due_count}
        </div>
        <p className="text-[10px] text-slate-400 mt-1 truncate">
          {kpis.followups_overdue_count > 0 ? (
            <span className="text-rose-600 font-bold">
              {kpis.followups_overdue_count} atrasado(s)
            </span>
          ) : (
            'Em dia'
          )}
        </p>
      </div>

      {/* 3. Feedback Response Rate */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs hover:border-blue-300 transition-all">
        <div className="flex items-center justify-between text-slate-500 mb-1.5">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-500">
            Taxa Feedback
          </span>
          <MessageSquare className="w-4 h-4 text-indigo-600" />
        </div>
        <div className="text-xl font-black text-slate-800 font-heading">
          {kpis.feedback_response_rate !== null ? `${kpis.feedback_response_rate}%` : 'Sem dados'}
        </div>
        <p className="text-[10px] text-slate-400 mt-1 truncate">
          {kpis.feedback_received_count} recebido(s)
        </p>
      </div>

      {/* 4. Testimonial Response Rate */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs hover:border-blue-300 transition-all">
        <div className="flex items-center justify-between text-slate-500 mb-1.5">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-500">
            Taxa Depoim.
          </span>
          <Award className="w-4 h-4 text-amber-500" />
        </div>
        <div className="text-xl font-black text-slate-800 font-heading">
          {kpis.testimonial_response_rate !== null
            ? `${kpis.testimonial_response_rate}%`
            : 'Sem dados'}
        </div>
        <p className="text-[10px] text-slate-400 mt-1 truncate">
          {kpis.testimonials_received_count} obtido(s)
        </p>
      </div>

      {/* 5. Testimonial Opportunities */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs hover:border-amber-300 transition-all">
        <div className="flex items-center justify-between text-slate-500 mb-1.5">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-500">
            Oport. Depoim.
          </span>
          <Sparkles className="w-4 h-4 text-amber-600" />
        </div>
        <div className="text-xl font-black text-amber-700 font-heading">
          {kpis.testimonial_opportunities_count}
        </div>
        <p className="text-[10px] text-slate-400 mt-1 truncate">Feedback recebido</p>
      </div>

      {/* 6. Next Course Opportunities */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs hover:border-emerald-300 transition-all">
        <div className="flex items-center justify-between text-slate-500 mb-1.5">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-500">
            Próximo Curso
          </span>
          <TrendingUp className="w-4 h-4 text-emerald-600" />
        </div>
        <div className="text-xl font-black text-emerald-700 font-heading">
          {kpis.next_course_opportunities_count}
        </div>
        <p className="text-[10px] text-slate-400 mt-1 truncate">Interesse ativo</p>
      </div>

      {/* 7. Repeat Students */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs hover:border-blue-300 transition-all">
        <div className="flex items-center justify-between text-slate-500 mb-1.5">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-500">
            Repeat Students
          </span>
          <Users className="w-4 h-4 text-purple-600" />
        </div>
        <div className="text-xl font-black text-purple-700 font-heading">
          {kpis.repeat_students_count}
        </div>
        <p className="text-[10px] text-slate-400 mt-1 truncate">
          {kpis.repeat_student_rate !== null ? `${kpis.repeat_student_rate}% base` : 'Snapshot'}
        </p>
      </div>

      {/* 8. Alumni Total */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs hover:border-blue-300 transition-all">
        <div className="flex items-center justify-between text-slate-500 mb-1.5">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-500">
            Alumni
          </span>
          <Award className="w-4 h-4 text-[#08254f]" />
        </div>
        <div className="text-xl font-black text-[#08254f] font-heading">
          {kpis.alumni_students_count}
        </div>
        <p className="text-[10px] text-slate-400 mt-1 truncate">No pipeline Alumni</p>
      </div>
    </div>
  );
};
