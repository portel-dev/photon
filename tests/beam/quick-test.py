"""Quick debug test"""
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1400, "height": 900})

    print("Loading BEAM UI...")
    page.goto("http://localhost:4321")
    page.wait_for_load_state("networkidle")
    time.sleep(2)

    page.screenshot(path="/tmp/beam-visual-tests/debug-load.png")
    print("Screenshot saved: debug-load.png")

    # Check what's in the page
    print(f"Title: {page.title()}")
    sidebar = page.locator(".sidebar")
    if sidebar.is_visible():
        print("Sidebar is visible")
    else:
        print("Sidebar NOT visible")

    # List all text content
    all_text = page.locator("body").text_content()
    print(f"Page text (first 500 chars): {all_text[:500] if all_text else 'empty'}")

    browser.close()
