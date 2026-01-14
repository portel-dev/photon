"""Test JSON input for array parameters"""
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
            page.wait_for_selector("text=knowledge-graph", timeout=15000)
        except:
            print("Timeout - knowledge-graph not found")
            return

        time.sleep(1)

        print("Clicking knowledge-graph...")
        page.locator("text=knowledge-graph").first.click()
        time.sleep(0.5)

        print("Clicking entities...")
        page.locator("text=entities").first.click()
        time.sleep(1)

        page.screenshot(path="/tmp/beam-visual-tests/json-input.png")
        print("\nScreenshot: json-input.png")
        browser.close()

if __name__ == "__main__":
    test()
