// Tour-Registry: jede Tour besteht aus Segmenten mit Fortbewegungsmodus
// (walk / tram / ferry / bike), Foto-Ankern und Text-Metadaten.
// Segment-Nahtpunkte teilen sich exakt dieselbe Koordinate.

export const TOURS = {
  oberland: {
    no: 'N°01',
    brandTitle: 'Berner Oberland',
    kicker: 'Eine Reise durch das',
    titleHtml: 'Berner<br />Oberland',
    stops: ['Lauterbrunnen', 'Wengen', 'Kleine Scheidegg', 'Grindelwald'],
    finaleTitle: 'Grindelwald',
    // Pseudo-Timestamps: Streckenanteil ↦ linear interpolierte Uhrzeit.
    // Mittsommer — Aufbruch in der Morgendämmerung, Ankunft zur goldenen Stunde
    time: { start: '2025-06-21T06:15:00+02:00', end: '2025-06-21T20:45:00+02:00', zone: 'Europe/Zurich' },
    geoid: 48, // m: Geoid über WGS84-Ellipsoid in der Region (für den Google-3D-Testmodus)
    segments: [
      {
        mode: 'bike',
        label: 'Rad',
        pts: [
          [7.9086, 46.5934, 800], // Lauterbrunnen
          [7.9105, 46.59, 830],
          [7.9142, 46.5872, 905],
          [7.9184, 46.5891, 1005],
          [7.9205, 46.5942, 1115],
          [7.9218, 46.5995, 1215],
          [7.9222, 46.605, 1274], // Wengen
          // Abschnitt Wengen → Kleine Scheidegg: per DEM-Sampling auf die
          // reale Geländeterrasse gelegt (ein GPX-Import ersetzt das)
          [7.9245, 46.595, 1310],
          [7.924, 46.591, 1363],
          [7.9265, 46.5885, 1455],
          [7.93, 46.586, 1560],
          [7.934, 46.5838, 1700],
          [7.938, 46.5812, 1890], // Wengernalp
          [7.942, 46.58, 2065],
          [7.9465, 46.5798, 2095],
          [7.951, 46.58, 2090],
          [7.9555, 46.5808, 2055],
          [7.9585, 46.5825, 2010],
          [7.9611, 46.5852, 2061], // Kleine Scheidegg
          [7.97, 46.5878, 2005],
          [7.979, 46.5928, 1895],
          [7.986, 46.5975, 1745],
          [7.993, 46.6022, 1616], // Alpiglen
          [8.001, 46.608, 1455],
          [8.006, 46.6125, 1330], // Brandegg
          [8.015, 46.617, 1180],
          [8.0245, 46.621, 1000],
          [8.0341, 46.6244, 1034], // Grindelwald
        ],
      },
    ],
    photos: [
      {
        src: '/photos/01-lauterbrunnen.jpg',
        title: 'Staubbachfall',
        caption: 'Morgennebel über dem Talboden — 300 Meter freier Fall.',
        anchor: [7.9105, 46.59],
      },
      {
        src: '/photos/02-wengen.jpg',
        title: 'Wengen',
        caption: 'Autofrei seit jeher — Geranien, Chalets, und tief unten das Tal.',
        anchor: [7.9222, 46.605],
      },
      {
        src: '/photos/wengernalp.jpg',
        title: 'Wengernalp',
        caption: 'Hochweide unter der Jungfrau — nur Kuhglocken und Zahnradbahn.',
        anchor: [7.938, 46.5812],
      },
      {
        src: '/photos/03-kleine-scheidegg.jpg',
        title: 'Kleine Scheidegg',
        caption: 'Unter der Eigernordwand — der höchste Punkt der Tour.',
        anchor: [7.9611, 46.5852],
      },
      {
        src: '/photos/alpiglen.jpg',
        title: 'Alpiglen',
        caption: 'Rasante Schotterabfahrt — das Wetterhorn glüht schon voraus.',
        anchor: [8.001, 46.608],
      },
      {
        src: '/photos/04-grindelwald.jpg',
        title: 'Grindelwald',
        caption: 'Goldene Stunde bei der Ankunft — das Wetterhorn im Rücken.',
        anchor: [8.015, 46.617],
      },
    ],
  },

  stockholm: {
    no: 'N°02',
    brandTitle: 'Stockholm & Schären',
    kicker: 'Ein Sommertag in',
    titleHtml: 'Stockholm<br />& Schären',
    stops: ['Gamla Stan', 'Djurgården', 'Fjäderholmarna', 'Vaxholm'],
    finaleTitle: 'Vaxholm',
    // Spätsommertag bis in die Nacht: Sonnenuntergang ~20:10, Finale im Dunkeln
    time: { start: '2025-08-24T09:30:00+02:00', end: '2025-08-24T23:00:00+02:00', zone: 'Europe/Stockholm' },
    geoid: 22, // m: Geoid über WGS84-Ellipsoid in der Region (für den Google-3D-Testmodus)
    // Flacher Schärengarten: DEM auf maxzoom 11 gröbern → keine Terrain-Nahtspikes
    // über dem Wasser (MapLibre-Skirt-Artefakt). Auf der flachen Insellandschaft
    // ist der Auflösungsverlust unsichtbar, die Überhöhung bleibt voll erhalten.
    demMaxzoom: 11,
    // Landwege: reale Straßenrouten (FOSSGIS-OSRM, Fußprofil, OSM-Wegenetz);
    // Tram: echte Gleistrasse aus OSM (railway=tram, via Overpass gestitcht)
    segments: [
      {
        mode: 'walk',
        label: 'Zu Fuß',
        pts: [
          [18.07094, 59.32491, 5], // Stortorget, Gamla Stan
          [18.0713, 59.32499, 5],
          [18.07114, 59.32566, 5], // Köpmangatan
          [18.073, 59.32593, 5],
          [18.07294, 59.32606, 5],
          [18.07307, 59.32617, 5],
          [18.07304, 59.32621, 5],
          [18.0742, 59.32641, 5], // Slottsbacken / Königspalast
          [18.07424, 59.32648, 5],
          [18.0741, 59.3266, 5],
          [18.07418, 59.32662, 5],
          [18.07265, 59.32788, 5], // Skeppsbron → Slottskajen
          [18.07228, 59.32784, 5],
          [18.07117, 59.3275, 5],
          [18.07101, 59.32764, 5],
          [18.07068, 59.32754, 5],
          [18.06981, 59.32824, 5], // Norrbro
          [18.0694, 59.32812, 5],
          [18.0694, 59.32825, 5],
          [18.06933, 59.32825, 5],
          [18.06922, 59.32847, 5],
          [18.06947, 59.32853, 5],
          [18.06946, 59.32857, 5],
          [18.06891, 59.32903, 5], // Gustav Adolfs torg
          [18.06929, 59.32916, 5],
          [18.0693, 59.32928, 5],
          [18.06913, 59.32952, 5],
          [18.06894, 59.32964, 5],
          [18.06947, 59.32984, 5],
          [18.07087, 59.3302, 5], // Kungsträdgården
          [18.07146, 59.33026, 5],
          [18.07066, 59.33161, 5],
          [18.07079, 59.33163, 5],
          [18.07038, 59.33232, 5],
          [18.07056, 59.33231, 5],
          [18.07109, 59.33239, 5],
          [18.07144, 59.3326, 5],
          [18.07137, 59.33267, 5],
          [18.0718, 59.3327, 5],
          [18.07189, 59.33278, 5],
          [18.07231, 59.33286, 5],
          [18.07343, 59.3329, 5],
          [18.07343, 59.33301, 5],
          [18.07438, 59.333, 5], // Nybroplan
          [18.07439, 59.33293, 5], // Tram-Haltestelle
        ],
      },
      {
        mode: 'tram',
        label: 'Tram 7',
        pts: [
          [18.07439, 59.33293, 5], // Nybroplan
          [18.07519, 59.33295, 5],
          [18.0755, 59.33294, 5],
          [18.0758, 59.3329, 5],
          [18.08116, 59.33148, 5], // Strandvägen (diagonale Trasse)
          [18.0816, 59.3314, 5],
          [18.09144, 59.33164, 5], // Kai-Seite
          [18.09218, 59.33173, 5],
          [18.09312, 59.33174, 5],
          [18.09338, 59.33168, 5],
          [18.09352, 59.33157, 5],
          [18.09364, 59.33138, 5], // Djurgårdsbron
          [18.09401, 59.33087, 5],
          [18.09431, 59.33027, 5], // Haltestelle Nordiska museet/Vasamuseet
        ],
      },
      {
        mode: 'walk',
        label: 'Zu Fuß',
        pts: [
          [18.09431, 59.33027, 5],
          [18.09406, 59.33021, 5],
          [18.09335, 59.33026, 5],
          [18.09296, 59.32985, 5], // Galärparken
          [18.09275, 59.32934, 5],
          [18.09243, 59.32894, 5],
          [18.09243, 59.32886, 5],
          [18.09252, 59.32879, 5],
          [18.09222, 59.32865, 5],
          [18.09227, 59.32846, 5],
          [18.09208, 59.32813, 5], // Vasamuseet
          [18.09232, 59.32774, 5],
          [18.09213, 59.32768, 5],
          [18.09216, 59.32753, 5],
          [18.09191, 59.32744, 5],
          [18.0919, 59.32726, 5],
          [18.09454, 59.3267, 5], // Djurgårdsvägen
          [18.09496, 59.32608, 5],
          [18.0955, 59.32584, 5],
          [18.0954, 59.32576, 5],
          [18.09524, 59.32544, 5],
          [18.09527, 59.32532, 5],
          [18.09587, 59.32462, 5],
          [18.09619, 59.32442, 5], // Allmänna gränd / Gröna Lund
          [18.09507, 59.32419, 5],
          [18.09452, 59.32401, 2], // Fähranleger Allmänna gränd
        ],
      },
      {
        mode: 'ferry',
        label: 'Schärenfähre',
        // Echtes Fahrwasser aus OSM (route=ferry: Pendelbåt 80/84, Waxholmsbolaget) —
        // südlich um Beckholmen, an Fjäderholmarna vorbei, durch Lilla Värtan nach Vaxholm
        pts: [
          [18.09452, 59.32401, 0], // Anleger Allmänna gränd
          [18.09379, 59.32299, 0],
          [18.09677, 59.32004, 0], // westlich um Beckholmen
          [18.09943, 59.31895, 0],
          [18.10907, 59.31772, 0], // südlich Djurgården
          [18.14289, 59.31986, 0],
          [18.15501, 59.32021, 0], // Fjäderholmarna querab
          [18.18107, 59.32665, 0],
          [18.2079, 59.33697, 0], // Lilla Värtan
          [18.22748, 59.34523, 0],
          [18.23816, 59.3495, 0],
          [18.26636, 59.35956, 0], // Höggarnsfjärden
          [18.28169, 59.36134, 0],
          [18.28552, 59.36007, 0],
          [18.29391, 59.36284, 0],
          [18.29569, 59.3681, 0],
          [18.30793, 59.37497, 0],
          [18.30868, 59.37586, 0],
          [18.30865, 59.3762, 0],
          [18.31541, 59.37618, 0],
          [18.31848, 59.37513, 0],
          [18.33318, 59.37933, 0],
          [18.3375, 59.38214, 0],
          [18.34345, 59.38417, 0],
          [18.34297, 59.38446, 0],
          [18.34236, 59.38694, 0],
          [18.34201, 59.38706, 0],
          [18.34106, 59.38843, 0],
          [18.34341, 59.39294, 0], // Anfahrt Vaxholm
          [18.35167, 59.39849, 0],
          [18.35417, 59.40184, 0], // Vaxholm Terminal (Söderhamnen)
        ],
      },
      {
        mode: 'walk',
        label: 'Zu Fuß',
        pts: [
          [18.35417, 59.40184, 3], // Vaxholm Terminal
          [18.3534, 59.40194, 5],
          [18.35283, 59.40214, 5],
          [18.35295, 59.40239, 5],
          [18.35285, 59.40246, 5],
          [18.35052, 59.40319, 6], // Hamngatan
          [18.35121, 59.40374, 6], // Rådhustorget-Richtung
          [18.35129, 59.40369, 6],
          [18.35155, 59.40389, 6],
          [18.35212, 59.40374, 6],
          [18.35315, 59.40363, 6],
          [18.35314, 59.40371, 6],
          [18.35362, 59.40391, 6], // Waterfront
          [18.35485, 59.40341, 5],
          [18.35461, 59.4038, 4], // Blick zum Kastell
        ],
      },
    ],
    photos: [
      {
        src: '/photos/stockholm/01-gamla-stan.jpg',
        title: 'Stortorget',
        caption: 'Gamla Stans bunte Giebel — der älteste Platz der Stadt.',
        // bewusst erst am Slottsbacken verankert: so ist der Intro-Anflug
        // abgeschlossen, bevor der erste Foto-Stopp auslöst
        anchor: [18.0742, 59.32641],
      },
      {
        // zweites Foto am selben Halt (gleicher Anker) → gemeinsamer Foto-Stopp
        src: '/photos/stockholm/prastgatan.jpg',
        title: 'Prästgatan',
        caption: 'Eine Gasse weiter: schiefe Fassaden in Ocker und Falunrot.',
        anchor: [18.0742, 59.32641],
      },
      {
        src: '/photos/stockholm/kungstradgarden.jpg',
        title: 'Kungsträdgården',
        caption: 'Stockholms grünes Wohnzimmer — Linden, Fontäne, Sommerpause.',
        anchor: [18.07087, 59.3302],
      },
      {
        src: '/photos/stockholm/strandvagen.jpg',
        title: 'Strandvägen',
        caption: 'Aus der Tram 7: Prachtfassaden links, Segler am Kai rechts.',
        anchor: [18.086, 59.3315],
      },
      {
        src: '/photos/stockholm/02-vasa.jpg',
        title: 'Vasamuseet',
        caption: 'Ein Kriegsschiff von 1628 — fast unversehrt aus dem Hafenschlamm geborgen.',
        anchor: [18.0916, 59.3281],
      },
      {
        src: '/photos/stockholm/vasa-heck.jpg',
        title: 'Galionsfiguren',
        caption: 'Vergoldete Löwen und Wappen — das Heck sollte Feinde beeindrucken.',
        anchor: [18.0916, 59.3281],
      },
      {
        src: '/photos/stockholm/grona-lund.jpg',
        title: 'Gröna Lund',
        caption: 'Kurz vor dem Ablegen — Schreie vom Freifallturm, Zuckerwatte in der Luft.',
        anchor: [18.09619, 59.32442],
      },
      {
        src: '/photos/stockholm/saltsjon.jpg',
        title: 'Saltsjön',
        caption: 'Rückblick vom Achterdeck — die Stadt versinkt langsam im Kielwasser.',
        anchor: [18.12801, 59.31892],
      },
      {
        src: '/photos/stockholm/03-schaeren.jpg',
        title: 'Fjäderholmarna',
        caption: 'Achterdeck, Kielwasser, die ersten Schären ziehen vorbei.',
        anchor: [18.154, 59.32018],
      },
      {
        src: '/photos/stockholm/hoggarnsfjarden.jpg',
        title: 'Höggarnsfjärden',
        caption: 'Offenes Wasser, Segler in der Brise, Schären bis zum Horizont.',
        anchor: [18.25202, 59.35444],
      },
      {
        src: '/photos/stockholm/kastell.jpg',
        title: 'Vaxholm Kastell',
        caption: 'Die Festung wächst aus dem Sund — die Überfahrt ist fast geschafft.',
        anchor: [18.34926, 59.39686],
      },
      {
        src: '/photos/stockholm/04-vaxholm.jpg',
        title: 'Vaxholm',
        caption: 'Pastellhäuser am Kai, das Kastell im Sund — Endstation Idylle.',
        anchor: [18.351, 59.40303],
      },
    ],
  },
}
