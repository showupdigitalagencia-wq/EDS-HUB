import React, { useState, useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { createOrUpdateCourseSession } from '../services/course-operations-service';
import type { Course, CourseSessionStatus, UpcomingSessionSummary } from '../../../types/database';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  sessionToEdit?: UpcomingSessionSummary | null;
}

const CANONICAL_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'UTC',
];

export const SessionModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSuccess,
  sessionToEdit,
}) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState('');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<CourseSessionStatus>('open');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [capacity, setCapacity] = useState<string>('12');
  const [location, setLocation] = useState('Orlando, FL');
  const [instructorName, setInstructorName] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadCourses();
      if (sessionToEdit) {
        setCourseId(sessionToEdit.course_id);
        setCode(sessionToEdit.code);
        setTitle(sessionToEdit.title);
        setStatus(sessionToEdit.status);
        setStartDate(sessionToEdit.start_date);
        setEndDate(sessionToEdit.end_date);
        setTimezone(sessionToEdit.timezone || 'America/New_York');
        setCapacity(sessionToEdit.capacity !== null ? String(sessionToEdit.capacity) : '');
        setLocation(sessionToEdit.location || 'Orlando, FL');
        setInstructorName(sessionToEdit.instructor_name || '');
        setError(null);
      } else {
        resetForm();
      }
    }
  }, [isOpen, sessionToEdit]);

  const loadCourses = async () => {
    try {
      const { data } = await supabase
        .from('courses')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true });
      if (data) {
        setCourses(data);
        if (!sessionToEdit && data.length > 0 && !courseId) {
          setCourseId(data[0].id);
          autoGenerateCodeAndTitle(data[0]);
        }
      }
    } catch (err) {
      console.error('Error loading courses:', err);
    }
  };

  const autoGenerateCodeAndTitle = (course: Course) => {
    const currentYear = new Date().getFullYear();
    const nextMonth = String(new Date().getMonth() + 2).padStart(2, '0');
    setCode(`${course.code || 'COURSE'}-${currentYear}-${nextMonth}`);
    setTitle(`${course.name} — Class of ${currentYear}/${nextMonth}`);
  };

  const handleCourseChange = (id: string) => {
    setCourseId(id);
    const selected = courses.find((c) => c.id === id);
    if (selected && !sessionToEdit) {
      autoGenerateCodeAndTitle(selected);
    }
  };

  const resetForm = () => {
    setCode('');
    setTitle('');
    setStatus('open');
    setStartDate('');
    setEndDate('');
    setTimezone('America/New_York');
    setCapacity('12');
    setLocation('Orlando, FL');
    setInstructorName('');
    setNotes('');
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!courseId) {
      setError('Please select a course.');
      return;
    }
    if (!code.trim()) {
      setError('Session code is required.');
      return;
    }
    if (!title.trim()) {
      setError('Session title is required.');
      return;
    }
    if (!startDate || !endDate) {
      setError('Start date and End date are required.');
      return;
    }
    if (endDate < startDate) {
      setError('End date cannot be earlier than start date.');
      return;
    }

    const parsedCap = capacity.trim() === '' ? null : parseInt(capacity, 10);
    if (parsedCap !== null && (isNaN(parsedCap) || parsedCap <= 0)) {
      setError('Capacity must be a positive integer or left blank.');
      return;
    }

    setLoading(true);
    try {
      await createOrUpdateCourseSession({
        sessionId: sessionToEdit?.id,
        courseId,
        code: code.trim().toUpperCase(),
        title: title.trim(),
        status,
        startDate,
        endDate,
        timezone,
        capacity: parsedCap,
        location: location.trim(),
        instructorName: instructorName.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save course session.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden transform transition-all">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {sessionToEdit ? 'Edit Course Session' : 'Create Course Session'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Configuração operacional da turma presencial e capacidade
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Course Select */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Course *
            </label>
            <select
              value={courseId}
              onChange={(e) => handleCourseChange(e.target.value)}
              disabled={!!sessionToEdit}
              className="w-full text-sm rounded-lg border border-slate-300 py-2 px-3 bg-white text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>

          {/* Code & Title */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Session Code *
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="IDIT-2026-10"
                className="w-full text-sm rounded-lg border border-slate-300 py-2 px-3 text-slate-900 font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Session Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Intensive Dental Implant Training - Oct 2026"
                className="w-full text-sm rounded-lg border border-slate-300 py-2 px-3 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Dates & Timezone */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Start Date *
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full text-sm rounded-lg border border-slate-300 py-2 px-3 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                End Date *
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full text-sm rounded-lg border border-slate-300 py-2 px-3 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Timezone *
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full text-sm rounded-lg border border-slate-300 py-2 px-3 bg-white text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                {CANONICAL_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Capacity, Status, Location */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Capacity (Seats)
              </label>
              <input
                type="number"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="12 (Blank = Unlimited)"
                min="1"
                className="w-full text-sm rounded-lg border border-slate-300 py-2 px-3 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Status *
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as CourseSessionStatus)}
                className="w-full text-sm rounded-lg border border-slate-300 py-2 px-3 bg-white text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="draft">Draft (em preparação)</option>
                <option value="open">Open (aberta para matrículas)</option>
                <option value="confirmed">Confirmed (confirmada)</option>
                <option value="completed">Completed (concluída)</option>
                <option value="cancelled">Cancelled (cancelada)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Location
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Orlando, FL"
                className="w-full text-sm rounded-lg border border-slate-300 py-2 px-3 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Instructor Name & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Instructor Name
              </label>
              <input
                type="text"
                value={instructorName}
                onChange={(e) => setInstructorName(e.target.value)}
                placeholder="Dr. John Doe"
                className="w-full text-sm rounded-lg border border-slate-300 py-2 px-3 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Notes
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observações operacionais..."
                className="w-full text-sm rounded-lg border border-slate-300 py-2 px-3 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving...' : sessionToEdit ? 'Update Session' : 'Create Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
