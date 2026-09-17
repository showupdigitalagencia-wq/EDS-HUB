// =============================================================================
// Lead Enrollment Card (Lead Detail Component)
// =============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  GraduationCap,
  Plus,
  Edit2,
  Calendar,
  ChevronDown,
  ChevronUp,
  CreditCard,
  AlertCircle,
  Loader2,
  Award,
} from 'lucide-react';
import type { Enrollment, EnrollmentPayment, LeadSource, PaymentStatus } from '../../../types/database';
import {
  fetchLeadEnrollments,
  formatCurrency,
} from '../../revenue/services/revenue-service';
import { EnrollmentModal } from './EnrollmentModal';
import { PaymentModal } from './PaymentModal';
import { AssignSessionModal } from '../../courses/components/AssignSessionModal';

interface LeadEnrollmentCardProps {
  leadId: string;
  leadSource?: LeadSource;
  onEnrollmentChanged?: () => void;
}

export const LeadEnrollmentCard: React.FC<LeadEnrollmentCardProps> = ({
  leadId,
  leadSource,
  onEnrollmentChanged,
}) => {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [isEnrollmentModalOpen, setIsEnrollmentModalOpen] = useState(false);
  const [editingEnrollment, setEditingEnrollment] = useState<Enrollment | null>(null);

  // Expanded accordions for payments
  const [expandedEnrollmentIds, setExpandedEnrollmentIds] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await fetchLeadEnrollments(leadId);
      setEnrollments(list);
      // Auto expand if only one
      if (list.length === 1) {
        setExpandedEnrollmentIds({ [list[0].id]: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar matrículas.');
    } finally {
      setIsLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleExpand = (id: string) => {
    setExpandedEnrollmentIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleOpenCreate = () => {
    setEditingEnrollment(null);
    setIsEnrollmentModalOpen(true);
  };

  const handleOpenEdit = (e: Enrollment) => {
    setEditingEnrollment(e);
    setIsEnrollmentModalOpen(true);
  };

  // Payment Modal State
  const [paymentModalEnrollment, setPaymentModalEnrollment] = useState<{
    id: string;
    courseName: string;
    suggestedAmount: number;
    mode?: 'payment' | 'refund';
    parentPayment?: EnrollmentPayment | null;
    maxRefundableAmount?: number;
  } | null>(null);

  const handleOpenAddPayment = (e: Enrollment) => {
    setPaymentModalEnrollment({
      id: e.id,
      courseName: e.course_name_snapshot,
      suggestedAmount: e.remaining_balance || 0,
      mode: 'payment',
    });
  };

  const handleOpenRefund = (e: Enrollment, parentPayment: EnrollmentPayment, maxRefund: number) => {
    setPaymentModalEnrollment({
      id: e.id,
      courseName: e.course_name_snapshot,
      suggestedAmount: maxRefund,
      mode: 'refund',
      parentPayment,
      maxRefundableAmount: maxRefund,
    });
  };

  const [assignSessionEnrollment, setAssignSessionEnrollment] = useState<{
    id: string;
    courseId: string;
    sessionId?: string | null;
  } | null>(null);

  const isRepeatStudent = enrollments.filter((e) => e.enrollment_status === 'confirmed').length >= 2;

  const sortedEnrollments = [...enrollments].sort((a, b) => {
    const aIsActive =
      a.enrollment_status === 'confirmed' &&
      (!a.participation || a.participation.completion_status !== 'completed');
    const bIsActive =
      b.enrollment_status === 'confirmed' &&
      (!b.participation || b.participation.completion_status !== 'completed');
    if (aIsActive && !bIsActive) return -1;
    if (!aIsActive && bIsActive) return 1;

    const aIsCompleted = a.participation?.completion_status === 'completed';
    const bIsCompleted = b.participation?.completion_status === 'completed';
    if (aIsCompleted && !bIsCompleted) return -1;
    if (!aIsCompleted && bIsCompleted) return 1;

    return new Date(b.enrollment_date).getTime() - new Date(a.enrollment_date).getTime();
  });

  const handleMutationSuccess = () => {
    loadData();
    if (onEnrollmentChanged) onEnrollmentChanged();
  };

  const getEnrollmentStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Confirmada
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
            Pendente
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
            Cancelada
          </span>
        );
      default:
        return null;
    }
  };

  const getPaymentStatusBadge = (status: PaymentStatus) => {
    switch (status) {
      case 'paid':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Pago
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
            Pendente
          </span>
        );
      case 'refunded':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            Reembolsado
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
            Cancelado
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
      {/* Card Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-[#f8fafc]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#08254f] text-[#449bd5] shadow-xs">
            <GraduationCap className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[#08254f] font-heading">
                Matrículas & Histórico Acadêmico
              </h3>
              {isRepeatStudent && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 shadow-2xs" title="Aluno com 2 ou mais matrículas confirmadas">
                  <Award className="w-3 h-3 text-amber-600" />
                  Repeat Student
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              Contratos acadêmicos, turmas vinculadas e registros financeiros
            </p>
          </div>
        </div>

        <button
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-[#125e95] hover:bg-[#08254f] shadow-xs transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          Nova Matrícula
        </button>
      </div>

      {/* Content */}
      <div className="p-6">
        {isLoading ? (
          <div className="py-8 flex items-center justify-center gap-2 text-slate-400 text-xs">
            <Loader2 className="w-4 h-4 animate-spin text-[#125e95]" />
            Carregando matrículas...
          </div>
        ) : error ? (
          <div className="p-3 bg-rose-50 border border-rose-200/80 rounded-xl flex items-start gap-2.5 text-xs text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        ) : enrollments.length === 0 ? (
          <div className="py-10 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
              <GraduationCap className="w-6 h-6" />
            </div>
            <h4 className="text-xs font-bold text-slate-800 mb-1">Nenhuma matrícula registrada</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
              Este lead ainda não concluiu uma matrícula comercial oficial. Clique no botão abaixo
              para formalizar um contrato.
            </p>
            <button
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#125e95] hover:bg-[#08254f] shadow-xs transition-all"
            >
              <Plus className="w-4 h-4" />
              Criar Primeira Matrícula
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedEnrollments.map((enr) => {
              const isExpanded = !!expandedEnrollmentIds[enr.id];
              const payments = enr.payments || [];

              return (
                <div
                  key={enr.id}
                  className="rounded-xl border border-slate-200/90 overflow-hidden bg-white shadow-xs transition-all hover:border-slate-300"
                >
                  {/* Enrollment Summary Row */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/40">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#08254f] font-heading">
                          {enr.course_name_snapshot}
                        </span>
                        {getEnrollmentStatusBadge(enr.enrollment_status)}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          {enr.enrollment_date}
                        </span>
                        <span>•</span>
                        <span className="capitalize text-slate-600 font-medium">
                          Origem: {enr.source}
                        </span>
                      </div>

                      {/* Course Session Linkage */}
                      {enr.session ? (
                        <div className="pt-1 flex items-center gap-2 flex-wrap text-xs">
                          <span className="font-semibold text-slate-700 font-mono bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                            {enr.session.code}
                          </span>
                          <span className="text-slate-700 font-medium">{enr.session.title}</span>
                          <span className="text-slate-400 font-mono text-[11px]">
                            ({enr.session.start_date} até {enr.session.end_date})
                          </span>
                          {enr.participation && (
                            <>
                              <span className="text-slate-300">•</span>
                              <span className="text-[11px] font-semibold text-slate-700 capitalize">
                                Presença: {enr.participation.attendance_status}
                              </span>
                              <span className="text-slate-300">•</span>
                              <span className="text-[11px] font-semibold text-slate-700 capitalize">
                                Status: {enr.participation.completion_status}
                              </span>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setAssignSessionEnrollment({
                                id: enr.id,
                                courseId: enr.course_id,
                                sessionId: enr.session?.id,
                              })
                            }
                            className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 ml-1 underline"
                          >
                            Trocar Turma
                          </button>
                        </div>
                      ) : enr.enrollment_status === 'confirmed' ? (
                        <div className="pt-1 flex items-center gap-2 text-xs">
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            Aguardando Turma
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setAssignSessionEnrollment({
                                id: enr.id,
                                courseId: enr.course_id,
                                sessionId: null,
                              })
                            }
                            className="px-2 py-0.5 rounded text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                          >
                            Atribuir Turma
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {/* Financial Metrics Badges */}
                    <div className="flex items-center flex-wrap gap-3 sm:gap-4">
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400 font-medium uppercase">Valor Acordado</div>
                        <div className="text-xs font-extrabold text-slate-800">
                          {formatCurrency(enr.agreed_amount, enr.currency)}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[10px] text-slate-400 font-medium uppercase">Total Pago</div>
                        <div className="text-xs font-extrabold text-emerald-600">
                          {formatCurrency(enr.paid_amount || 0, enr.currency)}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[10px] text-slate-400 font-medium uppercase">Saldo Restante</div>
                        <div
                          className={`text-xs font-extrabold ${
                            (enr.remaining_balance || 0) > 0 ? 'text-amber-600' : 'text-slate-400'
                          }`}
                        >
                          {formatCurrency(enr.remaining_balance || 0, enr.currency)}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
                        <button
                          onClick={() => handleOpenAddPayment(enr)}
                          title="Registrar Pagamento"
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#125e95] bg-[#e1f0fb] hover:bg-[#125e95] hover:text-white transition-all flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          Pagamento
                        </button>
                        <button
                          onClick={() => handleOpenEdit(enr)}
                          title="Editar Termos da Matrícula"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => toggleExpand(enr.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Section: Payments & Notes */}
                  {isExpanded && (
                    <div className="p-4 border-t border-slate-100 bg-white space-y-3 animate-in fade-in duration-150">
                      {enr.notes && (
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-600">
                          <span className="font-semibold text-slate-800 block mb-0.5">Observações:</span>
                          {enr.notes}
                        </div>
                      )}

                      {/* Payments Subtable */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                            <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                            Histórico de Pagamentos ({payments.length})
                          </h5>
                          <button
                            onClick={() => handleOpenAddPayment(enr)}
                            className="text-[11px] font-semibold text-[#125e95] hover:underline"
                          >
                            + Novo Pagamento
                          </button>
                        </div>

                        {payments.length === 0 ? (
                          <div className="py-4 text-center text-xs text-slate-400 bg-slate-50/50 rounded-lg">
                            Nenhum pagamento registrado nesta matrícula ainda.
                          </div>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-slate-200/80">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-[#f8fafc] text-slate-500 font-semibold border-b border-slate-200/80">
                                <tr>
                                  <th className="py-2 px-3">Data</th>
                                  <th className="py-2 px-3">Tipo</th>
                                  <th className="py-2 px-3">Valor</th>
                                  <th className="py-2 px-3">Status</th>
                                  <th className="py-2 px-3">Método</th>
                                  <th className="py-2 px-3">Ref / Notas</th>
                                  <th className="py-2 px-3 text-right">Ações</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-slate-700">
                                {payments.map((p) => {
                                  const isRefund = p.payment_type === 'refund';
                                  const refundsForThis = payments.filter(
                                    (r) => r.payment_type === 'refund' && r.parent_payment_id === p.id && r.payment_status === 'paid'
                                  );
                                  const totalRefunded = refundsForThis.reduce((s, r) => s + (Number(r.amount) || 0), 0);
                                  const refundableRemaining = Math.max((Number(p.amount) || 0) - totalRefunded, 0);

                                  return (
                                    <tr key={p.id} className={`hover:bg-slate-50/60 transition-colors ${isRefund ? 'bg-amber-50/30' : ''}`}>
                                      <td className="py-2 px-3 whitespace-nowrap font-medium text-slate-600">
                                        {p.payment_date}
                                      </td>
                                      <td className="py-2 px-3 whitespace-nowrap">
                                        {isRefund ? (
                                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                            Reembolso
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                                            Pagamento
                                          </span>
                                        )}
                                      </td>
                                      <td className={`py-2 px-3 whitespace-nowrap font-bold ${isRefund ? 'text-amber-700' : 'text-slate-900'}`}>
                                        {isRefund ? `-${formatCurrency(p.amount, p.currency)}` : formatCurrency(p.amount, p.currency)}
                                      </td>
                                      <td className="py-2 px-3 whitespace-nowrap">
                                        {getPaymentStatusBadge(p.payment_status)}
                                      </td>
                                      <td className="py-2 px-3 whitespace-nowrap capitalize text-slate-500 text-[11px]">
                                        {p.payment_method?.replace(/_/g, ' ') || '—'}
                                      </td>
                                      <td className="py-2 px-3 text-[11px] text-slate-500 max-w-[200px] truncate">
                                        {[p.external_reference, p.notes].filter(Boolean).join(' - ') || '—'}
                                      </td>
                                      <td className="py-2 px-3 text-right">
                                        {!isRefund && p.payment_status === 'paid' && refundableRemaining > 0 && (
                                          <button
                                            onClick={() => handleOpenRefund(enr, p, refundableRemaining)}
                                            title="Registrar Reembolso Integral ou Parcial"
                                            className="text-[11px] font-semibold text-amber-700 hover:text-amber-900 hover:underline"
                                          >
                                            Reembolsar
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      <EnrollmentModal
        isOpen={isEnrollmentModalOpen}
        onClose={() => setIsEnrollmentModalOpen(false)}
        leadId={leadId}
        leadSource={leadSource}
        existingEnrollment={editingEnrollment}
        onSuccess={handleMutationSuccess}
      />

      {paymentModalEnrollment && (
        <PaymentModal
          isOpen={true}
          onClose={() => setPaymentModalEnrollment(null)}
          enrollmentId={paymentModalEnrollment.id}
          courseName={paymentModalEnrollment.courseName}
          suggestedAmount={paymentModalEnrollment.suggestedAmount}
          mode={paymentModalEnrollment.mode || 'payment'}
          parentPayment={paymentModalEnrollment.parentPayment}
          maxRefundableAmount={paymentModalEnrollment.maxRefundableAmount}
          onSuccess={handleMutationSuccess}
        />
      )}

      {assignSessionEnrollment && (
        <AssignSessionModal
          isOpen={true}
          onClose={() => setAssignSessionEnrollment(null)}
          enrollmentId={assignSessionEnrollment.id}
          leadId={leadId}
          studentName=""
          courseId={assignSessionEnrollment.courseId}
          currentSessionId={assignSessionEnrollment.sessionId}
          onSuccess={handleMutationSuccess}
        />
      )}
    </div>
  );
};
