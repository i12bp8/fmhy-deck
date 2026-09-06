import QtQuick
import qs.Commons
import qs.Ui as Ui

Rectangle {
  id: root
  required property var entry
  property bool selected: false
  property bool saved: false
  property var surfaceColors: Color.popups
  property var typography: Style.font
  signal activated()
  signal inspectRequested()
  signal saveRequested()
  signal pointed()
  height: Style.space(78)
  radius: Style.cornerRadius
  color: selected ? Style.selectedFillFor(surfaceColors.text, Color.accent)
    : pointer.containsMouse ? Style.hoverFillFor(surfaceColors.text, Color.accent) : "transparent"
  Behavior on color { ColorAnimation { duration: 110 } }

  Rectangle {
    width: Style.space(2)
    height: parent.height - Style.space(20)
    anchors.verticalCenter: parent.verticalCenter
    color: Color.accent
    visible: root.selected
  }
  MouseArea {
    id: pointer
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    acceptedButtons: Qt.LeftButton | Qt.RightButton
    onEntered: root.pointed()
    onPositionChanged: root.pointed()
    onClicked: function(mouse) {
      if (mouse.button === Qt.RightButton) root.inspectRequested()
      else root.activated()
    }
  }
  Column {
    anchors.left: parent.left
    anchors.right: actions.left
    anchors.leftMargin: Style.space(12)
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(3)
    DeckText {
      width: parent.width
      text: root.entry.title + (root.entry.starred ? "  ★" : "")
      font.pixelSize: root.typography.subtitle
      font.weight: Font.DemiBold
    }
    DeckText {
      width: parent.width
      visible: text.length > 0
      text: root.entry.description
      secondary: true
    }
    DeckText {
      width: parent.width
      text: root.entry.category + (root.entry.category && root.entry.hostname ? "   ·   " : "") + root.entry.hostname
        + (root.entry.safety.level !== "listed" ? "   ·   Review before opening" : root.entry.missing ? "   ·   No longer listed" : "")
      color: root.entry.safety.level !== "listed" ? Color.urgent : root.surfaceColors.text
      secondary: true
      font.pixelSize: root.typography.bodySmall
    }
  }
  Row {
    id: actions
    visible: root.selected || pointer.containsMouse
    anchors.right: parent.right
    anchors.rightMargin: Style.space(5)
    anchors.verticalCenter: parent.verticalCenter
    Ui.Button {
      text: root.saved ? "󰆤" : "󰆣"
      tooltipText: root.saved ? "Unsave · Ctrl+D" : "Save · Ctrl+D"
      foreground: root.surfaceColors.text
      onClicked: root.saveRequested()
    }
    Ui.Button {
      text: "󰋽"
      tooltipText: "Inspect · Ctrl+I"
      foreground: root.surfaceColors.text
      onClicked: root.inspectRequested()
    }
  }
}
