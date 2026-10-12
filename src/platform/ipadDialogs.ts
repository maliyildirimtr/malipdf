/**
 * Small modal dialogs for the iPad app, standing in for the native dialogs
 * the desktop app gets from Electron (close confirmation, file name).
 */
import { translate } from '../../electron/i18n';
import { useUIStore } from '../store/uiStore';

const t = (text: string) => translate(useUIStore.getState().language, text);

interface DialogButton<T> {
  label: string;
  value: T;
  primary?: boolean;
  destructive?: boolean;
}

function openDialog<T>(
  message: string,
  detail: string | null,
  buttons: DialogButton<T>[],
  cancelValue: T,
  input?: { value: string },
): Promise<{ value: T; text: string }> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'ipad-dialog-backdrop';
    backdrop.setAttribute('data-no-translate', '');
    const box = document.createElement('div');
    box.className = 'ipad-dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'ipad-dialog__title';
    title.textContent = message;
    box.appendChild(title);
    if (detail) {
      const text = document.createElement('div');
      text.className = 'ipad-dialog__detail';
      text.textContent = detail;
      box.appendChild(text);
    }

    let field: HTMLInputElement | null = null;
    if (input) {
      field = document.createElement('input');
      field.className = 'ipad-dialog__input';
      field.type = 'text';
      field.value = input.value;
      field.autocapitalize = 'off';
      field.spellcheck = false;
      box.appendChild(field);
    }

    const finish = (value: T) => {
      backdrop.remove();
      resolve({ value, text: field?.value.trim() ?? '' });
    };

    const row = document.createElement('div');
    row.className = 'ipad-dialog__buttons';
    for (const button of buttons) {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = button.label;
      element.className = 'ipad-dialog__button'
        + (button.primary ? ' ipad-dialog__button--primary' : '')
        + (button.destructive ? ' ipad-dialog__button--destructive' : '');
      element.addEventListener('click', () => finish(button.value));
      row.appendChild(element);
    }
    box.appendChild(row);

    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) finish(cancelValue);
    });
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') finish(cancelValue);
      if (event.key === 'Enter' && field) {
        const primary = buttons.find((b) => b.primary);
        if (primary) finish(primary.value);
      }
    });

    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    if (field) {
      field.focus();
      // Select the name without its extension, as Files does.
      const dot = field.value.lastIndexOf('.');
      field.setSelectionRange(0, dot > 0 ? dot : field.value.length);
    } else {
      (row.querySelector('.ipad-dialog__button--primary') as HTMLButtonElement | null)?.focus();
    }
  });
}

/** Save / Don't Save / Cancel for unsaved documents. */
export async function askSaveChanges(names: string[]): Promise<'save' | 'discard' | 'cancel'> {
  const message = names.length === 1
    ? (useUIStore.getState().language === 'tr'
      ? `"${names[0]}" belgesindeki değişiklikler kaydedilsin mi?`
      : `Save the changes to "${names[0]}"?`)
    : (useUIStore.getState().language === 'tr'
      ? `${names.length} belgedeki değişiklikler kaydedilsin mi?`
      : `Save the changes to ${names.length} documents?`);
  const { value } = await openDialog<'save' | 'discard' | 'cancel'>(
    message,
    t("Your changes will be lost if you don't save them."),
    [
      { label: t('Cancel'), value: 'cancel' },
      { label: t("Don't Save"), value: 'discard', destructive: true },
      { label: t('Save'), value: 'save', primary: true },
    ],
    'cancel',
  );
  return value;
}

/** Asks for a file name; null when cancelled. */
export async function askFileName(title: string, defaultName: string): Promise<string | null> {
  const { value, text } = await openDialog<boolean>(
    t(title),
    null,
    [
      { label: t('Cancel'), value: false },
      { label: t('Save'), value: true, primary: true },
    ],
    false,
    { value: defaultName },
  );
  return value && text ? text : null;
}

/** Yes / no question. */
export async function askConfirm(message: string, confirmLabel: string): Promise<boolean> {
  const { value } = await openDialog<boolean>(
    t(message),
    null,
    [
      { label: t('Cancel'), value: false },
      { label: t(confirmLabel), value: true, primary: true, destructive: true },
    ],
    false,
  );
  return value;
}
