import {
  MAX_PATH_COMMANDS,
  MAX_PATH_COORDINATE,
  MAX_PATH_FLATTENED_POINTS,
  MAX_PATH_VALUES,
  PathAuthoringError,
  type AuthoringPath,
  type FlattenedPath,
  type FlattenedPathContour,
  type FlattenedPathPoint,
  type PathCommand,
  type PathCommandInput,
  type PathCubicCommand,
  type PathHit,
  type PathPoint,
  type PathPointPart,
  type PathPointReference,
  type PathQuadraticCommand,
  type PathTangentMode,
  type PathTopologySignature,
  type PathViewportTransform,
} from './PathAuthoringTypes';

const VALUE_COUNTS = Object.freeze({ M: 2, L: 2, Q: 4, C: 6, Z: 0 } as const);

export function createAuthoringPath(id: string, start: PathPoint = [0, 0]): AuthoringPath {
  validatePathId(id);
  return freezePath(id, 1, [{ id: `${id}:command:1`, kind: 'M', end: validPoint(start, '$.commands[0].end') }]);
}

export function parseAuthoringPath(
  id: string,
  commands: string,
  values: readonly number[] | Float32Array,
  geometryVersion = 1,
): AuthoringPath {
  validatePathId(id);
  const normalized = String(commands).toUpperCase();
  if (!normalized || !/^[MLQCZ]+$/u.test(normalized) || normalized[0] !== 'M') {
    throw new PathAuthoringError(
      'E_PATH_COMMAND_STREAM', '$.commands', 'Path commands must start with M and contain only M, L, Q, C and Z.',
    );
  }
  validateCommandBudget(normalized.length);
  const expected = pathValueCount(normalized);
  if (values.length !== expected) throw new PathAuthoringError(
    'E_PATH_VALUE_COUNT', '$.values', `Path command stream requires ${expected} values, received ${values.length}.`,
    { expected, actual: values.length },
  );
  validateValueBudget(values.length);
  const result: PathCommand[] = [];
  let cursor = 0;
  for (let index = 0; index < normalized.length; index++) {
    const kind = normalized[index] as keyof typeof VALUE_COUNTS;
    const idValue = `${id}:command:${index + 1}`;
    if (kind === 'Z') result.push({ id: idValue, kind });
    else if (kind === 'M' || kind === 'L') {
      result.push({ id: idValue, kind, end: point(values, cursor, `$.values[${cursor}]`) });
    } else if (kind === 'Q') {
      result.push({
        id: idValue, kind,
        control: point(values, cursor, `$.values[${cursor}]`),
        end: point(values, cursor + 2, `$.values[${cursor + 2}]`),
      });
    } else {
      result.push({
        id: idValue, kind,
        controlOut: point(values, cursor, `$.values[${cursor}]`),
        controlIn: point(values, cursor + 2, `$.values[${cursor + 2}]`),
        end: point(values, cursor + 4, `$.values[${cursor + 4}]`),
      });
    }
    cursor += VALUE_COUNTS[kind];
  }
  validateStructuralTopology(result);
  return freezePath(id, positiveVersion(geometryVersion), result);
}

export function serializeAuthoringPath(path: AuthoringPath): Readonly<{
  commands: string;
  values: readonly number[];
}> {
  validateAuthoringPath(path);
  const values: number[] = [];
  for (const command of path.commands) {
    if (command.kind === 'M' || command.kind === 'L') values.push(...command.end);
    else if (command.kind === 'Q') values.push(...command.control, ...command.end);
    else if (command.kind === 'C') values.push(...command.controlOut, ...command.controlIn, ...command.end);
  }
  return Object.freeze({ commands: path.commands.map(command => command.kind).join(''), values: Object.freeze(values) });
}

