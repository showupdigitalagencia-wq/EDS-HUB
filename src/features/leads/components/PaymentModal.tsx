// =============================================================================
// Payment Modal (Record Payment or Refund on Enrollment)
// =============================================================================

import React, { useState, useEffect } from 'react';
import { X, Calendar, CheckCircle2, AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import type { PaymentMethod, PaymentStatus, EnrollmentPayment } from '../../../types/database';
import { recordPayment, recordRefund, formatCurrency } from '../../revenue/services/revenue-service';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  enrollmentId: string;
  courseName: string;
  suggestedAmount?: number;
  mode?: 'payment' | 'refund';
  parentPayment?: EnrollmentPayment | null;
  maxRefundableAmount?: number;
  onSuccess: () => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  enrollmentId,
  courseName,
  suggestedAmount = 0,
  mode = 'payment',
  parentPayment,
  maxRefundableAmount,
  onSuccess,
}) => {
  const isRefund = mode === 'refund';
  const maxRefund = maxRefundableAmount ?? parentPayment?.amount ?? 0;

  const [amount, setAmount] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('paid');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit_card');
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [externalReference, setExternalReference] = useState('');
  const [notes, setNotes] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setIdempotencyKey(crypto.randomUUID());
      if (isRefund) {
        setAmount(maxRefund > 0 ? String(maxRefund) : '');
        setNotes('Reembolso solicitado pelo cliente.');
      } else {
        setAmount(suggestedAmount > 0 ? String(suggestedAmount) : '');
        setPaymentStatus('paid');
        setNotes('');
      }
    }
  }, [isOpen, isRefund, maxRefund, suggestedAmount]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setError('O valor deve ser um número maior que zero.');
      return;
    }

    if (isRefund && numericAmount > maxRefund) {
      setError(`O valor do reembolso não pode exceder o saldo reembolsável de ${formatCurrency(maxRefund)}.`);
      return;
    }

    setIsSubmitting(true);

    try {
      if (isRefund && parentPayment) {
        await recordRefund({
          parentPaymentId: parentPayment.id,
          amount: numericAmount,
          reason: notes.trim() || undefined,
          idempotencyKey,
        });
      } else {
        await recordPayment({
          enrollmentId,
          amount: numericAmount,
          currency: 'USD',
          paymentStatus,
          paymentDate,
          paymentMethod,
          externalReference: externalReference.trim() || undefined,
          notes: notes.trim() || undefined,
          idempotencyKey,
        });
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao processar transação financeira.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200/90 w-full max-w-md overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-[#f8fafc]">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl ${isRefund ? 'bg-amber-100 text-amber-700' : 'bg-[#125e95]/10 text-[#125e95]'}`}>
              {isRefund ? <RotateCcw className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-[#08254f] font-heading">
                {isRefund ? 'Registrar Reembolso' : 'Registrar Pagamento'}
              </h3>
              <p className="text-xs text-slate-500 truncate max-w-[280px]">
                {courseName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200/80 rounded-xl flex items-start gap-2.5 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <span>{error}</span>
            </div>
          )}

          {isRefund && parentPayment && (
            <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-xl text-xs space-y-1">
              <div className="text-amber-900 font-bold">Pagamento Original</div>
              <div className="text-amber-800 flex justify-between">
                <span>Valor Original:</span>
                <span className="font-semibold">{formatCurrency(parentPayment.amount, parentPayment.currency)}</span>
              </div>
              <div className="text-amber-800 flex justify-between">
                <span>Limite Reembolsável:</span>
                <span className="font-bold text-amber-950">{formatCurrency(maxRefund, parentPayment.currency)}</span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {isRefund ? 'Valor do Reembolso (USD)' : 'Valor do Pagamento (USD)'} <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-xs">
                $
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={isRefund ? maxRefund : undefined}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full pl-7 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:outline-hidden focus:ring-2 focus:ring-[#125e95]/20 focus:border-[#125e95] transition-all"
                required
                autoFocus
              />
            </div>
          </div>

          {!isRefund && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Situação <span className="text-rose-500">*</span>
                </label>
                <select
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:outline-hidden focus:border-[#125e95]"
                >
                  <option value="paid">Liquidado / Pago</option>
                  <option value="pending">Pendente</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Método de Pagamento
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:outline-hidden focus:border-[#125e95]"
                >
                  <option value="credit_card">Cartão de Crédito</option>
                  <option value="wire_transfer">Transferência Bancária</option>
                  <option value="financing">Financiamento</option>
                  <option value="check">Cheque</option>
                  <option value="cash">Dinheiro</option>
                  <option value="other">Outro</option>
                </select>
              </div>
            </div>
          )}

          {!isRefund && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Data do Pagamento
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:outline-hidden focus:border-[#125e95]"
                />
                <Calendar className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          )}

          {!isRefund && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Referência Externa (Opcional)
              </label>
              <input
                type="text"
                value={externalReference}
                onChange={(e) => setExternalReference(e.target.value)}
                placeholder="ID transação, comprovante, recibo..."
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:border-[#125e95]"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {isRefund ? 'Motivo do Reembolso' : 'Observações Financeiras'}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={isRefund ? 'Explique o motivo do reembolso integral ou parcial...' : 'Ex: 1ª parcela de entrada, autorização gerencial...'}
              className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:border-[#125e95] resize-none"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white shadow-xs transition-all disabled:opacity-50 ${
                isRefund ? 'bg-amber-600 hover:bg-amber-700' : 'bg-[#125e95] hover:bg-[#08254f]'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processando...
                </>
              ) : isRefund ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  Confirmar Reembolso
                </>
              ) : (
                'Salvar Pagamento'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
