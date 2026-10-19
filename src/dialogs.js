'use strict';

(() => {
  const ordersDialog = document.getElementById('uxOrdersDialog');
  const settingsDialog = document.getElementById('uxSettingsDialog');

  for (const dialog of [ordersDialog, settingsDialog])
    dialog.querySelector('.ux-dialog-close').onclick = () => dialog.close();

  document.getElementById('settingsNewGame').onclick = () => {
    settingsDialog.close();
    openNewGame();
  };
})();
