/* The canonical core supplies available actions and content. This UI owns no stage machine. */
(() => {
  const el = id => document.getElementById(id);
  const labels = {advance: 'Continue', ask_more_explanation: 'Explain more', ask_example: 'Show example',
    submit_practice: 'Capture room evidence and observation', answer_socratic_check: 'Record my explanation', finish: 'Save reflection and finish'};
  let lessons = [], current = null, pending = null, sending = false, polling = false, connected = false, rendered = '';
  async function send(path, body) {
    const headers = {'Content-Type': 'application/json'};
    if (el('token').value) headers.Authorization = 'Bearer ' + el('token').value;
    const response = await fetch(path, {method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined});
    const data = await response.json();
    if (!response.ok) { const error = Error(data.error || 'Request failed'); error.status = response.status; throw error; }
    return data;
  }
  function render(data) {
    current = data.session;
    el('lessonActive').hidden = !current;
    el('learningStatus').textContent = data.issue || (current ? current.completionLabel : connected ? 'Core connected. Place a block, select it in Objects, then start.' : 'Connect the local learning core to begin.');
    el('restoreRetry').hidden = !data.restorePending || data.restoreFailed;
    el('restoreDismiss').hidden = !data.restoreFailed;
    const runtimeReady = latest?.online && !latest?.pendingCount;
    el('lessonStart').disabled = sending || !!pending || !connected || !runtimeReady || data.restorePending || !el('object').value;
    if (!current) { rendered = ''; return; }
    const s = current, content = s.content;
    el('learningHeading').textContent = content.title;
    el('lessonStage').textContent = s.stageLabel;
    el('lessonProgress').textContent = `${s.progress.index} / ${s.progress.total}`;
    el('lessonMeter').max = s.progress.total; el('lessonMeter').value = s.progress.index;
    el('lessonBody').textContent = content.body; el('lessonPrompt').textContent = content.prompt;
    el('lessonHint').textContent = content.hint;
    el('lessonBinding').textContent = 'Bound block: ' + s.context.objectId + ' · target: ' + s.context.anchorId;
    const block = latest?.snapshot?.scene?.objects.find(o => o.objectId === s.context.objectId);
    const scale = block?.transform.scale;
    el('lessonScale').textContent = 'Local scale multipliers (X, Y, Z)\nStarting: ' + ['x','y','z'].map(k => s.context.baselineScale[k].toFixed(3)).join(', ')
      + '\nCurrent:  ' + (scale ? ['x','y','z'].map(k => scale[k].toFixed(3)).join(', ') : 'Block unavailable')
      + (scale ? '\nRatios:   ' + ['x','y','z'].map(k => (scale[k] / s.context.baselineScale[k]).toFixed(3)).join(', ') : '');
    el('lessonResponse').disabled = sending || !!pending || s.stage === 'ended';
    const version = s.id + ':' + s.revision;
    const actionsDisabled = sending || !!pending || !runtimeReady || !!data.issue;
    if (rendered === version) {
      el('lessonActions').querySelectorAll('button').forEach(button => { button.disabled = actionsDisabled; });
      return; // Preserve focus on stable buttons, links and history during polling.
    }
    rendered = version;
    el('lessonActions').replaceChildren();
    for (const action of s.availableActions) {
      const button = document.createElement('button'); button.textContent = labels[action] || action;
      button.disabled = actionsDisabled;
      button.onclick = () => mutate('/api/learning/action', {requestId: crypto.randomUUID(), sessionId: s.id,
        expectedRevision: s.revision, action, message: el('lessonResponse').value});
      el('lessonActions').append(button);
    }
    el('lessonSources').replaceChildren();
    for (const source of content.sources) {
      const item = document.createElement('li');
      let url; try { url = new URL(source.url); } catch { /* Authored arithmetic can be uncited. */ }
      if (url && url.protocol === 'https:') {
        const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.textContent = source.title; item.append(link);
      } else { item.textContent = source.title; }
      item.append(document.createTextNode(' — ' + (source.citation || source.kind)));
      el('lessonSources').append(item);
    }
    el('lessonHistory').replaceChildren();
    for (const message of s.messages.filter(m => m.role === 'learner').slice(-30)) {
      const p = document.createElement('p'); p.textContent = message.stage + ': ' + message.content; el('lessonHistory').append(p);
    }
  }
  async function poll() {
    if (polling) return;
    polling = true;
    try { render(await send('/api/learning')); }
    catch (error) { el('learningStatus').textContent = error.message; }
    finally { polling = false; }
  }
  async function connect() {
    try { const data = await send('/api/lessons'); lessons = data.lessons; connected = lessons.length > 0; await poll(); }
    catch (error) { connected = false; el('learningStatus').textContent = error.message; }
  }
  async function mutate(path, body) {
    if (sending) return;
    pending = {path, body}; sending = true; await poll(); el('lessonError').textContent = '';
    try {
      await send(path, body); pending = null; el('lessonResponse').value = ''; el('lessonRetry').hidden = true;
    } catch (error) {
      // A transport/server failure is uncertain: preserve the exact ID and payload for retry.
      if (error.status && error.status < 500) pending = null;
      el('lessonError').textContent = error.message;
      el('lessonRetry').hidden = !pending;
    } finally { sending = false; await poll(); }
  }
  el('lessonConnect').onclick = connect;
  el('lessonStart').onclick = () => mutate('/api/learning/start', {requestId: crypto.randomUUID(), lessonId: lessons[0].id, objectId: el('object').value});
  el('lessonRetry').onclick = () => pending && mutate(pending.path, pending.body);
  el('restoreRetry').onclick = async () => { try { await send('/api/learning/retry_restore', {}); await poll(); } catch(e) { el('learningStatus').textContent = e.message; } };
  el('restoreDismiss').onclick = async () => { try { await send('/api/learning/dismiss_restore', {}); await poll(); } catch(e) { el('learningStatus').textContent = e.message; } };
  el('object').addEventListener('change', poll);
  connect(); setInterval(poll, 1500);
})();
