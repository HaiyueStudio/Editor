import type { HaiyueEngine } from '@haiyue/engine';
import type { ScriptDebuggerEvent } from '@haiyue/engine/components';
import { getEditorOrigin, postLifecycle } from './PlayerProtocol';
import type { RuntimeInspectorBridge } from './RuntimeInspectorBridge';

interface PendingBreakpointHit {
  event: ScriptDebuggerEvent;
  breakpoint: string;
  key: string;
}

/** Converts ScriptComponent debug events into frame-safe player pause transitions. */
export class ScriptBreakpointController {
  private breakpoints: string[] = [];
  private pausedKey: string | null = null;
  private skipNextKey: string | null = null;
  private pending: PendingBreakpointHit | null = null;

  constructor(private readonly inspector: RuntimeInspectorBridge) {}

  get count(): number { return this.breakpoints.length; }

  setBreakpoints(values: readonly string[]): void {
    this.breakpoints = values.filter(value => typeof value === 'string');
  }

  reset(): void {
    this.breakpoints = [];
    this.pausedKey = null;
    this.skipNextKey = null;
    this.pending = null;
  }

  resetPauseState(): void {
    this.pausedKey = null;
    this.skipNextKey = null;
    this.pending = null;
  }

  handle = (event: ScriptDebuggerEvent): 'pause' | 'continue' => {
    const breakpoint = this.findMatch(event);
    if (!breakpoint) return 'continue';
    const key = breakpointKey(event);
    if (this.skipNextKey === key) {
      this.skipNextKey = null;
      return 'continue';
    }
    this.pending ??= { event, breakpoint, key };
    return 'continue';
  };

  flush(engine: HaiyueEngine | null, paused: boolean, onPaused: () => void): void {
    if (!this.pending || !engine || paused) return;
    const { event, breakpoint, key } = this.pending;
    this.pending = null;
    this.pausedKey = key;
    this.inspector.select(event.entity.id, false);
    engine.stop();
    onPaused();
    postBreakpointHit(event, breakpoint);
    this.inspector.postSnapshot();
    postLifecycle('paused');
  }

  prepareResume(): void {
    this.skipNextKey = this.pausedKey;
    this.pausedKey = null;
    this.pending = null;
  }

  private findMatch(event: ScriptDebuggerEvent): string | null {
    if (!this.breakpoints.length) return null;
    const names = new Set(breakpointNames(event));
    for (const breakpoint of this.breakpoints) {
      const normalized = normalizeBreakpoint(breakpoint);
      if (!normalized) continue;
      if (names.has(normalized)) return breakpoint;
      const [target, suffix] = normalized.split(':');
      if (target && suffix && /^\d+$/.test(suffix) && names.has(target)) return breakpoint;
    }
    return null;
  }
}

function normalizeBreakpoint(value: string): string {
  return value.trim().toLowerCase();
}

function breakpointNames(event: ScriptDebuggerEvent): string[] {
  return [
    '*',
    String(event.component.id),
    event.component.name,
    event.component.resource?.name ?? '',
    event.entity.name,
    `${event.component.id}:${event.lifecycle}`,
    `${event.component.name}:${event.lifecycle}`,
    event.component.resource?.name ? `${event.component.resource.name}:${event.lifecycle}` : '',
    `${event.entity.name}:${event.lifecycle}`,
  ].filter(Boolean).map(normalizeBreakpoint);
}

function breakpointKey(event: ScriptDebuggerEvent): string {
  return `${event.entity.id}:${event.component.id}:${event.lifecycle}`;
}

function postBreakpointHit(event: ScriptDebuggerEvent, breakpoint: string): void {
  window.parent.postMessage({
    type: 'game-editor-player-breakpoint-hit',
    time: Date.now(),
    breakpoint,
    lifecycle: event.lifecycle,
    entity: { id: event.entity.id, name: event.entity.name },
    script: {
      id: event.component.id,
      name: event.component.resource?.name ?? event.component.name,
    },
  }, getEditorOrigin());
}
