import gzip,base64,sys
host=open(sys.argv[3] if len(sys.argv)>3 else 'host/host.js').read()
wasm=open(sys.argv[2] if len(sys.argv)>2 else 'tfx_web.wasm','rb').read()
b64=base64.b64encode(gzip.compress(wasm,9)).decode()
t=open(sys.argv[4] if len(sys.argv)>4 else 'host/template.html').read()
t=t.replace('/*HOST_JS*/',host.replace('</script','<\\/script')).replace('/*WASM_B64*/',b64)
open(sys.argv[1],'w').write(t); print(len(t)/1e6,'MB')
