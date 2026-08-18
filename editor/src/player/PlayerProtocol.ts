import { EngineErrorCode } from '@haiyue/engine';
import { ErrorDomain, ErrorRecovery, serializeEngineError } from '@haiyue/engine/core';
import type { SerializedScript } from '../export/runtimeScene';

export interface RuntimeInspectorFieldEdit {
  entityId?: number;
  componentId?: number;
  path?: string;
  value?: unknown;
}

export type PlayerCommand = Record<string, unknown> & { type: string };
export type PlayerLogLevel = 'log' | 'info' | 'debug' | 'warn' | 'error';

function formatLogArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`.trim();
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

export function getLogContext(args: unknown[]): { message: string; source: string; entity?: number; script?: number } {
  const first = typeof args[0] === 'string' ? args[0] : '';
  const match = /^\[ScriptComponent entity=(\d+):.* script=(\d+) lifecycle=([^\]]+)\]$/.exec(first)
    ?? /^\[ScriptComponent script=(\d+)\]$/.exec(first);
  if (!match) return { message: args.map(formatLogArg).join(' '), source: 'console' };
  if (match.length === 4) {
    return {
      message: args.slice(1).map(formatLogArg).join(' '),
      source: `script:${match[3]}`,
      entity: Number(match[1]),
      script: Number(match[2]),
    };
  }
  return {
    message: args.slice(1).map(formatLogArg).join(' '),
    source: 'script',
    script: Number(match[1]),
  };
}

export function getEditorOrigin(): string {
  try {
    return window.parent.location.origin;
  } catch {
    return window.location.origin;
  }
}

export function isTrustedEditorMessage(event: MessageEvent<unknown>): boolean {
  return event.origin === getEditorOrigin() && event.source === window.parent;
}

export function getPlayerCommand(value: unknown): PlayerCommand | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const command = value as Record<string, unknown>;
  return typeof command.type === 'string' ? command as PlayerCommand : null;
}

export function isRuntimeInspectorFieldEdit(value: unknown): value is RuntimeInspectorFieldEdit {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const edit = value as Record<string, unknown>;
  return (edit.entityId === undefined || typeof edit.entityId === 'number')
    && (edit.componentId === undefined || typeof edit.componentId === 'number')
    && (edit.path === undefined || typeof edit.path === 'string');
}

export function isSerializedScriptMessage(value: unknown): value is SerializedScript {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const script = value as Record<string, unknown>;
  return typeof script.id === 'number'
    && typeof script.name === 'string'
    && typeof script.scripts === 'object'
    && script.scripts !== null
    && !Array.isArray(script.scripts)
    && Object.values(script.scripts).every(source => typeof source === 'string');
}

export function postLifecycle(phase: string): void {
  window.parent.postMessage({ type: 'game-editor-player-lifecycle', phase }, getEditorOrigin());
}

export function postLog(level: PlayerLogLevel, args: unknown[]): void {
  const context = getLogContext(args);
  window.parent.postMessage({
    type: 'game-editor-player-log',
    level,
    source: context.source,
    time: Date.now(),
    entity: context.entity,
    script: context.script,
    message: context.message,
  }, getEditorOrigin());
}

export function postError(error: unknown): void {
  const structured = serializeEngineError(error, {
    code: EngineErrorCode.SceneDataInvalid,
    options: {
      domain: ErrorDomain.Script,
      recovery: ErrorRecovery.TerminateRuntime,
      path: 'player.runtime',
    },
  });
  window.parent.postMessage({
    type: 'game-editor-player-error',
    source: 'runtime',
    time: Date.now(),
    message: `${structured.name}: ${structured.message}`,
    stack: structured.stack ?? '',
    error: structured,
  }, getEditorOrigin());
}

/** Installs the document-lifetime console and uncaught-error bridge. */
export function installPlayerConsoleBridge(): void {
  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  for (const level of ['log', 'info', 'debug', 'warn', 'error'] as const) {
    console[level] = (...args: unknown[]) => {
      originalConsole[level](...args);
      postLog(level, args);
    };
  }
  window.addEventListener('error', event => postError(event.error ?? event.message));
  window.addEventListener('unhandledrejection', event => postError(event.reason));
}
