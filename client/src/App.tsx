import { useCallback, useMemo, useState } from 'react';
import { usePipelineStream } from './hooks/usePipelineStream';
import { CompanySelector } from './components/CompanySelector';
import { ConfigEditor } from './components/ConfigEditor';
import { RunControls } from './components/RunControls';
import { StagePanel } from './components/StagePanel';
import { ReportCard } from './components/ReportCard';
import { ScoredJobsList } from './components/ScoredJobsList';
import { AddCompanyDialog } from './components/AddCompanyDialog';
import type { NewCompanyInput } from './components/AddCompanyDialog';
import type {
  StageNumber,
  PipelineEvent,
  ReportCard as ReportCardData,
  ScoredJobSummary,
  RunMode,
} from './types/events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAGE_ORDER: StageNumber[] = [1, 2, 3, 4, 5];

interface StageData {
  stage: StageNumber;
  label: string;
  passedJobs: Array<{
    id: number;
    title: string;
    url: string;
    department?: string;
    location?: string;
    updatedAt?: string;
    firstPublished?: string;
  }>;
  rejectedJobs: Array<{ id: number; title: string; url: string; reason: string }>;
  isRunning: boolean;
  isComplete: boolean;
  isPending: boolean;
}

/**
 * Derive per-stage data from the flat event list.
 * Stages appear in order 1–5 regardless of whether they've started.
 */
