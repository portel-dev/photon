"""Test Data tab JSON syntax highlighting"""
from playwright.sync_api import sync_playwright
import time

def test():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        print("Loading BEAM...")
        page.goto("http://localhost:3000")
        page.wait_for_load_state("networkidle")

        try:
            page.wait_for_selector("text=demo", timeout=15000)
        except:
            print("Timeout")
            return

        time.sleep(1)

        print("Clicking demo...")
        page.locator("text=demo").first.click()
        time.sleep(0.5)

        print("Clicking getObject...")
        page.locator("text=getObject").first.click()
        time.sleep(1)

        print("Clicking Data tab...")
        page.locator("div.tab:has-text('Data')").click()
        time.sleep(0.5)

        page.screenshot(path="/tmp/beam-visual-tests/data-tab-result.png")
        print("\nScreenshot: data-tab-result.png")
        browser.close()

if __name__ == "__main__":
    test()
