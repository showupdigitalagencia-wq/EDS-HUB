import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from '../../components/Sidebar';
import {
  Calendar,
  Clock,
  MessageSquare,
  Flame,
  GraduationCap,
  CheckCircle2,
  RefreshCw,
  Search,
  Plus,
  Download,
  AlertTriangle,
  Filter,
} from 'lucide-react';
import {
  fetchDailyOperationsDashboard,
  fetchDailyOperationsQueue,
  completeCrmTask,
  exportWorkQueueCSV,
  downloadCSV,
} from './services/work-queue-service';
import { WorkItemCard } from './components/WorkItemCard';
import { CreateTaskModal } from './components/CreateTaskModal';
import { RescheduleTaskModal } from './components/RescheduleTaskModal';
import type {
  DailyOperationsDashboardKpis,
  WorkItem,
  TaskPriority,
} from '../../types/database';

export const WorkDashboardPage: React.FC = () => {
  const [kpis, setKpis] = useState<DailyOperationsDashboardKpis | null>(null);
  const [activeTab, setActiveTab] = useState<string>('today');
  const [subFilter, setSubFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | ''>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState<WorkItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [loadingKpis, setLoadingKpis] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [createTaskLeadContext, setCreateTaskLeadContext] = useState<{
    leadId: string;
    leadName?: string | null;
    title?: string;
    priority?: TaskPriority;
  } | null>(null);

  const [rescheduleTaskContext, setRescheduleTaskContext] = useState<{
    taskId: string;
    taskTitle: string;
    dueAt: string | null;
  } | null>(null);

  // Load KPIs
  const loadKpis = useCallback(async () => {
    try {
      setLoadingKpis(true);
      const data = await fetchDailyOperationsDashboard();
      setKpis(data);
    } catch (err) {
      console.error('Failed to load operations KPIs:', err);
    } finally {
      setLoadingKpis(false);
    }
  }, []);

  // Load Queue Items
  const loadQueue = useCallback(async () => {
    try {
      setLoadingItems(true);
      setError(null);

      const offset = (page - 1) * pageSize;
      const res = await fetchDailyOperationsQueue({
        tab: activeTab,
        subFilter: activeTab === 'leads' ? subFilter : null,
        priority: priorityFilter || null,
        search: searchQuery.trim() || undefined,
        limit: pageSize,
        offset,
      });

      setItems(res.items);
      setTotalCount(res.total_count);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load work queue items');
    } finally {
      setLoadingItems(false);
    }
  }, [activeTab, subFilter, priorityFilter, searchQuery, page]);

  useEffect(() => {
    loadKpis();
  }, [loadKpis]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Quick Action Handlers
  const handleCompleteTask = async (taskId: string) => {
    try {
      await completeCrmTask(taskId);
      loadKpis();
      loadQueue();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to complete task');
    }
  };

  const handleOpenReschedule = (item: WorkItem) => {
    const taskId = item.context_id || item.id.replace('task:', '');
    setRescheduleTaskContext({
      taskId,
      taskTitle: item.title,
      dueAt: item.due_at,
    });
  };

  const handleOpenCreateForLead = (item: WorkItem) => {
    if (item.lead_id) {
      setCreateTaskLeadContext({
        leadId: item.lead_id,
        leadName: item.lead_name,
        title: item.title.startsWith('Hot Lead')
          ? 'Call hot lead: ' + item.lead_name
          : 'Follow-up with: ' + item.lead_name,
        priority: item.priority,
      });
      setIsCreateTaskOpen(true);
    }
  };

  const handleExportCSV = () => {
    if (items.length === 0) return;
    const csv = exportWorkQueueCSV(items);
    downloadCSV(csv, `work_queue_${activeTab}_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto pl-64">
        {/* Header Bar */}
        <header className="px-8 py-6 bg-white border-b border-slate-200/80 sticky top-0 z-20 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-[#08254f] font-heading tracking-tight">
                  Daily Operations Command Center
                </h1>
                {kpis?.timezone && (
                  <span className="px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-600 rounded-md">
                    TZ: {kpis.timezone}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Unified work queues consolidating tasks, critical readiness issues, and commercial opportunities.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  loadKpis();
                  loadQueue();
                }}
                className="p-2 text-slate-600 hover:text-[#08254f] hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
                title="Refresh Workspace"
              >
                <RefreshCw className={`w-4 h-4 ${loadingItems ? 'animate-spin' : ''}`} />
              </button>

              <button
                onClick={handleExportCSV}
                disabled={items.length === 0}
                className="px-3 py-2 text-xs font-semibold text-slate-700 hover:text-[#08254f] bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-1.5 disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>

              <button
                onClick={() => {
                  setCreateTaskLeadContext(null);
                  setIsCreateTaskOpen(true);
                }}
                className="btn-crimson text-xs px-4 py-2 flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>New Task</span>
              </button>
            </div>
          </div>

          {/* Top KPI Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-6">
            {/* Due Today */}
            <div
              onClick={() => {
                setActiveTab('today');
                setPage(1);
              }}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                activeTab === 'today'
                  ? 'bg-blue-50/70 border-[#449bd5] ring-2 ring-[#449bd5]/20 shadow-sm'
                  : 'bg-white border-slate-200/80 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
                <span>Due Today</span>
                <Calendar className="w-3.5 h-3.5 text-[#449bd5]" />
              </div>
              <p className="text-xl font-bold text-[#08254f] mt-1.5">
                {loadingKpis ? '...' : kpis?.due_today_count ?? 0}
              </p>
            </div>

            {/* Overdue */}
            <div
              onClick={() => {
                setActiveTab('overdue');
                setPage(1);
              }}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                activeTab === 'overdue'
                  ? 'bg-red-50/70 border-red-400 ring-2 ring-red-400/20 shadow-sm'
                  : 'bg-white border-slate-200/80 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
                <span>Overdue Tasks</span>
                <Clock className="w-3.5 h-3.5 text-red-500" />
              </div>
              <p className="text-xl font-bold text-red-600 mt-1.5">
                {loadingKpis ? '...' : kpis?.overdue_count ?? 0}
              </p>
            </div>

            {/* Needs Reply */}
            <div
              onClick={() => {
                setActiveTab('needs_reply');
                setPage(1);
              }}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                activeTab === 'needs_reply'
                  ? 'bg-indigo-50/70 border-indigo-400 ring-2 ring-indigo-400/20 shadow-sm'
                  : 'bg-white border-slate-200/80 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
                <span>Needs Reply</span>
                <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
              </div>
              <p className="text-xl font-bold text-indigo-700 mt-1.5">
                {loadingKpis ? '...' : kpis?.needs_reply_count ?? 0}
              </p>
            </div>

            {/* Hot Leads */}
            <div
              onClick={() => {
                setActiveTab('leads');
                setSubFilter('hot');
                setPage(1);
              }}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                activeTab === 'leads' && subFilter === 'hot'
                  ? 'bg-amber-50/70 border-amber-400 ring-2 ring-amber-400/20 shadow-sm'
                  : 'bg-white border-slate-200/80 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
                <span>Hot Leads</span>
                <Flame className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <p className="text-xl font-bold text-amber-800 mt-1.5">
                {loadingKpis ? '...' : kpis?.hot_leads_count ?? 0}
              </p>
            </div>

            {/* Course Ops Issues */}
            <div
              onClick={() => {
                setActiveTab('courses');
                setPage(1);
              }}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                activeTab === 'courses'
                  ? 'bg-purple-50/70 border-purple-400 ring-2 ring-purple-400/20 shadow-sm'
                  : 'bg-white border-slate-200/80 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
                <span>Course Ops</span>
                <GraduationCap className="w-3.5 h-3.5 text-purple-600" />
              </div>
              <p className="text-xl font-bold text-purple-800 mt-1.5">
                {loadingKpis ? '...' : kpis?.course_attention_count ?? 0}
              </p>
            </div>

            {/* Completed Today */}
            <div
              onClick={() => {
                setActiveTab('completed');
                setPage(1);
              }}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                activeTab === 'completed'
                  ? 'bg-emerald-50/70 border-emerald-400 ring-2 ring-emerald-400/20 shadow-sm'
                  : 'bg-white border-slate-200/80 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
                <span>Completed Today</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <p className="text-xl font-bold text-emerald-700 mt-1.5">
                {loadingKpis ? '...' : kpis?.completed_today_count ?? 0}
              </p>
            </div>
          </div>
        </header>

        {/* Workspace Body */}
        <main className="flex-1 p-8 space-y-6">
          {/* Tabs Navigation & Search Bar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Primary Tab Buttons */}
            <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-white border border-slate-200/80 rounded-2xl shadow-sm">
              <button
                onClick={() => {
                  setActiveTab('today');
                  setSubFilter(null);
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'today'
                    ? 'bg-[#08254f] text-white shadow-sm'
                    : 'text-slate-600 hover:text-[#08254f] hover:bg-slate-100'
                }`}
              >
                My Day
              </button>

              <button
                onClick={() => {
                  setActiveTab('overdue');
                  setSubFilter(null);
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'overdue'
                    ? 'bg-[#08254f] text-white shadow-sm'
                    : 'text-slate-600 hover:text-[#08254f] hover:bg-slate-100'
                }`}
              >
                Overdue
              </button>

              <button
                onClick={() => {
                  setActiveTab('needs_reply');
                  setSubFilter(null);
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'needs_reply'
                    ? 'bg-[#08254f] text-white shadow-sm'
                    : 'text-slate-600 hover:text-[#08254f] hover:bg-slate-100'
                }`}
              >
                Needs Reply
              </button>

              <button
                onClick={() => {
                  setActiveTab('leads');
                  setSubFilter('hot');
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'leads'
                    ? 'bg-[#08254f] text-white shadow-sm'
                    : 'text-slate-600 hover:text-[#08254f] hover:bg-slate-100'
                }`}
              >
                Leads
              </button>

              <button
                onClick={() => {
                  setActiveTab('courses');
                  setSubFilter(null);
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'courses'
                    ? 'bg-[#08254f] text-white shadow-sm'
                    : 'text-slate-600 hover:text-[#08254f] hover:bg-slate-100'
                }`}
              >
                Courses
              </button>

              <button
                onClick={() => {
                  setActiveTab('payments');
                  setSubFilter(null);
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'payments'
                    ? 'bg-[#08254f] text-white shadow-sm'
                    : 'text-slate-600 hover:text-[#08254f] hover:bg-slate-100'
                }`}
              >
                Payments
              </button>

              <button
                onClick={() => {
                  setActiveTab('post_course');
                  setSubFilter(null);
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'post_course'
                    ? 'bg-[#08254f] text-white shadow-sm'
                    : 'text-slate-600 hover:text-[#08254f] hover:bg-slate-100'
                }`}
              >
                Post-Course
              </button>

              <button
                onClick={() => {
                  setActiveTab('completed');
                  setSubFilter(null);
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'completed'
                    ? 'bg-[#08254f] text-white shadow-sm'
                    : 'text-slate-600 hover:text-[#08254f] hover:bg-slate-100'
                }`}
              >
                Completed
              </button>
            </div>

            {/* Filters Bar: Priority + Search */}
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <select
                  value={priorityFilter}
                  onChange={(e) => {
                    setPriorityFilter(e.target.value as TaskPriority | '');
                    setPage(1);
                  }}
                  className="pl-3 pr-8 py-2 text-xs font-medium border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#449bd5]/20 focus:border-[#449bd5]"
                >
                  <option value="">All Priorities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search work items..."
                  className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#449bd5]/20 focus:border-[#449bd5] bg-white"
                />
              </div>
            </div>
          </div>

          {/* Subfilter Bar for Leads Tab */}
          {activeTab === 'leads' && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                <Filter className="w-3 h-3" />
                Filter:
              </span>
              <button
                onClick={() => {
                  setSubFilter('hot');
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  subFilter === 'hot'
                    ? 'bg-amber-100 text-amber-800 font-semibold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Hot Leads ({kpis?.hot_leads_count ?? 0})
              </button>
              <button
                onClick={() => {
                  setSubFilter('no_action');
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  subFilter === 'no_action'
                    ? 'bg-sky-100 text-sky-800 font-semibold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                No Next Action ({kpis?.leads_no_next_action_count ?? 0})
              </button>
              <button
                onClick={() => {
                  setSubFilter('stale');
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  subFilter === 'stale'
                    ? 'bg-purple-100 text-purple-800 font-semibold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Stale Leads ({kpis?.stale_leads_count ?? 0})
              </button>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Work Queue Items List */}
          <div className="space-y-3">
            {loadingItems ? (
              <div className="p-12 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-[#449bd5]" />
                <span>Loading operational items...</span>
              </div>
            ) : items.length === 0 ? (
              <div className="p-12 bg-white rounded-2xl border border-slate-200/80 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                <h3 className="text-sm font-bold text-slate-800 font-heading">
                  All Clear in this Queue
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  No items require attention in this category right now. Great job keeping operations up to date!
                </p>
              </div>
            ) : (
              items.map((item) => (
                <WorkItemCard
                  key={item.id}
                  item={item}
                  onCompleteTask={handleCompleteTask}
                  onRescheduleTask={handleOpenReschedule}
                  onCreateTaskForLead={handleOpenCreateForLead}
                />
              ))
            )}
          </div>

          {/* Pagination Controls */}
          {totalCount > pageSize && (
            <div className="flex items-center justify-between pt-4 border-t border-slate-200 text-xs text-slate-500">
              <span>
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalCount)} of {totalCount} items
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="font-semibold text-slate-700">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Create Task Modal */}
      <CreateTaskModal
        isOpen={isCreateTaskOpen}
        onClose={() => {
          setIsCreateTaskOpen(false);
          setCreateTaskLeadContext(null);
        }}
        onTaskCreated={() => {
          loadKpis();
          loadQueue();
        }}
        initialLeadId={createTaskLeadContext?.leadId}
        initialLeadName={createTaskLeadContext?.leadName}
        initialTitle={createTaskLeadContext?.title}
        initialPriority={createTaskLeadContext?.priority}
      />

      {/* Reschedule Task Modal */}
      {rescheduleTaskContext && (
        <RescheduleTaskModal
          isOpen={true}
          onClose={() => setRescheduleTaskContext(null)}
          onRescheduled={() => {
            loadKpis();
            loadQueue();
          }}
          taskId={rescheduleTaskContext.taskId}
          taskTitle={rescheduleTaskContext.taskTitle}
          currentDueAt={rescheduleTaskContext.dueAt}
        />
      )}
    </div>
  );
};
