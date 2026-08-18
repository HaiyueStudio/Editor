import { ComponentWithData, UniqueCheckType } from '@haiyue/engine/ecs';

export class PrefabInstanceComponent extends ComponentWithData<{ prefabId: number; sourceRevision?: number | undefined }> {
  static override UniqueCheckType =
    UniqueCheckType.SYMBOL | UniqueCheckType.REPLACE;
  static override UniqueSymbol = Symbol.for('PrefabInstance');

  constructor(prefabId: number, sourceRevision?: number) {
    super({ prefabId, ...(sourceRevision === undefined ? {} : { sourceRevision }) }, 'PrefabInstance');
  }

  get prefabId(): number {
    return this.data.prefabId;
  }

  set prefabId(value: number) {
    this.data.prefabId = value;
  }

  get sourceRevision(): number | undefined {
    return this.data.sourceRevision;
  }

  set sourceRevision(value: number | undefined) {
    this.data.sourceRevision = value;
  }
}