export function pathTopologySignature(path: AuthoringPath): PathTopologySignature {
  const serialized = serializeAuthoringPath(path);
  let openContours = 0;
  let closedContours = 0;
  let open = false;
  for (const command of path.commands) {
    if (command.kind === 'M') {
      if (open) openContours++;
      open = true;
    } else if (command.kind === 'Z') {
      closedContours++;
      open = false;
    }
  }
  if (open) openContours++;
  return Object.freeze({
    commands: serialized.commands,
    commandCount: path.commands.length,
    pointCount: path.commands.reduce((sum, command) => sum + (command.kind === 'Z' ? 0 : command.kind === 'M' || command.kind === 'L' ? 1 : command.kind === 'Q' ? 2 : 3), 0),
    valueCount: serialized.values.length,
    closedContours,
    openContours,
  });
}

export function appendPathCommand(path: AuthoringPath, input: PathCommandInput): AuthoringPath {
  const commands = path.commands.map(cloneCommand);
  const previous = commands.at(-1);
  if (input.kind === 'M' && previous?.kind !== 'Z') throw new PathAuthoringError(
    'E_PATH_COMMAND_STREAM', '$.commands', 'A new M contour can only follow Z.',
  );
  if (input.kind !== 'M' && input.kind !== 'Z' && (!previous || previous.kind === 'Z')) throw new PathAuthoringError(
    'E_PATH_COMMAND_STREAM', '$.commands', `${input.kind} must follow an open contour.`,
  );
  if (input.kind === 'Z') return closeAuthoringPath(path);
  commands.push(commandFromInput(uniqueCommandId(path, `${path.id}:command:${commands.length + 1}`), input));
  return changedPath(path, commands);
}

export function closeAuthoringPath(path: AuthoringPath): AuthoringPath {
  const commands = path.commands.map(cloneCommand);
  if (commands.at(-1)?.kind === 'Z') return path;
  const contourStart = findContourStart(commands, commands.length);
  if (contourStart < 0 || commands.length - contourStart < 3) throw new PathAuthoringError(
    'E_PATH_TOPOLOGY_POINTS', '$.commands', 'A closed contour requires M and at least two drawable segments.',
  );
  commands.push({ id: uniqueCommandId(path, `${path.id}:command:${commands.length + 1}`), kind: 'Z' });
  return changedPath(path, commands);
}

export function openAuthoringPath(path: AuthoringPath): AuthoringPath {
  const commands = path.commands.map(cloneCommand);
  if (commands.at(-1)?.kind !== 'Z') return path;
  commands.pop();
  return changedPath(path, commands);
}

export function movePathPoint(
  path: AuthoringPath,
  reference: PathPointReference,
  position: PathPoint,
  tangentMode: PathTangentMode = 'broken',
): AuthoringPath {
  const nextPosition = validPoint(position, '$.point');
  const commands = path.commands.map(cloneCommand) as MutablePathCommand[];
  const index = commands.findIndex(command => command.id === reference.commandId);
  if (index < 0) throw unknownCommand(reference.commandId);
  const command = commands[index]!;
  const before = pathPointForReference(command, reference.part);
  if (!before) throw new PathAuthoringError(
    'E_PATH_POINT_REFERENCE', `$.commands[${index}]`, `${command.kind} has no ${reference.part} point.`,
  );
  setCommandPoint(command, reference.part, nextPosition);
  if (reference.part === 'end') translateAdjacentTangent(commands, index, subtract(nextPosition, before));
  else if (tangentMode === 'unified') mirrorOppositeTangent(commands, index, reference.part, nextPosition);
  return changedPath(path, commands);
}

