'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  const dialog = byId('uxRulesDialog');
  const currentRules = byId('currentRules');
  const percent = (fraction) => `${Math.round(fraction * 1000) / 10}%`;

  const menuItem = document.createElement('button');
  menuItem.type = 'button';
  menuItem.id = 'menuRules';
  menuItem.textContent = 'Rules';
  document.querySelector('#tacticalMenu .tactical-menu-content').append(menuItem);

  menuItem.onclick = () => {
    byId('tacticalMenu').open = false;
    renderRules();
    dialog.showModal();
  };

  store.subscribe((snapshot, previous) => {
    if (dialog.open && GameStore.changed(snapshot, previous, (s) => s.match)) renderRules();
  });

  function renderRules() {
    currentRules.replaceChildren(...ruleRows(matchRules()).flatMap(definition));
  }

  function ruleRows(rules) {
    return [
      ['Production per node', rules.production],
      ['Investment interest', percent(rules.interest)],
      ['Node capacity', rules.capacity],
      ['Overflow decay', percent(rules.overflowDecay)],
    ];
  }

  function definition([name, value]) {
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = name;
    description.textContent = String(value);
    return [term, description];
  }
})();
