import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  UserX,
  Clock,
  DollarSign,
  AlertCircle,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';
import type { CourseOperationsNeedsAttentionItem, NeedsAttentionReasonCode } from '../../../types/database';

interface Props {
  items: CourseOperationsNeedsAttentionItem[];
  onAssignStudent?: (enrollmentId: string, leadId: string, studentName: string) => void;
}

export const OperationalNeedsAttentionWidget: React.FC<Props> = ({ items, onAssignStudent }) => {
  const navigate = useNavigate();
  const [selectedReason, setSelectedReason] = useState<string>('all');

  const reasonConfig: Record<
    NeedsAttentionReasonCode,
    { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
  > = {
    ENROLLMENT_WITHOUT_SESSION: {
      label: 'Awaiting Session',
      icon: UserX,
      color: 'bg-amber-100 text-amber-800 border-amber-200',
    },
    SESSION_CANCELLED_REASSIGNMENT_REQUIRED: {
      label: 'Session Cancelled (Reassign)',
      icon: RotateCcw,
      color: 'bg-rose-100 text-rose-800 border-rose-200',
    },
    UPCOMING_SESSION_UNREADY: {
      label: 'Upcoming Unready',
      icon: Clock,
      color: 'bg-orange-100 text-orange-800 border-orange-200',
    },
    PAYMENT_OUTSTANDING: {
      label: 'Payment Due',
      icon: DollarSign,
      color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    },
    NO_SHOW: {
      label: 'No Show',
      icon: AlertTriangle,
      color: 'bg-red-100 text-red-800 border-red-200',
    },
    POST_COURSE_FOLLOWUP_DUE: {
      label: 'Post-Course Follow-up',
      icon: CheckCircle2,
      color: 'bg-blue-100 text-blue-800 border-blue-200',
    },
    MISSING_REQUIRED_ITEM: {
      label: 'Missing Requirement',
      icon: AlertCircle,
      color: 'bg-purple-100 text-purple-800 border-purple-200',
    },
  };

  const filteredItems =
    selectedReason === 'all'
      ? items
      : items.filter((i) => i.reason_code === selectedReason);

  const countsByReason = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.reason_code] = (acc[item.reason_code] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span>Operational Needs Attention</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">
              {items.length}
            </span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Pendências acadêmicas, financeiras e operacionais que exigem intervenção
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
          <button
            onClick={() => setSelectedReason('all')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
              selectedReason === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All ({items.length})
          </button>
          {Object.entries(countsByReason).map(([reason, count]) => {
            const cfg = reasonConfig[reason as NeedsAttentionReasonCode];
            const isSelected = selectedReason === reason;
            return (
              <button
                key={reason}
                onClick={() => setSelectedReason(reason)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1 border ${
                  isSelected
                    ? 'bg-slate-900 text-white border-slate-900'
                    : `${cfg?.color || 'bg-slate-100 text-slate-700'} hover:opacity-80`
                }`}
              >
                <span>{cfg?.label || reason}</span>
                <span className="font-bold">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="p-10 text-center text-slate-400">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-400 stroke-[1.5]" />
          <p className="text-sm font-medium text-slate-700">Tudo em dia!</p>
          <p className="text-xs text-slate-400 mt-1">
            Nenhuma pendência operacional encontrada nesta categoria.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {filteredItems.map((item, idx) => {
            const cfg = reasonConfig[item.reason_code];
            const Icon = cfg?.icon || AlertCircle;

            return (
              <div
                key={`${item.enrollment_id}-${item.reason_code}-${idx}`}
                className="px-6 py-3.5 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${
                      cfg?.color || 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => navigate(`/leads/${item.lead_id}`)}
                        className="text-sm font-semibold text-slate-900 hover:text-blue-600 transition-colors text-left"
                      >
                        {item.student_name}
                      </button>
                      <span className="text-xs text-slate-400">•</span>
                      <span className="text-xs text-slate-600 font-medium truncate max-w-[200px]">
                        {item.course_name}
                      </span>
                      {item.session_code && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-100 text-slate-700">
                          {item.session_code}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{item.message}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {item.reason_code === 'ENROLLMENT_WITHOUT_SESSION' ||
                  item.reason_code === 'SESSION_CANCELLED_REASSIGNMENT_REQUIRED' ? (
                    onAssignStudent && (
                      <button
                        onClick={() =>
                          onAssignStudent(item.enrollment_id, item.lead_id, item.student_name)
                        }
                        className="px-3 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                      >
                        Assign Session
                      </button>
                    )
                  ) : item.session_id ? (
                    <button
                      onClick={() => navigate(`/courses/sessions/${item.session_id}`)}
                      className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                    >
                      View Session
                    </button>
                  ) : null}

                  <button
                    onClick={() => navigate(`/leads/${item.lead_id}`)}
                    className="px-2.5 py-1 text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors"
                  >
                    View Lead
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
