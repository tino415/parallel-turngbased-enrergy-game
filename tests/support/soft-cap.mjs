// Experimental adapter only. Production src/engine.js never imports this module.
// Orders are simultaneous: withdraw against the START state before spending,
// but incoming transfers arrive only after the source budgets are validated.
export function fundWithdrawals(nodes, withdrawals = {}, fee = 0) {
  if (!Number.isFinite(fee) || fee < 0 || fee >= 1) {
    throw new RangeError('Withdrawal fee must be in [0, 1)');
  }
  const funded = nodes.map((node) => ({ ...node }));
  let withdrawn = 0;
  let feeLoss = 0;
  for (const [rawId, requested] of Object.entries(withdrawals)) {
    if (!/^(0|[1-9]\d*)$/.test(rawId)) throw new Error('Invalid withdrawal source');
    const node = funded[Number(rawId)];
    if (
      !node ||
      node.owner === null ||
      !Number.isFinite(requested) ||
      requested < 0 ||
      requested > node.invested + 1e-8
    ) {
      throw new Error('Invalid withdrawal on node ' + rawId);
    }
    const amount = Math.min(node.invested, requested);
    node.invested -= amount;
    node.active += amount * (1 - fee);
    withdrawn += amount;
    feeLoss += amount * fee;
  }
  return { nodes: funded, withdrawn, feeLoss };
}

// The soft cap constrains TOTAL energy, not invested capital alone.
// At round end, a fraction of the OVERFLOW is removed proportionally from
// both pools. This leaves short-term concentrations possible without making
// invested principal an unlimited, decay-proof bank.
export function decayOverflow(nodes, capacity, decay) {
  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new RangeError('Capacity must be positive and finite');
  }
  if (!Number.isFinite(decay) || decay < 0 || decay > 1) {
    throw new RangeError('Overflow decay must be in [0, 1]');
  }
  let totalLoss = 0;
  const losses = {};
  const result = nodes.map((node) => {
    const copy = { ...node };
    // Neutral defensive energy is unchanged until the node is captured.
    if (node.owner === null) return copy;
    const total = node.active + node.invested;
    const loss = Math.min(total, Math.max(0, total - capacity) * decay);
    if (loss <= 0) return copy;
    copy.active = Math.max(0, node.active * (1 - loss / total));
    copy.invested = Math.max(0, node.invested * (1 - loss / total));
    totalLoss += loss;
    losses[node.owner] = (losses[node.owner] ?? 0) + loss;
    return copy;
  });
  return { nodes: result, totalLoss, losses };
}

// This adapter is never invoked from game.js. Using the unmodified engine
// preserves its combat RNG, investment accounting and simultaneous orders.
export function resolveSoftCapRound({
  engine,
  state,
  withdrawals = {},
  capacity,
  overflowDecay,
  withdrawalFee = 0,
  ...roundOrders
}) {
  const funded = fundWithdrawals(state.nodes, withdrawals, withdrawalFee);
  const resolved = engine.resolveRound({
    ...roundOrders,
    state: { ...state, nodes: funded.nodes },
  });
  const overflow = decayOverflow(resolved.state.nodes, capacity, overflowDecay);
  return {
    ...resolved,
    state: { ...resolved.state, nodes: overflow.nodes },
    economy: {
      withdrawn: funded.withdrawn,
      withdrawalFees: funded.feeLoss,
      overflowLoss: overflow.totalLoss,
      overflowLossesByOwner: overflow.losses,
    },
  };
}
