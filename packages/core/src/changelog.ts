/**
 * In-app changelog (mirrors CHANGELOG.md, condensed for the UI).
 * Entries are newest-first. Each carries English + Malay highlights so the
 * screen follows the active language like every other view.
 */

export interface ChangelogEntry {
  readonly version: string;
  readonly date: string;
  readonly en: readonly string[];
  readonly ms: readonly string[];
}

export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    version: "1.5.1",
    date: "2026-10-04",
    en: [
      "New Changelog tab: the full release history inside the app.",
      "The X button quits for real by default; hiding to tray is opt-in.",
      "Onboarding themes now preview live as you pick them.",
    ],
    ms: [
      "Tab Log Perubahan baharu: sejarah release penuh di dalam app.",
      "Butang X keluar betul-betul secara lalai; sembunyi ke tray ikut pilihan.",
      "Tema onboarding kini bertukar live semasa anda memilih.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-10-04",
    en: [
      "Single-instance lock, fluxdl:// links and CLI URLs, graceful shutdown.",
      "Auto-generated subtitles on by default; best audio quality pinned.",
      "Multi-link paste and drops route to Batch; Downloads search, filters, quick throttle, queue ETA and bandwidth sparkline.",
      "App + yt-dlp update reminders (toast and Logs); in-app Library preview.",
    ],
    ms: [
      "Kunci single-instance, pautan fluxdl:// dan URL CLI, shutdown kemas.",
      "Sari kata auto-janaan lalai ON; kualiti audio terbaik dipin.",
      "Tampal/lepasan multi-pautan ke Kelompok; carian Muat Turun, penapis, throttle pantas, ETA baris dan sparkline.",
      "Peringatan kemas kini app + yt-dlp (toast dan Log); pratonton Pustaka.",
    ],
  },
  {
    version: "1.4.1",
    date: "2026-10-04",
    en: [
      "Fixed settings never saving in any released build (atomic JSON store).",
      "Library “Download again” confirms and really re-downloads.",
      "Failed saves now surface an error instead of failing silently.",
    ],
    ms: [
      "Baiki tetapan yang tidak pernah tersimpan (storan JSON atomik).",
      "“Muat turun semula” Pustaka meminta pengesahan dan benar-benar memuat turun.",
      "Kegagalan menyimpan kini tunjuk ralat, bukan senyap.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-10-04",
    en: [
      "Live-stream and chapter flags that actually reach yt-dlp.",
      "Audio tag editor, mini always-on-top window, download stats.",
      "Light “Paper” theme with High Contrast support; signing docs.",
    ],
    ms: [
      "Flag siaran langsung dan bab yang benar-benar sampai ke yt-dlp.",
      "Editor tag audio, tetingkap mini sentiasa-di-atas, statistik.",
      "Tema cerah “Paper” dengan sokongan Kontras Tinggi; docs signing.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-10-03",
    en: [
      "Destination recovery, visible retry countdowns, settings search.",
      "Shortcut help dialog, log triage tools, template validation.",
      "Window title counts, toast file actions, accessibility pass.",
    ],
    ms: [
      "Pemulihan destinasi, kira detik cuba-semula, carian tetapan.",
      "Dialog bantuan pintasan, triaj log, pengesahan templat.",
      "Tajuk tetingkap mengira, tindakan fail dalam toast, laluan a11y.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-10-03",
    en: [
      "Command palette, first-run onboarding, faster cancellable analyze.",
      "Thumbnail accents, density toggle, accent picker, smarter playlists.",
      "Bahasa Melayu + English; library health with Missing badges.",
    ],
    ms: [
      "Palet perintah, onboarding mula-pertama, analisis pantas boleh-batal.",
      "Aksen gambar kecil, tukar ketumpatan, pemilih aksen, senarai pintar.",
      "Bahasa Melayu + English; kesihatan pustaka dengan lencana Fail tiada.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-10-03",
    en: [
      "Compatible MP4 + codec-aware presets, batch queueing, duplicate guard.",
      "Actionable errors, taskbar progress, context menus, bulk control.",
      "One-click diagnostics report with secret redaction.",
    ],
    ms: [
      "Pratetap MP4 Serasi + codec, barisan kelompok, pengawal duplikat.",
      "Ralat boleh-tindak, progres taskbar, menu konteks, kawalan pukal.",
      "Laporan diagnostik satu klik dengan redaksi rahsia.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-02",
    en: [
      "Initial Windows release: yt-dlp GUI with queue, themes and tray.",
      "Persisted settings, queue and history; NSIS + portable builds.",
    ],
    ms: [
      "Release Windows pertama: GUI yt-dlp dengan baris, tema dan tray.",
      "Tetapan, baris dan sejarah kekal; binaan NSIS + portable.",
    ],
  },
];
