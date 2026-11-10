import asyncio,sys
from playwright.async_api import async_playwright
D='/home/claude/work/tfx205/'; OUT='/home/claude/work/browser_test/'
name=sys.argv[1]; args=sys.argv[2]; keys=sys.argv[3] if len(sys.argv)>3 else ''
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg=await b.new_page(viewport={'width':1600,'height':1000}); logs=[]
        pg.on('console',lambda m:logs.append(m.text)); pg.on('pageerror',lambda e:logs.append('PAGEERROR '+str(e)))
        await pg.goto('file:///home/claude/work/wasm/tfx.html')
        await pg.set_input_files('#pick',[D+'TFX.DAT',D+'DID.DAT'])
        await pg.wait_for_function('!document.getElementById("start").disabled',timeout=60000)
        await pg.evaluate("void window.__tfxStart(%s)"%args); await asyncio.sleep(8)
        await pg.click('#bHD'); await asyncio.sleep(2)
        if keys:
            await pg.click('#cv')
            for k in keys.split(','):
                await pg.keyboard.press(k); await asyncio.sleep(4)
        await asyncio.sleep(2); await pg.screenshot(path=OUT+name+'.png')
        print('\n'.join(l for l in logs if 'GL Driver' not in l and 'Failed to load' not in l)[:1500]); await b.close()
asyncio.run(main())
