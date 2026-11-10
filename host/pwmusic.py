import asyncio
from playwright.async_api import async_playwright
D='/home/claude/work/tfx205/'; U='/mnt/user-data/uploads/'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        pg=await (await b.new_context(viewport={'width':1280,'height':800})).new_page()
        pg.on('console',lambda m:print('C:',m.text[:200]) if m.type in('error','warning') else None)
        await pg.goto('file:///home/claude/work/wasm/tfx.html')
        await pg.set_input_files('#pick',[D+'TFX.DAT',D+'DID.DAT',U+'df9279cb-TFX_v1_AIR_remaster.mp3',U+'5c22e85c-TFX_v1_Maritime_remaster.mp3'])
        await pg.wait_for_function('!document.getElementById("start").disabled',timeout=60000)
        print(await pg.evaluate("TFXHost.music.list()"))
        await pg.evaluate("void window.__tfxStart(['--mission','501'])"); await asyncio.sleep(5)
        print(await pg.evaluate("[TFXHost.music.el.paused,TFXHost.music.el.currentTime,TFXHost.music.el.duration,document.getElementById('bMus').textContent]"))
        await pg.click('#bMus'); await asyncio.sleep(2)
        print(await pg.evaluate("[TFXHost.music.idx,TFXHost.music.el.paused,TFXHost.music.el.currentTime,JSON.stringify(window.__game.audio.stats())]"))
        await b.close()
asyncio.run(main())
