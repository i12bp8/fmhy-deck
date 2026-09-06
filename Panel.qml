pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui as Ui
import "." as Deck
import "components"

Ui.Panel {
  id: root
  moduleName: "io.github.i12bp8.fmhy-deck"
  manageIpc: false
  property Item anchorItem
  property var hostWidget
  readonly property var store: Deck.DeckStore
  property var typography: Style.font
  property var surfaceColors: Color.popups
  property string filter: "All"
  property string category: ""
  property bool categoryMode: false
  property string browsePath: ""
  property int browseSelected: 0
  property var inspected: null
  property bool confirming: false
  property string confirmationUrl: ""
  property string confirmationReason: ""
  property string feedback: ""
  property int selected: 0
  property int changesSelected: 0
  readonly property bool hasQuery: search.text.length > 0
  readonly property bool browseMode: !inspected && categoryMode
  readonly property bool resultsMode: !inspected && filter !== "Changes" && !browseMode
  readonly property var chosen: filter === "Changes" ? (store.changes.length ? store.changes[Math.min(changesSelected, store.changes.length - 1)].resource : null)
    : browseMode ? (browseRows.length ? browseRows[Math.min(browseSelected, browseRows.length - 1)] : null)
    : store.resultsReady && store.rows.length ? store.rows[Math.min(selected, store.rows.length - 1)] : null
  readonly property var correctionText: store.corrections.filter(entry => !!entry && entry.from && entry.to)
    .map(entry => "matched “" + entry.to + "” for “" + entry.from + "”").join(" · ")
  readonly property var browseRows: {
    if (!browseMode || !browsePath) return store.categories
    const node = store.categories.find(item => item.name === browsePath)
    if (!node) return []
    return [{ path: browsePath, count: node.count, all: true }].concat(node.children)
  }
  function open() {
    const requested = store.requestedQuery === null ? "" : store.requestedQuery
    store.requestedQuery = null
    filter = "All"
    category = ""
    categoryMode = false
    browsePath = ""
    browseSelected = 0
    selected = 0
    changesSelected = 0
    inspected = null
    confirming = false
    feedback = ""
    search.text = requested
    controller.show()
    Qt.callLater(function() { search.forceActiveFocus(); search.selectAll() })
    store.search(requested, filter, category)
  }
  function close() { controller.hide(); inspected = null; confirming = false; feedback = "" }
  function chooseFilter(value) {
    filter = value
    category = ""
    categoryMode = false
    browsePath = ""
    browseSelected = 0
    inspected = null
    confirming = false
    selected = 0
    changesSelected = 0
    if (value === "Changes") {
      store.markSeen()
      panelFocus.forceActiveFocus()
    } else {
      store.search(search.text, filter, category)
      search.forceActiveFocus()
    }
  }
  function move(delta) {
    if (inspected) return
    if (filter === "Changes") {
      changesSelected = Math.max(0, Math.min(store.changes.length - 1, changesSelected + delta))
      changesView.positionViewAtIndex(changesSelected, ListView.Contain)
      return
    }
    if (browseMode) {
      browseSelected = Math.max(0, Math.min(browseRows.length - 1, browseSelected + delta))
      browse.positionViewAtIndex(browseSelected, ListView.Contain)
      return
    }
    selected = Math.max(0, Math.min(store.rows.length - 1, selected + delta))
    results.positionViewAtIndex(selected, ListView.Contain)
  }
  function movePage(delta) {
    const view = filter === "Changes" ? changesView : browseMode ? browse : results
    const rows = Math.max(1, Math.floor(view.height / Style.space(browseMode ? 48 : 78)))
    move(delta * rows)
  }
  function moveTo(edge) {
    if (inspected) return
    if (filter === "Changes") {
      changesSelected = edge < 0 ? 0 : Math.max(0, store.changes.length - 1)
      changesView.positionViewAtIndex(changesSelected, ListView.Contain)
      return
    }
    if (browseMode) {
      browseSelected = edge < 0 ? 0 : Math.max(0, browseRows.length - 1)
      browse.positionViewAtIndex(browseSelected, ListView.Contain)
    } else {
      selected = edge < 0 ? 0 : Math.max(0, store.rows.length - 1)
      results.positionViewAtIndex(selected, ListView.Contain)
    }
  }
  function showCategories() {
    filter = filter === "Changes" ? "All" : filter
    category = ""
    browsePath = ""
    browseSelected = 0
    selected = 0
    inspected = null
    categoryMode = true
    if (search.text) search.clear()
    search.forceActiveFocus()
  }
  function chooseBrowse(index) {
    const item = browseRows[index]
    if (!item) return
    if (item.all || browsePath) {
      category = item.path
      browsePath = ""
      categoryMode = false
      store.search(search.text, filter, category)
      search.forceActiveFocus()
    }
    else if (item.children && item.children.length) { browsePath = item.name; browseSelected = 0 }
    else {
      category = item.name
      categoryMode = false
      store.search(search.text, filter, category)
      search.forceActiveFocus()
    }
  }
  function activateChosen() {
    if (browseMode) { chooseBrowse(browseSelected); return }
    if (filter === "Changes") { inspect(chosen); return }
    requestOpen(chosen)
  }
  function clearCategory() {
    category = ""
    categoryMode = false
    browsePath = ""
    browseSelected = 0
    store.search(search.text, filter, category)
  }
  function inspect(entry) { if (entry) { inspected = entry; confirming = false; feedback = ""; Qt.callLater(details.focusBack) } }
  function back() {
    inspected = null
    confirming = false
    feedback = ""
    if (filter === "Changes") panelFocus.forceActiveFocus()
    else search.forceActiveFocus()
  }
  function requestOpen(entry) {
    if (!entry) return
    const safety = store.warningFor(entry)
    if (safety.level === "blocked") return
    if (safety.level !== "listed") {
      inspected = entry
      confirming = true
      confirmationUrl = entry.url
      confirmationReason = safety.reason
      feedback = ""
      Qt.callLater(details.focusBack)
    } else { store.openResource(entry); close() }
  }
  function confirmOpen() {
    if (!inspected || !confirming || inspected.url !== confirmationUrl) return
    const safety = store.warningFor(inspected)
    if (safety.level === "blocked") return
    if (safety.reason !== confirmationReason) { requestOpen(inspected); return }
    store.openResource(inspected)
    close()
  }
  function dismissStep() {
    if (inspected) back()
    else if (search.text) search.clear()
    else if (browseMode && browsePath) { browsePath = ""; browseSelected = 0 }
    else if (browseMode) { categoryMode = false; store.search("", filter, category) }
    else if (category) clearCategory()
    else close()
  }

  Connections {
    target: root.store
    function onRowsChanged() { root.selected = Math.min(root.selected, Math.max(0, root.store.rows.length - 1)) }
    function onChangesChanged() { root.changesSelected = Math.min(root.changesSelected, Math.max(0, root.store.changes.length - 1)) }
    function onRandomChanged() {
      if (root.store.random) {
        const entry = root.store.random
        root.store.random = null
        root.inspect(entry)
      }
    }
  }

  Ui.KeyboardPanel {
    id: popup
    anchorItem: root.anchorItem
    bar: root.bar
    owner: root.hostWidget
    open: root.opened
    focusTarget: root.inspected ? details.initialFocus : search
    contentWidth: popup.fittedContentWidth(Style.space(680))
    contentHeight: popup.fittedContentHeight(Style.space(660))

    FocusScope {
      id: panelFocus
      anchors.fill: parent
      Keys.onEscapePressed: root.dismissStep()
      Keys.onPressed: function(event) {
        if ((event.modifiers & Qt.ControlModifier) && event.key === Qt.Key_F && !root.inspected && root.filter !== "Changes") {
          search.forceActiveFocus()
          search.selectAll()
          event.accepted = true
        } else if ((event.modifiers & Qt.ControlModifier) && event.key === Qt.Key_B && !root.inspected) {
          root.showCategories()
          event.accepted = true
        } else if ((event.modifiers & Qt.ControlModifier) && event.key >= Qt.Key_1 && event.key <= Qt.Key_4) {
          root.chooseFilter(["All", "Starred", "Saved", "Changes"][event.key - Qt.Key_1])
          event.accepted = true
        } else if (!root.inspected && root.filter === "Changes" && event.key === Qt.Key_Down) {
          root.move(1); event.accepted = true
        } else if (!root.inspected && root.filter === "Changes" && event.key === Qt.Key_Up) {
          root.move(-1); event.accepted = true
        } else if (!root.inspected && root.filter === "Changes" && event.key === Qt.Key_PageDown) {
          root.movePage(1); event.accepted = true
        } else if (!root.inspected && root.filter === "Changes" && event.key === Qt.Key_PageUp) {
          root.movePage(-1); event.accepted = true
        } else if (!root.inspected && root.filter === "Changes" && event.key === Qt.Key_Home) {
          root.moveTo(-1); event.accepted = true
        } else if (!root.inspected && root.filter === "Changes" && event.key === Qt.Key_End) {
          root.moveTo(1); event.accepted = true
        } else if (!root.inspected && root.filter === "Changes"
                   && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)) {
          root.activateChosen(); event.accepted = true
        }
      }
      ColumnLayout {
        anchors.fill: parent
        spacing: Style.space(12)
        RowLayout {
          Layout.fillWidth: true
          DeckText { text: "FMHY Deck"; font.pixelSize: root.typography.title; font.weight: Font.DemiBold }
          Item { Layout.fillWidth: true }
          DeckText {
            Layout.maximumWidth: popup.contentWidth * 0.4
            text: root.store.status
            secondary: true
            font.pixelSize: root.typography.bodySmall
            elide: Text.ElideRight
          }
          Ui.Button {
            id: refreshButton
            text: "󰑐"
            tooltipText: "Refresh FMHY · checked every six hours"
            enabled: !root.store.busy
            focusable: true
            onClicked: root.store.sync()
          }
        }
        Ui.TextField {
          id: search
          Layout.fillWidth: true
          visible: !root.inspected && root.filter !== "Changes"
          placeholderText: root.category ? "Search in " + root.category + "…" : "Search 14,000+ FMHY resources…"
          foreground: root.surfaceColors.text
          font.pixelSize: root.typography.subtitle
          maximumLength: 200
          onTextChanged: {
            root.selected = 0
            if (text.length) root.categoryMode = false
            root.store.search(text, root.filter, root.category)
          }
          Keys.priority: Keys.BeforeItem
          Keys.onTabPressed: function(event) {
            categoryButton.forceActiveFocus()
            event.accepted = true
          }
          Keys.onBacktabPressed: function(event) {
            refreshButton.forceActiveFocus()
            event.accepted = true
          }
          KeyNavigation.tab: categoryButton
          KeyNavigation.backtab: refreshButton
          KeyNavigation.priority: KeyNavigation.BeforeItem
          Keys.onPressed: function(event) {
            if (event.key === Qt.Key_Down) { root.move(1); event.accepted = true }
            else if (event.key === Qt.Key_Up) { root.move(-1); event.accepted = true }
            else if (event.key === Qt.Key_PageDown) { root.movePage(1); event.accepted = true }
            else if (event.key === Qt.Key_PageUp) { root.movePage(-1); event.accepted = true }
            else if (event.key === Qt.Key_Home && !(event.modifiers & Qt.ControlModifier)) { root.moveTo(-1); event.accepted = true }
            else if (event.key === Qt.Key_End && !(event.modifiers & Qt.ControlModifier)) { root.moveTo(1); event.accepted = true }
            else if (event.key === Qt.Key_Escape) { root.dismissStep(); event.accepted = true }
            else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) { root.activateChosen(); event.accepted = true }
            else if ((event.modifiers & Qt.ControlModifier) && event.key === Qt.Key_D) { root.store.toggleSaved(root.chosen); event.accepted = true }
            else if (((event.modifiers & Qt.ControlModifier) && event.key === Qt.Key_I) || event.key === Qt.Key_Right) { root.inspect(root.chosen); event.accepted = true }
            else if ((event.modifiers & Qt.ControlModifier) && event.key === Qt.Key_R) { root.store.pickRandom(); event.accepted = true }
          }
        }
        RowLayout {
          Layout.fillWidth: true
          visible: !root.inspected
          spacing: Style.space(6)
          Ui.ButtonGroup {
            visible: !root.inspected
            options: [
              { value: "All", label: "All" },
              { value: "Starred", label: "★ Picks" },
              { value: "Saved", label: "Saved" },
              { value: "Changes", label: root.store.changes.length ? "Changes " + root.store.changes.length : "Changes" }
            ]
            value: root.filter
            foreground: root.surfaceColors.text
            background: "transparent"
            focusable: false
            onChanged: value => root.chooseFilter(value)
          }
          Item { Layout.fillWidth: true }
          Ui.Button {
            id: categoryButton
            visible: root.filter !== "Changes"
            text: root.category ? "All categories" : "Categories"
            tooltipText: root.category || "Browse the FMHY directory"
            focusable: true
            bordered: true
            selected: root.browseMode || !!root.category
            onClicked: root.category ? root.clearCategory() : root.showCategories()
          }
          Ui.Button {
            visible: root.filter !== "Changes"
            text: "󰒟"
            tooltipText: "Random FMHY pick · Ctrl+R"
            focusable: true
            enabled: root.store.initialized
            onClicked: root.store.pickRandom()
          }
        }
        RowLayout {
          Layout.fillWidth: true
          visible: !root.inspected && (root.browseMode || root.category.length > 0 || root.filter === "Changes" || root.resultsMode)
          spacing: Style.space(6)
          DeckText {
            Layout.fillWidth: true
            text: root.browseMode ? (root.browsePath ? "Categories  ›  " + root.browsePath : "Categories")
              : root.category ? root.category
              : root.filter === "Changes" ? "Saved resources and FMHY picks that changed"
              : root.filter === "Starred" ? "Preferred by FMHY"
              : root.filter === "Saved" ? "Your saved resources"
              : root.hasQuery ? "Search results" : "FMHY picks first"
            secondary: true
            font.pixelSize: root.typography.bodySmall
            elide: Text.ElideRight
          }
          DeckText {
            visible: root.resultsMode
            text: root.store.resultsReady ? root.store.total.toLocaleString() + (root.store.total === 1 ? " result" : " results") : "Searching…"
            secondary: true
            font.pixelSize: root.typography.bodySmall
          }
        }
        Ui.PanelSeparator { Layout.fillWidth: true; visible: !root.inspected }
        Item {
          Layout.fillWidth: true
          Layout.fillHeight: true
          ListView {
            id: results
            anchors.fill: parent
            visible: root.resultsMode
            clip: true
            enabled: root.store.resultsReady
            model: root.store.rows
            spacing: Style.space(2)
            boundsBehavior: Flickable.StopAtBounds
            reuseItems: true
            delegate: ResourceRow {
              required property var modelData
              required property int index
              width: results.width
              entry: modelData
              selected: root.selected === index
              saved: !!root.store.saved[modelData.id]
              onPointed: root.selected = index
              onActivated: root.requestOpen(modelData)
              onInspectRequested: root.inspect(modelData)
              onSaveRequested: root.store.toggleSaved(modelData)
            }
          }
          ListView {
            id: browse
            anchors.fill: parent
            visible: root.browseMode
            clip: true
            model: root.browseRows
            spacing: Style.space(2)
            boundsBehavior: Flickable.StopAtBounds
            reuseItems: true
            currentIndex: root.browseSelected
            delegate: CategoryRow {
              required property var modelData
              required property int index
              width: browse.width
              item: modelData
              selected: root.browseSelected === index
              onPointed: root.browseSelected = index
              onActivated: root.chooseBrowse(index)
            }
          }
          ListView {
            id: changesView
            anchors.fill: parent
            visible: !root.inspected && root.filter === "Changes"
            clip: true
            model: root.store.changes
            spacing: Style.space(16)
            boundsBehavior: Flickable.StopAtBounds
            delegate: Rectangle {
              id: changeRow
              required property var modelData
              required property int index
              width: changesView.width
              height: changeContent.implicitHeight + Style.space(18)
              radius: Style.cornerRadius
              color: root.changesSelected === changeRow.index
                ? Style.selectedFillFor(root.surfaceColors.text, Color.accent)
                : changePointer.containsMouse ? Style.hoverFillFor(root.surfaceColors.text, Color.accent) : "transparent"
              Behavior on color { ColorAnimation { duration: 110 } }
              MouseArea {
                id: changePointer
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onEntered: root.changesSelected = changeRow.index
                onClicked: root.inspect(changeRow.modelData.resource)
              }
              Column {
                id: changeContent
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.margins: Style.space(10)
                spacing: Style.space(4)
                DeckText { width: parent.width; text: changeRow.modelData.kind; color: Color.accent; font.weight: Font.DemiBold }
                DeckText { width: parent.width; text: changeRow.modelData.resource.title; font.pixelSize: root.typography.subtitle; font.weight: Font.DemiBold }
                DeckText { width: parent.width; text: changeRow.modelData.detail; wrapMode: Text.Wrap; secondary: true }
              }
            }
          }
          Column {
            anchors.centerIn: parent
            width: parent.width
            visible: !root.inspected && !root.browseMode
              && (root.filter === "Changes" ? root.store.changes.length === 0 : root.store.rows.length === 0)
            spacing: Style.space(10)
            DeckText {
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              wrapMode: Text.Wrap
              text: root.filter === "Changes" ? "You’re up to date" : root.filter === "Saved" && !search.text ? "Nothing saved yet"
                : !root.store.count ? "FMHY data has not been synced yet" : root.category
                  ? "No resources in “" + root.category + "”" : "No resources found for “" + search.text + "”"
              secondary: true
            }
            Ui.Button {
              anchors.horizontalCenter: parent.horizontalCenter
              visible: !root.store.count && root.filter !== "Changes"
              text: root.store.busy ? "Syncing…" : "Retry sync"
              focusable: true
              enabled: !root.store.busy
              onClicked: root.store.sync()
            }
          }
          DetailsView {
            id: details
            anchors.fill: parent
            visible: !!root.inspected
            entry: root.inspected || ({ title: "", description: "", category: "", hostname: "", url: "", source: "", starred: false })
            safety: root.inspected ? root.store.warningFor(root.inspected) : ({ level: "listed", reason: "" })
            warning: root.confirming
            saved: root.inspected ? !!root.store.saved[root.inspected.id] : false
            feedback: root.feedback
            onBackRequested: root.back()
            onOpenRequested: root.requestOpen(root.inspected)
            onConfirmed: root.confirmOpen()
            onSaveRequested: root.store.toggleSaved(root.inspected)
            onCopyRequested: { root.store.copyResource(root.inspected); root.feedback = "Copied" }
          }
        }
        Ui.PanelSeparator { Layout.fillWidth: true; visible: !root.inspected }
        DeckText {
          Layout.fillWidth: true
          text: root.store.persistenceError || (root.inspected ? "Esc back · Tab move between actions"
            : root.correctionText ? root.correctionText
            : root.browseMode ? "↑↓ browse   Enter select   Type to search   Esc back"
            : root.filter === "Changes" ? "Changes since your previous sync · local comparisons"
            : "↑↓ navigate   Enter open   → details   Ctrl+D save   Ctrl+B browse   Esc clear / close")
          font.pixelSize: root.typography.bodySmall
          secondary: true
        }
      }
    }
  }

  component CategoryRow: Rectangle {
    id: catRow
    // Plain properties: ListView injects delegate values into inline components
    // by context, which does not satisfy `required` initializers under Bound.
    property var item: null
    property int index: -1
    property bool selected: false
    signal pointed()
    signal activated()
    height: Style.space(48)
    radius: Style.cornerRadius
    color: selected ? Style.selectedFillFor(root.surfaceColors.text, Color.accent)
      : pointer.containsMouse ? Style.hoverFillFor(root.surfaceColors.text, Color.accent) : "transparent"
    Behavior on color { ColorAnimation { duration: 110 } }
    MouseArea {
      id: pointer
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onEntered: catRow.pointed()
      onPositionChanged: catRow.pointed()
      onClicked: catRow.activated()
    }
    RowLayout {
      anchors.fill: parent
      anchors.leftMargin: Style.space(12)
      anchors.rightMargin: Style.space(16)
      spacing: Style.space(8)
      DeckText {
        Layout.fillWidth: true
        elide: Text.ElideRight
        text: catRow.item.all ? "All in " + catRow.item.path : catRow.item.name !== undefined ? catRow.item.name : catRow.item.path
        font.pixelSize: root.typography.subtitle
        font.weight: catRow.item.all ? Font.DemiBold : Font.Normal
      }
      DeckText {
        text: catRow.item.count.toLocaleString()
        secondary: true
        font.pixelSize: root.typography.bodySmall
      }
      DeckText {
        visible: !!catRow.item.children && catRow.item.children.length > 0
        text: "›"
        secondary: true
        font.pixelSize: root.typography.subtitle
      }
    }
  }
}