function buildStageData(events: PipelineEvent[], status: string): StageData[] {
  const stageLabels = new Map<StageNumber, string>();
  const passedJobs = new Map<
    StageNumber,
    Array<{
      id: number;
      title: string;
      url: string;
      department?: string;
      location?: string;
      updatedAt?: string;
      firstPublished?: string;
    }>
  >();
  const rejectedJobs = new Map<
    StageNumber,
    Array<{ id: number; title: string; url: string; reason: string }>
  >();
  const completedStages = new Set<StageNumber>();

  // Initialise empty maps
  for (const s of STAGE_ORDER) {
    passedJobs.set(s, []);
    rejectedJobs.set(s, []);
  }

  for (const event of events) {
    switch (event.type) {
      case 'stage-start':
        stageLabels.set(event.stage, event.label);
        break;

      case 'stage-complete':
        completedStages.add(event.stage);
        break;

      case 'job-passed': {
        const list = passedJobs.get(event.stage);
        if (list) {
          list.push(event.job);
        }
        break;
      }

      case 'job-rejected': {
        const list = rejectedJobs.get(event.stage);
        if (list) {
          list.push({
            id: event.job.id,
            title: event.job.title,
            url: event.job.url,
            reason: event.job.reason,
          });
        }
        break;
      }
    }
  }

  // Determine which stage is currently running (latest stage-start without stage-complete)
  let currentRunningStage: StageNumber | null = null;
  for (const s of STAGE_ORDER) {
    if (stageLabels.has(s) && !completedStages.has(s)) {
      currentRunningStage = s;
    }
  }

  return STAGE_ORDER.map((stage) => {
    const label = stageLabels.get(stage) ?? `Stage ${stage}`;
    const isComplete = completedStages.has(stage);
    const isRunning =
      currentRunningStage === stage ||
      (status === 'running' && stageLabels.has(stage) && !completedStages.has(stage));
    const isPending =
      !stageLabels.has(stage) && (status === 'running' || status === 'awaiting_input');

    return {
      stage,
      label,
      passedJobs: passedJobs.get(stage) ?? [],
      rejectedJobs: rejectedJobs.get(stage) ?? [],
      isRunning,
      isComplete,
      isPending,
    };
  });
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const [token, setToken] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>('all');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const {
    state,
    start,
    startStep,
    nextStage,
    cancelStep,
    reset,
  } = usePipelineStream(token ?? '');

  const handleRun = () => start();
  const handleStartStep = () => startStep();
  const handleNextStage = () => nextStage();
  const handleCancelStep = () => cancelStep();
  const handleReset = () => reset();

  const handleRunModeChange = useCallback(
    (mode: RunMode) => {
      // Only allow mode change when idle or terminal
      if (state.status === 'idle' || state.status === 'complete' || state.status === 'error') {
        setRunMode(mode);
      }
    },
    [state.status],
  );

  const handleUnsavedChanges = useCallback((dirty: boolean) => {
    setHasUnsavedChanges(dirty);
  }, []);

  const handleAddClick = useCallback(() => {
    setAddDialogOpen(true);
  }, []);

  const handleCreateCompany = useCallback(
    async (input: NewCompanyInput): Promise<string | null> => {
      try {
        const res = await fetch('/api/config/company', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return body.detail ?? body.error ?? `Create failed (${res.status})`;
        }

        // Select the newly created company
        setToken(input.token);
        return null; // success
      } catch (err) {
        return String(err);
      }
    },
    [],
  );

  const handleDeleteClick = useCallback(
    async (companyToken: string) => {
      setDeleting(true);
      try {
        const res = await fetch(
          `/api/config/company/${encodeURIComponent(companyToken)}`,
          { method: 'DELETE' },
        );

        if (!res.ok && res.status !== 204) {
          // Log but don't block — refresh will show if it's still there
          console.error(`Delete returned ${res.status}`);
        }

        // If the deleted company was selected, clear selection
        if (token === companyToken) {
          setToken(null);
        }
      } catch (err) {
        console.error('Delete failed:', err);
      } finally {
        setDeleting(false);
      }
    },
    [token],
  );

  const stageDataList = useMemo(
    () => buildStageData(state.events, state.status),
    [state.events, state.status],
  );

  // Extract report card and scored jobs from the run-complete event (last event)
  const { reportCard, scoredJobs } = useMemo<{
    reportCard: ReportCardData | null;
    scoredJobs: ScoredJobSummary[];
  }>(() => {
    const runCompleteEvent = state.events.find(
      (e): e is PipelineEvent & { type: 'run-complete' } =>
        e.type === 'run-complete',
    );
    if (runCompleteEvent && runCompleteEvent.type === 'run-complete') {
      return {
        reportCard: runCompleteEvent.reportCard,
        scoredJobs: runCompleteEvent.scoredJobs,
      };
    }
    return { reportCard: null, scoredJobs: [] };
  }, [state.events]);

  return (
    <main style={{ padding: '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Job Harvester</h1>

      <section style={{ marginBottom: '1rem' }}>
        <label htmlFor="company-select" style={{ marginRight: '0.5rem' }}>
          Company:
        </label>
        <CompanySelector
          token={token}
          onTokenChange={setToken}
          onAddClick={handleAddClick}
          onDeleteClick={handleDeleteClick}
          deleting={deleting}
        />
      </section>

      {/* Config Editor — embedded between company selector and run controls */}
      <ConfigEditor token={token} onUnsavedChanges={handleUnsavedChanges} />

      <section style={{ marginBottom: '1rem' }}>
        <RunControls
          token={token}
          status={state.status}
          onRun={handleRun}
          onReset={handleReset}
          hasUnsavedChanges={hasUnsavedChanges}
          runMode={runMode}
          onRunModeChange={handleRunModeChange}
          onStartStep={handleStartStep}
          onNextStage={handleNextStage}
          onCancelStep={handleCancelStep}
          nextStage={state.nextStage}
        />
      </section>

      {/* Status bar */}
      <section style={{ marginBottom: '1rem' }}>
        <p>
          <strong>Status:</strong>{' '}
          <span
            style={{
              color:
                state.status === 'error'
                  ? 'red'
                  : state.status === 'complete'
                    ? 'green'
                    : state.status === 'running'
                      ? 'blue'
                      : state.status === 'awaiting_input'
                        ? '#e67e22'
                        : 'inherit',
            }}
          >
            {state.status}
            {state.status === 'awaiting_input' && state.nextStage
              ? ` — Stage ${state.nextStage} ready`
              : ''}
          </span>
        </p>

        {state.error && (
          <p style={{ color: 'red' }}>
            <strong>Error:</strong> {state.error}
          </p>
        )}
      </section>

      {/* Stage panels */}
      <section>
        <h2>Pipeline Stages</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {stageDataList.map((sd) => (
            <StagePanel
              key={sd.stage}
              stage={sd.stage}
              label={sd.label}
              passedJobs={sd.passedJobs}
              rejectedJobs={sd.rejectedJobs}
              isRunning={sd.isRunning}
              isComplete={sd.isComplete}
              isPending={sd.isPending}
            />
          ))}
        </div>
      </section>

      {/* Report card — shown on run-complete */}
      {reportCard && <ReportCard reportCard={reportCard} />}

      {/* Scored jobs list — shown on run-complete */}
      {scoredJobs.length > 0 && <ScoredJobsList scoredJobs={scoredJobs} />}

      {/* Add Company Dialog */}
      <AddCompanyDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onCreate={handleCreateCompany}
      />

      {/* Raw events — kept for debugging */}
      <details style={{ marginTop: '1.5rem' }}>
        <summary>Events ({state.events.length})</summary>
        <pre
          style={{
            background: '#f5f5f5',
            padding: '0.75rem',
            borderRadius: '4px',
            maxHeight: '400px',
            overflow: 'auto',
            fontSize: '0.8rem',
          }}
        >
          {JSON.stringify(state.events, null, 2)}
        </pre>
      </details>
    </main>
  );
}

export default App;
