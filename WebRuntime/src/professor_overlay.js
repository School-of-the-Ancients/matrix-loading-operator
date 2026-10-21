// Reuse the real Professor page. This is a browser-owned DOM surface, not a 3D browser.
export function professorRoute(location) {
  const local = location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname);
  return { available: local, url: local ? `http://${location.hostname}:3108/` : null,
    reason: local ? '' : 'Professor is restricted to the PC loopback address. This device URL needs an approved same-origin connection before the full page can be embedded. No network access was changed.' };
}

export class ProfessorOverlay {
  constructor({ root, panel, frame, status, notice, closeButton, standalone, triggers, location,
    canOpen = () => '', onOpenChange = () => {}, onNotice = () => {} }) {
    Object.assign(this, { root, panel, frame, status, notice, closeButton, standalone, triggers,
      canOpen, onOpenChange, onNotice });
    this.route = professorRoute(location); this.session = null; this.opened = false; this.loaded = false;
    this.previousFocus = null;
    this.root.addEventListener('beforexrselect', event => event.preventDefault());
    // DOM events do not reach the world canvas; also stop outer-page shortcuts.
    for (const type of ['pointerdown', 'pointerup', 'click', 'wheel', 'keydown'])
      this.panel.addEventListener(type, event => event.stopPropagation());
    this.panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
    });
    this.closeButton.addEventListener('click', () => this.close());
    for (const trigger of triggers) trigger.addEventListener('click', () => this.opened ? this.close() : this.open(trigger));
    this.frame.addEventListener('error', () => {
      this.notice.textContent = 'The Professor page could not load. Its standalone server must be running on this PC.';
    });
    this.standalone.hidden = !this.route.available;
    if (this.route.available) this.standalone.href = this.route.url;
    this.render();
  }
  setSession(session) {
    this.session = session;
    // Never carry a desktop CSS window into an unsupported immersive session.
    if (this.opened) this.close();
    this.render();
  }
  supported() { return !this.session || !!this.session.domOverlayState; }
  open(trigger = null) {
    if (!this.supported()) {
      const message = 'This XR session does not provide DOM overlay. The full Professor page cannot be shown here; exit XR to use the desktop Professor button.';
      this.status.textContent = message; this.onNotice(message); return false;
    }
    const blocked = this.canOpen();
    if (blocked) { this.onNotice(blocked); return false; }
    this.previousFocus = trigger;
    this.opened = true;
    if (this.route.available && !this.loaded) {
      this.frame.src = this.route.url; this.loaded = true;
    }
    this.onOpenChange(true); this.render(); this.closeButton.focus();
    return true;
  }
  close() {
    const wasOpen = this.opened; this.opened = false;
    if (wasOpen) this.onOpenChange(false);
    this.render();
    if (wasOpen) this.previousFocus?.focus?.({ preventScroll: true });
    // Keep the frame mounted: unsent drafts, navigation and its learner cookie survive.
  }
  render() {
    this.panel.hidden = !this.opened;
    this.root.dataset.professorOpen = String(this.opened);
    this.root.dataset.xrActive = String(!!this.session);
    this.root.style.display = this.opened || (this.session && this.supported()) ? '' : 'none';
    this.frame.hidden = !this.route.available;
    this.notice.textContent = this.route.available
      ? 'The complete Professor app runs on this PC. Use its own mentor, lesson, quiz and saved-session controls. Close returns to Matrix without unloading the page.'
      : this.route.reason;
    this.status.textContent = this.session
      ? this.supported() ? `Professor: browser DOM overlay (${this.session.domOverlayState.type}). Device input/readability still needs validation.`
        : 'Professor: DOM overlay is unsupported in this XR session. Exit XR for the desktop page.'
      : this.route.available ? 'Professor: desktop browser surface. XR support is checked on session entry.' : this.route.reason;
    for (const trigger of this.triggers) trigger.setAttribute('aria-expanded', String(this.opened));
  }
}
