import type { HaiyueEngine, World } from '@haiyue/engine';
import type { CommandBus } from '../../commands/CommandBus';
import type { RuntimeOwnershipScope } from '../runtime/RuntimeOwnershipScope';

export interface EditorRuntimeContext {
  readonly viewportEngine: HaiyueEngine;
  readonly world: World;
  readonly commandBus: CommandBus;
  readonly ownership: RuntimeOwnershipScope;
  readonly sessionId: number;
}

export interface RuntimeStateSnapshot {
  readonly context: EditorRuntimeContext | null;
}

export class RuntimeState {
  private _context: EditorRuntimeContext | null = null;
  private _nextSessionId = 1;

  constructor(private readonly _changed: (snapshot: RuntimeStateSnapshot) => void) {}

  snapshot(): RuntimeStateSnapshot {
    return Object.freeze({ context: this._context });
  }

  attach(context: Omit<EditorRuntimeContext, 'sessionId'>): EditorRuntimeContext {
    if (this._context) this._context.ownership.release();
    this._context = Object.freeze({ ...context, sessionId: this._nextSessionId++ });
    this._changed(this.snapshot());
    return this._context;
  }

  clear(): void {
    const context = this._context;
    if (!context) return;
    this._context = null;
    context.ownership.release();
    this._changed(this.snapshot());
  }
}

