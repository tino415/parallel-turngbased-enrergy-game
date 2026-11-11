'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  const idOf = (prefix, field) => prefix + field;
  const percentOf = (fraction) => Number((fraction * 100).toFixed(6));

  function read(prefix) {
    const { DEFAULT_RULES } = GameEngine;
    const within = (field, fallback) => {
      const input = byId(idOf(prefix, field)),
        value = Number(input.value);
      return input.value !== '' && Number.isFinite(value)
        ? Math.max(Number(input.min), Math.min(Number(input.max), value))
        : fallback;
    };
    return {
      economy: byId(idOf(prefix, 'Economy')).value,
      startingDeposit: within('StartingDeposit', DEFAULT_RULES.startingDeposit),
      production: within('Production', DEFAULT_RULES.production),
      interest: within('Interest', 100 * DEFAULT_RULES.interest) / 100,
      capacity: within('Capacity', DEFAULT_RULES.capacity),
      overflowDecay: within('OverflowDecay', 100 * DEFAULT_RULES.overflowDecay) / 100,
    };
  }

  function write(prefix, rules) {
    const set = (field, value) => {
      byId(idOf(prefix, field)).value = String(value);
    };
    set('Economy', rules.economy);
    set('StartingDeposit', rules.startingDeposit);
    set('Production', rules.production);
    set('Interest', percentOf(rules.interest));
    set('Capacity', rules.capacity);
    set('OverflowDecay', percentOf(rules.overflowDecay));
    showDepositOnlyUnderEquilibrium(prefix);
  }

  function showDepositOnlyUnderEquilibrium(prefix) {
    const equilibrium = byId(idOf(prefix, 'Economy')).value === 'equilibrium';
    byId(idOf(prefix, 'StartingDeposit')).closest('label').hidden = !equilibrium;
  }

  function bind(prefix) {
    byId(idOf(prefix, 'Economy')).addEventListener('change', () =>
      showDepositOnlyUnderEquilibrium(prefix),
    );
    showDepositOnlyUnderEquilibrium(prefix);
  }

  window.RulesForm = Object.freeze({ read, write, bind });
})();
