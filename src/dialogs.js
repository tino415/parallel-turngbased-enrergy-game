'use strict';

(() => {
  const ordersDialog = document.getElementById('uxOrdersDialog');
  const settingsDialog = document.getElementById('uxSettingsDialog');

  const tacticalMenu = () => document.getElementById('tacticalMenu');
  const isOverlay = (element) => element instanceof HTMLDialogElement || element === tacticalMenu();

  const closeOtherOverlays = (opened) => {
    for (const dialog of document.querySelectorAll('dialog[open]'))
      if (dialog !== opened) dialog.requestClose();
    if (tacticalMenu() && tacticalMenu() !== opened) tacticalMenu().open = false;
  };

  const closeMenuOnOutsideClick = (event) => {
    const menu = tacticalMenu();
    if (menu?.open && !menu.contains(event.target)) menu.open = false;
  };

  document.addEventListener(
    'toggle',
    (event) => {
      if (event.newState === 'open' && isOverlay(event.target)) closeOtherOverlays(event.target);
    },
    true,
  );
  document.addEventListener('click', closeMenuOnOutsideClick, true);

  for (const dialog of [ordersDialog, settingsDialog])
    dialog.querySelector('.ux-dialog-close').onclick = () => dialog.close();

  const aiDebug = document.getElementById('aiDebug');
  aiDebug.onchange = () => {
    store.setAiDebug(aiDebug.checked);
  };
  if (new URLSearchParams(location.search).has('aidebug')) {
    store.setAiDebug(true);
    aiDebug.checked = true;
  }

  document.getElementById('settingsNewGame').onclick = openNewGame;

  const currentRules = document.getElementById('currentRules');
  const percent = (fraction) => `${Math.round(fraction * 1000) / 10}%`;
  const ruleRows = (rules) => [
    ['Production per node', rules.production],
    ['Investment interest', percent(rules.interest)],
    ['Node capacity', rules.capacity],
    ['Overflow decay', percent(rules.overflowDecay)],
  ];
  const showCurrentRules = () => {
    currentRules.replaceChildren(
      ...ruleRows(matchRules()).flatMap(([name, value]) => {
        const term = document.createElement('dt');
        const description = document.createElement('dd');
        term.textContent = name;
        description.textContent = String(value);
        return [term, description];
      }),
    );
  };
  settingsDialog.addEventListener('toggle', (event) => {
    if (event.newState === 'open') showCurrentRules();
  });
})();
