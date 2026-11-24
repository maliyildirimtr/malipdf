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

export interface SaveDestinationChoice {
  target: 'files' | 'library';
  fileName: string;
  folderId: string | null;
  newFolderName?: string;
}

/**
 * Interactive iPad Save / Save As destination picker: lets the user edit the
 * file name and choose between iPadOS Files / iCloud Drive (via native Files
 * share sheet), MaliPDF Home Library, any existing Library folder, or a brand
 * new folder created on the spot.
 */
export async function askSaveDestination(
  defaultName: string,
  folders: ReadonlyArray<{ id: string; name: string }>,
  currentFolderId: string | null,
  isSaveAs: boolean,
): Promise<SaveDestinationChoice | null> {
  const isTr = useUIStore.getState().language === 'tr';
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'ipad-dialog-backdrop';
    backdrop.setAttribute('data-no-translate', '');

    const box = document.createElement('div');
    box.className = 'ipad-dialog ipad-dialog--wide';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'ipad-dialog__title';
    title.textContent = isSaveAs
      ? (isTr ? 'Farklı Kaydet — Konum Seç' : 'Save As — Choose Location')
      : (isTr ? 'Nereye Kaydedilsin?' : 'Where to Save?');
    box.appendChild(title);

    // File name input
    const nameLabel = document.createElement('label');
    nameLabel.className = 'ipad-dialog__label';
    nameLabel.textContent = isTr ? 'Dosya Adı' : 'File Name';
    box.appendChild(nameLabel);

    const nameInput = document.createElement('input');
    nameInput.className = 'ipad-dialog__input';
    nameInput.type = 'text';
    nameInput.value = defaultName;
    nameInput.autocapitalize = 'off';
    nameInput.spellcheck = false;
    box.appendChild(nameInput);

    // Destination list
    const locLabel = document.createElement('div');
    locLabel.className = 'ipad-dialog__label';
    locLabel.textContent = isTr ? 'Kayıt Konumu' : 'Destination';
    box.appendChild(locLabel);

    type SelectionKey = 'files' | 'root' | 'new-folder' | `folder:${string}`;
    let selected: SelectionKey = currentFolderId ? `folder:${currentFolderId}` : 'root';

    const list = document.createElement('div');
    list.className = 'ipad-dialog__list';

    const newFolderInput = document.createElement('input');
    newFolderInput.className = 'ipad-dialog__input';
    newFolderInput.type = 'text';
    newFolderInput.placeholder = isTr ? 'Yeni klasör adı…' : 'New folder name…';
    newFolderInput.style.display = 'none';

    const optionButtons: Array<{ key: SelectionKey; el: HTMLButtonElement }> = [];
    const syncSelected = () => {
      for (const item of optionButtons) {
        item.el.classList.toggle('ipad-dialog__option--active', item.key === selected);
      }
      newFolderInput.style.display = selected === 'new-folder' ? 'block' : 'none';
      if (selected === 'new-folder') setTimeout(() => newFolderInput.focus(), 0);
    };

    const addOption = (key: SelectionKey, iconText: string, label: string, sub: string) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ipad-dialog__option';
      btn.innerHTML = `<span class="ipad-dialog__option-icon">${iconText}</span><span class="ipad-dialog__option-body"><span class="ipad-dialog__option-title"></span><span class="ipad-dialog__option-sub"></span></span><span class="ipad-dialog__option-check">✓</span>`;
      btn.querySelector('.ipad-dialog__option-title')!.textContent = label;
      btn.querySelector('.ipad-dialog__option-sub')!.textContent = sub;
      btn.addEventListener('click', () => {
        selected = key;
        syncSelected();
      });
      list.appendChild(btn);
      optionButtons.push({ key, el: btn });
    };

    addOption(
      'files',
      '☁️',
      isTr ? 'Dosyalar / iCloud / iPad\'im…' : 'Files / iCloud Drive / On My iPad…',
      isTr ? 'Sistem konum menüsünü aç (iCloud, İndirilenler, klasörler)' : 'Open system location picker (iCloud, Downloads, folders)',
    );
    addOption(
      'root',
      '📚',
      isTr ? 'MaliPDF Kütüphanesi (Ana Klasör)' : 'MaliPDF Library (Home Folder)',
      isTr ? 'iPad\'imde › MaliPDF' : 'On My iPad › MaliPDF',
    );
    for (const folder of folders) {
      addOption(
        `folder:${folder.id}`,
        '📁',
        folder.name,
        isTr ? 'MaliPDF Klasörü' : 'MaliPDF Folder',
      );
    }
    addOption(
      'new-folder',
      '➕',
      isTr ? 'Yeni Klasör Oluştur…' : 'Create New Folder…',
      isTr ? 'MaliPDF içinde yeni klasör açıp oraya kaydet' : 'Create a new folder inside MaliPDF and save there',
    );

    box.appendChild(list);
    box.appendChild(newFolderInput);
    syncSelected();

    const finish = (choice: SaveDestinationChoice | null) => {
      backdrop.remove();
      resolve(choice);
    };

    const confirmSave = () => {
      const fileName = nameInput.value.trim() || defaultName;
      if (selected === 'files') {
        finish({ target: 'files', fileName, folderId: null });
        return;
      }
      if (selected === 'new-folder') {
        const folderName = newFolderInput.value.trim();
        if (!folderName) {
          newFolderInput.focus();
          return;
        }
        finish({ target: 'library', fileName, folderId: null, newFolderName: folderName });
        return;
      }
      const folderId = selected.startsWith('folder:') ? selected.slice('folder:'.length) : null;
      finish({ target: 'library', fileName, folderId });
    };

    const row = document.createElement('div');
    row.className = 'ipad-dialog__buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ipad-dialog__button';
    cancelBtn.textContent = isTr ? 'İptal' : 'Cancel';
    cancelBtn.addEventListener('click', () => finish(null));

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ipad-dialog__button ipad-dialog__button--primary';
    saveBtn.textContent = isTr ? 'Kaydet' : 'Save';
    saveBtn.addEventListener('click', confirmSave);

    row.appendChild(cancelBtn);
    row.appendChild(saveBtn);
    box.appendChild(row);

    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) finish(null);
    });
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') finish(null);
      if (event.key === 'Enter') confirmSave();
    });

    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
  });
}
