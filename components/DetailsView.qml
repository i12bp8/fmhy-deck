import QtQuick
import qs.Commons
import qs.Ui as Ui

Item {
  id: root
  required property var entry
  required property var safety
  property bool warning: false
  property bool saved: false
  property string feedback: ""
  property var typography: Style.font
  property var surfaceColors: Color.popups
  readonly property bool insecureHttp: root.entry.url.indexOf("http://") === 0
  readonly property bool onionDestination: root.entry.hostname.endsWith(".onion")
  readonly property bool requiresReview: root.safety.level !== "listed"
  readonly property string safetyLabel: root.safety.level === "listed" ? "NO KNOWN FMHY WARNING"
    : root.onionDestination && root.safety.level === "caution" ? "ONION DESTINATION"
    : root.insecureHttp && root.safety.level === "caution" ? "UNENCRYPTED CONNECTION" : "FMHY WARNING"
  readonly property alias initialFocus: backButton
  function focusBack() { backButton.forceActiveFocus() }
  signal backRequested()
  signal openRequested()
  signal confirmed()
  signal saveRequested()
  signal copyRequested()

  Column {
    anchors.fill: parent
    spacing: Style.space(16)
    Row {
      spacing: Style.space(8)
      Ui.Button { id: backButton; text: "‹ Back"; focusable: true; onClicked: root.backRequested() }
      DeckText {
        anchors.verticalCenter: parent.verticalCenter
        text: root.warning ? "REVIEW DESTINATION" : "RESOURCE DETAILS"
        secondary: true
        font.pixelSize: root.typography.bodySmall
      }
    }
    Flickable {
      width: parent.width
      height: parent.height - y - footer.height - Style.space(16)
      contentHeight: content.implicitHeight
      clip: true
      boundsBehavior: Flickable.StopAtBounds
      Column {
        id: content
        width: parent.width
        spacing: Style.space(16)
        DeckText { width: parent.width; text: root.entry.category; wrapMode: Text.Wrap; secondary: true }
        DeckText {
          width: parent.width
          text: root.entry.title
          wrapMode: Text.Wrap
          font.pixelSize: root.typography.heading
          font.weight: Font.DemiBold
        }
        DeckText { width: parent.width; text: root.entry.description; wrapMode: Text.Wrap }
        Ui.PanelSeparator { width: parent.width }
        DeckText {
          width: parent.width
          text: root.entry.hostname
          font.pixelSize: root.typography.title
          font.weight: Font.DemiBold
          wrapMode: Text.WrapAnywhere
        }
        DeckText { width: parent.width; text: root.entry.url; wrapMode: Text.WrapAnywhere; secondary: true }
        DeckText {
          width: parent.width
          text: root.safetyLabel
          color: root.safety.level === "listed" ? root.surfaceColors.text : Color.urgent
          font.pixelSize: root.typography.bodySmall
          font.weight: Font.DemiBold
        }
        DeckText {
          width: parent.width
          text: root.safety.reason
          wrapMode: Text.Wrap
          secondary: root.safety.level === "listed"
        }
        DeckText {
          width: parent.width
          text: (root.entry.starred ? "★ Preferred by FMHY · " : "") + "Source: " + (root.entry.source || "saved resource")
          wrapMode: Text.Wrap
          secondary: true
        }
      }
    }
    Row {
      id: footer
      spacing: Style.space(8)
      Ui.Button {
        text: root.warning ? "Open anyway" : root.requiresReview ? "Review to open" : "Open resource"
        focusable: true
        bordered: true
        foreground: root.requiresReview ? Color.urgent : root.surfaceColors.text
        onClicked: root.warning ? root.confirmed() : root.openRequested()
      }
      Ui.Button { text: root.saved ? "Unsave" : "Save"; focusable: true; onClicked: root.saveRequested() }
      Ui.Button { text: root.feedback || "Copy URL"; focusable: true; onClicked: root.copyRequested() }
    }
  }
}
