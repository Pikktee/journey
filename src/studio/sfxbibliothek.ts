// Kuratierte Soundeffekt-Bibliothek: ein fester Satz Effekte, den wir EINMAL
// über ElevenLabs erzeugen (scripts/gen-sfx-library.mjs) und statisch unter
// public/audio/sfx/ ausliefern. Anders als hochgeladene Tour-Audios sind diese
// GLOBAL — jede Tour kann sie auswählen, ohne eine Datei mitzubringen.
//
// Diese Datei ist die Autorität für Anzeige und Dateinamen; die Prompts zum
// Erzeugen liegen im Skript. Ein Drift-Wächter (test/studio-baukasten.test.ts)
// hält die Dateinamen-Menge beider Seiten synchron.

/** Wie ein Effekt abgespielt wird — deckt sich mit AudioEintrag.typ. */
export type SfxTyp = 'musik' | 'sfx'

export interface SfxEffekt {
  /** Dateiname unter public/audio/sfx/ — zugleich die Overlay-Referenz (audio.datei). */
  datei: string
  /** Anzeigename im Studio-Katalog. */
  name: string
  /**
   * 'umgebung' = Dauer-Atmosphäre (Loop über eine Spanne, typ 'musik'),
   * 'effekt' = punktueller One-Shot (typ 'sfx').
   */
  kategorie: 'umgebung' | 'effekt'
  typ: SfxTyp
  /** Ein Satz zum Charakter — Tooltip im Studio. */
  beschreibung: string
}

// Umgebungs-Atmosphären: nahtlose Loops, laufen über einen Streckenbereich.
const UMGEBUNG: SfxEffekt[] = [
  { datei: 'amb-hafen.mp3', name: 'Hafen', kategorie: 'umgebung', typ: 'musik', beschreibung: 'Möwen, Wellen an der Kaimauer, ferne Boote' },
  { datei: 'amb-wald.mp3', name: 'Wald', kategorie: 'umgebung', typ: 'musik', beschreibung: 'Vogelgezwitscher und Blätterrauschen' },
  { datei: 'amb-stadt.mp3', name: 'Stadt', kategorie: 'umgebung', typ: 'musik', beschreibung: 'Belebte Straße: ferner Verkehr, Schritte, Stimmen' },
  { datei: 'amb-markt.mp3', name: 'Markt', kategorie: 'umgebung', typ: 'musik', beschreibung: 'Stimmengewirr, Rufe, geschäftiges Treiben' },
  { datei: 'amb-brandung.mp3', name: 'Strand', kategorie: 'umgebung', typ: 'musik', beschreibung: 'Sanfte Meeresbrandung, auslaufende Wellen' },
  { datei: 'amb-grillen.mp3', name: 'Tropennacht', kategorie: 'umgebung', typ: 'musik', beschreibung: 'Grillen und Zikaden in warmer Nacht' },
  { datei: 'amb-bach.mp3', name: 'Bach', kategorie: 'umgebung', typ: 'musik', beschreibung: 'Plätscherndes Wasser über Steine' },
  { datei: 'amb-bergwind.mp3', name: 'Bergwind', kategorie: 'umgebung', typ: 'musik', beschreibung: 'Sanfter Wind in der Höhe, ferne Kuhglocken' },
  { datei: 'amb-fahrtwind.mp3', name: 'Fahrtwind', kategorie: 'umgebung', typ: 'musik', beschreibung: 'Luftrauschen der schnellen Vorwärtsfahrt' },
  { datei: 'amb-seewind.mp3', name: 'Seewind', kategorie: 'umgebung', typ: 'musik', beschreibung: 'Frischer Wind über offenem Wasser' },
]

// Punktuelle Effekte: feuern einmal beim Überfahren ihrer Marke.
const EFFEKT: SfxEffekt[] = [
  { datei: 'sfx-tempelglocke.mp3', name: 'Tempelglocke', kategorie: 'effekt', typ: 'sfx', beschreibung: 'Einzelner Schlag einer asiatischen Tempelglocke' },
  { datei: 'sfx-kirchenglocke.mp3', name: 'Kirchenglocke', kategorie: 'effekt', typ: 'sfx', beschreibung: 'Läuten einer Kirchenglocke' },
  { datei: 'sfx-moewe.mp3', name: 'Möwe', kategorie: 'effekt', typ: 'sfx', beschreibung: 'Einzelner Möwenschrei' },
  { datei: 'sfx-schiffshorn.mp3', name: 'Schiffshorn', kategorie: 'effekt', typ: 'sfx', beschreibung: 'Tiefes Horn eines auslaufenden Schiffs' },
  { datei: 'sfx-hupe.mp3', name: 'Hupe', kategorie: 'effekt', typ: 'sfx', beschreibung: 'Kurze Autohupe' },
  { datei: 'sfx-hund.mp3', name: 'Hund', kategorie: 'effekt', typ: 'sfx', beschreibung: 'Bellender Hund' },
  { datei: 'sfx-applaus.mp3', name: 'Applaus', kategorie: 'effekt', typ: 'sfx', beschreibung: 'Kurzer Jubel und Applaus' },
  { datei: 'sfx-kamera.mp3', name: 'Kamera', kategorie: 'effekt', typ: 'sfx', beschreibung: 'Auslöser einer Spiegelreflexkamera' },
]

export const SFX_BIBLIOTHEK: readonly SfxEffekt[] = [...UMGEBUNG, ...EFFEKT]

/** Menge der Bibliotheks-Dateinamen — für die Validierung (Server/Player-Referenz). */
export const SFX_DATEIEN: ReadonlySet<string> = new Set(SFX_BIBLIOTHEK.map((e) => e.datei))

/** Katalog-Eintrag zu einem Dateinamen (für Anzeige eines gesetzten Bibliothekseffekts). */
export function sfxEffekt(datei: string): SfxEffekt | undefined {
  return SFX_BIBLIOTHEK.find((e) => e.datei === datei)
}