export function splitPathCommand(path: AuthoringPath, commandId: string, t = 0.5): AuthoringPath {
  const commands = path.commands.map(cloneCommand) as MutablePathCommand[];
  const index = commands.findIndex(command => command.id === commandId);
  if (index < 0) throw unknownCommand(commandId);
  const command = commands[index]!;
  if (command.kind === 'M') throw new PathAuthoringError(
    'E_PATH_COMMAND_REFERENCE', `$.commands[${index}]`, 'M has no incoming segment to split.',
  );
  const ratio = Math.max(0.001, Math.min(0.999, Number.isFinite(t) ? t : 0.5));
  const start = previousEndpoint(commands, index);
  const secondId = uniqueCommandId(path, `${command.id}:split`);
  if (command.kind === 'Z') {
    const contourStart = commands[findContourStart(commands, index)] as Extract<MutablePathCommand, { kind: 'M' }>;
    commands.splice(index, 0, { id: secondId, kind: 'L', end: mixPoint(start, contourStart.end, ratio) });
  } else if (command.kind === 'L') {
    const middle = mixPoint(start, command.end, ratio);
    commands[index] = { ...command, end: middle };
    commands.splice(index + 1, 0, { id: secondId, kind: 'L', end: command.end });
  } else if (command.kind === 'Q') {
    const firstControl = mixPoint(start, command.control, ratio);
    const secondControl = mixPoint(command.control, command.end, ratio);
    const middle = mixPoint(firstControl, secondControl, ratio);
    commands[index] = { ...command, control: firstControl, end: middle };
    commands.splice(index + 1, 0, { id: secondId, kind: 'Q', control: secondControl, end: command.end });
  } else {
    const a = mixPoint(start, command.controlOut, ratio);
    const b = mixPoint(command.controlOut, command.controlIn, ratio);
    const c = mixPoint(command.controlIn, command.end, ratio);
    const d = mixPoint(a, b, ratio);
    const e = mixPoint(b, c, ratio);
    const middle = mixPoint(d, e, ratio);
    commands[index] = { ...command, controlOut: a, controlIn: d, end: middle };
    commands.splice(index + 1, 0, { id: secondId, kind: 'C', controlOut: e, controlIn: c, end: command.end });
  }
  return changedPath(path, commands);
}

export function deletePathPoint(path: AuthoringPath, reference: PathPointReference): AuthoringPath {
  const commands = path.commands.map(cloneCommand) as MutablePathCommand[];
  const index = commands.findIndex(command => command.id === reference.commandId);
  if (index < 0) throw unknownCommand(reference.commandId);
  const command = commands[index]!;
  if (reference.part !== 'end') {
    if (command.kind === 'Q' && reference.part === 'control') commands[index] = { id: command.id, kind: 'L', end: command.end };
    else if (command.kind === 'C' && (reference.part === 'control-out' || reference.part === 'control-in')) {
      commands[index] = {
        id: command.id,
        kind: 'Q',
        control: reference.part === 'control-out' ? command.controlIn : command.controlOut,
        end: command.end,
      };
    } else throw new PathAuthoringError(
      'E_PATH_POINT_REFERENCE', `$.commands[${index}]`, `${command.kind} has no deletable ${reference.part} point.`,
    );
    return changedPath(path, commands);
  }
  if (command.kind === 'Z') throw new PathAuthoringError(
    'E_PATH_POINT_REFERENCE', `$.commands[${index}]`, 'Z has no endpoint.',
  );
  if (command.kind === 'M') {
    const next = commands[index + 1];
    if (!next || next.kind === 'M' || next.kind === 'Z') throw new PathAuthoringError(
      'E_PATH_TOPOLOGY_POINTS', `$.commands[${index}]`, 'Cannot delete the only point in a contour.',
    );
    commands[index + 1] = { id: next.id, kind: 'M', end: next.end };
    commands.splice(index, 1);
  } else commands.splice(index, 1);
  validateStructuralTopology(commands);
  return changedPath(path, commands);
}

export function duplicateAuthoringPath(path: AuthoringPath, id: string): AuthoringPath {
  validatePathId(id);
  const commands = path.commands.map((command, index) => ({
    ...cloneCommand(command), id: `${id}:command:${index + 1}`,
  })) as PathCommand[];
  return freezePath(id, 1, commands);
}

