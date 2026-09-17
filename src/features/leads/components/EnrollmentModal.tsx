// =============================================================================
// Enrollment Modal (Create / Edit Enrollment)
// =============================================================================

import React, { useState, useEffect } from 'react';
import { X, Calendar, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import type { Course, Enrollment, EnrollmentStatus, PaymentMethod, PaymentStatus, LeadSource } from '../../../types/database';
import { fetchCourses, createEnrollment, updateEnrollment } from '../../revenue/services/revenue-service';

interface EnrollmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
  leadSource?: LeadSource;
  existingEnrollment?: Enrollment | null;
  onSuccess: () => void;
}

export const EnrollmentModal: React.FC<EnrollmentModalProps> = ({
  isOpen,
  onClose,
  leadId,
  leadSource = 'manual',
  existingEnrollment,
  onSuccess,
}) => {
  const isEdit = !!existingEnrollment;

  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [enrollmentStatus, setEnrollmentStatus] = useState<EnrollmentStatus>('confirmed');
  const [agreedAmount, setAgreedAmount] = useState<string>('');
  const [currency] = useState('USD');
  const [enrollmentDate, setEnrollmentDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [notes, setNotes] = useState('');

  // Initial Payment (Create only)
  const [recordInitialPayment, setRecordInitialPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('paid');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit_card');

  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [idempotencyKey, setIdempotencyKey] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setIdempotencyKey(crypto.randomUUID());

    const loadCourses = async () => {
      setIsLoadingCourses(true);
      setError(null);
      try {
        const list = await fetchCourses();
        setCourses(list);

        if (existingEnrollment) {
          setSelectedCourseId(existingEnrollment.course_id);
          setEnrollmentStatus(existingEnrollment.enrollment_status);
          setAgreedAmount(String(existingEnrollment.agreed_amount));
          setEnrollmentDate(existingEnrollment.enrollment_date);
          setNotes(existingEnrollment.notes || '');
          setRecordInitialPayment(false);
        } else if (list.length > 0) {
          const first = list[0];
          setSelectedCourseId(first.id);
          setAgreedAmount(first.default_price !== null ? String(first.default_price) : '');
          setPaymentAmount(first.default_price !== null ? String(first.default_price) : '');
          setEnrollmentStatus('confirmed');
          setRecordInitialPayment(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao carregar catálogo de cursos');
      } finally {
        setIsLoadingCourses(false);
      }
    };

    loadCourses();
  }, [isOpen, existingEnrollment]);

  const handleCourseChange = (courseId: string) => {
    setSelectedCourseId(courseId);
    if (!isEdit) {
      const found = courses.find((c) => c.id === courseId);
      if (found && found.default_price !== null) {
        setAgreedAmount(String(found.default_price));
        setPaymentAmount(String(found.default_price));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const numericAmount = parseFloat(agreedAmount);
    if (isNaN(numericAmount) || numericAmount < 0) {
      setError('O valor acordado deve ser um número válido maior ou igual a zero.');
      return;
    }

    if (!selectedCourseId) {
      setError('Selecione um curso válido do catálogo.');
      return;
    }

    setIsSubmitting(true);

    try {
      if (isEdit && existingEnrollment) {
        await updateEnrollment({
          enrollmentId: existingEnrollment.id,
          courseId: selectedCourseId,
          enrollmentStatus,
          agreedAmount: numericAmount,
          enrollmentDate,
          notes: notes.trim() || undefined,
        });
      } else {
        const initPaymentNum = recordInitialPayment ? parseFloat(paymentAmount) : undefined;
        if (recordInitialPayment && (isNaN(initPaymentNum!) || initPaymentNum! <= 0)) {
          setError('O valor do pagamento inicial deve ser maior que zero.');
          setIsSubmitting(false);
          return;
        }

        await createEnrollment({
          leadId,
          courseId: selectedCourseId,
          enrollmentStatus,
          agreedAmount: numericAmount,
          currency,
          enrollmentDate,
          source: leadSource,
          notes: notes.trim() || undefined,
          idempotencyKey: idempotencyKey || crypto.randomUUID(),
          initialPaymentAmount: recordInitialPayment ? initPaymentNum : undefined,
          initialPaymentStatus: recordInitialPayment ? paymentStatus : undefined,
          initialPaymentMethod: recordInitialPayment ? paymentMethod : undefined,
          initialPaymentDate: enrollmentDate,
        });
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar matrícula.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200/90 w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-[#f8fafc]">
          <div>
            <h3 className="text-base font-bold text-[#08254f] font-heading">
              {isEdit ? 'Editar Matrícula' : 'Nova Matrícula Comercial'}
            </h3>
            <p className="text-xs text-slate-500">
              {isEdit
                ? 'Atualize os dados e status da matrícula do aluno'
                : 'Vincule um curso canônico e defina os termos financeiros'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200/80 rounded-xl flex items-start gap-2.5 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <span>{error}</span>
            </div>
          )}

          {isLoadingCourses ? (
            <div className="py-8 flex items-center justify-center gap-2 text-slate-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin text-[#125e95]" />
              Carregando catálogo de cursos...
            </div>
          ) : (
            <>
              {/* Course Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Curso Oficial <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedCourseId}
                  onChange={(e) => handleCourseChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:outline-hidden focus:ring-2 focus:ring-[#125e95]/20 focus:border-[#125e95] transition-all"
                  required
                >
                  <option value="" disabled>Selecione um curso...</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.default_price !== null ? `($${c.default_price.toLocaleString()})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status & Agreed Amount */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Status da Matrícula <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={enrollmentStatus}
                    onChange={(e) => setEnrollmentStatus(e.target.value as EnrollmentStatus)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:outline-hidden focus:ring-2 focus:ring-[#125e95]/20 focus:border-[#125e95] transition-all"
                    required
                  >
                    <option value="confirmed">Confirmada (Garante Vaga)</option>
                    <option value="pending">Pendente (Em Análise)</option>
                    <option value="cancelled">Cancelada (Desistência)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Valor Acordado (USD) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-xs">
                      $
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={agreedAmount}
                      onChange={(e) => setAgreedAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-7 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:outline-hidden focus:ring-2 focus:ring-[#125e95]/20 focus:border-[#125e95] transition-all"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Enrollment Date */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Data da Matrícula
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="date"
                    value={enrollmentDate}
                    onChange={(e) => setEnrollmentDate(e.target.value)}
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#125e95]/20 focus:border-[#125e95] transition-all"
                    required
                  />
                </div>
              </div>

              {/* Initial Payment Section (New only) */}
              {!isEdit && (
                <div className="pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-3">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
                      <input
                        type="checkbox"
                        checked={recordInitialPayment}
                        onChange={(e) => setRecordInitialPayment(e.target.checked)}
                        className="rounded-sm border-slate-300 text-[#125e95] focus:ring-[#125e95]"
                      />
                      <span>Registrar pagamento inicial com a matrícula</span>
                    </label>
                  </div>

                  {recordInitialPayment && (
                    <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200/80 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Valor Pago ($)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={paymentAmount}
                            onChange={(e) => setPaymentAmount(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-semibold focus:outline-hidden focus:border-[#125e95]"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Método de Pagamento
                          </label>
                          <select
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-hidden focus:border-[#125e95]"
                          >
                            <option value="credit_card">Cartão de Crédito</option>
                            <option value="wire_transfer">Transferência Bancária (Wire/Zelle)</option>
                            <option value="financing">Financiamento</option>
                            <option value="check">Cheque</option>
                            <option value="cash">Dinheiro</option>
                            <option value="other">Outro</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Status do Pagamento
                        </label>
                        <select
                          value={paymentStatus}
                          onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-hidden focus:border-[#125e95]"
                        >
                          <option value="paid">Liquidado / Pago (Paid)</option>
                          <option value="pending">Pendente (Aguardando compensação)</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Notas / Observações Comerciais
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Detalhes sobre negociação, descontos concedidos, termos acordados..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#125e95]/20 focus:border-[#125e95] transition-all"
                />
              </div>
            </>
          )}

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
              disabled={isSubmitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isLoadingCourses}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#125e95] hover:bg-[#08254f] shadow-xs flex items-center gap-2 transition-all disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Gravando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  {isEdit ? 'Salvar Alterações' : 'Confirmar Matrícula'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
