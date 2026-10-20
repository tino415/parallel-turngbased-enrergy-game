'use strict';

(() => {
  const ordersDialog = document.getElementById('uxOrdersDialog');
  const settingsDialog = document.getElementById('uxSettingsDialog');

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
