import QtQuick
import qs.Commons
import qs.Ui
import "." as Deck

BarWidget {
  id: root
  moduleName: "io.github.i12bp8.fmhy-deck"
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight
  readonly property bool opened: deck.opened
  readonly property bool popoutSwitchClosing: deck.popoutSwitchClosing
  readonly property var shellHost: bar
  readonly property var hostShell: shellHost ? shellHost.shell : null
  onHostShellChanged: Deck.DeckStore.shell = hostShell
  Component.onCompleted: Deck.DeckStore.shell = hostShell
  function open() { deck.open() }
  function close() { deck.close() }
  function closeForPopoutSwitch() { deck.closeForPopoutSwitch() }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰆋"
    tooltipText: "FMHY Deck · " + (Deck.DeckStore.unseen ? "Changes to review" : "Find resources")
    onPressed: deck.toggle()
    Rectangle {
      anchors.right: parent.right
      anchors.top: parent.top
      anchors.margins: Style.space(3)
      width: Style.space(3)
      height: width
      radius: width / 2
      color: Color.accent
      visible: Deck.DeckStore.unseen
    }
  }

  Deck.Panel {
    id: deck
    bar: root.bar
    anchorItem: button
    hostWidget: root
  }
}
