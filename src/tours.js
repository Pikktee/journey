// Tour-Registry: jede Tour besteht aus Segmenten mit Fortbewegungsmodus
// (walk / tram / ferry / bike), Foto-Ankern und Text-Metadaten.
// Segment-Nahtpunkte teilen sich exakt dieselbe Koordinate.

export const TOURS = {
  oberland: {
    no: 'N°01',
    brandTitle: 'Berner Oberland',
    kicker: 'Eine Reise durch das',
    titleHtml: 'Berner<br />Oberland',
    stops: ['Lauterbrunnen', 'Zweilütschinen', 'Lütschental', 'Grindelwald'],
    finaleTitle: 'Grindelwald',
    // Pseudo-Timestamps: Streckenanteil ↦ linear interpolierte Uhrzeit.
    // Mittsommer — Aufbruch in der Morgendämmerung, Ankunft zur goldenen Stunde
    time: { start: '2025-06-21T06:15:00+02:00', end: '2025-06-21T20:45:00+02:00', zone: 'Europe/Zurich' },
    geoid: 48, // m: Geoid über WGS84-Ellipsoid in der Region (für den Google-3D-Testmodus)
    segments: [
      {
        mode: 'bike',
        label: 'Rad',
        // Reale Radroute auf dem OSM-Strassennetz (BRouter, Trekking-Profil): das
        // Lauterbrunnental hinaus nach Zweilütschinen und über das Lütschental nach
        // Grindelwald — die EINZIGE mit dem Rad fahrbare Verbindung. Wengen/Kleine
        // Scheidegg sind autofrei bzw. nur per Zahnradbahn erreichbar und daher raus.
        // 17 km, ~440 Hm: sanft talwärts, dann stetiger Anstieg. Höhen aus BRouter-DEM
        // (elevation.js überschreibt sie ohnehin mit Terrarium-Werten).
        pts: [
          [7.9086, 46.5934, 789], // Lauterbrunnen
          [7.9075, 46.5929, 803],
          [7.9065, 46.6033, 763],
          [7.9052, 46.6072, 736],
          [7.9028, 46.6089, 734],
          [7.9014, 46.6152, 721],
          [7.9038, 46.6245, 672],
          [7.9007, 46.6304, 655],
          [7.9052, 46.6317, 655], // Zweilütschinen
          [7.9064, 46.6338, 655],
          [7.9127, 46.6318, 659],
          [7.9203, 46.6358, 707],
          [7.9282, 46.6367, 703],
          [7.9312, 46.6377, 702],
          [7.9395, 46.6374, 702],
          [7.9521, 46.6386, 732],
          [7.9582, 46.6378, 778],
          [7.9655, 46.6384, 843], // Lütschental
          [7.9697, 46.6369, 873],
          [7.9753, 46.6363, 906],
          [7.9750, 46.6351, 897],
          [7.9782, 46.6343, 896],
          [7.9901, 46.6352, 907],
          [7.9959, 46.6340, 909], // Burglauenen
          [8.0069, 46.6274, 935],
          [8.0067, 46.6262, 941],
          [8.0127, 46.6218, 959],
          [8.0172, 46.6211, 959],
          [8.0191, 46.6221, 946],
          [8.0221, 46.6221, 941],
          [8.0228, 46.6230, 942],
          [8.0254, 46.6213, 945],
          [8.0305, 46.6216, 979],
          [8.0306, 46.6226, 995],
          [8.0341, 46.6244, 1034], // Grindelwald
        ],
      },
    ],
    // Foto-Anker liegen exakt auf der Route; Pseudo-Zeit + echtes Wetter (Open-Meteo,
    // 2025-06-21) ergeben den Tagesbogen: klarer Morgen → Nachmittagsschauer im
    // Lütschental → aufklarende goldene Stunde in Grindelwald.
    photos: [
      {
        src: '/photos/oberland/01-lauterbrunnen.jpg',
        title: 'Staubbachfall',
        caption: 'Erstes Licht im Tal — 300 Meter freier Fall, die Wände noch im Schatten.',
        anchor: [7.90747, 46.59475], // ~06:35, klar
      },
      {
        src: '/photos/oberland/02-weisse-luetschine.jpg',
        title: 'Weisse Lütschine',
        caption: 'Talauswärts am Gletscherfluss — die Sonne steht endlich über den Felswänden.',
        anchor: [7.90186, 46.61265], // ~08:24, sonnig
      },
      {
        src: '/photos/oberland/03-zweiluetschinen.jpg',
        title: 'Zweilütschinen',
        caption: 'Wo Weisse und Schwarze Lütschine sich treffen — ab hier geht es bergan.',
        anchor: [7.90495, 46.63167], // ~10:31, klar
      },
      {
        src: '/photos/oberland/04-luetschental.jpg',
        title: 'Lütschental',
        caption: 'Der Nachmittag zieht zu — erste Tropfen auf der Strasse, Quellwolken über den Graten.',
        anchor: [7.96338, 46.63829], // ~14:47, leichter Schauer
      },
      {
        src: '/photos/oberland/05-eiger-anfahrt.jpg',
        title: 'Vor Grindelwald',
        caption: 'Die Wolken reissen auf, die Eigernordwand tritt hervor — der lange Anstieg lohnt sich.',
        anchor: [8.01033, 46.62404], // ~18:43, halb bewölkt, aufklarend
      },
      {
        src: '/photos/oberland/06-grindelwald.jpg',
        title: 'Grindelwald',
        caption: 'Goldene Stunde am Ziel — Wetterhorn und Eiger glühen über dem Dorf.',
        anchor: [8.02894, 46.62154], // ~20:14, klar
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
        // erster Foto-Stopp jetzt am Kungsträdgården — bewusst so spät, dass der
        // Intro-Anflug abgeschlossen ist, bevor der erste Stopp auslöst
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

  kohphangan: {
    no: 'N°03',
    brandTitle: 'Koh Pha-ngan',
    kicker: 'Von Mittag bis Mitternacht auf',
    titleHtml: 'Koh<br />Pha-ngan',
    stops: ['Thong Sala', 'Baan Tai', 'Phaeng', 'Thong Nai Pan', 'Haad Rin'],
    finaleTitle: 'Haad Rin',
    // Vollmond-Tag 2025-05-12 (laut Open-Meteo real verregnet). Nachmittag: schwül,
    // Regen, Gewitter über dem Inselinneren (kuratiert via `weather`), abends aufklarend.
    time: { start: '2025-05-12T14:00:00+07:00', end: '2025-05-13T00:00:00+07:00', zone: 'Asia/Bangkok' },
    geoid: -31,
    // km-Marken an die 40-km-Route angepasst: Regen baut sich an der Südküste auf,
    // das Gewitter liegt über der Jeep-Bergüberquerung (Kamm bei ~20 km), reißt zur
    // Ankunft in Thong Nai Pan auf und ist auf dem nächtlichen Boot-Leg vorbei.
    weather: [
      { km: 0, mode: 'clouds', k: 0.55 },
      { km: 2.5, mode: 'rain', k: 0.5 },
      { km: 6, mode: 'rain', k: 0.72 },
      { km: 13, mode: 'rain', k: 0.85 },
      { km: 17.5, mode: 'storm', k: 0.95 },
      { km: 21.5, mode: 'rain', k: 0.55 },
      { km: 24, mode: 'clouds', k: 0.4 },
      { km: 28, mode: 'off', k: 0.3 },
    ],
    segments: [
      { mode: 'walk', label: 'Zu Fuß',  // Ankunft in Thong Sala, Bummel durch den Ort
        pts: [
          [99.9856, 9.7133, 6],
          [99.9865, 9.7129, 6],
          [99.9868, 9.71252, 6],
        ] },
      { mode: 'moped', label: 'Moped',  // Südküste (Baan Tai) und hoch zum Phaeng-Wasserfall (OSRM)
        pts: [
          [99.9868, 9.71252, 10],
          [99.98533, 9.71167, 10],
          [99.9861, 9.71045, 10],
          [99.98689, 9.70959, 10],
          [99.98815, 9.70918, 10],
          [99.9899, 9.70912, 10],
          [99.99129, 9.70914, 10],
          [99.99268, 9.7089, 10],
          [99.99451, 9.70844, 10],
          [99.99559, 9.70822, 10],
          [99.997, 9.70854, 10],
          [99.99811, 9.70862, 10],
          [99.99931, 9.70866, 10],
          [100.00041, 9.7087, 10],
          [100.00183, 9.70879, 10],
          [100.00346, 9.70875, 10],
          [100.0046, 9.70852, 10],
          [100.00569, 9.70782, 10],
          [100.00679, 9.70728, 10],
          [100.00809, 9.7066, 10],
          [100.00968, 9.70772, 10],
          [100.00983, 9.70921, 10],
          [100.00995, 9.71035, 10],
          [100.01038, 9.7119, 10],
          [100.00969, 9.71374, 10],
          [100.00926, 9.71488, 10],
          [100.01003, 9.71602, 10],
          [100.00858, 9.71704, 10],
          [100.00748, 9.7174, 10],
          [100.00773, 9.71861, 10],
          [100.0075, 9.72062, 10],
          [100.0068, 9.72169, 10],
          [100.00648, 9.72341, 10],
          [100.00904, 9.72455, 10],
          [100.00926, 9.72576, 10],
          [100.00883, 9.72693, 10],
          [100.00882, 9.72826, 10],
          [100.00879, 9.72945, 10],
          [100.01024, 9.72943, 10],
          [100.01137, 9.72957, 10],
          [100.01176, 9.73096, 10],
          [100.01249, 9.73217, 10],
          [100.01212, 9.73321, 10],
          [100.01322, 9.73333, 10],
          [100.01373, 9.73349, 10],
        ] },
      { mode: 'jeep', label: 'Jeep 4×4',
        // Echte Bergstraße (OSRM driving): vom Phaeng-Sporn zurück auf die Talstraße,
        // dann über die berüchtigte Beton-Steilrampe (surface=concrete:plates in OSM)
        // den Kamm hinauf (Pass ~290 m) und die Serpentinen hinab nach Thong Nai Pan.
        // 17,6 km — der straßenlose Inselkern lässt keinen direkten Schnitt zu, daher
        // der Zubringer-Bogen nach Süden. Höhen grob modelliert (elevation.js überschreibt).
        pts: [
          [100.01373, 9.73349, 60],
          [100.01217, 9.7334, 55],
          [100.01181, 9.73261, 52],
          [100.01265, 9.73264, 49],
          [100.01217, 9.73137, 45],
          [100.01169, 9.73119, 43],
          [100.01137, 9.72957, 38],
          [100.00879, 9.72945, 30],
          [100.00871, 9.72867, 30],
          [100.00903, 9.72715, 31],
          [100.01044, 9.72694, 32],
          [100.01052, 9.72754, 32],
          [100.01152, 9.72756, 32],
          [100.01278, 9.72654, 33],
          [100.01267, 9.72471, 34],
          [100.01401, 9.72504, 34],
          [100.01451, 9.72476, 34],
          [100.01384, 9.72403, 35],
          [100.01441, 9.72198, 36],
          [100.01388, 9.72176, 36],
          [100.01369, 9.7199, 37],
          [100.01284, 9.7197, 37],
          [100.01378, 9.71646, 38],
          [100.01558, 9.71667, 39],
          [100.01627, 9.71611, 40],
          [100.01639, 9.71474, 40],
          [100.01725, 9.71284, 41],
          [100.01826, 9.71245, 41],
          [100.01879, 9.71345, 42],
          [100.01873, 9.71707, 43],
          [100.02124, 9.71687, 44],
          [100.02374, 9.71746, 48],
          [100.02411, 9.71672, 50],
          [100.02643, 9.71562, 57],
          [100.02735, 9.71617, 60],
          [100.02876, 9.7193, 69],
          [100.02963, 9.71924, 72],
          [100.02982, 9.71981, 73],
          [100.03148, 9.71939, 78],
          [100.03242, 9.71856, 81],
          [100.03293, 9.71872, 83],
          [100.03268, 9.71751, 86],
          [100.03397, 9.7174, 90],
          [100.03439, 9.7188, 94],
          [100.03649, 9.71971, 100],
          [100.03605, 9.72069, 103],
          [100.03753, 9.72145, 108],
          [100.03789, 9.72241, 110],
          [100.03762, 9.72316, 113],
          [100.03882, 9.72394, 116],
          [100.03905, 9.72505, 120],
          [100.04025, 9.72676, 125],
          [100.03901, 9.72841, 131],
          [100.03911, 9.72898, 133],
          [100.04075, 9.73002, 138],
          [100.04241, 9.72999, 142],
          [100.04403, 9.72949, 147],
          [100.04552, 9.72765, 156],
          [100.0466, 9.72785, 161],
          [100.04658, 9.73097, 176],
          [100.04565, 9.7331, 188],
          [100.04658, 9.73458, 196],
          [100.04666, 9.73942, 219],
          [100.04816, 9.74209, 234],
          [100.04938, 9.74303, 242],
          [100.0511, 9.74587, 258],
          [100.05098, 9.74993, 277],
          [100.05048, 9.75074, 282],
          [100.04908, 9.75158, 290],
          [100.04892, 9.75326, 278],
          [100.04706, 9.75457, 262],
          [100.04606, 9.75706, 242],
          [100.04443, 9.75729, 230],
          [100.04396, 9.75835, 221],
          [100.04388, 9.75976, 211],
          [100.04491, 9.76238, 190],
          [100.04483, 9.76412, 177],
          [100.04368, 9.76745, 151],
          [100.04365, 9.7695, 136],
          [100.04415, 9.77099, 125],
          [100.04486, 9.77152, 118],
          [100.04507, 9.77262, 110],
          [100.04619, 9.77352, 100],
          [100.04767, 9.77208, 86],
          [100.04852, 9.77232, 80],
          [100.04923, 9.77173, 74],
          [100.05066, 9.77166, 64],
          [100.05561, 9.7694, 28],
          [100.05748, 9.76908, 15],
          [100.0582, 9.7702, 6],
        ] },
      { mode: 'walk', label: 'Zu Fuß',  // Strandweg zum Longtail-Steg
        pts: [
          [100.0582, 9.7702, 4],
          [100.06, 9.7699, 4],
        ] },
      { mode: 'ferry', label: 'Longtail-Boot',  // Longtail die Ostküste hinab, östlich an Haad Rin Nok
        pts: [
          [100.06, 9.7699, 0],
          [100.0605, 9.7725, 0],
          [100.063, 9.7752, 0],
          [100.07, 9.7752, 0],
          [100.0785, 9.7715, 0],
          [100.0825, 9.7655, 0],
          [100.07929, 9.76, 0],
          [100.08142, 9.753, 0],
          [100.08383, 9.746, 0],
          [100.08511, 9.739, 0],
          [100.08461, 9.732, 0],
          [100.08409, 9.725, 0],
          [100.08361, 9.718, 0],
          [100.08345, 9.711, 0],
          [100.08482, 9.704, 0],
          [100.08412, 9.697, 0],
          [100.08276, 9.69, 0],
          [100.08289, 9.683, 0],
          [100.0715, 9.6772, 0],
          [100.07, 9.6768, 0],
          [100.0688, 9.67667, 0],
        ] },
      { mode: 'walk', label: 'Zu Fuß',  // an Land am Sunrise Beach zur Full Moon Party
        pts: [
          [100.0688, 9.67667, 3],
          [100.0682, 9.67655, 3],
          [100.0678, 9.67635, 3],
        ] },
    ],
    photos: [
      {
        src: '/photos/kohphangan/01-thong-sala.jpg',
        title: 'Thong Sala',
        caption: 'Ankunft in Thong Sala — schwüle Luft, über dem Golf türmen sich dunkle Wolken, das Gewitter kündigt sich an.',
        anchor: [99.9872, 9.7112], // ~14:10 · land
      },
      {
        src: '/photos/kohphangan/02-baan-tai.jpg',
        title: 'Haad Baan Tai',
        caption: 'Südküste bei Baan Tai — grauer Himmel, die ersten Tropfen fallen, Blick über die Palmen aufs Meer.',
        anchor: [100.009, 9.7037], // ~15:04 · coast
      },
      {
        src: '/photos/kohphangan/03-phaeng.jpg',
        title: 'Nam Tok Phaeng',
        caption: 'Phaeng-Wasserfall im Inselinneren — Regenguss im Dschungel, der Fall führt braunes Hochwasser.',
        anchor: [100.014, 9.7339], // interior
      },
      {
        src: '/photos/kohphangan/04-dschungelpiste.jpg',
        title: 'Dschungelpiste',
        caption: 'Die Betonrampe hinauf in den Inselkern — der Jeep wühlt sich durch rotbraune Pfützen, Regen trommelt auf triefendes Blätterdach.',
        anchor: [100.03753, 9.72145], // interior · unterer Anstieg
      },
      {
        src: '/photos/kohphangan/05-bergpiste.jpg',
        title: 'Bergkamm',
        caption: 'Über den Kamm im Gewitter — Blitze zucken über dem Dschungel, die Steilrampe wird zum Bach, Regen peitscht durchs Scheinwerferlicht.',
        anchor: [100.05098, 9.74993], // interior · Pass
      },
      {
        src: '/photos/kohphangan/06-thong-nai-pan.jpg',
        title: 'Thong Nai Pan',
        caption: 'Das Gewitter ist durchgezogen — über der Doppelbucht reißen die Wolken auf, der volle Mond steigt übers Meer und legt einen Silberpfad auf den nassen Sand.',
        anchor: [100.0582, 9.7702], // land · Einbruch der Nacht
      },
      {
        src: '/photos/kohphangan/07-ostkueste.jpg',
        title: 'Wilde Ostküste',
        caption: 'Die einsame Ostküste hinab — der Longtail tuckert unter dem Vollmond an schwarzen Dschungelbergen und verborgenen Buchten (Than Sadet) vorbei, Mondlicht zittert auf dem Wasser.',
        anchor: [100.07947, 9.75823], // water · ~21:24, füllt die lange Boot-Lücke
      },
      {
        src: '/photos/kohphangan/08-longtail.jpg',
        title: 'Auf dem Golf',
        caption: 'Longtail auf dem Golf — der Regen ist vorbei, zwischen den Wolken bricht der Vollmond durch und legt Silber aufs Wasser.',
        anchor: [100.0845, 9.718], // water
      },
      {
        src: '/photos/kohphangan/09-vor-haad-rin.jpg',
        title: 'Vor Haad Rin',
        caption: 'Klare Nacht vor der Ostküste — der volle Mond steht hoch, vorn tauchen die Lichter von Haad Rin auf.',
        anchor: [100.08, 9.686], // water
      },
      {
        src: '/photos/kohphangan/10-haad-rin.jpg',
        title: 'Haad Rin',
        caption: 'Mitternacht am Sunrise Beach — Feuertänzer, Bass und Neon, der Vollmond überm Meer: die Full Moon Party.',
        anchor: [100.0679, 9.67635], // land
      },
    ],
  },
}
