export function roundOrdersFromPlan(plan, nodes) {
  const orders = {};
  const aiOrdersOverride = [];
  const aiWithdrawalsOverride = {};
  for (const [rawId, choice] of Object.entries(plan.orders)) {
    const source = Number(rawId);
    const options = Array.isArray(choice) ? choice : [choice];
    if (nodes[source].owner === 0) {
      const manual = {
        withdraw: plan.withdrawals[source] ?? 0,
        invest: 0,
        edges: {},
      };
      for (const action of options) {
        if (action.type === 'invest') manual.invest += action.amount;
        else manual.edges[action.dest] = (manual.edges[action.dest] ?? 0) + action.amount;
      }
      orders[source] = manual;
    } else {
      aiOrdersOverride.push(...options);
    }
  }
  for (const [source, amount] of Object.entries(plan.withdrawals)) {
    if (nodes[Number(source)].owner !== 0) aiWithdrawalsOverride[source] = amount;
    else if (!orders[source]) orders[source] = { withdraw: amount, invest: 0, edges: {} };
  }
  return { orders, aiOrdersOverride, aiWithdrawalsOverride };
}
