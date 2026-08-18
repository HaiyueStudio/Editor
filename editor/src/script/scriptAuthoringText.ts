import type { GESelectOption } from '@haiyue/ui';
import {
  SCRIPT_LIFECYCLES,
  SCRIPT_RUNTIME_COMPLETION_PATHS,
  type ScriptLifecycleName,
} from '@haiyue/engine/components';

export function getScriptLifecycleOptions(): GESelectOption[] {
  return SCRIPT_LIFECYCLES.map(lifecycle => ({ label: lifecycle, value: lifecycle }));
}

export function normalizeScriptLifecycle(lifecycle: string): ScriptLifecycleName {
  return SCRIPT_LIFECYCLES.includes(lifecycle as ScriptLifecycleName)
    ? lifecycle as ScriptLifecycleName
    : 'onUpdate';
}

export function getScriptLifecycleHelp(lifecycle: ScriptLifecycleName): string {
  const common = [
    'Available parameters:',
    'entity    // current Entity',
    'component // current ScriptComponent',
    'world     // current World, or null outside world callbacks',
    'api.read.globals // editor global settings, if available',
    'time      // frame timestamp in ms',
    'delta     // frame delta in ms',
    'event     // lifecycle-specific payload',
    'api       // capability groups: read, scene, asset, input, physics, debug',
    '',
    "api.scene.createEntity('Name')",
    "api.scene.spawnPrefab('Prefab Name', { position: [0, 0, 0] })",
    'api.scene.destroy(entity)',
    "api.read.find('ScoreText')",
    'api.read.data()?.speed',
    'new api.read.components.Transform2D({ x: 0, y: 0 })',
    '',
    `Contract hints: ${SCRIPT_RUNTIME_COMPLETION_PATHS.join(', ')}`,
  ].join('\n');

  if (lifecycle === 'onEntityAddComponent' || lifecycle === 'onEntityRemoveComponent') {
    return `${common}\n\nevent.component // component being added or removed`;
  }
  return common;
}

export function getScriptLifecycleExample(lifecycle: ScriptLifecycleName): string {
  if (lifecycle === 'onUpdate') {
    return [
      "const transform = entity.getComponent('Transform3D');",
      '',
      "if (api.input.wasPressed('HardDrop')) {",
      "  api.scene.spawnPrefab('Block', { position: [0, 0, 0] });",
      '}',
      '',
      "if (api.input.isPressed('MoveLeft') && transform?.setPosition) {",
      '  transform.setPosition(',
      '    transform.position[0] - delta * 0.003,',
      '    transform.position[1],',
      '    transform.position[2],',
      '  );',
      '}',
    ].join('\n');
  }
  if (lifecycle === 'onEntityAddComponent') {
    return [
      "api.debug.console.log('component added:', event.component?.name);",
      "api.debug.console.log('entity:', entity.name);",
    ].join('\n');
  }
  if (lifecycle === 'onEntityRemoveComponent') {
    return [
      "api.debug.console.log('component removed:', event.component?.name);",
      "api.debug.console.log('entity:', entity.name);",
    ].join('\n');
  }
  if (lifecycle === 'onEntityAddToWorld') {
    return [
      "api.debug.console.log('entity added to world:', entity.name);",
      "api.debug.console.log('world:', world?.name);",
    ].join('\n');
  }
  return [
    "api.debug.console.log('entity removed from world:', entity.name);",
    "api.debug.console.log('world:', world?.name);",
  ].join('\n');
}

export function getKeyboardExample(): string {
  return [
    "api.input.isPressed('MoveLeft')",
    "api.input.wasPressed('HardDrop')",
    "api.input.wasReleased('Pause')",
    "api.input.getActionKeys('MoveLeft')",
    'api.input.actionSnapshot()',
    '',
    "api.input.isKeyPressed('ArrowLeft')",
    "api.input.wasKeyPressed('Space')",
    "api.input.wasKeyReleased('KeyP')",
    'api.input.snapshot()',
    "const keyboard = entity.getComponent('KeyboardComponent');",
    "keyboard?.isPressed('ArrowDown');",
  ].join('\n');
}
