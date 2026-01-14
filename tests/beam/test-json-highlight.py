"""Quick test for JSON syntax highlighting in Data tab"""

from playwright.sync_api import sync_playwright
import time

def test_json_highlight():
    with sync_playwright() as p:
        # Try non-headless to debug WebSocket issues
        browser = p.chromium.launch(headless=False)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        print("Loading BEAM UI...")
        page.goto("http://localhost:4321")
        page.wait_for_load_state("networkidle")

        # Wait longer for WebSocket to connect and load photons
        print("Waiting for photon list to load...")
        try:
            page.wait_for_selector(".photon-item, text=demo", timeout=15000)
            print("  Photon list loaded!")
        except:
            print("  Timeout waiting for photon list, taking screenshot...")
            page.screenshot(path="/tmp/beam-visual-tests/load-timeout.png")
            print("  Screenshot saved: load-timeout.png")
            browser.close()
            return

        page.screenshot(path="/tmp/beam-visual-tests/loaded.png")

        # Click demo photon
        print("Clicking demo photon...")
        page.locator("text=demo").first.click()
        time.sleep(0.5)

        # Click getObject method (returns JSON)
        print("Clicking getObject method...")
        page.wait_for_selector("text=getObject", timeout=5000)
        page.locator("text=getObject").first.click()
        time.sleep(1)  # Wait for auto-run (no params)

        # Take Execute tab screenshot
        page.screenshot(path="/tmp/beam-visual-tests/json-execute-tab.png")
        print("Screenshot: json-execute-tab.png (Execute tab)")

        # Click Data tab - it's a div with data-tab="data", not a button
        print("Clicking Data tab...")
        data_tab = page.locator("div.tab[data-tab='data'], .tab:has-text('Data')").first
        if data_tab.is_visible():
            print("  Found Data tab!")
            data_tab.click()
            time.sleep(0.5)
        else:
            print("  Data tab not found with specific selector")

        page.screenshot(path="/tmp/beam-visual-tests/json-data-tab.png")
        print("Screenshot: json-data-tab.png (Data tab)")

        # Check for syntax highlighting
        json_keys = page.locator(".json-key").count()
        json_strings = page.locator(".json-string").count()
        json_numbers = page.locator(".json-number").count()
        json_bools = page.locator(".json-boolean").count()

        print(f"\nJSON Syntax Highlighting Check:")
        print(f"  - Keys (.json-key): {json_keys}")
        print(f"  - Strings (.json-string): {json_strings}")
        print(f"  - Numbers (.json-number): {json_numbers}")
        print(f"  - Booleans (.json-boolean): {json_bools}")

        total = json_keys + json_strings + json_numbers + json_bools
        if total > 0:
            print(f"\n✅ JSON syntax highlighting is working! ({total} highlighted elements)")
        else:
            print("\n❌ JSON syntax highlighting NOT detected")
            # Debug: Get the data-content element
            data_content = page.locator("#data-content").first
            if data_content.is_visible():
                html = data_content.inner_html()
                print(f"\nData content HTML (visible):")
                print(html[:500] if len(html) > 500 else html)
            else:
                print("\n#data-content is not visible")

        browser.close()

if __name__ == "__main__":
    test_json_highlight()
