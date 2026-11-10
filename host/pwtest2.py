import asyncio, time
from playwright.async_api import async_playwright
D='/home/claude/work/tfx205/'; OUT='/home/claude/work/browser_test/'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
        pg=await b.new_page(viewport={'width':1280,'height':800})
        logs=[]; pg.on('console',lambda m:logs.append(m.type+': '+m.text)); pg.on('pageerror',lambda e:logs.append('PAGEERROR: '+str(e)))
        await pg.goto('file:///home/claude/work/wasm/tfx.html')
        await pg.set_input_files('#pick',[D+'TFX.DAT',D+'DID.DAT'])
        await pg.wait_for_function('!document.getElementById("start").disabled',timeout=60000)
        await pg.evaluate("void window.__tfxStart(['--mission','501'])")
        await asyncio.sleep(10)
        await pg.screenshot(path=OUT+'2_classic.png')
        await pg.click('#bRemaster'); await asyncio.sleep(1.5)
        await pg.screenshot(path=OUT+'3_remaster.png')
        await pg.click('#bClassic'); await pg.click('#cv')
        # thrust + pitch via keyboard, see state change
        await pg.keyboard.down('Equal'); await asyncio.sleep(4); await pg.keyboard.up('Equal')
        await pg.keyboard.down('ArrowUp'); await asyncio.sleep(1.5); await pg.keyboard.up('ArrowUp')
        await pg.screenshot(path=OUT+'4_after_keys.png')
        await pg.keyboard.press('F5'); await asyncio.sleep(2); await pg.screenshot(path=OUT+'5_chase.png')
        print('frames',await pg.evaluate('window.__game.state.frames'))
        print('\n'.join(logs[-15:]))
        await b.close()
asyncio.run(main())
