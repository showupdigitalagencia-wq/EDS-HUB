import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Inbox,
  Mail,
  MessageSquare,
  Search,
  RefreshCw,
  Phone,
  ExternalLink,
  Archive,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeft,
} from 'lucide-react';
import { Layout } from '../../components/Layout';
import { supabase } from '../../lib/supabase';
import { ConversationThread } from './ConversationThread';
import { LeadProfileDrawer } from '../leads/components/LeadProfileDrawer';
import { getQualificationStatusBadge, getQualificationStatusLabel } from '../leads/utils/qualificationMapping';
import type {
  Conversation,
  QualificationStatus,
} from '../../types/database';

type FilterTab = 'all' | 'unread' | 'email' | 'sms' | 'closed';

export function InboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedIdFromUrl = searchParams.get('id');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isUpdatingLead, setIsUpdatingLead] = useState(false);
  const [showMobileThread, setShowMobileThread] = useState(false);
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);

  // Metrics
  const [metrics, setMetrics] = useState({
    totalOpen: 0,
    totalUnread: 0,
    totalEmail: 0,
    totalSms: 0,
  });

  const loadConversations = useCallback(async () => {
    setIsLoading(true);
    try {
      // Load conversations with lead and unread counts
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          *,
          lead:leads (
            id,
            first_name,
            last_name,
            email,
            phone_e164,
            contact_preference,
            qualification_status,
            course_interest,
            pipeline_stage_id,
            last_response_at,
            pipeline_stages (
              id,
              name,
              code
            )
          )
        `)
        .order('last_message_at', { ascending: false });

      if (error) throw error;

      // Also compute unread counts per conversation
      const { data: unreadRows } = await supabase
        .from('inbound_messages')
        .select('conversation_id')
        .is('read_at', null);

      const unreadMap = new Map<string, number>();
      (unreadRows || []).forEach((r) => {
        if (r.conversation_id) {
          unreadMap.set(r.conversation_id, (unreadMap.get(r.conversation_id) || 0) + 1);
        }
      });

      const enriched: Conversation[] = (data || []).map((conv: any) => ({
        ...conv,
        unread_count: unreadMap.get(conv.id) || 0,
      }));

      setConversations(enriched);

      // Compute metrics
      const openCount = enriched.filter((c) => c.status === 'open').length;
      const unreadCount = enriched.filter((c) => (c.unread_count || 0) > 0).length;
      const emailCount = enriched.filter((c) => c.channel === 'email').length;
      const smsCount = enriched.filter((c) => c.channel === 'sms').length;

      setMetrics({
        totalOpen: openCount,
        totalUnread: unreadCount,
        totalEmail: emailCount,
        totalSms: smsCount,
      });

      // Update selected conversation if needed
      if (selectedIdFromUrl) {
        const found = enriched.find((c) => c.id === selectedIdFromUrl);
        if (found) setSelectedConversation(found);
      } else if (enriched.length > 0 && !selectedConversation) {
        setSelectedConversation(enriched[0]);
        setSearchParams({ id: enriched[0].id });
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedIdFromUrl, selectedConversation, setSearchParams]);

  useEffect(() => {
    loadConversations();
  }, []);

  const handleSelectConversation = (conv: Conversation) => {
    setSelectedConversation(conv);
    setSearchParams({ id: conv.id });
    setShowMobileThread(true);
  };

  const handleUpdateQualification = async (newStatus: QualificationStatus) => {
    if (!selectedConversation?.lead?.id) return;
    setIsUpdatingLead(true);
    try {
      const { error } = await supabase
        .from('leads')
        .update({ qualification_status: newStatus })
        .eq('id', selectedConversation.lead.id);

      if (error) throw error;

      // Update local state
      if (selectedConversation.lead) {
        const updatedLead = { ...selectedConversation.lead, qualification_status: newStatus };
        const updatedConv = { ...selectedConversation, lead: updatedLead };
        setSelectedConversation(updatedConv);
        setConversations((prev) =>
          prev.map((c) => (c.id === updatedConv.id ? updatedConv : c))
        );
      }
    } catch (err) {
      console.error('Failed to update qualification status:', err);
    } finally {
      setIsUpdatingLead(false);
    }
  };

  // Filter conversations
  const filteredConversations = conversations.filter((conv) => {
    // Filter Tab
    if (activeFilter === 'unread' && (!conv.unread_count || conv.unread_count === 0)) return false;
    if (activeFilter === 'email' && conv.channel !== 'email') return false;
    if (activeFilter === 'sms' && conv.channel !== 'sms') return false;
    if (activeFilter === 'closed' && conv.status !== 'closed') return false;
    if (activeFilter !== 'closed' && conv.status === 'closed' && activeFilter !== 'all') return false;

    // Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const leadName = `${conv.lead?.first_name || ''} ${conv.lead?.last_name || ''}`.toLowerCase();
      const email = (conv.lead?.email || '').toLowerCase();
      const phone = (conv.lead?.phone_e164 || '').toLowerCase();
      const subject = (conv.subject || '').toLowerCase();
      const preview = (conv.last_message_preview || '').toLowerCase();

      return (
        leadName.includes(q) ||
        email.includes(q) ||
        phone.includes(q) ||
        subject.includes(q) ||
        preview.includes(q)
      );
    }

    return true;
  });

  return (
    <Layout
      eyebrow="CENTRAL DE COMUNICAÇÃO"
      title="Inbox de Conversas"
      subtitle="Gestão unificada de mensagens inbound e outbound de leads"
      actions={
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="badge-outline-neutral text-[10px]">
              {metrics.totalOpen} Abertas
            </span>
            {metrics.totalUnread > 0 && (
              <span className="badge-crimson text-[10px]">
                {metrics.totalUnread} Não lidas
              </span>
            )}
          </div>
          <button
            onClick={loadConversations}
            disabled={isLoading}
            className="btn-secondary text-xs p-1.5"
            title="Atualizar conversas"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#08254f]' : ''}`} />
          </button>
        </div>
      }
    >
      <div className="h-[calc(100vh-10rem)] flex flex-col rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-2xs">

        {/* 3-Column Workspace */}
        <div className="flex-1 flex overflow-hidden">
          {/* Column 1: Conversations List */}
          <div className={`w-full md:w-80 lg:w-96 border-r border-slate-200/80 bg-white flex-col ${showMobileThread ? 'hidden md:flex' : 'flex'}`}>
            {/* Search and Filters */}
            <div className="p-3 border-b border-slate-100 space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar contato, email, telefone ou mensagem..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#449bd5] focus:bg-white transition-all"
                />
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs">
                {(
                  [
                    { id: 'all', label: 'Todas' },
                    { id: 'unread', label: `Não lidas (${metrics.totalUnread})` },
                    { id: 'email', label: 'Email' },
                    { id: 'sms', label: 'SMS' },
                    { id: 'closed', label: 'Fechadas' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveFilter(tab.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                      activeFilter === tab.id
                        ? 'bg-[#08254f] text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Conversation Rows */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {isLoading && conversations.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">Carregando inbox...</div>
              ) : filteredConversations.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 space-y-2">
                  <Inbox className="w-8 h-8 text-slate-300 mx-auto" />
                  <p>Nenhuma conversa encontrada</p>
                </div>
              ) : (
                filteredConversations.map((conv) => {
                  const isSelected = selectedConversation?.id === conv.id;
                  const leadName =
                    `${conv.lead?.first_name || ''} ${conv.lead?.last_name || ''}`.trim() ||
                    conv.lead?.email ||
                    conv.lead?.phone_e164 ||
                    'Contato não identificado';
                  const hasUnread = (conv.unread_count || 0) > 0;

                  return (
                    <button
                      key={conv.id}
                      onClick={() => handleSelectConversation(conv)}
                      className={`w-full text-left p-3.5 transition-all flex flex-col gap-1.5 cursor-pointer ${
                        isSelected
                          ? 'bg-[#f0f5fb] border-l-4 border-l-[#8a1c1c]'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {conv.channel === 'email' ? (
                            <span className="p-1 rounded-md bg-[#e1f0fb] text-[#125e95] flex-shrink-0">
                              <Mail className="w-3.5 h-3.5" />
                            </span>
                          ) : (
                            <span className="p-1 rounded-md bg-emerald-50 text-emerald-700 flex-shrink-0">
                              <MessageSquare className="w-3.5 h-3.5" />
                            </span>
                          )}
                          <span
                            className={`text-xs truncate ${
                              hasUnread ? 'font-bold text-[#08254f]' : 'font-semibold text-slate-800'
                            }`}
                          >
                            {leadName}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {hasUnread && (
                            <span className="w-2 h-2 rounded-full bg-[#8a1c1c]" title="Mensagem não lida" />
                          )}
                          <span className="text-[10px] text-slate-400">
                            {new Date(conv.last_message_at).toLocaleDateString('pt-BR', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </div>
                      </div>

                      {conv.subject && (
                        <p className="text-[11px] font-medium text-slate-700 truncate">
                          {conv.subject}
                        </p>
                      )}

                      <div className="flex items-center gap-1 text-[11px] text-slate-500">
                        {conv.last_message_direction === 'outbound' ? (
                          <ArrowUpRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
                        ) : (
                          <ArrowDownLeft className="w-3 h-3 text-[#125e95] flex-shrink-0" />
                        )}
                        <span className="truncate">
                          {conv.last_message_preview || 'Sem prévia disponível'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        {conv.lead?.qualification_status ? (
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${getQualificationStatusBadge(
                              conv.lead.qualification_status
                            )}`}
                          >
                            {getQualificationStatusLabel(conv.lead.qualification_status)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">Sem qualificação</span>
                        )}

                        {conv.status === 'closed' && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                            <Archive className="w-2.5 h-2.5" />
                            Fechada
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Column 2: Center Thread Area */}
          <div className={`flex-1 flex-col bg-gray-50 overflow-hidden ${showMobileThread ? 'flex' : 'hidden md:flex'}`}>
            {/* Mobile Back Button (< md) */}
            <div className="md:hidden flex items-center justify-between px-3 py-2.5 bg-white border-b border-slate-200/80 shadow-2xs shrink-0">
              <button
                type="button"
                id="mobile-inbox-back-btn"
                onClick={() => setShowMobileThread(false)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#08254f] hover:text-[#449bd5] py-1 px-2 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Voltar para a lista</span>
              </button>
            </div>

            {selectedConversation ? (
              <ConversationThread
                key={selectedConversation.id}
                conversation={selectedConversation}
                onStatusChanged={loadConversations}
                onMessageSent={loadConversations}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-white border border-gray-200 shadow-xs flex items-center justify-center text-gray-400 mb-4">
                  <Inbox className="w-8 h-8" />
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1 font-heading">Nenhuma conversa selecionada</h3>
                <p className="text-xs text-gray-500 max-w-sm">
                  Selecione uma conversa na lista à esquerda para visualizar mensagens, responder ou gerenciar o contato.
                </p>
              </div>
            )}
          </div>

          {/* Column 3: Lead Quick Context Drawer */}
          {selectedConversation && selectedConversation.lead && (
            <div className="hidden xl:flex w-72 lg:w-80 border-l border-gray-200 bg-white p-5 flex-col overflow-y-auto space-y-6 shrink-0">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-heading">
                  Perfil do Lead
                </h3>
                <button
                  type="button"
                  onClick={() => selectedConversation?.lead?.id && setDrawerLeadId(selectedConversation.lead.id)}
                  className="flex items-center gap-1 text-xs text-[#08254f] hover:text-[#449bd5] font-semibold transition-colors cursor-pointer"
                >
                  <span>Ver Perfil Completo</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              {/* Lead Identity */}
              <div className="space-y-3 text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-[#08254f] font-bold flex items-center justify-center text-sm font-heading">
                    {selectedConversation.lead.first_name?.[0] || 'L'}
                  </div>
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => selectedConversation?.lead?.id && setDrawerLeadId(selectedConversation.lead.id)}
                      className="font-bold text-[#08254f] hover:underline truncate text-left block"
                    >
                      {selectedConversation.lead.first_name || ''}{' '}
                      {selectedConversation.lead.last_name || ''}
                    </button>
                    <span className="text-[11px] text-gray-400">
                      ID: {selectedConversation.lead.id.slice(0, 8)}...
                    </span>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className="truncate">{selectedConversation.lead.email || 'Sem email cadastrado'}</span>
                  </div>

                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className="truncate">
                      {selectedConversation.lead.phone_e164 || 'Sem telefone cadastrado'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-gray-400">Canal de Preferência</span>
                    <span className="font-semibold uppercase text-[#08254f] bg-[#08254f]/8 px-2 py-0.5 rounded text-[10px]">
                      {selectedConversation.lead.contact_preference}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick Qualification Updater */}
              <div className="space-y-2 pt-3 border-t border-gray-100">
                <label className="text-xs font-semibold text-gray-700 block">
                  Status de Qualificação
                </label>
                <select
                  disabled={isUpdatingLead}
                  value={selectedConversation.lead.qualification_status || ''}
                  onChange={(e) => handleUpdateQualification(e.target.value as QualificationStatus)}
                  className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white focus:ring-1 focus:ring-brand-500 font-medium text-gray-800"
                >
                  <option value="">Nenhum</option>
                  <option value="no_response">Sem Resposta</option>
                  <option value="some_response">Respondeu</option>
                  <option value="interested">Interessado</option>
                  <option value="hot">Quente</option>
                  <option value="confirmed">Confirmado / Matrícula</option>
                </select>
                <p className="text-[10px] text-gray-400">
                  Atualizações sincronizam em tempo real com o funil comercial.
                </p>
              </div>

              {/* CRM Context Info */}
              <div className="space-y-3 pt-3 border-t border-gray-100 text-xs">
                <div>
                  <span className="text-gray-400 block text-[11px]">Curso de Interesse</span>
                  <span className="font-medium text-gray-800">
                    {selectedConversation.lead.course_interest || 'Geral / Não especificado'}
                  </span>
                </div>

                <div>
                  <span className="text-gray-400 block text-[11px]">Etapa do Funil</span>
                  <span className="font-medium text-gray-800">
                    {selectedConversation.lead.pipeline_stages?.name || 'Etapa Padrão'}
                  </span>
                </div>

                {selectedConversation.lead.last_response_at && (
                  <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                    <span className="text-[10px] font-bold text-emerald-800 uppercase block">
                      Resposta Detectada
                    </span>
                    <p className="text-[11px] text-emerald-700 mt-0.5">
                      Respondido em{' '}
                      {new Date(selectedConversation.lead.last_response_at).toLocaleString('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Complete Lead Profile Drawer */}
      {drawerLeadId && (
        <LeadProfileDrawer
          isOpen={Boolean(drawerLeadId)}
          leadId={drawerLeadId}
          onClose={() => setDrawerLeadId(null)}
        />
      )}
    </Layout>
  );
}
