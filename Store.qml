pragma Singleton
import QtQuick
import QtQml.WorkerScript
import Quickshell
import Quickshell.Io
import "js/FmhySource.mjs" as Source
import "js/Resources.mjs" as Resources
import "js/Storage.mjs" as Storage
import "js/Safety.mjs" as Safety
import "js/UrlSafety.mjs" as UrlSafety

Item {
  id: root
  readonly property string cacheHome: Quickshell.env("XDG_CACHE_HOME") || Quickshell.env("HOME") + "/.cache"
  readonly property string stateHome: Quickshell.env("XDG_STATE_HOME") || Quickshell.env("HOME") + "/.local/state"
  readonly property string cachePath: cacheHome + "/fmhy-deck/index-v1.json"
  readonly property string statePath: stateHome + "/fmhy-deck/state-v1.json"
  property var shell: null
  property var requestedQuery: null
  property bool resultsReady: false
  property var saved: ({})
  property string seen: ""
  property var rows: []
  property var changes: []
  property var rules: ({})
  property var categories: []
  property int total: 0
  property int count: 0
  property string revision: ""
  property double synced: 0
  property bool busy: false
  property bool initialized: false
  property string status: "Loading local index…"
  property string persistenceError: ""
  property string query: ""
  property string tab: "All"
  property int serial: 0
  property var queue: []
  property var currentSource: null
  property string catalogRevision: ""
  property string safetyRevision: ""
  property int failures: 0
  property double nextCheck: 0
  property bool stateWritable: true
  property bool writingState: false
  property bool dirtyState: false
  property bool writingCache: false
  property var random: null
  property int randomSerial: 0
  property var corrections: []
  readonly property bool unseen: changes.length > 0 && seen !== revision

  function search(text, filter, category) {
    query = text.slice(0, 200)
    tab = filter
    resultsReady = false
    serial++
    corrections = []
    worker.sendMessage({ kind: "query", query: query, tab: tab, serial: serial, category: category || "" })
  }

  function pickRandom() {
    if (!initialized) return
    randomSerial++
    worker.sendMessage({ kind: "random", serial: randomSerial })
  }

  function toggleSaved(entry) {
    if (!entry || !stateWritable) return
    const clean = Resources.resource(entry)
    if (!clean) return
    const next = Object.assign({}, saved)
    if (next[clean.id]) delete next[clean.id]
    else {
      if (Object.keys(next).length >= 1000) { persistenceError = "Saved limit reached (1,000 resources)"; return }
      next[clean.id] = clean
    }
    saved = next
    worker.sendMessage({ kind: "saved", saved: saved })
    persistState()
  }

  function markSeen() { seen = revision; persistState() }
  function persistState() {
    if (!stateWritable) return
    if (writingState) { dirtyState = true; return }
    writingState = true
    stateFile.setText(JSON.stringify({ schema: 1, saved: Object.values(saved), seen: seen }))
  }

  function warningFor(entry) { return Safety.safetyFor(entry.url, rules) }
  function openResource(entry) {
    const parsed = UrlSafety.validateExternalUrl(entry.url)
    if (parsed) Qt.openUrlExternally(parsed.url)
  }
  function copyResource(entry) {
    const parsed = UrlSafety.validateExternalUrl(entry.url)
    if (parsed) Quickshell.clipboardText = parsed.url
  }

  function sync() {
    if (!initialized || busy) return
    busy = true
    status = "Checking FMHY…"
    queue = [
      { kind: "revision", name: "catalog", url: "https://api.github.com/repos/fmhy/edit/commits/main" },
      { kind: "revision", name: "safety", url: "https://api.github.com/repos/fmhy/FMHYFilterlist/commits/main" }
    ]
    nextDownload()
  }

  function nextDownload() {
    if (!busy) return
    if (!queue.length) {
      if (currentSource && currentSource.kind === "revision") {
        const nextRevision = catalogRevision + ":" + safetyRevision
        if (revision === nextRevision) { worker.sendMessage({ kind: "unchanged" }); return }
        queue = Source.fetchPlan(catalogRevision, safetyRevision)
        worker.sendMessage({ kind: "begin", revision: nextRevision })
        status = "Updating local index…"
      } else { worker.sendMessage({ kind: "finish", seen: seen }); return }
    }
    currentSource = queue[0]
    queue = queue.slice(1)
    download.command = Source.downloadArguments(currentSource.url)
    download.running = true
  }

  function received(text) {
    if (!busy) return
    if (currentSource.kind === "revision") {
      try {
        const data = JSON.parse(text)
        if (!/^[a-f0-9]{40}$/.test(data.sha)) throw new Error("Missing revision")
        if (currentSource.name === "catalog") catalogRevision = data.sha
        else safetyRevision = data.sha
        nextDownload()
      } catch (error) { failSync("Update format changed · using previous index") }
    } else worker.sendMessage({ kind: "document", source: currentSource, text: text })
  }

  function failSync(message) {
    busy = false
    queue = []
    worker.sendMessage({ kind: "abort" })
    failures = Math.min(failures + 1, 5)
    nextCheck = Date.now() + Math.min(24, Math.pow(2, failures)) * 3600000
    status = count ? message : "No local index yet · sync to get started"
  }

  WorkerScript {
    id: worker
    source: Qt.resolvedUrl("js/Worker.mjs")
    onMessage: function(message) {
      if (message.kind === "results") {
        root.corrections = message.corrected || []
        if (message.serial === root.serial) { root.rows = message.rows; root.total = message.total; root.resultsReady = true }
      } else if (message.kind === "active") {
        root.revision = message.revision
        root.synced = message.synced
        root.count = message.count
        root.changes = message.changes
        root.rules = message.rules
        root.categories = message.categories || []
        root.busy = false
        root.failures = 0
        root.nextCheck = root.synced + 6 * 3600000
        root.status = "Synced " + Qt.formatDateTime(new Date(root.synced), "ddd HH:mm")
        root.initialized = true
        if (Date.now() >= root.nextCheck) root.sync()
      } else if (message.kind === "random") {
        if (message.serial === root.randomSerial) root.random = message.entry
      } else if (message.kind === "next") root.nextDownload()
      else if (message.kind === "persist") {
        root.writingCache = true
        cacheFile.setText(message.text)
      } else if (message.kind === "error") {
        console.warn("FMHY Deck:", message.operation, message.reason)
        if (message.operation === "load") {
          root.initialized = true
          root.status = "Local index needs rebuilding"
          root.sync()
        } else root.failSync("Update format changed · using previous index")
      }
    }
  }

  // One singleton owns persistence and transport across all monitor widgets.
  Process {
    id: initialize
    command: ["mkdir", "-p", "-m", "700", "--", root.cacheHome + "/fmhy-deck", root.stateHome + "/fmhy-deck"]
    running: true
    // Quickshell’s qmltypes omit QProcess::ExitStatus; the runtime signal is valid.
    // qmllint disable signal-handler-parameters
    onExited: function(code) {
      if (code !== 0) { root.persistenceError = "Could not create local storage"; root.stateWritable = false }
      readState.running = true
    }
    // qmllint enable signal-handler-parameters
  }
  Process {
    id: readState
    command: ["env", "LC_ALL=C", "head", "-c", "4194305", "--", root.statePath]
    stdout: StdioCollector { id: stateRead }
    stderr: StdioCollector { id: stateError }
    // Quickshell’s qmltypes omit QProcess::ExitStatus; the runtime signal is valid.
    // qmllint disable signal-handler-parameters
    onExited: function(code) {
      try {
        if (code !== 0 && stateError.text.indexOf("No such file or directory") < 0) throw new Error("State unreadable")
        const state = Storage.parseUserState(code === 0 ? stateRead.text : "")
        root.saved = state.saved
        root.seen = state.seen
        worker.sendMessage({ kind: "saved", saved: root.saved })
      } catch (error) {
        root.stateWritable = false
        root.persistenceError = "Saved file is damaged · preserved on disk"
      }
      readCache.running = true
    }
    // qmllint enable signal-handler-parameters
  }
  Process {
    id: readCache
    command: ["head", "-c", "33554433", "--", root.cachePath]
    stdout: StdioCollector { id: cacheRead }
    // Quickshell’s qmltypes omit QProcess::ExitStatus; the runtime signal is valid.
    // qmllint disable signal-handler-parameters
    onExited: function(code) {
      if (code === 0) worker.sendMessage({ kind: "load", text: cacheRead.text })
      else { root.initialized = true; root.sync() }
    }
    // qmllint enable signal-handler-parameters
  }
  FileView {
    id: cacheFile
    path: root.cachePath
    blockAllReads: true
    atomicWrites: true
    printErrors: false
    onSaved: {
      if (root.writingCache) { root.writingCache = false; worker.sendMessage({ kind: "commit" }) }
    }
    onSaveFailed: { root.writingCache = false; root.failSync("Could not save update · using previous index") }
  }
  FileView {
    id: stateFile
    path: root.statePath
    blockAllReads: true
    atomicWrites: true
    printErrors: false
    onSaved: {
      root.writingState = false
      root.persistenceError = ""
      if (root.dirtyState) { root.dirtyState = false; root.persistState() }
    }
    onSaveFailed: { root.writingState = false; root.persistenceError = "Could not save · changes remain in memory" }
  }
  Process {
    id: download
    stdout: StdioCollector { id: response }
    stderr: StdioCollector {}
    // Quickshell’s qmltypes omit QProcess::ExitStatus; the runtime signal is valid.
    // qmllint disable signal-handler-parameters
    onExited: function(code) {
      if (code === 0) root.received(response.text)
      else root.failSync("Offline · using cached index")
    }
    // qmllint enable signal-handler-parameters
  }
  IpcHandler {
      target: "io.github.i12bp8.fmhy-deck"
    function sync(): void { root.sync() }
    function search(query: string): void {
      root.requestedQuery = query.slice(0, 200)
      if (root.shell) root.shell.summon("io.github.i12bp8.fmhy-deck", "{}")
    }
    function status(): string {
      return JSON.stringify({ status: root.status, count: root.count, busy: root.busy,
        saved: Object.keys(root.saved).length, changes: root.changes.length, revision: root.revision })
    }
  }
  Timer {
    interval: 30 * 60 * 1000
    running: true
    repeat: true
    onTriggered: if (Date.now() >= root.nextCheck) root.sync()
  }
}
