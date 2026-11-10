# Notice
This repository contains only original glue code (browser host, build script, tests) and a patch for
Lost-Engines/tfx-cpp (commit 9459601). It contains no TFX game data, no music and no compiled game.
tfx-cpp has no licence file at its repository root (only NOTICE.md); obtain it from its upstream and respect its terms.
You must supply your own TFX.DAT and DID.DAT (CD 2.05). Keep this repository private unless the upstream terms allow otherwise.
Build: apply patches/tfx-web-port.patch to tfx-cpp, build with wasi-sdk 34 (see README.md), then run host/build_html.py.
