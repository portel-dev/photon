"""Test content-creator.research() rendering"""
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
            page.wait_for_selector("text=content-creator", timeout=15000)
        except:
            print("Timeout - photons not loaded")
            return

        time.sleep(1)

        print("Clicking content-creator...")
        page.locator("text=content-creator").first.click()
        time.sleep(0.5)

        print("Clicking research...")
        page.locator("text=research").first.click()
        time.sleep(0.5)

        # Fill in topic
        topic_input = page.locator("input").first
        if topic_input.is_visible():
            topic_input.fill("AI testing")
            time.sleep(0.3)

        # Click run button
        run_btn = page.locator("button:has-text('Research')").first
        if run_btn.is_visible():
            run_btn.click()
            print("Executing research...")
            time.sleep(5)  # Wait for execution

        print("\nConsole output:")
        for msg in console_msgs:
            if "renderSmartResult" in msg or "format" in msg.lower():
                print(msg)

        page.screenshot(path="/tmp/beam-visual-tests/research-result.png")
        print("\nScreenshot: research-result.png")
        browser.close()

if __name__ == "__main__":
    test()
