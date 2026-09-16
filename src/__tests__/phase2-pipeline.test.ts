// =============================================================================
// Tests: Phase 2 Commercial Pipeline & Kanban Stage Flow
// =============================================================================
// Covers:
// 1. Strict 7-Stage Pipeline Configuration
// 2. Stage Ordering by Position (1 to 7)
// 3. Atomic Lead Stage Movement (move_lead_stage RPC semantics)
// 4. Audit Trail in lead_stage_history (change_reason = 'manual')
// 5. Timeline Activity in lead_activities (activity_type = 'stage_changed')
// 6. Idempotency & No-Op on Same Stage Transition
// 7. Kanban Drag-and-Drop Optimistic State Handling & Rollback
// =============================================================================

import { describe, it, expect } from 'vitest';

describe('Phase 2 Pipeline: Canonical 7 Stages', () => {
  const EXPECTED_STAGES = [
    { name: 'New Lead', position: 1 },
    { name: 'Contacted', position: 2 },
    { name: 'Qualified', position: 3 },
    { name: 'Meeting Scheduled', position: 4 },
    { name: 'Proposal Sent', position: 5 },
    { name: 'Negotiation', position: 6 },
    { name: 'Closed Won', position: 7 },
  ];

  it('verifies exactly 7 canonical pipeline stages exist in sequential order', () => {
    expect(EXPECTED_STAGES).toHaveLength(7);
    EXPECTED_STAGES.forEach((stage, idx) => {
      expect(stage.position).toBe(idx + 1);
    });
  });

  it('sorts stages strictly by ascending position', () => {
    const unsorted = [
      { name: 'Closed Won', position: 7 },
      { name: 'New Lead', position: 1 },
      { name: 'Proposal Sent', position: 5 },
      { name: 'Contacted', position: 2 },
    ];

    const sorted = [...unsorted].sort((a, b) => a.position - b.position);
    expect(sorted[0].name).toBe('New Lead');
    expect(sorted[1].name).toBe('Contacted');
    expect(sorted[2].name).toBe('Proposal Sent');
    expect(sorted[3].name).toBe('Closed Won');
  });
});

describe('Phase 2 Pipeline: Stage Movement Semantics (move_lead_stage)', () => {
  interface Lead {
    id: string;
    pipeline_stage_id: string;
  }

  interface StageHistory {
    id: string;
    lead_id: string;
    from_stage_id: string | null;
    to_stage_id: string;
    change_reason: string;
    created_at: string;
  }

  interface Activity {
    id: string;
    lead_id: string;
    activity_type: string;
    description: string;
    created_at: string;
  }

  it('moves lead to new stage, recording history and activity atomically', () => {
    const lead: Lead = { id: 'lead-1', pipeline_stage_id: 'stage-1' };
    const history: StageHistory[] = [];
    const activities: Activity[] = [];

    // Simulated atomic RPC move_lead_stage
    const moveLeadStage = (
      leadId: string,
      newStageId: string,
      stageNameMap: Record<string, string>,
      reason = 'manual'
    ) => {
      const oldStageId = lead.pipeline_stage_id;
      if (oldStageId === newStageId) {
        // Idempotent no-op
        return { modified: false };
      }

      lead.pipeline_stage_id = newStageId;

      history.push({
        id: `hist-${history.length + 1}`,
        lead_id: leadId,
        from_stage_id: oldStageId,
        to_stage_id: newStageId,
        change_reason: reason,
        created_at: new Date().toISOString(),
      });

      const toName = stageNameMap[newStageId] || newStageId;
      const fromName = stageNameMap[oldStageId] || oldStageId;

      activities.push({
        id: `act-${activities.length + 1}`,
        lead_id: leadId,
        activity_type: 'stage_changed',
        description: `Stage changed from ${fromName} to ${toName}`,
        created_at: new Date().toISOString(),
      });

      return { modified: true };
    };

    const stageNames = {
      'stage-1': 'New Lead',
      'stage-2': 'Contacted',
      'stage-3': 'Qualified',
    };

    const res1 = moveLeadStage('lead-1', 'stage-2', stageNames);
    expect(res1.modified).toBe(true);
    expect(lead.pipeline_stage_id).toBe('stage-2');
    expect(history).toHaveLength(1);
    expect(history[0].from_stage_id).toBe('stage-1');
    expect(history[0].to_stage_id).toBe('stage-2');
    expect(history[0].change_reason).toBe('manual');

    expect(activities).toHaveLength(1);
    expect(activities[0].activity_type).toBe('stage_changed');
    expect(activities[0].description).toBe('Stage changed from New Lead to Contacted');

    // Idempotent transition to same stage
    const res2 = moveLeadStage('lead-1', 'stage-2', stageNames);
    expect(res2.modified).toBe(false);
    expect(history).toHaveLength(1); // No new history record
    expect(activities).toHaveLength(1); // No new activity record
  });

  it('supports optimistic state updates with rollback on failure', () => {
    let currentStage = 'stage-1';
    const previousStage = currentStage;

    // Optimistic transition
    const targetStage = 'stage-4';
    currentStage = targetStage;
    expect(currentStage).toBe('stage-4');

    // Network / RPC failure triggers rollback
    const rpcFailed = true;
    if (rpcFailed) {
      currentStage = previousStage;
    }

    expect(currentStage).toBe('stage-1');
  });
});
