import { defineHaiyueUI } from '@haiyue/ui';
import { defineEditorEntityTreeNode } from './ui/entityTreeNode';
import { startSceneEditorPlatform } from './platform/sceneEditorPlatform';
import { applyStoredEditorTheme, installLegacyButtonThemeBridge } from './infra/theme/editorTheme';

applyStoredEditorTheme();
defineHaiyueUI();
installLegacyButtonThemeBridge();
defineEditorEntityTreeNode();

// Let the custom-element shell upgrade and paint before loading the editor
// application closure. Optional component runtimes are activated even later,
// when the project or an explicit user action requires them.
void startSceneEditorPlatform()
  .then(() => requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void import('./infra/app/mainEditorApp')
        .then(module => module.runMainEditorApp())
        .catch(error => console.error('Failed to start the editor application.', error));
    });
  }))
  .catch(error => {
    console.error('Failed to start the editor platform.', error);
  });
