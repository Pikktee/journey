// Welche Anbieter es gibt — und welche davon tatsächlich benutzbar sind.

import type { TrackerProviderId, TrackerProvider } from './contract.js'

export class Registry {
  private readonly anbieter = new Map<TrackerProviderId, TrackerProvider>()

  constructor(provider: readonly TrackerProvider[] = []) {
    for (const p of provider) this.anbieter.set(p.id, p)
  }

  /**
   * Alle registrierten Anbieter — auch unkonfigurierte.
   *
   * Die Oberfläche zeigt sie mit `verfuegbar: false`, statt sie zu verschweigen:
   * „Polar (noch nicht eingerichtet)" ist eine Auskunft, ein fehlender Eintrag
   * wäre keine.
   */
  alle(): TrackerProvider[] {
    return [...this.anbieter.values()]
  }

  /** Nur, was auch wirklich arbeiten kann (Zugangsdaten hinterlegt). */
  verfuegbare(): TrackerProvider[] {
    return this.alle().filter((p) => p.konfiguriert)
  }

  /**
   * Ein Anbieter für einen Routen-Parameter. Gibt `null` auch für einen
   * bekannten, aber UNkonfigurierten zurück: Wer nicht arbeiten kann, darf
   * keine Route beantworten — sonst führte „Verbinden" auf eine Fehlerseite
   * des Anbieters statt auf eine verständliche Meldung bei uns.
   */
  hole(id: string): TrackerProvider | null {
    const p = this.anbieter.get(id as TrackerProviderId)
    return p?.konfiguriert ? p : null
  }
}
