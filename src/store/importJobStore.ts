import { create } from 'zustand';
import type { DocumentIdentity } from '../types/documentSession';

export type ImportJobStatus =
  | 'idle'
  | 'loading'
  | 'converting'
  | 'preparing'
  | 'rendering'
  | 'committing'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface ImportJobState {
  requestId: number;
  targetIdentity: DocumentIdentity;
  targetPageIndex: number;
  completedPages: number;
  totalPages: number;
  status: ImportJobStatus;
  errorMessage?: string;
}

interface ImportJobStore {
  job: ImportJobState | null;
  abortController: AbortController | null;

  startJob: (
    requestId: number,
    targetIdentity: DocumentIdentity,
    targetPageIndex: number,
    abortController: AbortController
  ) => void;
  updateStatus: (status: ImportJobStatus, errorMessage?: string) => void;
  setTotalPages: (totalPages: number) => void;
  incrementCompleted: () => void;
  cancelJob: () => void;
  clearJob: () => void;
}

export const useImportJobStore = create<ImportJobStore>((set, get) => ({
  job: null,
  abortController: null,

  startJob: (requestId, targetIdentity, targetPageIndex, abortController) => {
    set({
      job: {
        requestId,
        targetIdentity,
        targetPageIndex,
        completedPages: 0,
        totalPages: 0,
        status: 'loading',
      },
      abortController,
    });
  },

  updateStatus: (status, errorMessage) => {
    const { job } = get();
    if (!job) return;
    set({ job: { ...job, status, errorMessage } });
  },

  setTotalPages: (totalPages) => {
    const { job } = get();
    if (!job) return;
    set({ job: { ...job, totalPages } });
  },

  incrementCompleted: () => {
    const { job } = get();
    if (!job) return;
    set({ job: { ...job, completedPages: job.completedPages + 1 } });
  },

  cancelJob: () => {
    const { job, abortController } = get();
    if (!job || !abortController) return;
    if (job.status === 'committing' || job.status === 'completed' || job.status === 'cancelled') {
      return;
    }
    abortController.abort();

    // If we're converting, also signal the main process to abort LibreOffice
    if (job.status === 'converting' && window.electronAPI) {
      window.electronAPI.pptxCancelConversion(job.requestId.toString()).catch(() => {
        // Ignore errors if the job was already cleaned up
      });
    }

    set({ job: { ...job, status: 'cancelled' } });
  },

  clearJob: () => {
    set({ job: null, abortController: null });
  },
}));
