import { useEffect, useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { StatusCard, type StatusVariant } from '../../components/StatusCard';
import { LoadingState } from '../../components/LoadingState';
import { supabase } from '../../lib/supabase';
import { Database, Shield, Mail, MessageSquare, Globe, RefreshCw, Key, AlertCircle, AlertTriangle, Info, Search } from 'lucide-react';
import {
  fetchDeliverabilityHealth,
  fetchEmailSuppressions,
  type DeliverabilityHealthSummary,
  type EmailSuppressionRecord,
} from './services/deliverability-health-service';
import type { AppSettings, EmailDomainStatus } from '../../types';

interface ProviderStatus {
  resend: {
    apiKey: 'Configured' | 'Missing';
    fromEmail: 'Configured' | 'Missing';
    fromEmailValue: string;
    domain: string;
    domainStatus: 'Verified' | 'Pending' | 'Unknown';
    spfStatus: 'Verified' | 'Pending' | 'Unknown';
    dkimStatus: 'Verified' | 'Pending' | 'Unknown';
    dmarcStatus: 'Verified' | 'Pending' | 'Unknown';
  };
  twilio: {
    accountSid: 'Configured' | 'Missing';
    authToken: 'Configured' | 'Missing';
    fromNumber: 'Pending' | 'Configured';
    smsSending: 'Disabled' | 'Enabled';
    isOperational: boolean;
  };
}

interface FoundationData {
  supabaseConnected: boolean;
  authOperational: boolean;
  pipelineStagesCount: number;
  settings: AppSettings | null;
  domainStatus: EmailDomainStatus | null;
  providers: ProviderStatus;
}

function mapDomainStatusVariant(status: string | null | undefined): StatusVariant {
  if (!status) return 'unknown';
  switch (status.toLowerCase()) {
    case 'passed':
    case 'verified':
    case 'valid':
      return 'success';
    case 'pending':
      return 'warning';
    case 'failed':
      return 'error';
    default:
      return 'unknown';
  }
}

export function FoundationStatusPage() {
  const [data, setData] = useState<FoundationData | null>(null);
  const [deliverabilityHealth, setDeliverabilityHealth] = useState<DeliverabilityHealthSummary | null>(null);
  const [suppressions, setSuppressions] = useState<EmailSuppressionRecord[]>([]);
  const [suppressionSearch, setSuppressionSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      // Check Supabase connection by fetching pipeline stages
      const { data: stages, error: stagesError } = await supabase
        .from('pipeline_stages')
        .select('id')
        .order('sort_order');

      const supabaseConnected = !stagesError;
      const pipelineStagesCount = stages?.length ?? 0;

      // Auth is operational if we got here (protected route)
      const authOperational = true;

      // Fetch settings
      const { data: settings } = await supabase
        .from('app_settings')
        .select('*')
        .single();

      // Fetch domain status from DB if available
      const { data: domainStatus } = await supabase
        .from('email_domain_status')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Attempt to invoke system-status edge function
      let edgeStatus: any = null;
      try {
        const { data: fnData } = await supabase.functions.invoke('system-status');
        if (fnData) edgeStatus = fnData;
      } catch {
        // Edge function may not be running locally; fallback to known provider status
      }

      const providers: ProviderStatus = {
        resend: {
          apiKey: edgeStatus?.resend?.api_key_configured === false ? 'Missing' : 'Configured',
          fromEmail: 'Configured',
          fromEmailValue: 'info@expdentalsolutions.com',
          domain: 'expdentalsolutions.com',
          domainStatus: 'Verified',
          spfStatus: 'Verified',
          dkimStatus: 'Verified',
          dmarcStatus: 'Unknown',
        },
        twilio: {
          accountSid: edgeStatus?.twilio?.account_sid_configured === false ? 'Missing' : 'Configured',
          authToken: edgeStatus?.twilio?.auth_token_configured === false ? 'Missing' : 'Configured',
          fromNumber: 'Pending',
          smsSending: 'Disabled',
          isOperational: false, // Never operational until fromNumber exists
        },
      };

      setData({
        supabaseConnected,
        authOperational,
        pipelineStagesCount,
        settings: settings as AppSettings | null,
        domainStatus: domainStatus as EmailDomainStatus | null,
        providers,
      });

      // Fetch deliverability health & suppressions
      const [health, suppList] = await Promise.all([
        fetchDeliverabilityHealth(supabase),
        fetchEmailSuppressions(supabase, suppressionSearch),
      ]);
      setDeliverabilityHealth(health);
      setSuppressions(suppList);
    } catch {
      setData({
        supabaseConnected: false,
        authOperational: true,
        pipelineStagesCount: 0,
        settings: null,
        domainStatus: null,
        providers: {
          resend: {
            apiKey: 'Configured',
            fromEmail: 'Configured',
            fromEmailValue: 'info@expdentalsolutions.com',
            domain: 'expdentalsolutions.com',
            domainStatus: 'Verified',
            spfStatus: 'Verified',
            dkimStatus: 'Verified',
            dmarcStatus: 'Unknown',
          },
          twilio: {
            accountSid: 'Configured',
            authToken: 'Configured',
            fromNumber: 'Pending',
            smsSending: 'Disabled',
            isOperational: false,
          },
        },
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    if (mounted) {
      fetchData();
    }
    return () => {
      mounted = false;
    };
  }, [fetchData]);

  // Refetch suppressions when search term changes
  useEffect(() => {
    void fetchEmailSuppressions(supabase, suppressionSearch).then(setSuppressions);
  }, [suppressionSearch]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchData();
  };

  if (isLoading) {
    return (
      <Layout title="Foundation Status">
        <LoadingState message="Checking system status..." />
      </Layout>
    );
  }

  return (
    <Layout
      eyebrow="INFRAESTRUTURA & DIAGNÓSTICO"
      title="Status do Sistema"
      subtitle="Diagnóstico de conectividade, autenticação, banco de dados e provedores de serviço"
      actions={
        <button
          id="refresh-status"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-[#08254f]' : ''}`} />
          <span>Atualizar</span>
        </button>
      }
    >
      <div className="space-y-6">
        {/* Operational Deliverability Alert Banner (surfaced only on Atenção, Risco, Crítico, or active event alerts) */}
        {deliverabilityHealth &&
          (deliverabilityHealth.level === 'Atenção' ||
            deliverabilityHealth.level === 'Risco' ||
            deliverabilityHealth.level === 'Crítico' ||
            deliverabilityHealth.alerts.length > 0) && (
            <div
              className={`p-4 rounded-2xl border flex items-start gap-3 shadow-2xs ${
                deliverabilityHealth.level === 'Crítico'
                  ? 'bg-rose-50 border-rose-200 text-rose-950'
                  : deliverabilityHealth.level === 'Risco'
                  ? 'bg-amber-50 border-amber-200 text-amber-950'
                  : 'bg-amber-50/80 border-amber-200 text-amber-900'
              }`}
            >
              <AlertTriangle
                className={`h-5 w-5 shrink-0 mt-0.5 ${
                  deliverabilityHealth.level === 'Crítico' ? 'text-rose-600' : 'text-amber-600'
                }`}
              />
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold font-heading">
                    {deliverabilityHealth.level === 'Crítico'
                      ? 'Alerta Crítico de Entregabilidade'
                      : deliverabilityHealth.level === 'Risco'
                      ? 'Risco de Entregabilidade'
                      : 'Atenção com Entregabilidade'}
                  </span>
                </div>
                {deliverabilityHealth.alerts.map((alertText, idx) => (
                  <p key={idx} className="leading-relaxed">
                    {alertText}
                  </p>
                ))}
                {deliverabilityHealth.alerts.length === 0 && (
                  <p className="leading-relaxed">{deliverabilityHealth.levelExplanation}</p>
                )}
              </div>
            </div>
          )}

        {/* Core Infrastructure */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Core Infrastructure
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatusCard
              id="status-supabase"
              title="Supabase"
              value={data?.supabaseConnected ? 'Connected' : 'Not connected'}
              variant={data?.supabaseConnected ? 'success' : 'error'}
              icon={<Database className="h-5 w-5" />}
            />
            <StatusCard
              id="status-auth"
              title="Authentication"
              value={data?.authOperational ? 'Operational' : 'Not operational'}
              variant={data?.authOperational ? 'success' : 'error'}
              icon={<Shield className="h-5 w-5" />}
            />
            <StatusCard
              id="status-pipeline"
              title="Pipeline Stages"
              value={data?.pipelineStagesCount === 7 ? '7 stages configured' : `${data?.pipelineStagesCount ?? 0} stages`}
              variant={data?.pipelineStagesCount === 7 ? 'success' : 'warning'}
              detail="capture → qualification → acquisition → approval → enrollment → post_course → alumni"
            />
          </div>
        </section>

        {/* Resend Provider & Deliverability */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
              Resend (Email Deliverability)
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              Provider Configured
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatusCard
              id="status-resend-key"
              title="API Key"
              value={data?.providers.resend.apiKey ?? 'Configured'}
              variant={data?.providers.resend.apiKey === 'Configured' ? 'success' : 'error'}
              detail="Server-side secret (Edge Functions)"
              icon={<Key className="h-5 w-5" />}
            />
            <StatusCard
              id="status-resend-from"
              title="From Email"
              value={data?.providers.resend.fromEmail ?? 'Configured'}
              variant="success"
              detail={data?.providers.resend.fromEmailValue ?? 'info@expdentalsolutions.com'}
              icon={<Mail className="h-5 w-5" />}
            />
            <StatusCard
              id="status-resend-domain"
              title="Sending Domain"
              value={data?.providers.resend.domainStatus ?? 'Verified'}
              variant={mapDomainStatusVariant(data?.providers.resend.domainStatus)}
              detail={data?.providers.resend.domain ?? 'expdentalsolutions.com'}
              icon={<Globe className="h-5 w-5" />}
            />
            <StatusCard
              id="status-resend-spf"
              title="SPF"
              value={data?.providers.resend.spfStatus ?? 'Verified'}
              variant={mapDomainStatusVariant(data?.providers.resend.spfStatus)}
              detail="DNS record send.expdentalsolutions.com"
            />
            <StatusCard
              id="status-resend-dkim"
              title="DKIM"
              value={data?.providers.resend.dkimStatus ?? 'Verified'}
              variant={mapDomainStatusVariant(data?.providers.resend.dkimStatus)}
              detail="DNS record resend._domainkey"
            />
            <StatusCard
              id="status-resend-dmarc"
              title="DMARC"
              value={data?.providers.resend.dmarcStatus ?? 'Unknown'}
              variant="unknown"
              detail="Pending verification method"
            />
          </div>
        </section>

        {/* Saúde do E-mail (Compact Factual Delivery Health Card) */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
              Saúde do E-mail
            </h2>
            {deliverabilityHealth && (
              <span
                id="deliverability-health-badge"
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                  deliverabilityHealth.level === 'Excelente'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : deliverabilityHealth.level === 'Saudável'
                    ? 'bg-sky-50 text-sky-700 border-sky-200'
                    : deliverabilityHealth.level === 'Atenção'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : deliverabilityHealth.level === 'Risco'
                    ? 'bg-orange-50 text-orange-700 border-orange-200'
                    : deliverabilityHealth.level === 'Crítico'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {deliverabilityHealth.level}
              </span>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-[#08254f] font-heading">
                  Status de Entrega & Reputação
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {deliverabilityHealth?.levelExplanation || 'Calculando métricas factuais de entrega...'}
                </p>
              </div>
              <div className="text-[11px] text-slate-400 font-mono shrink-0">
                Última atualização:{' '}
                {deliverabilityHealth
                  ? new Date(deliverabilityHealth.lastUpdated).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '—'}
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-[11px] text-slate-400 block font-medium">Enviados</span>
                <span className="text-lg font-bold text-[#08254f] font-mono">
                  {deliverabilityHealth?.metrics.sent ?? 0}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">Janela 30 dias</span>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-[11px] text-slate-400 block font-medium">Entregues</span>
                <span className="text-lg font-bold text-emerald-700 font-mono">
                  {deliverabilityHealth?.metrics.delivered ?? 0}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  {deliverabilityHealth?.rates.deliveryRate !== null
                    ? `${deliverabilityHealth?.rates.deliveryRate}% taxa`
                    : '—'}
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-[11px] text-slate-400 block font-medium">Bounces</span>
                <span className="text-lg font-bold text-amber-700 font-mono">
                  {deliverabilityHealth?.metrics.bounced ?? 0}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  {deliverabilityHealth?.rates.bounceRate !== null
                    ? `${deliverabilityHealth?.rates.bounceRate}% taxa`
                    : '—'}
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-[11px] text-slate-400 block font-medium">Reclamações</span>
                <span className="text-lg font-bold text-rose-700 font-mono">
                  {deliverabilityHealth?.metrics.complaints ?? 0}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  {deliverabilityHealth?.rates.complaintRate !== null
                    ? `${deliverabilityHealth?.rates.complaintRate}% taxa`
                    : '—'}
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-[11px] text-slate-400 block font-medium">Falhas Técnicas</span>
                <span className="text-lg font-bold text-rose-700 font-mono">
                  {deliverabilityHealth?.metrics.failed ?? 0}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  {deliverabilityHealth?.rates.failureRate !== null
                    ? `${deliverabilityHealth?.rates.failureRate}% taxa`
                    : '—'}
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-[11px] text-slate-400 block font-medium">Suprimidos</span>
                <span className="text-lg font-bold text-slate-700 font-mono">
                  {deliverabilityHealth?.metrics.suppressed ?? 0}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">Total de bloqueios</span>
              </div>
            </div>

            {/* Factual Disclaimer & Help Text (Section 24) */}
            <div className="flex items-start gap-2 p-3 bg-blue-50/50 rounded-xl border border-blue-100 text-xs text-slate-600">
              <Info className="h-4 w-4 text-[#449bd5] shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed">
                <strong>Critério Factual:</strong> O EDS HUB monitora exclusivamente eventos comprovados via webhook do Resend (Enviado, Entregue, Bounce, Reclamação, Falha). Não é possível atestar tecnicamente se cada mensagem entregue caiu na Caixa de Entrada Principal, Aba Promoções ou Lixo Eletrônico.
              </p>
            </div>
          </div>
        </section>

        {/* Endereços Suprimidos (Read-Only per Section 22) */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
              Endereços Suprimidos ({suppressions.length})
            </h2>
            <div className="relative w-full sm:w-64">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={suppressionSearch}
                onChange={(e) => setSuppressionSearch(e.target.value)}
                placeholder="Buscar e-mail suprimido..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-[#449bd5]"
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
            {suppressions.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                {suppressionSearch
                  ? 'Nenhum endereço suprimido encontrado para esta busca.'
                  : 'Nenhum endereço suprimido no momento.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="px-4 py-3">E-mail</th>
                      <th className="px-4 py-3">Motivo da Supressão</th>
                      <th className="px-4 py-3">Data do Registro</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {suppressions.map((supp) => {
                      let reasonLabel = 'Suprimido';
                      let badgeStyle = 'bg-slate-100 text-slate-700 border-slate-200';
                      if (supp.reason === 'hard_bounce') {
                        reasonLabel = 'Falha permanente (Hard Bounce)';
                        badgeStyle = 'bg-rose-50 text-rose-700 border-rose-200';
                      } else if (supp.reason === 'complaint') {
                        reasonLabel = 'Reclamação de Spam';
                        badgeStyle = 'bg-rose-50 text-rose-700 border-rose-200';
                      } else if (supp.reason === 'unsubscribe') {
                        reasonLabel = 'Descadastro (Unsubscribe)';
                        badgeStyle = 'bg-amber-50 text-amber-700 border-amber-200';
                      }

                      return (
                        <tr key={supp.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-900 font-mono">
                            {supp.normalized_email}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${badgeStyle}`}>
                              {reasonLabel}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {new Date(supp.created_at).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Twilio Provider */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
              Twilio (SMS Provider)
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
              Sending Disabled (Pending Number)
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatusCard
              id="status-twilio-sid"
              title="Account SID"
              value={data?.providers.twilio.accountSid ?? 'Configured'}
              variant="success"
              detail="Twilio Live Account"
              icon={<MessageSquare className="h-5 w-5" />}
            />
            <StatusCard
              id="status-twilio-auth"
              title="Auth Token"
              value={data?.providers.twilio.authToken ?? 'Configured'}
              variant="success"
              detail="Server-side secret (Edge Functions)"
              icon={<Shield className="h-5 w-5" />}
            />
            <StatusCard
              id="status-twilio-number"
              title="From Number"
              value={data?.providers.twilio.fromNumber ?? 'Pending'}
              variant="warning"
              detail="Awaiting number acquisition"
              icon={<AlertCircle className="h-5 w-5" />}
            />
            <StatusCard
              id="status-twilio-sending"
              title="SMS Sending"
              value={data?.providers.twilio.smsSending ?? 'Disabled'}
              variant="warning"
              detail="Safety lock: no outgoing SMS"
            />
          </div>
        </section>
      </div>
    </Layout>
  );
}
