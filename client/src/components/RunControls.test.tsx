import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RunControls } from './RunControls';
import type { PipelineStatus } from '../hooks/usePipelineStream';
import type { RunMode } from '../types/events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RunControlsOverrides {
  token?: string | null;
  status?: PipelineStatus;
  hasUnsavedChanges?: boolean;
  runMode?: RunMode;
  nextStage?: number | null;
  onRun?: () => void;
  onReset?: () => void;
  onRunModeChange?: (mode: RunMode) => void;
  onStartStep?: () => void;
  onNextStage?: () => void;
  onCancelStep?: () => void;
}

function defaultProps(overrides: RunControlsOverrides = {}) {
  return {
    token: 'test-token',
    status: 'idle' as PipelineStatus,
    onRun: vi.fn(),
    onReset: vi.fn(),
    hasUnsavedChanges: false,
    runMode: 'all' as RunMode,
    onRunModeChange: vi.fn(),
    onStartStep: vi.fn(),
    onNextStage: vi.fn(),
    onCancelStep: vi.fn(),
    nextStage: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunControls', () => {
  // ---------------------------------------------------------------------------
  // Run button disable logic
  // ---------------------------------------------------------------------------

  it('disables Run button when token is null', () => {
    render(<RunControls {...defaultProps({ token: null })} />);

    const runButton = screen.getByRole('button', { name: 'Run Pipeline' });
    expect(runButton).toBeDefined();
    expect((runButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Run button when hasUnsavedChanges is true', () => {
    render(<RunControls {...defaultProps({ hasUnsavedChanges: true })} />);

    const runButton = screen.getByRole('button', { name: 'Run Pipeline' });
    expect((runButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Run button when token is set and no unsaved changes (idle state)', () => {
    render(
      <RunControls
        {...defaultProps({ token: 'valid-token', hasUnsavedChanges: false })}
      />,
    );

    const runButton = screen.getByRole('button', { name: 'Run Pipeline' });
    expect((runButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables Run button when status is running', () => {
    render(
      <RunControls
        {...defaultProps({ token: 'valid-token', status: 'running' })}
      />,
    );

    const runButton = screen.getByRole('button', { name: 'Run Pipeline' });
    expect((runButton as HTMLButtonElement).disabled).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Run button callback
  // ---------------------------------------------------------------------------

  it('calls onRun callback when Run button is clicked', () => {
    const onRun = vi.fn();
    render(<RunControls {...defaultProps({ onRun })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Run Pipeline' }));
    expect(onRun).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Reset button
  // ---------------------------------------------------------------------------

  it('does not show Reset button when status is idle', () => {
    render(<RunControls {...defaultProps({ status: 'idle' })} />);

    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });

  it('shows Reset button when status is running', () => {
    render(<RunControls {...defaultProps({ status: 'running' })} />);

    expect(screen.getByRole('button', { name: 'Reset' })).toBeDefined();
  });

  it('shows Reset button when status is complete', () => {
    render(<RunControls {...defaultProps({ status: 'complete' })} />);

    expect(screen.getByRole('button', { name: 'Reset' })).toBeDefined();
  });

  it('shows Reset button when status is error', () => {
    render(<RunControls {...defaultProps({ status: 'error' })} />);

    expect(screen.getByRole('button', { name: 'Reset' })).toBeDefined();
  });

  it('calls onReset when Reset button is clicked', () => {
    const onReset = vi.fn();
    render(
      <RunControls {...defaultProps({ status: 'complete', onReset })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Run mode toggle
  // ---------------------------------------------------------------------------

  it('renders "all" mode radio checked by default', () => {
    render(<RunControls {...defaultProps({ runMode: 'all' })} />);

    const allRadio = screen.getByLabelText('Run All') as HTMLInputElement;
    const stepRadio = screen.getByLabelText('Step') as HTMLInputElement;

    expect(allRadio.checked).toBe(true);
    expect(stepRadio.checked).toBe(false);
  });

  it('renders "step" mode radio checked when runMode is step', () => {
    render(<RunControls {...defaultProps({ runMode: 'step' })} />);

    const allRadio = screen.getByLabelText('Run All') as HTMLInputElement;
    const stepRadio = screen.getByLabelText('Step') as HTMLInputElement;

    expect(allRadio.checked).toBe(false);
    expect(stepRadio.checked).toBe(true);
  });

  it('calls onRunModeChange with "step" when Step radio is clicked', () => {
    const onRunModeChange = vi.fn();
    render(
      <RunControls {...defaultProps({ runMode: 'all', onRunModeChange })} />,
    );

    fireEvent.click(screen.getByLabelText('Step'));
    expect(onRunModeChange).toHaveBeenCalledWith('step');
  });

  it('calls onRunModeChange with "all" when Run All radio is clicked', () => {
    const onRunModeChange = vi.fn();
    render(
      <RunControls {...defaultProps({ runMode: 'step', onRunModeChange })} />,
    );

    fireEvent.click(screen.getByLabelText('Run All'));
    expect(onRunModeChange).toHaveBeenCalledWith('all');
  });

  // ---------------------------------------------------------------------------
  // Step mode: Start button
  // ---------------------------------------------------------------------------

  it('shows Start button in step mode when idle', () => {
    render(
      <RunControls {...defaultProps({ runMode: 'step', status: 'idle' })} />,
    );

    expect(screen.getByRole('button', { name: 'Start' })).toBeDefined();
    // Run Pipeline button should not be visible in step mode
    expect(screen.queryByRole('button', { name: 'Run Pipeline' })).toBeNull();
  });

  it('disables Start button when token is null in step mode', () => {
    render(
      <RunControls
        {...defaultProps({ runMode: 'step', status: 'idle', token: null })}
      />,
    );

    const startButton = screen.getByRole('button', { name: 'Start' });
    expect((startButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Start button when hasUnsavedChanges is true in step mode', () => {
    render(
      <RunControls
        {...defaultProps({
          runMode: 'step',
          status: 'idle',
          hasUnsavedChanges: true,
        })}
      />,
    );

    const startButton = screen.getByRole('button', { name: 'Start' });
    expect((startButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onStartStep when Start button is clicked', () => {
    const onStartStep = vi.fn();
    render(
      <RunControls
        {...defaultProps({ runMode: 'step', status: 'idle', onStartStep })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onStartStep).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Step mode: Next Stage button
  // ---------------------------------------------------------------------------

  it('shows Next Stage button in step mode when awaiting_input', () => {
    render(
      <RunControls
        {...defaultProps({
          runMode: 'step',
          status: 'awaiting_input',
          nextStage: 3,
        })}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Next Stage (3)' }),
    ).toBeDefined();
  });

  it('shows Next Stage button without number when nextStage is null', () => {
    render(
      <RunControls
        {...defaultProps({
          runMode: 'step',
          status: 'awaiting_input',
          nextStage: null,
        })}
      />,
    );

    const btn = screen.getByRole('button', { name: 'Next Stage' });
    expect(btn).toBeDefined();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onNextStage when Next Stage button is clicked', () => {
    const onNextStage = vi.fn();
    render(
      <RunControls
        {...defaultProps({
          runMode: 'step',
          status: 'awaiting_input',
          nextStage: 2,
          onNextStage,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next Stage (2)' }));
    expect(onNextStage).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Step mode: Cancel button
  // ---------------------------------------------------------------------------

  it('shows Cancel button in step mode when running', () => {
    render(
      <RunControls {...defaultProps({ runMode: 'step', status: 'running' })} />,
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('shows Cancel button in step mode when awaiting_input', () => {
    render(
      <RunControls
        {...defaultProps({ runMode: 'step', status: 'awaiting_input' })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('does not show Cancel button in step mode when complete', () => {
    render(
      <RunControls
        {...defaultProps({ runMode: 'step', status: 'complete' })}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('does not show Cancel button in "all" mode', () => {
    render(
      <RunControls {...defaultProps({ runMode: 'all', status: 'running' })} />,
    );

    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('calls onCancelStep when Cancel button is clicked', () => {
    const onCancelStep = vi.fn();
    render(
      <RunControls
        {...defaultProps({ runMode: 'step', status: 'running', onCancelStep })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancelStep).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Unsaved changes warning
  // ---------------------------------------------------------------------------

  it('shows unsaved changes warning when hasUnsavedChanges is true', () => {
    render(<RunControls {...defaultProps({ hasUnsavedChanges: true })} />);

    expect(screen.getByText('⚠ Unsaved changes')).toBeDefined();
  });

  it('does not show unsaved changes warning when hasUnsavedChanges is false', () => {
    render(<RunControls {...defaultProps({ hasUnsavedChanges: false })} />);

    expect(screen.queryByText('⚠ Unsaved changes')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Run button in non-idle states
  // ---------------------------------------------------------------------------

  it('does not show Run button in step mode even when idle', () => {
    render(
      <RunControls {...defaultProps({ runMode: 'step', status: 'idle' })} />,
    );

    expect(screen.queryByRole('button', { name: 'Run Pipeline' })).toBeNull();
  });

  it('shows Run button in all mode when idle', () => {
    render(
      <RunControls {...defaultProps({ runMode: 'all', status: 'idle' })} />,
    );

    expect(screen.getByRole('button', { name: 'Run Pipeline' })).toBeDefined();
  });
});