export function reverseAuthoringPath(path: AuthoringPath): AuthoringPath {
  const output: PathCommand[] = [];
  let cursor = 0;
  while (cursor < path.commands.length) {
    const move = path.commands[cursor];
    if (!move || move.kind !== 'M') throw new PathAuthoringError(
      'E_PATH_COMMAND_STREAM', `$.commands[${cursor}]`, 'Every contour must start with M.',
    );
    let end = cursor + 1;
    while (end < path.commands.length && path.commands[end]!.kind !== 'M') end++;
    const contour = path.commands.slice(cursor, end);
    const close = contour.at(-1)?.kind === 'Z' ? contour.at(-1) as Extract<PathCommand, { kind: 'Z' }> : null;
    const segments = contour.slice(1, close ? -1 : undefined).filter(command => command.kind !== 'Z');
    const start = segments.length ? endpoint(segments.at(-1)!) : move.end;
    output.push({ id: move.id, kind: 'M', end: start });
    for (let index = segments.length - 1; index >= 0; index--) {
      const segment = segments[index]!;
      const previous = index === 0 ? move.end : endpoint(segments[index - 1]!);
      if (segment.kind === 'L') output.push({ id: segment.id, kind: 'L', end: previous });
      else if (segment.kind === 'Q') output.push({ id: segment.id, kind: 'Q', control: segment.control, end: previous });
      else if (segment.kind === 'C') output.push({
        id: segment.id, kind: 'C', controlOut: segment.controlIn, controlIn: segment.controlOut, end: previous,
      });
    }
    if (close) output.push(cloneCommand(close));
    cursor = end;
  }
  return changedPath(path, output);
}

export function validateAuthoringPath(
  path: AuthoringPath,
  options: Readonly<{ requireClosed?: boolean; requireDrawable?: boolean }> = {},
): void {
  validatePathId(path.id);
  validateCommandBudget(path.commands.length);
  validateStructuralTopology(path.commands);
  const signature = pathTopologySignatureUnsafe(path);
  validateValueBudget(signature.valueCount);
  if (options.requireDrawable !== false) {
    forEachContour(path.commands, (commands, startIndex, closed) => {
      const drawable = commands.filter(command => command.kind !== 'M' && command.kind !== 'Z').length;
      if (drawable < 1 || (options.requireClosed && drawable < 2)) throw new PathAuthoringError(
        'E_PATH_TOPOLOGY_POINTS', `$.commands[${startIndex}]`,
        options.requireClosed ? 'A filled contour requires at least three anchor points.' : 'A path contour requires at least two anchor points.',
      );
      if (options.requireClosed && !closed) throw new PathAuthoringError(
        'E_PATH_TOPOLOGY_OPEN', `$.commands[${startIndex}]`, 'Every filled contour must end with Z.',
      );
    });
  }
}

export function flattenAuthoringPath(
  path: AuthoringPath,
  tolerance = 0.5,
  maximumPoints = MAX_PATH_FLATTENED_POINTS,
): FlattenedPath {
  validateAuthoringPath(path, { requireDrawable: false });
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new PathAuthoringError(
    'E_PATH_COORDINATE', '$.tolerance', 'Path flatten tolerance must be positive and finite.',
  );
  const pointLimit = Math.max(2, Math.min(MAX_PATH_FLATTENED_POINTS, Math.floor(maximumPoints)));
  const contours: FlattenedPathContour[] = [];
  let current: FlattenedPathPoint[] | null = null;
  let contourStart: PathPoint | null = null;
  let previous: PathPoint | null = null;
  let pointCount = 0;
  const append = (item: FlattenedPathPoint) => {
    if (++pointCount > pointLimit) throw new PathAuthoringError(
      'E_PATH_CACHE_BUDGET', '$.commands', `Flattened path exceeds the ${pointLimit}-point cache budget.`,
      { pointLimit },
    );
    current!.push(Object.freeze(item));
  };
  for (const command of path.commands) {
    if (command.kind === 'M') {
      if (current) contours.push(Object.freeze({ points: Object.freeze(current), closed: false }));
      current = [];
      contourStart = command.end;
      previous = command.end;
      append({ position: command.end, commandId: command.id, t: 0 });
      continue;
    }
    if (!current || !previous || !contourStart) continue;
    if (command.kind === 'Z') {
      append({ position: contourStart, commandId: command.id, t: 1 });
      contours.push(Object.freeze({ points: Object.freeze(current), closed: true }));
      current = null;
      previous = null;
      contourStart = null;
      continue;
    }
    const steps = curveSteps(previous, command, tolerance);
    for (let step = 1; step <= steps; step++) {
      const time = step / steps;
      append({ position: sampleSegment(previous, command, time), commandId: command.id, t: time });
    }
    previous = command.end;
  }
  if (current) contours.push(Object.freeze({ points: Object.freeze(current), closed: false }));
  return Object.freeze({
    pathId: path.id,
    geometryVersion: path.geometryVersion,
    pointCount,
    contours: Object.freeze(contours),
  });
}

