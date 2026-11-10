#!/bin/sh
m=$1; d=/tmp/mcmp/$m; mkdir -p $d/w
/home/claude/work/build/tfx --data-dir /home/claude/work/tfx205 --mission=$m --flight-frames=100 --screenshot=$d/n.ppm >/dev/null 2>&1; nrc=$?
st=none
for i in 1 2 3 4 5 6 7 8 9 10; do rm -f $d/w/f.ppm; OUT=$d/w timeout 300 node /home/claude/work/wasm/run_node.js /home/claude/work/wasm/tfx_web_audio.wasm --data-dir /data --mission=$m --flight-frames=100 --screenshot=/out/f.ppm >$d/log 2>&1; [ -f $d/w/f.ppm ] && break; done
if [ -f $d/n.ppm ] && [ -f $d/w/f.ppm ]; then cmp -s $d/n.ppm $d/w/f.ppm && st=IDENT || st=DIFF; elif [ ! -f $d/n.ppm ]; then st=NONATIVE; else st=NOWASM; fi
echo "$m $st" >> /tmp/mcmp/result.txt
