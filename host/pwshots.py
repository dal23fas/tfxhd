import asyncio,sys
from playwright.async_api import async_playwright
D='/home/claude/work/tfx205/'; OUT='/home/claude/work/browser_test/'; tag=sys.argv[1]; html=sys.argv[2] if len(sys.argv)>2 else '/home/claude/work/wasm/tfx.html'
MISSION=sys.argv[3] if len(sys.argv)>3 else '501'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg=await (await b.new_context(viewport={'width':1280,'height':800})).new_page()
        pg.on('console',lambda m:print('C:',m.text[:200]) if m.type in ('error','log') else None)
        await pg.goto('file://'+html)
        await pg.set_input_files('#pick',[D+'TFX.DAT',D+'DID.DAT'])
        await pg.wait_for_function('!document.getElementById("start").disabled',timeout=60000)
        await pg.evaluate("void window.__tfxStart(['--mission','%s'])"%MISSION); await asyncio.sleep(7)
        await pg.click('#bHD'); await pg.click('#cv'); await asyncio.sleep(3)
        await pg.screenshot(path=OUT+f'{tag}_cockpit.png')
        await pg.keyboard.press('F5'); await asyncio.sleep(3)
        await pg.screenshot(path=OUT+f'{tag}_chase.png')
        await pg.keyboard.press('F6'); await asyncio.sleep(4)
        await pg.screenshot(path=OUT+f'{tag}_flypast.png')
        await b.close()
asyncio.run(main())
