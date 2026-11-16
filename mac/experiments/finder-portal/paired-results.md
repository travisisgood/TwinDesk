# Paired Finder acceptance, November 15 2026

Mac source: `c8f2bff2d8bfa7d00b0e751b942a17d0d0afa7b7`.
Windows receiver: `125ce778404d21192a26a4ca52833bc911c4322b`.
Wire v1, including agreed amendments in `coordination-relay` `ce24665`.
No TwinDesk rebuild or integration; no shared/wire files changed by Mac.

The actual Mac and Windows endpoints connected over pinned TLS. Pairing material
was encrypted to Windows' ephemeral RSA public key; no plaintext token or private
key entered chat, logs, or repository. The source captured only its dedicated
Finder window and sent the installed Finder bundle ID/icon catalog data.

| Check | Evidence | Result |
| --- | --- | --- |
| Changing Finder content | Windows saved first-frame baseline, notified Mac, then Mac created NETWORKPAIREDPROOF; Windows visually confirmed its later appearance | Pass, paired |
| Name sorting | Mac logged seq 1 dispatched; Windows observed arrow up → down | Pass, paired |
| Open Search | Mac logged seq 2 dispatched; Windows saw expanded search field | Pass, paired |
| Text + Return | seq 7 setSearchText and seq 8 confirmSearch dispatched; Windows saw exact query and two matching test results | Pass, paired |
| Receiver minimize/restore | Windows observed local minimize/restore while stream remained live | Pass, Windows report |
| Receiver close returns source | Windows used local close shortcut; Mac independently measured original physical frame and not minimized | Pass, paired |
| Backing lifetime | Mac enumerated the same backing display after receiver close, then explicitly ended backing session | Pass, Mac measurement |
| Physical layout | Backing (-1280,0), 1280×900; physical helper map only (0,0), 1440×900; original physical display unchanged | Pass, Mac measurement |
| Actual Finder taskbar icon rendering | Icon transmitted and set by Windows, but taskbar appearance not visually inspected | Pending |

Mac source window: 800×550 points at (-1240,60) while transferred. Stream:
1600×1100 pixels with matching content rectangle. Return: (100,100), 800×550,
not minimized. Window dimensions and encoded image dimensions are separate.
The receiver's destination screen geometry was not independently measured by Mac;
this is not acceptance of automatic adjacent-edge layout mapping.

Four later pressAt calls were unsupported because the Search field was already
open and its text field has no AXPress action. Those failures were recorded, not
counted as successful clicks. Existing setSearchText/confirmSearch nevertheless
worked. A separate source-field-focus improvement follows this tested checkpoint.

Windows' screenshots and native UI observations are its report, not locally
re-executed Mac tests. Mac independently inspected source accessibility state,
marker creation timing, input/ACK logs, final Finder frame, and display topology.
`paired-results.json` preserves the sanitized evidence and source references.

Still outstanding: Windows source → Mac receiver, actual taskbar/Dock logo
appearance, automatic normal title-bar edge crossing and dragging back, general
keyboard/wheel/drag input, arbitrary app/child windows and owned popups. Scarlett
and REAPER were not tested; their audio/settings were not changed. This proves
paired Finder streaming and the listed semantic controls, not completed seamless
window transfer for all applications.
