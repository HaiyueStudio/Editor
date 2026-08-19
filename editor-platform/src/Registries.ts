import type {
  EditorContribution,
  EditorContributionKind,
  EditorContributionRegistryPort,
  EditorDisposable,
  EditorServiceRegistrationOptions,
  EditorServiceRegistryPort,
  EditorServiceToken,
} from '@haiyue/editor-plugin-sdk';

interface ServiceRegistration<T = unknown> {
  readonly token: EditorServiceToken<T>;
  readonly value: T;
  readonly ownerId: string;
  readonly priority: number;
  readonly sequence: number;
  active: boolean;
}

interface ContributionRegistration<T = unknown> {
  readonly contribution: EditorContribution<T>;
  readonly priority: number;
  readonly sequence: number;
  active: boolean;
}

export interface EditorServiceDebugEntry {
  readonly token: string;
  readonly ownerId: string;
  readonly priority: number;
}

export class EditorServiceRegistry implements EditorServiceRegistryPort, EditorDisposable {
  private readonly registrations = new Map<symbol, ServiceRegistration[]>();
  private sequence = 1;
  private disposed = false;

  register<T>(token: EditorServiceToken<T>, value: T, options: EditorServiceRegistrationOptions): EditorDisposable {
    this.assertActive();
    if (!options.ownerId.trim()) throw new TypeError('Service owner id is required.');
    const list = this.registrations.get(token.key) ?? [];
    const priority = options.priority ?? 0;
    const current = activeService(list);
    if (current && current.priority === priority && !options.replace) {
      throw new Error(`Service ${token.id} is already registered by ${current.ownerId} at priority ${priority}.`);
    }
    const registration: ServiceRegistration<T> = {
      token, value, ownerId: options.ownerId, priority, sequence: this.sequence++, active: true,
    };
    list.push(registration as ServiceRegistration);
    this.registrations.set(token.key, list);
    return disposable(() => {
      registration.active = false;
      prune(list);
      if (list.length === 0) this.registrations.delete(token.key);
    });
  }

  get<T>(token: EditorServiceToken<T>): T {
    const value = this.optional(token);
    if (value === undefined) throw new Error(`Required editor service ${token.id} is unavailable.`);
    return value;
  }

  optional<T>(token: EditorServiceToken<T>): T | undefined {
    const registration = activeService(this.registrations.get(token.key) ?? []);
    return registration?.value as T | undefined;
  }

  has<T>(token: EditorServiceToken<T>): boolean { return this.optional(token) !== undefined; }

  snapshot(): readonly EditorServiceDebugEntry[] {
    return Object.freeze([...this.registrations.values()]
      .map(activeService)
      .filter((entry): entry is ServiceRegistration => Boolean(entry))
      .map(entry => Object.freeze({ token: entry.token.id, ownerId: entry.ownerId, priority: entry.priority }))
      .sort((left, right) => left.token.localeCompare(right.token)));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.registrations.clear();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Service registry is disposed.');
  }
}

export class EditorContributionRegistry implements EditorContributionRegistryPort, EditorDisposable {
  private readonly registrations = new Map<EditorContributionKind, Map<string, ContributionRegistration[]>>();
  private sequence = 1;
  private disposed = false;

  register<T>(contribution: EditorContribution<T>): EditorDisposable {
    this.assertActive();
    if (!contribution.id.trim() || !contribution.ownerId.trim()) {
      throw new TypeError('Contribution id and owner id are required.');
    }
    const byId = this.registrations.get(contribution.kind) ?? new Map<string, ContributionRegistration[]>();
    const list = byId.get(contribution.id) ?? [];
    const priority = contribution.priority ?? 0;
    const current = activeContribution(list);
    if (current && current.priority === priority) {
      throw new Error(`Contribution ${contribution.kind}:${contribution.id} conflicts with owner ${current.contribution.ownerId}.`);
    }
    const registration: ContributionRegistration<T> = {
      contribution: Object.freeze({ ...contribution }), priority, sequence: this.sequence++, active: true,
    };
    list.push(registration as ContributionRegistration);
    byId.set(contribution.id, list);
    this.registrations.set(contribution.kind, byId);
    return disposable(() => {
      registration.active = false;
      prune(list);
      if (list.length === 0) byId.delete(contribution.id);
      if (byId.size === 0) this.registrations.delete(contribution.kind);
    });
  }

  list<T = unknown>(kind: EditorContributionKind): readonly EditorContribution<T>[] {
    const byId = this.registrations.get(kind);
    if (!byId) return Object.freeze([]);
    return Object.freeze([...byId.values()]
      .map(activeContribution)
      .filter((entry): entry is ContributionRegistration => Boolean(entry))
      .sort((left, right) => right.priority - left.priority || left.sequence - right.sequence)
      .map(entry => entry.contribution as EditorContribution<T>));
  }

  snapshot(): Readonly<Record<string, readonly EditorContribution[]>> {
    const result: Record<string, readonly EditorContribution[]> = {};
    for (const kind of this.registrations.keys()) result[kind] = this.list(kind);
    return Object.freeze(result);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.registrations.clear();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Contribution registry is disposed.');
  }
}

function activeService(list: readonly ServiceRegistration[]): ServiceRegistration | undefined {
  return list.filter(entry => entry.active)
    .sort((left, right) => right.priority - left.priority || right.sequence - left.sequence)[0];
}

function activeContribution(list: readonly ContributionRegistration[]): ContributionRegistration | undefined {
  return list.filter(entry => entry.active)
    .sort((left, right) => right.priority - left.priority || left.sequence - right.sequence)[0];
}

function prune<T extends { active: boolean }>(list: T[]): void {
  for (let index = list.length - 1; index >= 0; index--) {
    if (!list[index]?.active) list.splice(index, 1);
  }
}

function disposable(dispose: () => void): EditorDisposable {
  let active = true;
  return Object.freeze({
    dispose() {
      if (!active) return;
      active = false;
      dispose();
    },
  });
}