export function hitTestAuthoringPath(
  path: AuthoringPath,
  screenPoint: PathPoint,
  view: PathViewportTransform,
  tolerancePixels = 8,
): PathHit | null {
  const normalizedView = validateView(view);
  const point = validPoint(screenPoint, '$.screenPoint');
  const tolerance = Math.max(1, Number.isFinite(tolerancePixels) ? tolerancePixels : 8);
  let bestPoint: Extract<PathHit, { kind: 'point' }> | null = null;
  for (const command of path.commands) {
    for (const [part, world] of commandPoints(command)) {
      const distancePixels = distance(worldToPathScreen(world, normalizedView), point);
      if (distancePixels <= tolerance && (!bestPoint || distancePixels < bestPoint.distancePixels)) {
        bestPoint = Object.freeze({ kind: 'point', reference: Object.freeze({ commandId: command.id, part }), distancePixels });
      }
    }
  }
  if (bestPoint) return bestPoint;
  const flattened = flattenAuthoringPath(path, Math.max(0.1, tolerance / normalizedView.zoom / 2));
  let bestSegment: Extract<PathHit, { kind: 'segment' }> | null = null;
  for (const contour of flattened.contours) {
    for (let index = 1; index < contour.points.length; index++) {
      const from = contour.points[index - 1]!;
      const to = contour.points[index]!;
      const projected = projectPointToSegment(
        point,
        worldToPathScreen(from.position, normalizedView),
        worldToPathScreen(to.position, normalizedView),
      );
      if (projected.distance > tolerance || (bestSegment && projected.distance >= bestSegment.distancePixels)) continue;
      const fromT = from.commandId === to.commandId ? from.t : 0;
      bestSegment = Object.freeze({
        kind: 'segment',
        commandId: to.commandId,
        t: fromT + (to.t - fromT) * projected.t,
        distancePixels: projected.distance,
      });
    }
  }
  return bestSegment;
}

export function worldToPathScreen(point: PathPoint, view: PathViewportTransform): PathPoint {
  const normalized = validateView(view);
  return Object.freeze([point[0] * normalized.zoom + normalized.pan[0], point[1] * normalized.zoom + normalized.pan[1]]);
}

export function pathScreenToWorld(point: PathPoint, view: PathViewportTransform): PathPoint {
  const normalized = validateView(view);
  const valid = validPoint(point, '$.screenPoint');
  return Object.freeze([(valid[0] - normalized.pan[0]) / normalized.zoom, (valid[1] - normalized.pan[1]) / normalized.zoom]);
}

export function pathGeometryFingerprint(path: AuthoringPath): string {
  const serialized = serializeAuthoringPath(path);
  let hash = 2166136261;
  const source = `${serialized.commands}|${serialized.values.join(',')}`;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

type MutablePathCommand =
  | { id: string; kind: 'M'; end: PathPoint }
  | { id: string; kind: 'L'; end: PathPoint }
  | { id: string; kind: 'Q'; control: PathPoint; end: PathPoint }
  | { id: string; kind: 'C'; controlOut: PathPoint; controlIn: PathPoint; end: PathPoint }
  | { id: string; kind: 'Z' };

function pathTopologySignatureUnsafe(path: AuthoringPath): PathTopologySignature {
  const values = path.commands.reduce((sum, command) => sum + VALUE_COUNTS[command.kind], 0);
  let closedContours = 0;
  let openContours = 0;
  let open = false;
  for (const command of path.commands) {
    if (command.kind === 'M') { if (open) openContours++; open = true; }
    else if (command.kind === 'Z') { closedContours++; open = false; }
  }
  if (open) openContours++;
  return {
    commands: path.commands.map(command => command.kind).join(''),
    commandCount: path.commands.length,
    pointCount: path.commands.reduce((sum, command) => sum + (command.kind === 'Z' ? 0 : command.kind === 'M' || command.kind === 'L' ? 1 : command.kind === 'Q' ? 2 : 3), 0),
    valueCount: values,
    closedContours,
    openContours,
  };
}

function validateStructuralTopology(commands: readonly PathCommand[]): void {
  let open = false;
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index]!;
    if (!stableId(command.id)) throw new PathAuthoringError(
      'E_PATH_ID', `$.commands[${index}].id`, 'Path command id must be a stable identifier.',
    );
    for (const [, pointValue] of commandPoints(command)) validPoint(pointValue, `$.commands[${index}]`);
    if (command.kind === 'M') {
      if (open) throw new PathAuthoringError(
        'E_PATH_COMMAND_STREAM', `$.commands[${index}]`, 'A new M requires the previous contour to end with Z.',
      );
      open = true;
    } else if (command.kind === 'Z') {
      if (!open) throw new PathAuthoringError(
        'E_PATH_COMMAND_STREAM', `$.commands[${index}]`, 'Z must close an open contour.',
      );
      open = false;
    } else if (!open) throw new PathAuthoringError(
      'E_PATH_COMMAND_STREAM', `$.commands[${index}]`, `${command.kind} must follow M inside a contour.`,
    );
  }
}

