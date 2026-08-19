/*
 * Die Leiste, die ein geöffneter Mockup mitbekommt.
 *
 * Sie wird NICHT in die Mockup-Datei geschrieben — der Dev-Server hängt sie
 * beim Ausliefern an (`vite.config.js`, Plugin `maptale-doku`). Das Original in
 * `docs/mockups/` bleibt unberührt: Es ist eine Vorlage und soll genau das
 * zeigen, was es zeigt, auch wenn man es direkt im Finder öffnet.
 *
 * Alles Sichtbare trägt Inline-Stile und einen eigenen Namensraum. Ein
 * Mockup bringt sein eigenes CSS mit, oft mit weiten Regeln (`button {…}`) —
 * eine Leiste, die sich davon gestalten ließe, sähe in jedem Mockup anders aus.
 */
;(function () {
  'use strict'
  var datei = document.currentScript && document.currentScript.getAttribute('data-datei')
  if (!datei) return
  var api = '/doku/api/'

  var K = {
    leiste:
      'position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:8px;' +
      'padding:8px 10px;border:1px solid rgba(255,255,255,.14);border-radius:999px;' +
      'background:rgba(12,15,20,.82);backdrop-filter:blur(12px);box-shadow:0 14px 34px rgba(2,5,10,.5);' +
      "font:500 13px/1 'Outfit',system-ui,sans-serif;color:#f2ede3",
    knopf:
      'appearance:none;padding:7px 12px;border:1px solid rgba(255,255,255,.14);border-radius:999px;' +
      "background:transparent;color:#a7b1bf;font:500 13px/1 'Outfit',system-ui,sans-serif;cursor:pointer",
    klappe:
      'position:fixed;right:16px;bottom:64px;z-index:2147483000;min-width:210px;padding:6px;' +
      'border:1px solid rgba(255,255,255,.16);border-radius:12px;background:#111722;' +
      'box-shadow:0 14px 34px rgba(2,5,10,.5)',
    eintrag:
      'display:block;width:100%;padding:8px 11px;border:0;border-radius:8px;background:transparent;' +
      "color:#a7b1bf;font:400 14px/1.3 'Outfit',system-ui,sans-serif;text-align:left;cursor:pointer",
    titel:
      "padding:6px 10px 3px;color:#7e8a99;font:600 11px/1 'Outfit',system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase",
  }

  function el(tag, stil, text) {
    var e = document.createElement(tag)
    e.setAttribute('style', stil)
    if (text != null) e.textContent = text
    return e
  }

  /*
   * Nach dem Verschieben liegt DIESE Seite woanders — also geht sie mit.
   *
   * Vorher stand nur „diese Seite ist umgezogen" in der Meldung, und was die
   * Adresse danach neu lud, war der Wächter des Dev-Servers: auf den alten
   * Pfad, den es nicht mehr gibt. Der Dienst nennt den neuen (`docs/…`),
   * unter `/doku/` liegt er gespiegelt.
   */
  function zieheUm(pfad) {
    if (!pfad) return location.reload()
    setTimeout(function () {
      location.replace('/doku/' + String(pfad).replace(/^docs\//, ''))
    }, 700)
  }

  function ruf(aktion, daten) {
    return fetch(api + aktion, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(daten || {}),
    })
      .then(function (a) {
        return a.json()
      })
      .then(function (a) {
        if (!a.ok) throw new Error(a.meldung || 'Fehlgeschlagen')
        return a
      })
  }

  function melde(text, schlimm) {
    var t = el(
      'div',
      'position:fixed;left:50%;bottom:74px;transform:translateX(-50%);z-index:2147483001;' +
        'padding:10px 18px;border-radius:999px;border:1px solid rgba(255,255,255,.16);' +
        'background:#161e2c;color:' +
        (schlimm ? '#e5484d' : '#f2ede3') +
        ";font:400 13px/1 'Outfit',system-ui,sans-serif",
      text,
    )
    document.body.appendChild(t)
    setTimeout(
      function () {
        t.remove()
      },
      schlimm ? 5000 : 2200,
    )
  }

  ruf('stand', { datei: datei })
    .then(function (stand) {
      var leiste = el('div', K.leiste)
      var marke = el(
        'span',
        "color:#7e8a99;font:500 12px/1 'Outfit',system-ui,sans-serif;padding-left:4px",
        'Maptale-Doku',
      )
      var zurueck = el('a', K.knopf, '← Doku')
      zurueck.href = '/doku/mockups.html'
      zurueck.style.textDecoration = 'none'

      // Der Weg zum Konzept. Er gehört in die LEISTE und nicht ins Menü: Ein
      // Mockup ist die Antwort auf eine Frage, die woanders gestellt wird,
      // und wer ihn ansieht, will als Nächstes meist genau dorthin. Bei
      // mehreren Konzepten trägt der Knopf die Zahl und öffnet die Auswahl —
      // eine Reihe von vier Titeln machte aus der Leiste eine Zeile Text.
      var konzepte = stand.konzepte || []
      var konzeptGriff = null
      if (konzepte.length === 1) {
        konzeptGriff = el('a', K.knopf, 'Konzept ↗')
        konzeptGriff.href = '/doku/' + konzepte[0].ziel
        konzeptGriff.title = konzepte[0].titel
        konzeptGriff.style.textDecoration = 'none'
      } else if (konzepte.length > 1) {
        konzeptGriff = el('button', K.knopf, 'Konzepte (' + konzepte.length + ')')
      }

      // KEIN Roadmap-Griff: Auf die Roadmap kommen Konzepte, nicht Mockups.
      // Ein Mockup ist eine Antwort in einem Konzept — geplant wird das
      // Konzept, und das Mockup steht in seinem nächsten Schritt.
      var griff = el('button', K.knopf, '⋯')
      var klappe = el('div', K.klappe)
      klappe.style.display = 'none'

      function eintrag(text, aktion) {
        var e = el('button', K.eintrag, text)
        e.addEventListener('mouseenter', function () {
          e.style.background = '#161e2c'
          e.style.color = '#f2ede3'
        })
        e.addEventListener('mouseleave', function () {
          e.style.background = 'transparent'
          e.style.color = '#a7b1bf'
        })
        e.addEventListener('click', aktion)
        return e
      }

      // Dieselben drei Griffe wie im Menü einer Kachel: WO steht das, WIE
      // öffne ich es, WIE heißt es. Umbenannt wird hier mit einer Eingabe statt
      // mit einer Maske — die Leiste lebt in fremdem HTML, und ein Dialog
      // darin träfe auf dessen CSS.
      klappe.appendChild(el('div', K.titel, 'Datei'))
      klappe.appendChild(
        eintrag('Im Editor öffnen', function () {
          klappe.style.display = 'none'
          ruf('oeffnen', { datei: datei })
            .then(function (a) {
              melde(a.meldung)
            })
            .catch(function (f) {
              melde(f.message, true)
            })
        }),
      )
      klappe.appendChild(
        eintrag('Pfad kopieren', function () {
          klappe.style.display = 'none'
          var pfad = 'docs/' + datei.replace(/^docs\//, '')
          if (navigator.clipboard && navigator.clipboard.writeText)
            navigator.clipboard.writeText(pfad).then(function () {
              melde('Pfad kopiert: ' + pfad)
            })
          else melde(pfad)
        }),
      )
      klappe.appendChild(
        eintrag('Umbenennen …', function () {
          klappe.style.display = 'none'
          var alt = (document.title || '').replace(/^Mockup\s*[—–·|-]\s*/i, '')
          var titel = prompt('Titel des Mockups', alt)
          if (titel == null || !titel.trim()) return
          var name = prompt(
            'Dateiname (ohne .html)',
            datei
              .split('/')
              .pop()
              .replace(/\.html$/, ''),
          )
          if (name == null) return
          ruf('umbenennen', { datei: datei, titel: titel.trim(), name: name.trim() })
            .then(function (a) {
              melde(a.meldung)
              zieheUm(a.pfad)
            })
            .catch(function (f) {
              melde(f.message, true)
            })
        }),
      )
      klappe.appendChild(
        el('hr', 'margin:5px 4px;border:0;border-top:1px solid rgba(255,255,255,.1)'),
      )

      klappe.appendChild(
        eintrag(stand.archiv ? 'Zurück nach Mockups' : 'Archivieren', function () {
          klappe.style.display = 'none'
          var aktion = stand.archiv ? 'zurueckholen' : 'archivieren'
          // Kein Bereich: Ein Mockup kehrt nach `docs/mockups/` zurück, immer.
          ruf(aktion, { datei: datei })
            .then(function (a) {
              melde(a.meldung)
              zieheUm(a.pfad)
            })
            .catch(function (f) {
              melde(f.message, true)
            })
        }),
      )

      // Die Auswahl bei mehreren Konzepten — dieselbe Optik wie das ⋯-Menü,
      // nur mit Links statt Handlungen.
      var konzeptKlappe = null
      if (konzepte.length > 1) {
        konzeptKlappe = el('div', K.klappe)
        konzeptKlappe.style.display = 'none'
        konzeptKlappe.appendChild(el('div', K.titel, 'Gehört zu'))
        konzepte.forEach(function (k) {
          var a = el('a', K.eintrag, k.titel)
          a.href = '/doku/' + k.ziel
          a.style.textDecoration = 'none'
          konzeptKlappe.appendChild(a)
        })
        konzeptGriff.addEventListener('click', function (e) {
          e.stopPropagation()
          klappe.style.display = 'none'
          konzeptKlappe.style.display = konzeptKlappe.style.display === 'none' ? 'block' : 'none'
        })
      }

      griff.addEventListener('click', function (e) {
        e.stopPropagation()
        if (konzeptKlappe) konzeptKlappe.style.display = 'none'
        klappe.style.display = klappe.style.display === 'none' ? 'block' : 'none'
      })
      document.addEventListener('click', function () {
        klappe.style.display = 'none'
        if (konzeptKlappe) konzeptKlappe.style.display = 'none'
      })

      leiste.appendChild(marke)
      leiste.appendChild(griff)
      if (konzeptGriff) leiste.appendChild(konzeptGriff)
      leiste.appendChild(zurueck)
      document.body.appendChild(leiste)
      document.body.appendChild(klappe)
      if (konzeptKlappe) document.body.appendChild(konzeptKlappe)
    })
    .catch(function () {
      /* Ohne Dienst keine Leiste — das Mockup bleibt, wie es ist. */
    })
})()
