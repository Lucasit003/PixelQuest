#!/bin/sh
# Move the newest Gemini_Generated_Image_* out of ~/Downloads into the city
# sheet folder under a proper name. The Gemini web UI names every download
# the same way, so the newest-by-mtime is the one just clicked.
#   sh tools/grab_sheet.sh buildings
set -e
NAME="${1:?usage: grab_sheet.sh SHEETNAME}"
DST="/Users/lucassetji/Downloads/pixelquest/assets/_src/city"
# Only files touched in the last 3 minutes, so a stale download from an
# earlier session can never be picked up by mistake.
SRC=$(find /Users/lucassetji/Downloads -maxdepth 1 -name 'Gemini_Generated_Image_*' \
        -mmin -3 -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)
[ -n "$SRC" ] || { echo "no fresh Gemini_Generated_Image_* in ~/Downloads (last 3 min)"; exit 1; }
EXT="${SRC##*.}"
mkdir -p "$DST"
mv "$SRC" "$DST/${NAME}_raw.${EXT}"
echo "$DST/${NAME}_raw.${EXT}"
python3 -c "from PIL import Image; im=Image.open('$DST/${NAME}_raw.${EXT}'); print(im.mode, im.size)"
