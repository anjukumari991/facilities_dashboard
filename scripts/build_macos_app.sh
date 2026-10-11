#!/bin/zsh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-$REPO_DIR/.venv/bin/python}"
APP_NAME="Facilities Dashboard.app"
DIST_DIR="$REPO_DIR/dist"
APP_DIR="$DIST_DIR/$APP_NAME"
CONTENTS_DIR="$APP_DIR/Contents"
FRAMEWORK_DEST="$CONTENTS_DIR/Frameworks/Python.framework"
PYTHON_DEST="$FRAMEWORK_DEST/Versions/3.11"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
ICONSET_DIR="$REPO_DIR/build/AppIcon.iconset"

if [[ ! -x "$PYTHON_BIN" ]]; then
  print -u2 "Python environment not found at $PYTHON_BIN"
  exit 1
fi

PYTHON_VERSION="$($PYTHON_BIN -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [[ "$PYTHON_VERSION" != "3.11" ]]; then
  print -u2 "This bundle currently expects Python 3.11; found $PYTHON_VERSION"
  exit 1
fi

PYTHON_SOURCE="$($PYTHON_BIN -c 'import sys; print(sys.base_prefix)')"
SITE_PACKAGES="$($PYTHON_BIN -c 'import site; print(next(path for path in site.getsitepackages() if path.endswith("site-packages")))')"

if [[ ! -f "$PYTHON_SOURCE/Python" ]]; then
  print -u2 "The Python framework could not be found at $PYTHON_SOURCE"
  exit 1
fi

rm -rf "$APP_DIR" "$ICONSET_DIR"
mkdir -p "$CONTENTS_DIR/MacOS" "$FRAMEWORK_DEST/Versions" "$RESOURCES_DIR/app" "$RESOURCES_DIR/site-packages" "$ICONSET_DIR"

rsync -a \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude 'site-packages' \
  --exclude 'test' \
  --exclude 'tests' \
  --exclude 'idlelib' \
  --exclude 'tkinter' \
  --exclude 'turtledemo' \
  --exclude 'ensurepip' \
  --exclude 'venv' \
  "$PYTHON_SOURCE/" "$PYTHON_DEST/"

ln -s 3.11 "$FRAMEWORK_DEST/Versions/Current"
ln -s Versions/Current/Python "$FRAMEWORK_DEST/Python"
ln -s Versions/Current/Resources "$FRAMEWORK_DEST/Resources"

rsync -a \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude 'pip' \
  --exclude 'pip-*' \
  --exclude 'setuptools' \
  --exclude 'setuptools-*' \
  --exclude 'wheel' \
  --exclude 'wheel-*' \
  "$SITE_PACKAGES/" "$RESOURCES_DIR/site-packages/"

rsync -a \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  "$REPO_DIR/dashboard/" "$RESOURCES_DIR/app/dashboard/"

cp "$REPO_DIR/packaging/macos/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$REPO_DIR/packaging/macos/facilities_dashboard" "$CONTENTS_DIR/MacOS/facilities_dashboard"
chmod +x "$CONTENTS_DIR/MacOS/facilities_dashboard"

SQUARE_ICON="$REPO_DIR/build/AppIcon-1024.png"
mkdir -p "$REPO_DIR/build"
sips -s format png "$REPO_DIR/dashboard/static/app-icon.png" --out "$SQUARE_ICON" >/dev/null
sips --resampleHeightWidthMax 1024 "$SQUARE_ICON" >/dev/null
sips --padToHeightWidth 1024 1024 --padColor 042B42 "$SQUARE_ICON" >/dev/null

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$SQUARE_ICON" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null
  double_size=$((size * 2))
  sips -z "$double_size" "$double_size" "$SQUARE_ICON" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/AppIcon.icns"
rm -rf "$ICONSET_DIR" "$SQUARE_ICON"

xattr -cr "$APP_DIR"
codesign --force --deep --sign - "$APP_DIR" >/dev/null

print "Built $APP_DIR"
du -sh "$APP_DIR"
