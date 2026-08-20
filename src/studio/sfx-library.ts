// Kuratierte Musik- und Effektbibliothek: ein fester Satz, den wir EINMAL über
// ElevenLabs erzeugen (scripts/gen-music-library.mjs für die Musik,
// scripts/gen-sfx-library.mjs für Atmosphären und Effekte) und statisch unter
// public/audio/sfx/ ausliefern. Anders als hochgeladene Tour-Audios sind diese
// GLOBAL — jede Tour kann sie auswählen, ohne eine Datei mitzubringen.
// (Eigene Dateien bleiben daneben jederzeit möglich: „Datei hochladen …".)
//
// Diese Datei ist die Autorität für Anzeige und Dateinamen; die Prompts zum
// Erzeugen liegen in den Skripten. Ein Drift-Wächter
// (test/studio-baukasten.test.ts) hält die Dateinamen-Menge beider Seiten
// synchron.

/** Wie ein Effekt abgespielt wird — deckt sich mit AudioEntry.typ. */
export type SfxType = 'music' | 'sfx'

export interface SfxEffect {
  /** Dateiname unter public/audio/sfx/ — zugleich die Overlay-Referenz (audio.file). */
  file: string
  /** Anzeigename im Studio-Katalog. */
  name: string
  /**
   * 'music' = komponiertes Stück (Loop über eine Spanne, typ 'music'),
   * 'ambience' = Dauer-Atmosphäre (ebenfalls Loop, typ 'music'),
   * 'sfx' = punktueller One-Shot (typ 'sfx').
   */
  category: 'music' | 'ambience' | 'sfx'
  type: SfxType
  /** Ein Satz zum Charakter — Tooltip im Studio. */
  description: string
}

// Musik: zehn Stücke für die Stimmungen, die auf einer Reise vorkommen. Sie
// laufen über eine Spanne und schleifen — deshalb typ 'music' wie die
// Atmosphären, aber eine eigene Kategorie: eine Komposition ist etwas anderes
// als der Klang eines Ortes.
const MUSIC: SfxEffect[] = [
  {
    file: 'mus-aufbruch.mp3',
    name: 'Aufbruch',
    category: 'music',
    type: 'music',
    description: 'Hoffnungsvoller Folk zum Losfahren, Gitarre, Shaker, Glockenspiel',
  },
  {
    file: 'mus-fernweh.mp3',
    name: 'Fernweh',
    category: 'music',
    type: 'music',
    description: 'Weit und sehnsüchtig: Klavier über langsamen Streichern',
  },
  {
    file: 'mus-kuestenstrasse.mp3',
    name: 'Küstenstraße',
    category: 'music',
    type: 'music',
    description: 'Sonnige Fahrt am Meer, Surfgitarre, lockeres Schlagzeug',
  },
  {
    file: 'mus-nachtfahrt.mp3',
    name: 'Nachtfahrt',
    category: 'music',
    type: 'music',
    description: 'Pulsierender Synthwave durchs Dunkel',
  },
  {
    file: 'mus-bergpass.mp3',
    name: 'Bergpass',
    category: 'music',
    type: 'music',
    description: 'Weite Streicher und Hörner in dünner Höhenluft',
  },
  {
    file: 'mus-tropen.mp3',
    name: 'Tropen',
    category: 'music',
    type: 'music',
    description: 'Marimba, Nylongitarre, warme Perkussion',
  },
  {
    file: 'mus-stadtpuls.mp3',
    name: 'Stadtpuls',
    category: 'music',
    type: 'music',
    description: 'Trockener Groove, Funkgitarre, tiefer Bass',
  },
  {
    file: 'mus-goldene-stunde.mp3',
    name: 'Goldene Stunde',
    category: 'music',
    type: 'music',
    description: 'Glühende Gitarrenflächen, fast ohne Takt',
  },
  {
    file: 'mus-regentag.mp3',
    name: 'Regentag',
    category: 'music',
    type: 'music',
    description: 'Stilles Klavier, sparsam gesetzt',
  },
  {
    file: 'mus-heimkehr.mp3',
    name: 'Heimkehr',
    category: 'music',
    type: 'music',
    description: 'Ruhig auflösend, Gitarre und Klavier zum Ankommen',
  },
]

