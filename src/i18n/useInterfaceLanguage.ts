import { useLayoutEffect } from 'react';
import { useUIStore } from '../store/uiStore';
import { DomTranslator } from './domTranslator';

let translator: DomTranslator | null = null;

/** Applies Settings ▸ Language to the whole window and the native menu. */
export function useInterfaceLanguage(): void {
  const language = useUIStore((state) => state.language);

  useLayoutEffect(() => {
    translator ??= new DomTranslator(document.body);
    translator.setLanguage(language);
    document.documentElement.lang = language;
    window.electronAPI?.setLanguage?.(language);
  }, [language]);

  useLayoutEffect(() => () => {
    translator?.dispose();
    translator = null;
  }, []);
}
