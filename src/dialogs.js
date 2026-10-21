'use strict';

(() => {
  const ordersDialog = document.getElementById('uxOrdersDialog');
  const settingsDialog = document.getElementById('uxSettingsDialog');

  const menu = () => document.getElementById('tacticalMenu');
  const openDialogs = () => [...document.querySelectorAll('dialog[open]')];

  const closeMenu = () => {
    if (menu()) menu().open = false;
  };

  const closeDialogs = (except) => {
    for (const dialog of openDialogs()) if (dialog !== except) dialog.close();
  };

  const isOutside = (dialog, { clientX, clientY }) => {
    const box = dialog.getBoundingClientRect();
    return clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom;
  };

  const showModalAlone = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function () {
    closeMenu();
    closeDialogs(this);
    showModalAlone.call(this);
  };

  document.addEventListener(
    'toggle',
    (event) => {
      if (event.target === menu() && menu().open) closeDialogs();
    },
    true,
  );

  document.addEventListener('click', (event) => {
    const dialog = event.target.closest('dialog[open]');
    if (dialog === event.target && isOutside(dialog, event)) {
      if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
    } else if (!dialog && menu()?.open && !menu().contains(event.target)) closeMenu();
  });

  for (const dialog of [ordersDialog, settingsDialog])
    dialog.querySelector('.ux-dialog-close').onclick = () => dialog.close();

  const aiDebug = document.getElementById('aiDebug');
  aiDebug.onchange = () => {
    store.setAiDebug(aiDebug.checked);
    render();
  };
  if (new URLSearchParams(location.search).has('aidebug')) {
    store.setAiDebug(true);
    aiDebug.checked = true;
  }

  document.getElementById('settingsNewGame').onclick = () => {
    settingsDialog.close();
    openNewGame();
  };
})();