function forEachContour(
  commands: readonly PathCommand[],
  visit: (commands: readonly PathCommand[], startIndex: number, closed: boolean) => void,
): void {
  let start = 0;
  while (start < commands.length) {
    let end = start + 1;
    while (end < commands.length && commands[end]!.kind !== 'M') end++;
    const contour = commands.slice(start, end);
    visit(contour, start, contour.at(-1)?.kind === 'Z');
    start = end;
  }
}

function commandFromInput(id: string, input: Exclude<PathCommandInput, { kind: 'Z' }>): PathCommand {
  if (input.kind === 'M' || input.kind === 'L') return { id, kind: input.kind, end: validPoint(input.end, '$.command.end') };
  if (input.kind === 'Q') return {
    id, kind: input.kind, control: validPoint(input.control, '$.command.control'), end: validPoint(input.end, '$.command.end'),
  };
  return {
    id, kind: input.kind,
    controlOut: validPoint(input.controlOut, '$.command.controlOut'),
    controlIn: validPoint(input.controlIn, '$.command.controlIn'),
    end: validPoint(input.end, '$.command.end'),
  };
}

function cloneCommand(command: PathCommand): MutablePathCommand {
  if (command.kind === 'Z') return { ...command };
  if (command.kind === 'M' || command.kind === 'L') return { ...command, end: [...command.end] as PathPoint };
  if (command.kind === 'Q') return { ...command, control: [...command.control] as PathPoint, end: [...command.end] as PathPoint };
  return {
    ...command,
    controlOut: [...command.controlOut] as PathPoint,
    controlIn: [...command.controlIn] as PathPoint,
    end: [...command.end] as PathPoint,
  };
}

function freezePath(id: string, geometryVersion: number, commands: readonly PathCommand[]): AuthoringPath {
  const frozenCommands = commands.map(command => Object.freeze(command.kind === 'Z' ? { ...command } : command.kind === 'M' || command.kind === 'L'
    ? { ...command, end: Object.freeze([...command.end] as [number, number]) }
    : command.kind === 'Q'
      ? { ...command, control: Object.freeze([...command.control] as [number, number]), end: Object.freeze([...command.end] as [number, number]) }
      : {
          ...command,
          controlOut: Object.freeze([...command.controlOut] as [number, number]),
          controlIn: Object.freeze([...command.controlIn] as [number, number]),
          end: Object.freeze([...command.end] as [number, number]),
        })) as PathCommand[];
  const result = Object.freeze({ id, geometryVersion, commands: Object.freeze(frozenCommands) });
  validateAuthoringPath(result, { requireDrawable: false });
  return result;
}

function changedPath(path: AuthoringPath, commands: readonly PathCommand[]): AuthoringPath {
  validateCommandBudget(commands.length);
  validateStructuralTopology(commands);
  const result = freezePath(path.id, positiveVersion(path.geometryVersion + 1), commands);
  validateValueBudget(pathTopologySignatureUnsafe(result).valueCount);
  return result;
}

