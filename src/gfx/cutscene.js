// =========================================================================
// PRE-RENDERED CUTSCENE PLAYBACK
// =========================================================================
//
// Plays an mp4 INTO the game canvas rather than over it as a DOM element.
// Drawing it through the same context means it inherits the game's scaling,
// its pixel snapping and its letterboxing for free, and there is no second
// surface to keep aligned when the window resizes or the canvas is scaled.
//
// The rest of the engine is a 60Hz canvas loop, so a cutscene is just a scene
// that draws a video frame and reports when it is finished. Nothing about
// combat, waves or the camera needs to know it exists.

export class Cutscene {
  constructor(src, opts) {
    const o = opts || {};
    this.src = src;
    this.done = false;
    this.started = false;
    this.failed = false;
    this.canSkip = o.canSkip !== false;
    this.fadeIn = 0;
    this.t = 0;

    const v = document.createElement('video');
    v.src = src;
    v.preload = 'auto';
    // Muted + inline is what makes autoplay permitted without a gesture. The
    // render has no audio track anyway; sound is the game's job.
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.crossOrigin = 'anonymous';
    v.addEventListener('ended', () => { this.done = true; });
    // A cutscene that cannot load must never strand the player in a black
    // frame — it fails straight through to gameplay.
    v.addEventListener('error', () => { this.failed = true; this.done = true; });
    this.video = v;
  }

  // Starting is a RETRY, not a one-shot. A browser refuses to play video-only
  // media while the tab is in the background ("paused to save power"), and it
  // interrupts playback the moment the player alt-tabs. Treating either as a
  // failure would silently skip the cutscene for anyone who looked away, so a
  // refusal just leaves it pending and it is attempted again when the page is
  // visible. Only a genuine media error gives up.
  start() {
    this.started = true;
    this._attempt();
    if (!this._visHook) {
      this._visHook = () => { if (!document.hidden && !this.done) this._attempt(); };
      document.addEventListener('visibilitychange', this._visHook);
    }
  }

  _attempt() {
    if (this.done || document.hidden) return;
    const p = this.video.play();
    if (p && p.catch) p.catch(() => { /* pending; retried on visibility */ });
  }

  skip() {
    if (!this.canSkip || this.done) return false;
    try { this.video.pause(); } catch (e) { /* already gone */ }
    this.done = true;
    return true;
  }

  update(dt) {
    if (this.done) return;
    this.t += dt;
    this.fadeIn = Math.min(1, this.fadeIn + dt * 4);
    // Nudge it back into life if something paused it while the page is visible.
    if (!document.hidden && this.video.paused && this.video.readyState >= 2) {
      this._stalled = (this._stalled || 0) + dt;
      if (this._stalled > 0.4) { this._stalled = 0; this._attempt(); }
    } else {
      this._stalled = 0;
    }
    // If it never gets going at all, do not strand the player behind a black
    // frame — hand the fight over after a few seconds.
    if (!document.hidden && this.video.currentTime === 0 && this.t > 5) {
      this.failed = true; this.done = true;
    }
    // Belt and braces: if `ended` never fires (a stalled decode, a tab that
    // slept), finish on duration instead of hanging the fight forever.
    const d = this.video.duration;
    if (d && this.video.currentTime >= d - 0.05) this.done = true;
  }

  // The video is authored at the game's own aspect, so it fills exactly; the
  // fit is computed anyway so a differently-shaped clip letterboxes rather
  // than stretching.
  draw(g, W, H) {
    if (this.done || this.failed) return;
    const v = this.video;
    if (!v.videoWidth) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); return; }
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const s = Math.min(W / v.videoWidth, H / v.videoHeight);
    const w = Math.round(v.videoWidth * s);
    const h = Math.round(v.videoHeight * s);
    g.globalAlpha = this.fadeIn;
    g.drawImage(v, Math.round((W - w) / 2), Math.round((H - h) / 2), w, h);
    g.globalAlpha = 1;
  }

  dispose() {
    if (this._visHook) { document.removeEventListener('visibilitychange', this._visHook); this._visHook = null; }
    try { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); }
    catch (e) { /* nothing to release */ }
  }
}
