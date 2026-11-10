import asyncio
from playwright.async_api import async_playwright
D='/home/claude/work/tfx205/'; OUT='/home/claude/work/browser_test/'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg=await b.new_page(viewport={'width':1600,'height':1000})
        logs=[]; pg.on('console',lambda m:logs.append(m.type+': '+m.text)); pg.on('pageerror',lambda e:logs.append('PAGEERROR: '+str(e)))
        await pg.goto('file:///home/claude/work/wasm/tfx.html')
        await pg.set_input_files('#pick',[D+'TFX.DAT',D+'DID.DAT'])
        await pg.wait_for_function('!document.getElementById("start").disabled',timeout=60000)
        await pg.evaluate("void window.__tfxStart(['--mission','501'])")
        await asyncio.sleep(10)
        await pg.screenshot(path=OUT+'6_classic_big.png')
        await pg.click('#bHD'); await asyncio.sleep(4)
        f0=await pg.evaluate('window.__game.state.frames'); await asyncio.sleep(3); f1=await pg.evaluate('window.__game.state.frames')
        print('HD fps ~',(f1-f0)/3)
        await pg.screenshot(path=OUT+'7_hd_big.png')
        await pg.click('#cv'); await pg.keyboard.down('Equal'); await asyncio.sleep(3); await pg.keyboard.up('Equal')
        await pg.keyboard.press('F5'); await asyncio.sleep(2); await pg.screenshot(path=OUT+'8_hd_chase.png')
        print('\n'.join(l for l in logs if 'GL Driver' not in l)[-1500:])
        await b.close()
asyncio.run(main())
