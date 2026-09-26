/**
 * One long-running task at a time (OCR, merging, splitting…), shown as a
 * small progress panel with a Cancel button.
 */
import { create } from 'zustand';

export interface TaskProgress {
  id: number;
  label: string;
  done: number;
  total: number;
  cancelled: boolean;
}

interface TaskProgressStore {
  task: TaskProgress | null;
  start: (label: string, total: number) => number;
  update: (id: number, done: number, label?: string) => void;
  finish: (id: number) => void;
  cancel: () => void;
  isCancelled: (id: number) => boolean;
}

let nextId = 1;

export const useTaskProgressStore = create<TaskProgressStore>((set, get) => ({
  task: null,
  start: (label, total) => {
    const id = nextId++;
    set({ task: { id, label, done: 0, total, cancelled: false } });
    return id;
  },
  update: (id, done, label) => set((state) => (state.task?.id === id
    ? { task: { ...state.task, done, label: label ?? state.task.label } }
    : state)),
  finish: (id) => set((state) => (state.task?.id === id ? { task: null } : state)),
  cancel: () => set((state) => (state.task ? { task: { ...state.task, cancelled: true } } : state)),
  isCancelled: (id) => get().task?.id !== id || get().task?.cancelled === true,
}));