// Umgebungs-Atmosphären: nahtlose Loops, laufen über einen Streckenbereich.
const AMBIENCE: SfxEffect[] = [
  {
    file: 'amb-hafen.mp3',
    name: 'Hafen',
    category: 'ambience',
    type: 'music',
    description: 'Möwen, Wellen an der Kaimauer, ferne Boote',
  },
  {
    file: 'amb-wald.mp3',
    name: 'Wald',
    category: 'ambience',
    type: 'music',
    description: 'Vogelgezwitscher und Blätterrauschen',
  },
  {
    file: 'amb-stadt.mp3',
    name: 'Stadt',
    category: 'ambience',
    type: 'music',
    description: 'Belebte Straße: ferner Verkehr, Schritte, Stimmen',
  },
  {
    file: 'amb-markt.mp3',
    name: 'Markt',
    category: 'ambience',
    type: 'music',
    description: 'Stimmengewirr, Rufe, geschäftiges Treiben',
  },
  {
    file: 'amb-brandung.mp3',
    name: 'Strand',
    category: 'ambience',
    type: 'music',
    description: 'Sanfte Meeresbrandung, auslaufende Wellen',
  },
  {
    file: 'amb-grillen.mp3',
    name: 'Tropennacht',
    category: 'ambience',
    type: 'music',
    description: 'Grillen und Zikaden in warmer Nacht',
  },
  {
    file: 'amb-bach.mp3',
    name: 'Bach',
    category: 'ambience',
    type: 'music',
    description: 'Plätscherndes Wasser über Steine',
  },
  {
    file: 'amb-bergwind.mp3',
    name: 'Bergwind',
    category: 'ambience',
    type: 'music',
    description: 'Sanfter Wind in der Höhe, ferne Kuhglocken',
  },
  {
    file: 'amb-fahrtwind.mp3',
    name: 'Fahrtwind',
    category: 'ambience',
    type: 'music',
    description: 'Luftrauschen der schnellen Vorwärtsfahrt',
  },
  {
    file: 'amb-seewind.mp3',
    name: 'Seewind',
    category: 'ambience',
    type: 'music',
    description: 'Frischer Wind über offenem Wasser',
  },
]

// Punktuelle Effekte: feuern einmal beim Überfahren ihrer Marke.
const SFX: SfxEffect[] = [
  {
    file: 'sfx-tempelglocke.mp3',
    name: 'Tempelglocke',
    category: 'sfx',
    type: 'sfx',
    description: 'Einzelner Schlag einer asiatischen Tempelglocke',
  },
  {
    file: 'sfx-kirchenglocke.mp3',
    name: 'Kirchenglocke',
    category: 'sfx',
    type: 'sfx',
    description: 'Läuten einer Kirchenglocke',
  },
  {
    file: 'sfx-moewe.mp3',
    name: 'Möwe',
    category: 'sfx',
    type: 'sfx',
    description: 'Einzelner Möwenschrei',
  },
  {
    file: 'sfx-schiffshorn.mp3',
    name: 'Schiffshorn',
    category: 'sfx',
    type: 'sfx',
    description: 'Tiefes Horn eines auslaufenden Schiffs',
  },
  {
    file: 'sfx-hupe.mp3',
    name: 'Hupe',
    category: 'sfx',
    type: 'sfx',
    description: 'Kurze Autohupe',
  },
  {
    file: 'sfx-hund.mp3',
    name: 'Hund',
    category: 'sfx',
    type: 'sfx',
    description: 'Bellender Hund',
  },
  {
    file: 'sfx-applaus.mp3',
    name: 'Applaus',
    category: 'sfx',
    type: 'sfx',
    description: 'Kurzer Jubel und Applaus',
  },
  {
    file: 'sfx-kamera.mp3',
    name: 'Kamera',
    category: 'sfx',
    type: 'sfx',
    description: 'Auslöser einer Spiegelreflexkamera',
  },
]

export const SFX_LIBRARY: readonly SfxEffect[] = [...MUSIC, ...AMBIENCE, ...SFX]

/** Überschriften der Gruppen im Katalog — Reihenfolge wie in SFX_BIBLIOTHEK. */
export const CATEGORY_NAMES: Record<SfxEffect['category'], string> = {
  music: 'Musik',
  ambience: 'Atmosphäre',
  sfx: 'Effekte',
}

/** Menge der Bibliotheks-Dateinamen — für die Validierung (Server/Player-Referenz). */
export const SFX_FILES: ReadonlySet<string> = new Set(SFX_LIBRARY.map((e) => e.file))

/** Katalog-Eintrag zu einem Dateinamen (für Anzeige eines gesetzten Bibliothekseffekts). */
export function sfxEffect(file: string): SfxEffect | undefined {
  return SFX_LIBRARY.find((e) => e.file === file)
}
