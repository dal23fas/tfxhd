import gzip,base64,sys
host=open('/home/claude/work/wasm/host/host.js').read()
wasm=open('/home/claude/work/wasm/tfx_web_audio.wasm','rb').read()
b64=base64.b64encode(gzip.compress(wasm,9)).decode()
t=open('/home/claude/work/wasm/host/template.html').read()
t=t.replace('/*HOST_JS*/',host.replace('</script','<\\/script')).replace('/*WASM_B64*/',b64)
open(sys.argv[1],'w').write(t); print(len(t)/1e6,'MB')
