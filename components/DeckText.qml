import QtQuick
import qs.Commons

Text {
  property var typography: Style.font
  property var surfaceColors: Color.popups
  property bool secondary: false
  font.family: typography.family
  font.pixelSize: typography.body
  color: surfaceColors.text
  opacity: secondary ? 0.72 : 1
  textFormat: Text.PlainText
  elide: Text.ElideRight
}