function point(values: readonly number[] | Float32Array, offset: number, path: string): PathPoint {
  return validPoint([values[offset]!, values[offset + 1]!], path);
}

function validPoint(value: PathPoint, path: string): PathPoint {
  if (value.length !== 2 || value.some(component => !Number.isFinite(component) || Math.abs(component) > MAX_PATH_COORDINATE)) {
    throw new PathAuthoringError(
      'E_PATH_COORDINATE', path, `Path coordinates must be finite and within ±${MAX_PATH_COORDINATE}.`,
    );
  }
  return Object.freeze([value[0], value[1]]);
}

function pathValueCount(commands: string): number {
  return [...commands].reduce((sum, command) => sum + VALUE_COUNTS[command as keyof typeof VALUE_COUNTS], 0);
}

function validatePathId(id: string): void {
  if (!stableId(id)) throw new PathAuthoringError('E_PATH_ID', '$.id', 'Path id must be a stable identifier.');
}

function stableId(value: string): boolean { return /^[A-Za-z0-9._:-]+$/u.test(value); }

function validateCommandBudget(count: number): void {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_PATH_COMMANDS) throw new PathAuthoringError(
    'E_PATH_COMMAND_BUDGET', '$.commands', `Path command count must be within 1–${MAX_PATH_COMMANDS}.`, { count },
  );
}

function validateValueBudget(count: number): void {
  if (!Number.isSafeInteger(count) || count > MAX_PATH_VALUES) throw new PathAuthoringError(
    'E_PATH_VALUE_BUDGET', '$.values', `Path values exceed the ${MAX_PATH_VALUES}-value morph/runtime budget.`, { count },
  );
}

function positiveVersion(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function uniqueCommandId(path: AuthoringPath, base: string): string {
  const ids = new Set(path.commands.map(command => command.id));
  let id = base;
  let suffix = 2;
  while (ids.has(id)) id = `${base}:${suffix++}`;
  return id;
}

function unknownCommand(id: string): PathAuthoringError {
  return new PathAuthoringError('E_PATH_COMMAND_REFERENCE', '$.commands', `Unknown path command "${id}".`, { commandId: id });
}

function pathPointForReference(command: MutablePathCommand, part: PathPointPart): PathPoint | null {
  if (part === 'end' && command.kind !== 'Z') return command.end;
  if (part === 'control' && command.kind === 'Q') return command.control;
  if (part === 'control-out' && command.kind === 'C') return command.controlOut;
  if (part === 'control-in' && command.kind === 'C') return command.controlIn;
  return null;
}

function setCommandPoint(command: MutablePathCommand, part: PathPointPart, position: PathPoint): void {
  if (part === 'end' && command.kind !== 'Z') command.end = position;
  else if (part === 'control' && command.kind === 'Q') command.control = position;
  else if (part === 'control-out' && command.kind === 'C') command.controlOut = position;
  else if (part === 'control-in' && command.kind === 'C') command.controlIn = position;
}

function translateAdjacentTangent(commands: MutablePathCommand[], index: number, delta: PathPoint): void {
  const current = commands[index]!;
  if (current.kind === 'C') current.controlIn = add(current.controlIn, delta);
  const next = commands[index + 1];
  if (next?.kind === 'C') next.controlOut = add(next.controlOut, delta);
  else if (next?.kind === 'Q') next.control = add(next.control, delta);
}

function mirrorOppositeTangent(
  commands: MutablePathCommand[],
  index: number,
  part: PathPointPart,
  position: PathPoint,
): void {
  const command = commands[index]!;
  if (command.kind !== 'C') return;
  if (part === 'control-in') {
    const next = commands[index + 1];
    if (next?.kind === 'C') next.controlOut = reflect(position, command.end);
  } else if (part === 'control-out') {
    const anchor = previousEndpoint(commands, index);
    const previous = commands[index - 1];
    if (previous?.kind === 'C') previous.controlIn = reflect(position, anchor);
  }
}

function previousEndpoint(commands: readonly MutablePathCommand[], index: number): PathPoint {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const command = commands[cursor]!;
    if (command.kind !== 'Z') return command.end;
  }
  throw new PathAuthoringError('E_PATH_COMMAND_STREAM', `$.commands[${index}]`, 'Path segment has no previous endpoint.');
}

