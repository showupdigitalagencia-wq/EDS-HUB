import { useState } from 'react';
import { Info } from 'lucide-react';
import type { CoursesReportData, CoursePerformanceItem } from '../types/reporting';

interface CoursesTabProps {
  data: CoursesReportData;
  selectedCourseId?: string;
  onSelectCourse: (courseId: string | undefined) => void;
}

type CourseSortField = keyof CoursePerformanceItem;

export function CoursesTab({ data, selectedCourseId, onSelectCourse }: CoursesTabProps) {
  const [sortField, setSortField] = useState<CourseSortField>('net_revenue');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  const handleSort = (field: CourseSortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const sortedCourses = [...data.courses].sort((a, b) => {
    const valA = a[sortField];
    const valB = b[sortField];
    if (valA === null || valA === undefined) return sortAsc ? -1 : 1;
    if (valB === null || valB === undefined) return sortAsc ? 1 : -1;
    if (typeof valA === 'string' && typeof valB === 'string') {
      return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return sortAsc ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
  });

  return (
    <div className="space-y-8">
      {/* Course Filter Selector */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-[#08254f] uppercase tracking-wider">
            Course Filter
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Filter by specific course or view all</p>
        </div>
        <select
          value={selectedCourseId || ''}
          onChange={(e) => onSelectCourse(e.target.value || undefined)}
          className="text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-[#08254f] font-medium focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
        >
          <option value="">All Courses ({data.courses.length})</option>
          {data.courses.map((c) => (
            <option key={c.course_id} value={c.course_id}>
              {c.course_code} - {c.course_name}
            </option>
          ))}
        </select>
      </div>

      {/* Course Performance Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#08254f] uppercase tracking-wider">
              Course Performance Summary
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Sorted by <strong className="capitalize">{String(sortField).replace(/_/g, ' ')}</strong>
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] tracking-wider">
                <th
                  onClick={() => handleSort('course_name')}
                  className="py-3 px-4 font-semibold cursor-pointer hover:text-[#08254f]"
                >
                  Course {sortField === 'course_name' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('confirmed_enrollments')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  Enrollments {sortField === 'confirmed_enrollments' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('unique_students')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  Students {sortField === 'unique_students' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('new_students')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  New / Repeat
                </th>
                <th
                  onClick={() => handleSort('booked_revenue')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  Booked {sortField === 'booked_revenue' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('net_revenue')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  Net Revenue {sortField === 'net_revenue' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('current_outstanding_balance')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  Outstanding {sortField === 'current_outstanding_balance' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('attendance_rate')}
                  className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  <span className="inline-flex items-center gap-1">
                    Attendance
                    <span title="attended / (attended + no_show)" className="cursor-help">
                      <Info className="w-3 h-3 text-slate-400" />
                    </span>
                  </span>
                </th>
                <th
                  onClick={() => handleSort('completion_rate')}
                  className="py-3 px-4 font-semibold text-right cursor-pointer hover:text-[#08254f]"
                >
                  <span className="inline-flex items-center gap-1">
                    Completion
                    <span title="completed / (completed + incomplete)" className="cursor-help">
                      <Info className="w-3 h-3 text-slate-400" />
                    </span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedCourses.map((c) => (
                <tr key={c.course_id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-bold text-[#08254f]">{c.course_name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{c.course_code}</div>
                  </td>
                  <td className="py-3 px-3 text-right font-semibold text-[#08254f]">
                    {c.confirmed_enrollments}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-600">
                    {c.unique_students}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-600">
                    <span className="text-emerald-700 font-medium">{c.new_students}</span> /{' '}
                    <span className="text-purple-700 font-medium">{c.repeat_students}</span>
                  </td>
                  <td className="py-3 px-3 text-right text-blue-700 font-medium">
                    ${c.booked_revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-emerald-700">
                    ${c.net_revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-600">
                    ${c.current_outstanding_balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-right font-medium text-slate-700">
                    {c.attendance_rate !== null ? `${c.attendance_rate}%` : '—'}
                  </td>
                  <td className="py-3 px-4 text-right font-medium text-slate-700">
                    {c.completion_rate !== null ? `${c.completion_rate}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Session Performance Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-[#08254f] uppercase tracking-wider">
            Course Sessions (Turmas) Performance
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Operational attendance, completion, and revenue by cohort session
          </p>
        </div>

        {data.sessions.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">No sessions active or completed in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4 font-semibold">Session</th>
                  <th className="py-3 px-3 font-semibold">Course</th>
                  <th className="py-3 px-3 font-semibold">Dates</th>
                  <th className="py-3 px-3 font-semibold text-right">Students</th>
                  <th className="py-3 px-3 font-semibold text-right">Attendance</th>
                  <th className="py-3 px-3 font-semibold text-right">Completion</th>
                  <th className="py-3 px-4 font-semibold text-right">Net Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.sessions.map((s) => (
                  <tr key={s.session_id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-bold text-[#08254f]">
                      {s.session_title}
                      <div className="text-[10px] font-mono text-slate-400">{s.session_code}</div>
                    </td>
                    <td className="py-3 px-3 text-slate-600 truncate max-w-[150px]">
                      {s.course_name}
                    </td>
                    <td className="py-3 px-3 text-slate-500 text-[11px]">
                      {s.start_date} to {s.end_date}
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-slate-700">
                      {s.assigned_enrollments}
                      {s.capacity ? ` / ${s.capacity}` : ''}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-700">
                      {s.attendance_rate !== null ? `${s.attendance_rate}%` : '—'}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-700">
                      {s.completion_rate !== null ? `${s.completion_rate}%` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-700">
                      ${s.net_revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
