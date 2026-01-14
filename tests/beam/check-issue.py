"""Check current state of BEAM UI"""
from playwright.sync_api import sync_playwright
import time

def test():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        console_msgs = []
        page.on("console", lambda msg: console_msgs.append(f"[{msg.type}] {msg.text}"))

        print("Loading BEAM...")
        page.goto("http://localhost:3000")
        page.wait_for_load_state("networkidle")

        try:
            page.wait_for_selector("text=demo", timeout=15000)
        except:
            print("Timeout - photons not loaded")
            return

        time.sleep(1)

        print("Clicking demo...")
        page.locator("text=demo").first.click()
        time.sleep(0.5)

        print("Clicking getObject...")
        page.locator("text=getObject").first.click()
        time.sleep(2)

        print("\nConsole output:")
        for msg in console_msgs:
            print(msg)

        page.screenshot(path="/tmp/beam-visual-tests/current-state.png")
        print("\nScreenshot: current-state.png")
        browser.close()

if __name__ == "__main__":
    test()
