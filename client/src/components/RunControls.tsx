import type { PipelineStatus } from '../hooks/usePipelineStream';
import type { RunMode } from '../types/events';

interface RunControlsProps {
  token: string | null;
  status: PipelineStatus;
  onRun: () => void;
  onReset: () => void;
  /** When true, the config editor has unsaved changes – Run / Start buttons are disabled. */
  hasUnsavedChanges?: boolean;

  // Step mode
  runMode: RunMode;
  onRunModeChange: (mode: RunMode) => void;
  onStartStep?: () => void;
  onNextStage?: () => void;
  onCancelStep?: () => void;
  /** Which stage will run next (shown on Next Stage button). */
  nextStage?: number | null;
}

export function RunControls({
  token,
  status,
  onRun,
  onReset,
  hasUnsavedChanges = false,
  runMode,
  onRunModeChange,
  onStartStep,
  onNextStage,
  onCancelStep,
  nextStage,
}: RunControlsProps) {
  const isIdle = status === 'idle';
  const isRunning = status === 'running';
  const isAwaitingInput = status === 'awaiting_input';
  const isTerminal = status === 'complete' || status === 'error';

  // In "all" mode, Run button is disabled when: no token, running, or unsaved.
  const runDisabled = token === null || isRunning || hasUnsavedChanges;

  // In "step" mode, Start button is disabled when: no token, running, or unsaved.
  const startStepDisabled = token === null || isRunning || hasUnsavedChanges;

  // Next Stage button is enabled only when awaiting input.
  const nextDisabled = !isAwaitingInput || nextStage === null;

  // Cancel button visible only during step mode (running or awaiting).
  const showCancel = runMode === 'step' && (isRunning || isAwaitingInput) && !isTerminal;

  return (
    <div>
      {/* ---- Mode toggle ---- */}
      <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Mode:</span>
        <label style={{ cursor: 'pointer', fontSize: '0.9rem' }}>
          <input
            type="radio"
            name="runMode"
            value="all"
            checked={runMode === 'all'}
            onChange={() => onRunModeChange('all')}
            disabled={!isIdle && !isTerminal}
            style={{ marginRight: '0.25rem' }}
          />
          Run All
        </label>
        <label style={{ cursor: 'pointer', fontSize: '0.9rem' }}>
          <input
            type="radio"
            name="runMode"
            value="step"
            checked={runMode === 'step'}
            onChange={() => onRunModeChange('step')}
            disabled={!isIdle && !isTerminal}
            style={{ marginRight: '0.25rem' }}
          />
          Step
        </label>
      </div>

      {/* ---- Buttons ---- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {/* Run All button (visible only in "all" mode) */}
        {runMode === 'all' && (
          <button
            onClick={onRun}
            disabled={runDisabled}
            title={
              hasUnsavedChanges
                ? 'Save or discard unsaved config changes before running'
                : token === null
                  ? 'Select a company first'
                  : isRunning
                    ? 'Pipeline is already running'
                    : 'Start pipeline'
            }
          >
            Run Pipeline
          </button>
        )}

        {/* Step mode: Start button (when idle) */}
        {runMode === 'step' && isIdle && (
          <button
            onClick={onStartStep}
            disabled={startStepDisabled}
            title={
              hasUnsavedChanges
                ? 'Save or discard unsaved config changes before running'
                : token === null
                  ? 'Select a company first'
                  : 'Start step-mode pipeline'
            }
          >
            Start
          </button>
        )}

        {/* Step mode: Next Stage button (when awaiting input) */}
        {runMode === 'step' && isAwaitingInput && (
          <button
            onClick={onNextStage}
            disabled={nextDisabled}
            title={
              nextStage
                ? `Run Stage ${nextStage}`
                : 'No more stages'
            }
          >
            Next Stage{nextStage ? ` (${nextStage})` : ''}
          </button>
        )}

        {/* Step mode: Cancel button */}
        {showCancel && (
          <button
            onClick={onCancelStep}
            style={{ background: '#e74c3c', color: '#fff', border: 'none' }}
            title="Cancel step session"
          >
            Cancel
          </button>
        )}

        {/* Unsaved changes warning */}
        {hasUnsavedChanges && (
          <span style={{ color: '#e67e22', marginLeft: '0.25rem', fontSize: '0.85rem' }}>
            ⚠ Unsaved changes
          </span>
        )}

        {/* Reset button (always visible when not idle) */}
        {!isIdle && (
          <button
            onClick={onReset}
            title="Reset pipeline state"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
