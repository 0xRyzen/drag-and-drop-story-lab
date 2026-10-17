#!/bin/sh
# Run once INSIDE the n8n server/container as its runtime user, from a reviewed checkout.
set -eu
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEST=/files/dnd-story-lab/app
CONFIG=/files/dnd-story-lab/operator.json
node --check "$SOURCE/runtime/core.mjs"
node --check "$SOURCE/runtime/runner.mjs"
(cd "$SOURCE" && node --test tests/*.test.mjs)
mkdir -p "$DEST/runtime" "$DEST/schemas" /files/dnd-story-lab/runs
cp "$SOURCE/runtime/core.mjs" "$DEST/runtime/core.mjs"
cp "$SOURCE/runtime/runner.mjs" "$DEST/runtime/runner.mjs"
cp "$SOURCE"/schemas/*.json "$DEST/schemas/"
if [ ! -e "$CONFIG" ]; then
    cp "$SOURCE/runtime/operator.example.json" "$CONFIG"
    chmod 600 "$CONFIG"
fi
node -e 'const fs=require("node:fs"),cp=require("node:child_process");const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));for(const k of ["ffmpeg","ffprobe"]){const r=cp.spawnSync(c[k],["-version"],{encoding:"utf8"});if(r.status!==0)throw Error(k+" unavailable at configured path");}const b=cp.spawnSync(c.ffmpeg,["-hide_banner","-bsfs"],{encoding:"utf8"});if(!/^setts$/m.test(b.stdout||""))throw Error("FFmpeg setts filter required for exact episode duration");' "$CONFIG"
node "$DEST/runtime/runner.mjs" health
printf '%s\n' 'Installed isolated Story Lab runtime. Configure operator.json; paid rendering remains disabled until explicitly enabled.'
