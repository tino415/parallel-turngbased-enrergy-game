'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  const { selectors } = GameStore;
  const dialog = byId('templatesDialog');
  const templates = () => store.getSnapshot().ui.templates;

  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (label, act, id) => {
    const control = element('button', label);
    control.type = 'button';
    if (id) control.id = id;
    control.onclick = act;
    return control;
  };

  const summary = (template) => {
    const parts = ['invest ' + template.investPct + '%'];
    if (template.investTarget !== null) parts.push('until ' + template.investTarget);
    if (template.divestPct) parts.push('↓ ' + template.divestPct + '%/round');
    parts.push('floor ' + template.reserve);
    if (template.defensePct) parts.push('grow ' + template.defensePct + '%');
    if (template.defenseTarget !== null) parts.push('up to ' + template.defenseTarget);
    return parts.join(' · ');
  };

  const namedAfter = (ids) => 'node' + (ids.length === 1 ? ' ' : 's ') + ids.join(', ');

  function applyTo(ids, template) {
    const match = store.getSnapshot().match;
    const skipped = selectors.templateMisfits(match, ids, template);
    store.applyTemplate(ids, template);
    const applied = ids.filter((id) => !skipped.includes(id));
    const done = 'Applied “' + template.name + '” to ' + namedAfter(applied) + '.';
    return skipped.length
      ? (applied.length ? done + ' ' : '') +
          'Skipped ' +
          namedAfter(skipped) +
          ': pressure shares leave no room for the template.'
      : done;
  }

  function saveAs(id, name) {
    if (!name.trim()) return false;
    const exists = templates().some((t) => t.name === name.trim());
    if (exists && !confirm('Replace the template “' + name.trim() + '”?')) return false;
    const policy = { ...selectors.defaultPolicy(), ...store.getSnapshot().match.policies[id] };
    store.saveTemplate(name, policy);
    return true;
  }

  function saveForm(id, ids) {
    const form = element('div', '', 'template-row');
    const name = document.createElement('input');
    name.id = 'templateName';
    name.placeholder = 'Template name';
    name.setAttribute('aria-label', 'Template name');
    form.append(
      name,
      button(
        'Save node ' + id + ' as template',
        () => saveAs(id, name.value) && renderSheet(ids),
        'templateSaveNode',
      ),
    );
    return form;
  }

  function templateRow(template, actions) {
    const row = element('div', '', 'template-row');
    const text = element('div');
    text.append(element('strong', template.name), element('div', summary(template), 'muted'));
    row.append(text, ...actions);
    return row;
  }

  function renderSheet(ids, notice = '') {
    const body = dialog.querySelector('.ux-dialog-body');
    const rows = templates().map((template) =>
      templateRow(template, [button('Apply', () => renderSheet(ids, applyTo(ids, template)))]),
    );
    body.replaceChildren(
      element('p', notice, 'muted template-notice'),
      ...(rows.length ? rows : [element('p', 'No templates yet.', 'muted')]),
      ...(ids.length === 1 ? [saveForm(ids[0], ids)] : []),
    );
    dialog.querySelector('h2').textContent =
      ids.length === 1 ? 'Templates for node ' + ids[0] : 'Templates for ' + ids.length + ' nodes';
  }

  window.openTemplates = (ids) => {
    renderSheet(ids);
    dialog.showModal();
  };
  dialog.querySelector('.ux-dialog-close').onclick = () => dialog.close();

  const settingsList = byId('settingsTemplates');
  const fillSelect = byId('fillFromTemplate');

  function renderSettings() {
    const rows = templates().map((template) =>
      templateRow(template, [
        button('Rename', () => {
          const name = prompt('New name', template.name);
          if (name !== null) store.renameTemplate(template.name, name);
        }),
        button('Delete', () => store.deleteTemplate(template.name)),
      ]),
    );
    settingsList.replaceChildren(
      ...(rows.length ? rows : [element('p', 'No templates yet.', 'muted')]),
    );
    fillSelect.replaceChildren(
      ...templates().map((template) => new Option(template.name, template.name)),
    );
    byId('fillFromTemplateRow').hidden = templates().length === 0;
  }

  byId('fillFromTemplateApply').onclick = () => {
    const template = templates().find((t) => t.name === fillSelect.value);
    if (!template) return;
    store.setDefaults(selectors.templateDefaults(template));
    writeDefaults(store.getSnapshot().match.defaults);
  };

  store.subscribe((snapshot, previous) => {
    if (GameStore.changed(snapshot, previous, (s) => s.ui.templates)) renderSettings();
  });
  renderSettings();
})();
