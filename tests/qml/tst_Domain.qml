import QtQuick
import QtTest
import QtQml.WorkerScript
import "../../js/FmhySource.mjs" as Source
import "../../js/Resources.mjs" as Resources
import "../../js/UrlSafety.mjs" as UrlSafety

TestCase {
  id: root
  name: "QtRuntime"
  when: true
  property var reply: null
  WorkerScript {
    id: worker
    source: Qt.resolvedUrl("../../js/Worker.mjs")
    onMessage: function(message) { root.reply = message }
  }
  function test_url() { compare(UrlSafety.validateExternalUrl("https://example.com").hostname, "example.com") }
  function test_parser() {
    const rows = Source.parseDocument("# Tools\n* ⭐ **[Tool](https://tool.example/)** - Useful", "system-tools.md")
    compare(rows.length, 1)
    verify(rows[0].starred)
    compare(Resources.normalizeSearchText("CAFÉ.Tools"), "cafe tools")
  }
  function test_worker() {
    const resources = []
    for (let i = 0; i < 100; i++) resources.push({ title: "Tool " + i, url: "https://tool" + i + ".example", category: "Tools", description: "A tool", source: "misc.md", starred: false })
    root.reply = null
    worker.sendMessage({ kind: "load", text: JSON.stringify({ schema: 1, revision: "a".repeat(40) + ":" + "b".repeat(40), synced: Date.now(), resources: resources, rules: { "bad.example": { level: "warning", reason: "bad" } }, changes: [] }) })
    tryVerify(function() { return root.reply !== null }, 3000)
    root.reply = null

    worker.sendMessage({ kind: "query", query: "Tool 99", tab: "All", serial: 4 })
    tryVerify(function() { return root.reply !== null }, 3000)
    compare(root.reply.kind, "results")
    compare(root.reply.serial, 4)
    compare(root.reply.total, 1)
    compare(root.reply.rows[0].title, "Tool 99")
    root.reply = null
    worker.sendMessage({ kind: "query", query: "nonexistent", tab: "All", serial: 5 })
    tryVerify(function() { return root.reply !== null }, 3000)
    compare(root.reply.serial, 5)
    compare(root.reply.total, 0)
  }
}
