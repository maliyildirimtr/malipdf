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

/** Save / Don't Save / Cancel when exiting an external "Open in MaliPDF" PDF. */
export async function askKeepExternalPdf(name: string, hasEdits: boolean): Promise<'save' | 'discard' | 'cancel'> {
  const isTr = useUIStore.getState().language === 'tr';
  const message = hasEdits
    ? (isTr
      ? `"${name}" ve yaptığınız düzenlemeler kaydedilsin mi?`
      : `Save "${name}" and your annotations to your library?`)
    : (isTr
      ? `"${name}" kütüphanenize kaydedilsin mi?`
      : `Save "${name}" to your library?`);
  const detail = hasEdits
    ? (isTr
      ? 'Kaydetmezseniz bu PDF ve üzerindeki notlar silinecektir.'
      : "Your changes will be lost if you don't save them.")
    : (isTr
      ? 'Bu PDF dışarıdan açıldı. Kaydetmezseniz cihazınızda yer kaplamaz.'
      : "This PDF was opened from another app. Choose Don't Save to close without using storage.");
  const { value } = await openDialog<'save' | 'discard' | 'cancel'>(
    message,
    detail,
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
  scope: 'local' | 'cloud';
  newFolderName?: string;
}

/**
 * Interactive Save / Save As destination picker: lets the user edit the
 * file name and choose between system Files / Share, This Device ("Cihazım"),
 * Cloud ("Bulut — iCloud Drive / Google Drive"), any folder, or a brand-new folder.
 */
export async function askSaveDestination(
  defaultName: string,
  folders: ReadonlyArray<{ id: string; name: string; scope?: 'local' | 'cloud' }>,
  currentFolderId: string | null,
  isSaveAs: boolean,
  cloudOptions?: {
    currentScope?: 'local' | 'cloud';
    cloudEnabled?: boolean;
    cloudLabel?: string;
  },
): Promise<SaveDestinationChoice | null> {
  const isTr = useUIStore.getState().language === 'tr';
  const currentScope = cloudOptions?.currentScope ?? 'local';
  const cloudEnabled = Boolean(cloudOptions?.cloudEnabled);
  const cloudLabel = cloudOptions?.cloudLabel || 'iCloud Drive';
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

    type SelectionKey =
      | 'files'
      | 'local-root'
      | 'cloud-root'
      | 'new-local-folder'
      | 'new-cloud-folder'
      | `folder:${'local' | 'cloud'}:${string}`;

    const initialFolder = currentFolderId ? folders.find((f) => f.id === currentFolderId) : undefined;
    let selected: SelectionKey = initialFolder
      ? `folder:${initialFolder.scope === 'cloud' ? 'cloud' : 'local'}:${initialFolder.id}`
      : currentScope === 'cloud' && cloudEnabled
        ? 'cloud-root'
        : 'local-root';

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
      const isNew = selected === 'new-local-folder' || selected === 'new-cloud-folder';
      newFolderInput.style.display = isNew ? 'block' : 'none';
      if (isNew) setTimeout(() => newFolderInput.focus(), 0);
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

    // 1. Local Device options ("Cihazım")
    addOption(
      'local-root',
      '📱',
      isTr ? 'Cihazım — Ana Klasör' : 'This Device — Home Folder',
      isTr ? 'Yalnızca bu cihazda kalır (buluta yüklenmez)' : 'Stays on this device only (never auto-uploaded)',
    );
    for (const folder of folders.filter((f) => (f.scope ?? 'local') === 'local')) {
      addOption(
        `folder:local:${folder.id}`,
        '📁',
        folder.name,
        isTr ? 'Cihazım Klasörü' : 'This Device Folder',
      );
    }

    // 2. Cloud options ("Bulut — iCloud Drive / Google Drive") when connected
    if (cloudEnabled) {
      addOption(
        'cloud-root',
        '☁️',
        isTr ? `Ana Klasör (${cloudLabel})` : `Home Folder (${cloudLabel})`,
        isTr ? 'Otomatik bulut senkronizasyonu açık' : 'Automatically synced across your devices',
      );
      for (const folder of folders.filter((f) => f.scope === 'cloud')) {
        addOption(
          `folder:cloud:${folder.id}`,
          '☁️',
          folder.name,
          isTr ? `${cloudLabel} Klasörü` : `${cloudLabel} Folder`,
        );
      }
      addOption(
        'new-cloud-folder',
        '➕',
        isTr ? `Yeni Bulut Klasörü (${cloudLabel})…` : `New Cloud Folder (${cloudLabel})…`,
        isTr ? 'Bulutta yeni klasör açıp oraya kaydet' : 'Create a new synced cloud folder and save there',
      );
    }

    addOption(
      'new-local-folder',
      '➕',
      isTr ? 'Yeni Cihaz Klasörü Oluştur…' : 'New Folder on This Device…',
      isTr ? 'Cihazımda yeni klasör açıp oraya kaydet' : 'Create a local folder on this device and save there',
    );

    addOption(
      'files',
      '📤',
      isTr ? 'Dosyalar Uygulamasına Dışa Aktar…' : 'Export to System Files…',
      isTr ? 'Sistem konum menüsünü aç (İndirilenler, başka uygulamalar)' : 'Open system location picker (Downloads, other apps)',
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
        finish({ target: 'files', fileName, folderId: null, scope: currentScope });
        return;
      }
      if (selected === 'new-local-folder' || selected === 'new-cloud-folder') {
        const folderName = newFolderInput.value.trim();
        if (!folderName) {
          newFolderInput.focus();
          return;
        }
        finish({
          target: 'library',
          fileName,
          folderId: null,
          scope: selected === 'new-cloud-folder' ? 'cloud' : 'local',
          newFolderName: folderName,
        });
        return;
      }
      if (selected === 'cloud-root') {
        finish({ target: 'library', fileName, folderId: null, scope: 'cloud' });
        return;
      }
      if (selected === 'local-root') {
        finish({ target: 'library', fileName, folderId: null, scope: 'local' });
        return;
      }
      if (selected.startsWith('folder:cloud:')) {
        finish({ target: 'library', fileName, folderId: selected.slice('folder:cloud:'.length), scope: 'cloud' });
        return;
      }
      const folderId = selected.startsWith('folder:local:') ? selected.slice('folder:local:'.length) : null;
      finish({ target: 'library', fileName, folderId, scope: 'local' });
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
