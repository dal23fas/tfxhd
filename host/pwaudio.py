import asyncio
from playwright.async_api import async_playwright
D='/home/claude/work/tfx205/'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        pg=await (await b.new_context(viewport={'width':1280,'height':800})).new_page()
        pg.on('console',lambda m:print('C:',m.text[:200]) if m.type in('error','warning') else None)
        await pg.goto('file:///home/claude/work/wasm/tfx.html')
        await pg.set_input_files('#pick',[D+'TFX.DAT',D+'DID.DAT'])
        await pg.wait_for_function('!document.getElementById("start").disabled',timeout=60000)
        await pg.evaluate("void window.__tfxStart(['--mission','501'])"); await asyncio.sleep(4)
        await pg.mouse.click(300,300)
        for i in range(4):
            await asyncio.sleep(3)
            print(await pg.evaluate("JSON.stringify(window.__game.audio.stats())"))
            await pg.keyboard.press('Space')
        await b.close()
asyncio.run(main())
