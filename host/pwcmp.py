import asyncio,sys
from playwright.async_api import async_playwright
D='/home/claude/work/tfx205/'; OUT='/home/claude/work/browser_test/'
args=sys.argv[1]; keys=sys.argv[2].split(',') if len(sys.argv)>2 and sys.argv[2] else []; tag=sys.argv[3]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg=await b.new_page(viewport={'width':1600,'height':1000})
        await pg.goto('file:///home/claude/work/wasm/tfx.html')
        await pg.set_input_files('#pick',[D+'TFX.DAT',D+'DID.DAT'])
        await pg.wait_for_function('!document.getElementById("start").disabled',timeout=60000)
        await pg.evaluate("void window.__tfxStart(%s)"%args); await asyncio.sleep(8)
        await pg.click('#cv')
        for k in keys: await pg.keyboard.press(k); await asyncio.sleep(3)
        await pg.keyboard.press('p'); await asyncio.sleep(1.5)
        await pg.screenshot(path=OUT+tag+'_classic.png')
        await pg.click('#bHD'); await asyncio.sleep(2.5)
        await pg.screenshot(path=OUT+tag+'_hd.png'); await b.close()
asyncio.run(main())
