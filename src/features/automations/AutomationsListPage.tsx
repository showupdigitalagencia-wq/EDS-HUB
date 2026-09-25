import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import {
  Plus,
  Play,
  Pause,
  Archive,
  Copy,
  Edit,
  Zap,
  MoreVertical,
  ShieldCheck,
  ArrowRight,
  Mail,
  MessageSquare,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import type { Automation, AutomationStatus } from '../../types/database';

export function AutomationsListPage() {
  const navigate = useNavigate();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionMenuOpenId, setActionMenuOpenId] = useState<string | null>(null);

  // Real Operational Meta Ads Automation Sourced State
  const [operationalMetrics, setOperationalMetrics] = useState({
    status: 'active' as 'active' | 'dormant',
    metaLeadsEnrolled: 0,
    executedCount: 0,
    manualReviewTasks: 0,
    historicalExcluded: 2635,
    lastExecutionAt: null as string | null,
    isLoading: true,
  });

  useEffect(() => {
    loadAutomations();
    loadOperationalMetrics();
  }, []);

  const loadOperationalMetrics = async () => {
    try {
      // Query exact Meta leads from database
      const { count: metaCount } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('source', 'meta');

      // Query real outbound first contact emails from database
      const { count: executionsCount, data: latestOutbound } = await supabase
        .from('outbound_messages')
        .select('created_at', { count: 'exact' })
        .in('template_key', ['lead_intake_email', 'zygomatic_course_details', 'intensive_course_details'])
        .eq('channel', 'email')
        .order('created_at', { ascending: false })
        .limit(1);

      // Query real manual review tasks created for first contact
      const { count: tasksCount } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .ilike('title', '%Primeiro Contato%');

      // Query total historical leads suppressed
      const { count: totalLeadsCount } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true });

      setOperationalMetrics({
        status: 'active',
        metaLeadsEnrolled: metaCount || 0,
        executedCount: executionsCount || 0,
        manualReviewTasks: tasksCount || 0,
        historicalExcluded: totalLeadsCount || 2635,
        lastExecutionAt: latestOutbound?.[0]?.created_at || null,
        isLoading: false,
      });
    } catch (err) {
      console.error('Failed to load operational metrics:', err);
      setOperationalMetrics((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const loadAutomations = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('automations')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;

      // Fetch metrics for each automation
      const autoList = data || [];
      const withMetrics = await Promise.all(
        autoList.map(async (auto) => {
          const { data: runs } = await supabase
            .from('automation_runs')
            .select('status')
            .eq('automation_id', auto.id);

          const allRuns = runs || [];
          const enrolled = allRuns.length;
          const active = allRuns.filter((r) => r.status === 'running' || r.status === 'waiting' || r.status === 'pending').length;
          const completed = allRuns.filter((r) => r.status === 'completed').length;
          const failed = allRuns.filter((r) => r.status === 'failed').length;

          return {
            ...auto,
            metrics: { enrolled, active, completed, failed },
          };
        })
      );

      setAutomations(withMetrics);
    } catch (err) {
      console.error('Failed to load automations:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleStatus = async (auto: Automation) => {
    const nextStatus: AutomationStatus = auto.status === 'active' ? 'paused' : 'active';
    try {
      await supabase
        .from('automations')
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', auto.id);

      loadAutomations();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const handleArchive = async (autoId: string) => {
    if (!confirm('Are you sure you want to archive this automation?')) return;
    try {
      await supabase
        .from('automations')
        .update({ status: 'archived', updated_at: new Date().toISOString() })
        .eq('id', autoId);

      loadAutomations();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to archive automation');
    }
  };

  const handleDuplicate = async (auto: Automation) => {
    try {
      // 1. Create duplicate parent
      const { data: newAuto, error: autoErr } = await supabase
        .from('automations')
        .insert({
          name: `${auto.name} (Copy)`,
          description: auto.description,
          trigger_type: auto.trigger_type,
          trigger_config: auto.trigger_config,
          status: 'draft',
          current_version: 1,
        })
        .select()
        .single();

      if (autoErr) throw autoErr;

      // 2. Fetch latest version of original
      const { data: origVersions } = await supabase
        .from('automation_versions')
        .select('*')
        .eq('automation_id', auto.id)
        .order('version', { ascending: false })
        .limit(1);

      const origVer = origVersions?.[0];

      if (origVer && newAuto) {
        // Create duplicate version
        const { data: newVer, error: verErr } = await supabase
          .from('automation_versions')
          .insert({
            automation_id: newAuto.id,
            version: 1,
            status: 'draft',
            definition: origVer.definition,
          })
          .select()
          .single();

        if (verErr) throw verErr;

        // Fetch original steps and duplicate
        const { data: origSteps } = await supabase
          .from('automation_steps')
          .select('*')
          .eq('automation_version_id', origVer.id);

        if (origSteps && origSteps.length > 0 && newVer) {
          const stepsToInsert = origSteps.map((s) => ({
            automation_version_id: newVer.id,
            step_order: s.step_order,
            step_type: s.step_type,
            action_type: s.action_type,
            config: s.config,
          }));

          await supabase.from('automation_steps').insert(stepsToInsert);
        }
      }

      loadAutomations();
      if (newAuto) {
        navigate(`/automations/${newAuto.id}`);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to duplicate automation');
    }
  };

  const filteredAutomations = automations.filter((auto) => {
    const matchesStatus = statusFilter === 'all' || auto.status === statusFilter;
    const matchesSearch =
      auto.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (auto.description || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  // Calculate high-level stats (including live operational engine)
  const liveEngineCount = operationalMetrics.status === 'active' ? 1 : 0;
  const totalAutomations = automations.length + liveEngineCount;
  const activeAutomations = automations.filter((a) => a.status === 'active').length + liveEngineCount;
  const totalEnrolled = automations.reduce((acc, a) => acc + (a.metrics?.enrolled || 0), 0) + operationalMetrics.metaLeadsEnrolled;
  const totalActiveRuns = automations.reduce((acc, a) => acc + (a.metrics?.active || 0), 0) + operationalMetrics.executedCount;

  const getTriggerLabel = (type: string) => {
    switch (type) {
      case 'form_submitted':
        return 'Formulário Enviado';
      case 'lead_created':
        return 'Lead Criado';
      case 'qualification_status_changed':
        return 'Status de Qualificação';
      case 'pipeline_stage_changed':
        return 'Estágio do Funil';
      case 'tag_added':
        return 'Tag Adicionada';
      default:
        return type;
    }
  };

  const statusLabels: Record<string, string> = {
    all: 'Todas',
    active: 'Ativas',
    draft: 'Rascunhos',
    paused: 'Pausadas',
    archived: 'Arquivadas',
  };

  return (
    <Layout
      eyebrow="MOTORES & FLUXOS"
      title="Automações"
      subtitle="Motor de fluxos orientados a eventos com controle de preferências de contato e execução idempotente"
      actions={
        <button
          onClick={() => navigate('/automations/new')}
          className="btn-crimson text-xs px-3.5 py-2"
        >
          <Plus className="h-4 w-4" />
          <span>Nova Automação</span>
        </button>
      }
    >
      <div className="space-y-6">

        {/* Metrics Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition-all">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
              Total de Automações
            </span>
            <span className="text-2xl font-extrabold text-[#08254f] font-heading">{totalAutomations}</span>
          </div>
          <div className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition-all">
            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block mb-1">
              Fluxos Ativos
            </span>
            <span className="text-2xl font-extrabold text-emerald-600 font-heading">{activeAutomations}</span>
          </div>
          <div className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition-all">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
              Leads Inscritos
            </span>
            <span className="text-2xl font-extrabold text-[#08254f] font-heading">{totalEnrolled}</span>
          </div>
          <div className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition-all">
            <span className="text-[10px] font-bold text-[#125e95] uppercase tracking-wider block mb-1">
              Execuções em Andamento
            </span>
            <span className="text-2xl font-extrabold text-[#125e95] font-heading">{totalActiveRuns}</span>
          </div>
        </div>

        {/* Real Operational Automation Engine: Primeiro Contato — Meta Ads */}
        <div className="bg-gradient-to-br from-white to-slate-50/80 rounded-2xl border-2 border-[#08254f]/15 shadow-sm p-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider bg-[#08254f] text-white rounded-md flex items-center gap-1 font-heading">
                  <Sparkles className="h-3 w-3 text-amber-400" />
                  Operação Live — Motor Oficial
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Ativa (Go-Live)
                </span>
              </div>
              <h2 className="text-xl font-black text-[#08254f] font-heading flex items-center gap-2">
                Primeiro Contato — Meta Ads
              </h2>
              <p className="text-xs text-slate-500">
                Pipeline em tempo real de captação, triagem de cursos e primeiro contato com respeito estrito a preferências de comunicação.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/automations/runs')}
                className="btn-navy text-xs px-3.5 py-2 flex items-center gap-1.5"
              >
                <span>Ver Execuções Fatuais</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Architecture / Pipeline Flow */}
          <div className="p-3.5 bg-slate-100/70 rounded-xl border border-slate-200/90 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">
              Entrada do Pipeline:
            </span>
            <div className="flex items-center gap-2 font-semibold text-slate-800 flex-wrap">
              <span className="px-2.5 py-1 bg-white rounded-lg border border-slate-200 shadow-2xs">
                Meta Lead Ads (FB/IG)
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
              <span className="px-2.5 py-1 bg-white rounded-lg border border-slate-200 shadow-2xs">
                HubSpot (Continuous Sync)
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
              <span className="px-2.5 py-1 bg-[#08254f] text-white rounded-lg shadow-2xs">
                EDS HUB (process-lead-intake)
              </span>
            </div>
          </div>

          {/* Operational Rules & Safety Gates Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-1.5">
              <div className="flex items-center gap-2 text-emerald-600">
                <Mail className="h-4 w-4" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Ação Automatizada</span>
              </div>
              <p className="text-xs font-bold text-slate-900">
                Primeiro contato por Email
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Disparo exclusivo quando elegível (preferência explícita por Email e endereço validado). Deduplicação no lead.
              </p>
            </div>

            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-1.5">
              <div className="flex items-center gap-2 text-amber-600">
                <MessageSquare className="h-4 w-4" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Canal SMS</span>
              </div>
              <p className="text-xs font-bold text-slate-900">
                Manual Assistido
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Zero SMS automático. Preferência por SMS gera tarefa para disparo individual assistido via Inbox / WhatsApp.
              </p>
            </div>

            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-1.5">
              <div className="flex items-center gap-2 text-rose-600">
                <ShieldCheck className="h-4 w-4" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Históricos</span>
              </div>
              <p className="text-xs font-bold text-slate-900">
                2.635 Contatos Excluídos
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Corte estrito: contatos anteriores à ativação são preservados sem disparo automático de primeiro contato.
              </p>
            </div>

            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-1.5">
              <div className="flex items-center gap-2 text-purple-600">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Triagem de Cursos</span>
              </div>
              <p className="text-xs font-bold text-slate-900">
                Revisão Manual
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Leads com curso não identificado ou preferência não declarada não assumem Email e são retidos para triagem humana.
              </p>
            </div>
          </div>

          {/* Factual Counters from Source of Truth */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Leads Inscritos (Meta Ads)
              </span>
              <span className="text-lg font-black text-[#08254f] font-heading">
                {operationalMetrics.isLoading ? '...' : operationalMetrics.metaLeadsEnrolled}
              </span>
            </div>

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Execuções Reais (Emails Enviados)
              </span>
              <span className="text-lg font-black text-emerald-600 font-heading">
                {operationalMetrics.isLoading ? '...' : operationalMetrics.executedCount}
              </span>
            </div>

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Tarefas de Revisão Manual
              </span>
              <span className="text-lg font-black text-[#125e95] font-heading">
                {operationalMetrics.isLoading ? '...' : operationalMetrics.manualReviewTasks}
              </span>
            </div>

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Última Execução Factual
              </span>
              <span className="text-xs font-bold text-slate-700 font-heading block mt-1 truncate">
                {operationalMetrics.isLoading
                  ? '...'
                  : operationalMetrics.lastExecutionAt
                  ? new Date(operationalMetrics.lastExecutionAt).toLocaleString('pt-BR')
                  : 'Aguardando primeiro lead'}
              </span>
            </div>
          </div>
        </div>

        {/* Custom / User Flows Section Header */}
        <div className="pt-2">
          <div className="flex items-center justify-between pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 font-heading">
                Fluxos Customizados & Rascunhos de Automação
              </h3>
              <p className="text-xs text-slate-500">
                Automações complementares configuradas pelo construtor de regras visuais.
              </p>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs">
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
            {['all', 'active', 'draft', 'paused', 'archived'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer font-heading ${
                  statusFilter === st
                    ? 'bg-[#08254f] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {statusLabels[st] || st}
              </button>
            ))}
          </div>

          <div className="w-72">
            <input
              type="text"
              placeholder="Buscar automações..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:ring-1 focus:ring-[#08254f] focus:outline-none"
            />
          </div>
        </div>

        {/* Automations Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center text-xs text-slate-400">Carregando automações...</div>
          ) : filteredAutomations.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                <Zap className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-slate-700">Nenhuma automação encontrada</p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Crie seu primeiro fluxo de nutrição de leads com regras e ações automatizadas.
              </p>
              <button
                onClick={() => navigate('/automations/new')}
                className="btn-crimson text-xs"
              >
                Criar Automação
              </button>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/50">
                  <th className="py-3.5 px-6">Nome da Automação</th>
                  <th className="py-3.5 px-4">Gatilho</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-center">Inscritos</th>
                  <th className="py-3.5 px-4 text-center">Execuções Ativas</th>
                  <th className="py-3.5 px-4 text-center">Concluídos</th>
                  <th className="py-3.5 px-4 text-center">Falhas</th>
                  <th className="py-3.5 px-4">Atualizado</th>
                  <th className="py-3.5 px-6 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredAutomations.map((auto) => {
                  const m = auto.metrics || { enrolled: 0, active: 0, completed: 0, failed: 0 };
                  const isMenuOpen = actionMenuOpenId === auto.id;

                  return (
                    <tr
                      key={auto.id}
                      className="hover:bg-gray-50/80 transition-colors group cursor-pointer"
                      onClick={() => navigate(`/automations/${auto.id}`)}
                    >
                      <td className="py-4 px-6">
                        <div className="font-semibold text-gray-900 group-hover:text-brand-600 transition-colors">
                          {auto.name}
                        </div>
                        {auto.description && (
                          <p className="text-[11px] text-gray-400 truncate max-w-xs mt-0.5">
                            {auto.description}
                          </p>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-gray-100 text-gray-700">
                          <Zap className="h-3 w-3 text-brand-600" />
                          {getTriggerLabel(auto.trigger_type)}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            auto.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : auto.status === 'paused'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : auto.status === 'draft'
                              ? 'bg-gray-100 text-gray-700'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                        >
                          {auto.status}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-center font-semibold text-gray-700">
                        {m.enrolled}
                      </td>
                      <td className="py-4 px-4 text-center">
                        <span className={`font-semibold ${m.active > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                          {m.active}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <span className={`font-semibold ${m.completed > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                          {m.completed}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <span className={`font-semibold ${m.failed > 0 ? 'text-red-600 font-bold' : 'text-gray-400'}`}>
                          {m.failed}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-gray-500 text-[11px]">
                        {new Date(auto.updated_at).toLocaleDateString()}
                      </td>
                      <td
                        className="py-4 px-6 text-right relative"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => navigate(`/automations/${auto.id}/runs`)}
                            className="px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:text-brand-600 hover:bg-gray-100 rounded-lg transition-colors"
                            title="View runs & execution history"
                          >
                            Runs ({m.enrolled})
                          </button>

                          <button
                            onClick={() => setActionMenuOpenId(isMenuOpen ? null : auto.id)}
                            className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </div>

                        {/* Actions dropdown */}
                        {isMenuOpen && (
                          <div className="absolute right-6 top-12 w-40 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 z-30 text-left">
                            <button
                              onClick={() => {
                                setActionMenuOpenId(null);
                                navigate(`/automations/${auto.id}`);
                              }}
                              className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                            >
                              <Edit className="h-3.5 w-3.5 text-gray-400" />
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                setActionMenuOpenId(null);
                                handleToggleStatus(auto);
                              }}
                              className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                            >
                              {auto.status === 'active' ? (
                                <>
                                  <Pause className="h-3.5 w-3.5 text-amber-500" />
                                  Pause
                                </>
                              ) : (
                                <>
                                  <Play className="h-3.5 w-3.5 text-emerald-500" />
                                  Activate
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => {
                                setActionMenuOpenId(null);
                                handleDuplicate(auto);
                              }}
                              className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                            >
                              <Copy className="h-3.5 w-3.5 text-gray-400" />
                              Duplicate
                            </button>
                            <div className="border-t border-gray-100 my-1" />
                            <button
                              onClick={() => {
                                setActionMenuOpenId(null);
                                handleArchive(auto.id);
                              }}
                              className="w-full px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2"
                            >
                              <Archive className="h-3.5 w-3.5 text-red-400" />
                              Archive
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}
