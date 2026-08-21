// Welche Anbieter es gibt — und welche davon tatsächlich benutzbar sind.

import type { TrackerProviderId, TrackerProvider } from './contract.js'

export class Registry {
  private readonly providers = new Map<TrackerProviderId, TrackerProvider>()

  constructor(provider: readonly TrackerProvider[] = []) {
    for (const p of provider) this.providers.set(p.id, p)
  }

  /**
   * Alle registrierten Anbieter — auch unkonfigurierte.
   *
   * Die Oberfläche zeigt sie mit `verfuegbar: false`, statt sie zu verschweigen:
   * „Polar (noch nicht eingerichtet)" ist eine Auskunft, ein fehlender Eintrag
   * wäre keine.
   */
  all(): TrackerProvider[] {
    return [...this.providers.values()]
  }

  /** Nur, was auch wirklich arbeiten kann (Zugangsdaten hinterlegt). */
  available(): TrackerProvider[] {
    return this.all().filter((p) => p.configured)
  }

  /**
   * Ein Anbieter für einen Routen-Parameter. Gibt `null` auch für einen
   * bekannten, aber UNkonfigurierten zurück: Wer nicht arbeiten kann, darf
   * keine Route beantworten — sonst führte „Verbinden" auf eine Fehlerseite
   * des Anbieters statt auf eine verständliche Meldung bei uns.
   */
  get(id: string): TrackerProvider | null {
    const p = this.providers.get(id as TrackerProviderId)
    return p?.configured ? p : null
  }
}
