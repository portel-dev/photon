"""Debug test to capture browser console output"""
from playwright.sync_api import sync_playwright
import time

def test_debug():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        # Capture console messages
        console_messages = []
        page.on("console", lambda msg: console_messages.append(f"[{msg.type}] {msg.text}"))

        print("Loading BEAM UI...")
        page.goto("http://localhost:3000")
        page.wait_for_load_state("networkidle")

        # Wait for photons to load
        print("Waiting for photons...")
        try:
            page.wait_for_selector("text=demo", timeout=15000)
        except:
            print("Timeout waiting for demo photon")
            print("\nConsole messages so far:")
            for msg in console_messages:
                print(f"  {msg}")
            browser.close()
            return

        time.sleep(1)

        # Click demo
        print("Clicking demo...")
        page.locator("text=demo").first.click()
        time.sleep(0.5)

        # Click getObject
        print("Clicking getObject...")
        page.locator("text=getObject").first.click()
        time.sleep(2)

        # Print all console messages
        print("\n" + "="*60)
        print("BROWSER CONSOLE OUTPUT:")
        print("="*60)
        for msg in console_messages:
            print(msg)

        # Take screenshot
        page.screenshot(path="/tmp/beam-visual-tests/debug-result.png")
        print("\nScreenshot saved: /tmp/beam-visual-tests/debug-result.png")

        browser.close()

if __name__ == "__main__":
    test_debug()