function findContourStart(commands: readonly MutablePathCommand[], before: number): number {
  for (let index = Math.min(before - 1, commands.length - 1); index >= 0; index--) {
    if (commands[index]!.kind === 'M') return index;
  }
  return -1;
}

function endpoint(command: Exclude<PathCommand, { kind: 'Z' }>): PathPoint { return command.end; }

function commandPoints(command: PathCommand): readonly (readonly [PathPointPart, PathPoint])[] {
  if (command.kind === 'Z') return [];
  if (command.kind === 'M' || command.kind === 'L') return [['end', command.end]];
  if (command.kind === 'Q') return [['control', command.control], ['end', command.end]];
  return [['control-out', command.controlOut], ['control-in', command.controlIn], ['end', command.end]];
}

function curveSteps(start: PathPoint, command: Exclude<PathCommand, { kind: 'M' | 'Z' }>, tolerance: number): number {
  const length = command.kind === 'L'
    ? distance(start, command.end)
    : command.kind === 'Q'
      ? distance(start, command.control) + distance(command.control, command.end)
      : distance(start, command.controlOut) + distance(command.controlOut, command.controlIn) + distance(command.controlIn, command.end);
  return Math.max(1, Math.min(64, Math.ceil(length / Math.max(0.25, tolerance * 4))));
}

function sampleSegment(start: PathPoint, command: Exclude<PathCommand, { kind: 'M' | 'Z' }>, time: number): PathPoint {
  if (command.kind === 'L') return mixPoint(start, command.end, time);
  const inverse = 1 - time;
  if (command.kind === 'Q') return Object.freeze([
    inverse * inverse * start[0] + 2 * inverse * time * command.control[0] + time * time * command.end[0],
    inverse * inverse * start[1] + 2 * inverse * time * command.control[1] + time * time * command.end[1],
  ]);
  return Object.freeze([
    inverse ** 3 * start[0] + 3 * inverse ** 2 * time * command.controlOut[0]
      + 3 * inverse * time ** 2 * command.controlIn[0] + time ** 3 * command.end[0],
    inverse ** 3 * start[1] + 3 * inverse ** 2 * time * command.controlOut[1]
      + 3 * inverse * time ** 2 * command.controlIn[1] + time ** 3 * command.end[1],
  ]);
}

function validateView(view: PathViewportTransform): PathViewportTransform {
  if (!Number.isFinite(view.zoom) || view.zoom <= 0 || view.zoom > 1_000) throw new PathAuthoringError(
    'E_PATH_COORDINATE', '$.view.zoom', 'Path viewport zoom must be within (0, 1000].',
  );
  return Object.freeze({ zoom: view.zoom, pan: validPoint(view.pan, '$.view.pan') });
}

function projectPointToSegment(pointValue: PathPoint, start: PathPoint, end: PathPoint) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared <= 1e-12 ? 0 : Math.max(0, Math.min(1,
    ((pointValue[0] - start[0]) * dx + (pointValue[1] - start[1]) * dy) / lengthSquared,
  ));
  return { t, distance: distance(pointValue, [start[0] + dx * t, start[1] + dy * t]) };
}

function mixPoint(left: PathPoint, right: PathPoint, amount: number): PathPoint {
  return Object.freeze([left[0] + (right[0] - left[0]) * amount, left[1] + (right[1] - left[1]) * amount]);
}

function reflect(pointValue: PathPoint, around: PathPoint): PathPoint {
  return Object.freeze([around[0] * 2 - pointValue[0], around[1] * 2 - pointValue[1]]);
}

function subtract(left: PathPoint, right: PathPoint): PathPoint { return [left[0] - right[0], left[1] - right[1]]; }
function add(left: PathPoint, right: PathPoint): PathPoint { return [left[0] + right[0], left[1] + right[1]]; }
function distance(left: PathPoint, right: PathPoint): number { return Math.hypot(left[0] - right[0], left[1] - right[1]); }
