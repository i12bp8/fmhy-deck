#!/usr/bin/env bash
set -euo pipefail

plugin_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
shell_root=${OMARCHY_PATH:-/usr/share/omarchy}/shell
qt_bin=/usr/lib/qt6/bin

for required in node omarchy; do
  command -v "$required" >/dev/null || {
    echo "Missing required command: $required" >&2
    exit 1
  }
done

for required in "$qt_bin/qmllint" "$qt_bin/qmltestrunner"; do
  [[ -x $required ]] || {
    echo "Missing Qt tool: $required" >&2
    exit 1
  }
done

[[ -d $shell_root/Commons && -d $shell_root/Ui ]] || {
  echo "Omarchy shell modules were not found under: $shell_root" >&2
  exit 1
}

import_root=$(mktemp -d)
trap 'rm -rf -- "$import_root"' EXIT
mkdir -p -- "$import_root/qs"
ln -s -- "$shell_root/Commons" "$import_root/qs/Commons"
ln -s -- "$shell_root/Ui" "$import_root/qs/Ui"

cd -- "$plugin_root"
node --test tests/*.test.mjs
omarchy plugin validate "$plugin_root"
"$qt_bin/qmllint" \
  -I "$import_root" \
  -I /usr/lib/qt6/qml \
  BarWidget.qml Panel.qml Store.qml components/*.qml
env QT_QPA_PLATFORM=offscreen QT_QPA_PLATFORMTHEME= \
  "$qt_bin/qmltestrunner" \
  -import "$import_root" \
  -import /usr/lib/qt6/qml \
  -input tests/qml/tst_Domain.qml
