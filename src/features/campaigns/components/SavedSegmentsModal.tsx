import { useState, useEffect, useCallback, useId } from 'react';
import { campaignAudienceService } from '../services/campaign-audience-service';
import type { AudienceFilterDefinition, SavedSegment } from '../../../types';
import { X, Bookmark, Plus, Trash2, Check } from 'lucide-react';

interface SavedSegmentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentFilterDefinition?: AudienceFilterDefinition;
  onApplySegment?: (segment: SavedSegment) => void;
}

export function SavedSegmentsModal({
  isOpen,
  onClose,
  currentFilterDefinition = { version: 1, operator: 'and', rules: [] },
  onApplySegment,
}: SavedSegmentsModalProps) {
  const [segments, setSegments] = useState<SavedSegment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New segment form
  const [newSegmentName, setNewSegmentName] = useState('');
  const [newSegmentDesc, setNewSegmentDesc] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const segmentNameInputId = useId();
  const segmentDescInputId = useId();

  const loadSegments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await campaignAudienceService.listSavedSegments();
      setSegments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load saved segments');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadSegments();
    }
  }, [isOpen, loadSegments]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSegmentName.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const created = await campaignAudienceService.createSavedSegment(
        newSegmentName,
        newSegmentDesc,
        currentFilterDefinition,
      );
      setSegments([created, ...segments]);
      setNewSegmentName('');
      setNewSegmentDesc('');
      setShowCreateForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating saved segment');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this saved segment?')) return;
    try {
      await campaignAudienceService.deleteSavedSegment(id);
      setSegments(segments.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error deleting segment');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark className="h-5 w-5 text-brand-600" />
            <h3 className="text-base font-bold text-gray-900">Saved Audience Segments</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Action Button: Toggle Create Form */}
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {segments.length} saved {segments.length === 1 ? 'segment' : 'segments'} available
          </span>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-brand-600 text-white hover:bg-brand-700 transition-colors shadow-2xs cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            {showCreateForm ? 'Cancel' : 'Save Current Filter as Segment'}
          </button>
        </div>

        {/* Create Form Drawer */}
        {showCreateForm && (
          <form onSubmit={handleCreate} className="p-5 border-b border-gray-100 bg-brand-50/40 space-y-3">
            <h4 className="text-xs font-bold text-brand-950 uppercase tracking-wider">
              Save Current Audience Criteria
            </h4>
            <div className="space-y-2">
              <div>
                <label htmlFor={segmentNameInputId} className="block text-xs font-semibold text-gray-700 mb-1">
                  Segment Name *
                </label>
                <input
                  id={segmentNameInputId}
                  type="text"
                  required
                  value={newSegmentName}
                  onChange={(e) => setNewSegmentName(e.target.value)}
                  placeholder="e.g. Hot Leads — High Score & Inactive"
                  className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-xl bg-white"
                />
              </div>
              <div>
                <label htmlFor={segmentDescInputId} className="block text-xs font-semibold text-gray-700 mb-1">
                  Description (optional)
                </label>
                <input
                  id={segmentDescInputId}
                  type="text"
                  value={newSegmentDesc}
                  onChange={(e) => setNewSegmentDesc(e.target.value)}
                  placeholder="Brief explanation of when to use this audience segment"
                  className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-xl bg-white"
                />
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={isSaving || !newSegmentName.trim()}
                className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-gray-900 text-white hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Confirm & Save Segment'}
              </button>
            </div>
          </form>
        )}

        {/* List of Saved Segments */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && <p className="mb-4 text-xs font-semibold text-rose-600">{error}</p>}

          {isLoading ? (
            <div className="py-12 text-center text-xs text-gray-400">Loading saved segments...</div>
          ) : segments.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-400">
              No saved segments found. Click &quot;Save Current Filter as Segment&quot; above to create one.
            </div>
          ) : (
            <div className="space-y-3">
              {segments.map((segment) => (
                <div
                  key={segment.id}
                  className="p-4 rounded-xl border border-gray-200 bg-white hover:border-gray-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
                >
                  <div className="space-y-1">
                    <span className="font-bold text-xs text-gray-900 block">{segment.name}</span>
                    {segment.description && (
                      <p className="text-[11px] text-gray-500">{segment.description}</p>
                    )}
                    <span className="text-[10px] text-gray-400 block">
                      Updated {new Date(segment.updated_at).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    {onApplySegment && (
                      <button
                        type="button"
                        onClick={() => {
                          onApplySegment(segment);
                          onClose();
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors cursor-pointer"
                      >
                        <Check className="h-3 w-3" />
                        Apply to Campaign
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(segment.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      title="Delete saved segment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-gray-900 text-white hover:bg-black transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
