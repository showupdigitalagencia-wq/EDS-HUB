import React from 'react';
import { useNavigate } from 'react-router-dom';
import { UserCheck, UserPlus, Calendar } from 'lucide-react';
import type { UnassignedStudent } from '../../../types/database';

interface Props {
  students: UnassignedStudent[];
  onAssignStudent: (enrollmentId: string, leadId: string, studentName: string) => void;
}

export const UnassignedStudentsWidget: React.FC<Props> = ({ students, onAssignStudent }) => {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span>Students Awaiting Session Assignment</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
              {students.length}
            </span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Matrículas confirmadas aguardando definição de turma presencial
          </p>
        </div>
      </div>

      {students.length === 0 ? (
        <div className="p-10 text-center text-slate-400">
          <UserCheck className="w-10 h-10 mx-auto mb-2 text-emerald-400 stroke-[1.5]" />
          <p className="text-sm font-medium text-slate-700">Nenhum aluno sem turma</p>
          <p className="text-xs text-slate-400 mt-1">
            Todas as matrículas confirmadas já possuem turma atribuída.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500 tracking-wider">
              <tr>
                <th className="py-3 px-6">Student Name & Contacts</th>
                <th className="py-3 px-4">Course</th>
                <th className="py-3 px-4">Enrollment Date</th>
                <th className="py-3 px-4">Agreed Amount & Balance</th>
                <th className="py-3 px-6 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map((st) => (
                <tr key={st.enrollment_id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3.5 px-6">
                    <button
                      onClick={() => navigate(`/leads/${st.lead_id}`)}
                      className="font-semibold text-slate-900 hover:text-blue-600 transition-colors text-left"
                    >
                      {st.student_name}
                    </button>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {st.email || 'No email'} {st.phone ? `• ${st.phone}` : ''}
                    </div>
                  </td>

                  <td className="py-3.5 px-4">
                    <span className="font-medium text-slate-800">{st.course_name_snapshot}</span>
                  </td>

                  <td className="py-3.5 px-4 whitespace-nowrap text-xs text-slate-600">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>{st.enrollment_date}</span>
                    </div>
                  </td>

                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <div className="text-xs font-semibold text-slate-900">
                      ${st.agreed_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {st.outstanding_balance <= 0 ? (
                        <span className="text-emerald-600 font-medium">Fully Paid</span>
                      ) : (
                        <span className="text-amber-700 font-medium">
                          Balance: ${st.outstanding_balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="py-3.5 px-6 text-right whitespace-nowrap">
                    <button
                      onClick={() => onAssignStudent(st.enrollment_id, st.lead_id, st.student_name)}
                      className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Assign to Session</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
