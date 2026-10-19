'use strict';

(() => {
  const suffixes = ['', 'K', 'M', 'B', 'T'];

  function compactEnergy(value) {
    const number = Number(value) || 0;
    const sign = number < 0 ? '−' : '';
    return sign + compactMagnitude(Math.abs(number));
  }

  function compactMagnitude(magnitude) {
    if (Number(magnitude.toFixed(1)) < 100) return magnitude.toFixed(1);
    if (Math.round(magnitude) < 1000) return String(Math.round(magnitude));
    const tier = tierOf(magnitude);
    if (tier >= suffixes.length)
      return Number(magnitude.toPrecision(2)).toExponential().replace('+', '');
    return threeSignificantDigits(magnitude / 1000 ** tier) + suffixes[tier];
  }

  function tierOf(magnitude) {
    const tier = Math.floor(Math.log10(magnitude) / 3);
    const roundsUpToNextTier = Number((magnitude / 1000 ** tier).toPrecision(3)) >= 1000;
    return roundsUpToNextTier ? tier + 1 : tier;
  }

  function threeSignificantDigits(scaled) {
    return String(Number(scaled.toPrecision(3)));
  }

  function exactEnergy(value) {
    return (Number(value) || 0).toLocaleString('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }

  globalThis.EnergyFormat = Object.freeze({ compactEnergy, exactEnergy });
})();
