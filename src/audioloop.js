// Nahtlos geloopte Audiospur mit Crossfade am Schleifenende. Zwei Audio-Elemente
// derselben Quelle spielen versetzt: kurz vor dem Ende des einen blendet das andere
// von vorn ein (Equal-Power), das erste aus. Damit verschwindet der harte Schnitt am
// Loop-Punkt, den `<audio loop>` bzw. nicht perfekt schließende Clips erzeugen.
//
// Die öffentliche Fläche ahmt so viel vom <audio>-Element nach, dass weather.js die
// Elemente 1:1 austauschen kann: .volume (get/set), .paused, .play() (Promise),
// .pause(), ._blocked.
export class SeamlessLoop {
  constructor(url, { xfade = 0.7 } = {}) {
    this.xfade = xfade
    this._master = 0 // Ziel-Lautstärke (wie <audio>.volume)
    this._playing = false
    this._blocked = false
    this._cur = 0
    this._timer = null
    this.els = [new Audio(url), new Audio(url)]
    for (const a of this.els) { a.preload = 'auto'; a.loop = false; a.volume = 0 }
  }

  get paused() { return !this._playing }
  get volume() { return this._master }
  set volume(v) { this._master = v < 0 ? 0 : v > 1 ? 1 : v; if (this._playing) this._apply() }

  _apply() {
    const a = this.els[this._cur], b = this.els[1 - this._cur]
    const dur = a.duration
    let f = 0 // Crossfade-Fortschritt 0..1 in den letzten xfade-Sekunden
    if (dur && a.currentTime > dur - this.xfade) f = Math.min(1, (a.currentTime - (dur - this.xfade)) / this.xfade)
    a.volume = this._master * Math.cos((f * Math.PI) / 2) // Equal-Power: konstante Lautheit
    b.volume = this._master * Math.sin((f * Math.PI) / 2)
  }

  _tick() {
    if (!this._playing) return
    const a = this.els[this._cur], b = this.els[1 - this._cur]
    const dur = a.duration
    if (dur && a.currentTime > dur - this.xfade && b.paused) {
      b.currentTime = 0
      b.play().then(() => { this._blocked = false }).catch(() => { this._blocked = true })
    }
    if (dur && a.currentTime >= dur - 0.03) { a.pause(); a.currentTime = 0; this._cur = 1 - this._cur }
    this._apply()
  }

  play() {
    if (this._playing) return Promise.resolve()
    this._playing = true
    if (!this._timer) this._timer = setInterval(() => this._tick(), 40)
    this._apply()
    // Bei Autoplay-Block sauber zurück in den Pausenzustand (kein „stuck playing"),
    // damit ein Retry nach der nächsten User-Geste greift (wie bei <audio>).
    return Promise.resolve(this.els[this._cur].play())
      .then(() => { this._blocked = false })
      .catch((e) => { this._blocked = true; this.pause(); throw e })
  }

  pause() {
    this._playing = false
    for (const a of this.els) if (!a.paused) a.pause()
    if (this._timer) { clearInterval(this._timer); this._timer = null }
  }
}
