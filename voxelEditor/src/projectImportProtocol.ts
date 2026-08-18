import type { ProjectImportFormat, ProjectImportResult } from './projectImport';

export interface ProjectImportWorkerRequest {
  id: number;
  format: ProjectImportFormat;
  data: ArrayBuffer;
}

export type ProjectImportWorkerMessage = {
  type: 'success';
  id: number;
  result: ProjectImportResult;
} | {
  type: 'error';
  id: number;
  message: string;
};
