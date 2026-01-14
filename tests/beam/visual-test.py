"""
BEAM UI Visual Testing Script

Captures screenshots of distinct BEAM features to verify they work correctly.
"""

from playwright.sync_api import sync_playwright
import os
import time

SCREENSHOTS_DIR = "/tmp/beam-visual-tests"

def ensure_dir():
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
    # Clear old screenshots
    for f in os.listdir(SCREENSHOTS_DIR):
        if f.endswith('.png'):
            os.remove(f"{SCREENSHOTS_DIR}/{f}")
    print(f"Screenshots will be saved to: {SCREENSHOTS_DIR}")

def test_beam_ui():
    ensure_dir()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        print("\n" + "="*60)
        print("BEAM UI Visual Testing")
        print("="*60)

        # 1. Load BEAM UI
        print("\n[1] Loading BEAM UI...")
        page.goto("http://localhost:4321")
        page.wait_for_load_state("networkidle")
        time.sleep(1.5)

        page.screenshot(path=f"{SCREENSHOTS_DIR}/01-initial-load.png")
        print("    ✓ Screenshot: 01-initial-load.png")

        # 2. Click on content-creator photon
        print("\n[2] Expanding content-creator photon...")
        cc_item = page.locator("text=content-creator").first
        if cc_item.is_visible():
            cc_item.click()
            time.sleep(0.5)
            page.screenshot(path=f"{SCREENSHOTS_DIR}/02-content-creator-expanded.png")
            print("    ✓ Screenshot: 02-content-creator-expanded.png")

        # 3. Click on research method (has form fields)
        print("\n[3] Testing 'research' method with input fields...")
        research_method = page.locator("text=research").first
        if research_method.is_visible():
            research_method.click()
            time.sleep(0.5)
            page.screenshot(path=f"{SCREENSHOTS_DIR}/03-research-method.png")
            print("    ✓ Screenshot: 03-research-method.png (form with inputs)")

            # Check input field styling
            inputs = page.locator("input[type='text'], input[type='number']").all()
            print(f"    Found {len(inputs)} input fields")

            if inputs:
                # Fill topic field
                for inp in inputs:
                    name = inp.get_attribute("name") or ""
                    if "topic" in name.lower():
                        inp.fill("Test Topic")
                        break

                time.sleep(0.3)
                page.screenshot(path=f"{SCREENSHOTS_DIR}/04-input-filled.png")
                print("    ✓ Screenshot: 04-input-filled.png (input with value)")

        # 4. Click on demo photon
        print("\n[4] Expanding demo photon...")
        demo_item = page.locator("text=demo").first
        if demo_item.is_visible():
            demo_item.click()
            time.sleep(0.5)
            page.screenshot(path=f"{SCREENSHOTS_DIR}/05-demo-expanded.png")
            print("    ✓ Screenshot: 05-demo-expanded.png")

        # 5. Test a simple method with JSON output
        print("\n[5] Testing JSON output (getConfig)...")
        config_method = page.locator("text=getConfig").first
        if config_method.is_visible():
            config_method.click()
            time.sleep(0.3)

            # Find and click Run button
            run_btn = page.locator("button:has-text('Run'), button:has-text('Execute'), button[type='submit']").first
            if run_btn.is_visible():
                run_btn.click()
                time.sleep(1.5)
                page.screenshot(path=f"{SCREENSHOTS_DIR}/06-json-execute-result.png")
                print("    ✓ Screenshot: 06-json-execute-result.png (Execute tab result)")

                # Switch to Data tab
                data_tab = page.locator("button:has-text('Data')").first
                if data_tab.is_visible():
                    data_tab.click()
                    time.sleep(0.5)
                    page.screenshot(path=f"{SCREENSHOTS_DIR}/07-data-tab-json.png")
                    print("    ✓ Screenshot: 07-data-tab-json.png (Data tab with JSON)")

                    # Check for syntax highlighting
                    json_keys = page.locator(".json-key").count()
                    json_strings = page.locator(".json-string").count()
                    json_bools = page.locator(".json-boolean").count()
                    print(f"    JSON syntax highlighting: {json_keys} keys, {json_strings} strings, {json_bools} booleans")

        # 6. Test table format
        print("\n[6] Testing table format (getUsers)...")
        users_method = page.locator("text=getUsers").first
        if users_method.is_visible():
            users_method.click()
            time.sleep(0.3)
            run_btn = page.locator("button:has-text('Run'), button[type='submit']").first
            if run_btn.is_visible():
                run_btn.click()
                time.sleep(1.5)
                page.screenshot(path=f"{SCREENSHOTS_DIR}/08-table-format.png")
                print("    ✓ Screenshot: 08-table-format.png")

        # 7. Test smart list rendering
        print("\n[7] Testing smart list (getSmartUsers)...")
        smart_method = page.locator("text=getSmartUsers").first
        if smart_method.is_visible():
            smart_method.click()
            time.sleep(0.3)
            run_btn = page.locator("button:has-text('Run'), button[type='submit']").first
            if run_btn.is_visible():
                run_btn.click()
                time.sleep(1.5)
                page.screenshot(path=f"{SCREENSHOTS_DIR}/09-smart-list.png")
                print("    ✓ Screenshot: 09-smart-list.png")

        # 8. Test card format
        print("\n[8] Testing card format (getProfile)...")
        profile_method = page.locator("text=getProfile").first
        if profile_method.is_visible():
            profile_method.click()
            time.sleep(0.3)
            run_btn = page.locator("button:has-text('Run'), button[type='submit']").first
            if run_btn.is_visible():
                run_btn.click()
                time.sleep(1.5)
                page.screenshot(path=f"{SCREENSHOTS_DIR}/10-card-format.png")
                print("    ✓ Screenshot: 10-card-format.png")

        # 9. Test markdown format
        print("\n[9] Testing markdown (getDocs)...")
        docs_method = page.locator("text=getDocs").first
        if docs_method.is_visible():
            docs_method.click()
            time.sleep(0.3)
            run_btn = page.locator("button:has-text('Run'), button[type='submit']").first
            if run_btn.is_visible():
                run_btn.click()
                time.sleep(1.5)
                page.screenshot(path=f"{SCREENSHOTS_DIR}/11-markdown-format.png")
                print("    ✓ Screenshot: 11-markdown-format.png")

        # 10. Test chips/tags
        print("\n[10] Testing chips (getTags)...")
        tags_method = page.locator("text=getTags").first
        if tags_method.is_visible():
            tags_method.click()
            time.sleep(0.3)
            run_btn = page.locator("button:has-text('Run'), button[type='submit']").first
            if run_btn.is_visible():
                run_btn.click()
                time.sleep(1.5)
                page.screenshot(path=f"{SCREENSHOTS_DIR}/12-chips-format.png")
                print("    ✓ Screenshot: 12-chips-format.png")

        # 11. Test mermaid diagram
        print("\n[11] Testing mermaid diagram...")
        diagram_method = page.locator("text=getDiagram").first
        if diagram_method.is_visible():
            diagram_method.click()
            time.sleep(0.3)
            run_btn = page.locator("button:has-text('Run'), button[type='submit']").first
            if run_btn.is_visible():
                run_btn.click()
                time.sleep(2)  # Mermaid needs extra time
                page.screenshot(path=f"{SCREENSHOTS_DIR}/13-mermaid-diagram.png")
                print("    ✓ Screenshot: 13-mermaid-diagram.png")

        # 12. Test method with parameters (greet)
        print("\n[12] Testing method with parameters (greet)...")
        greet_method = page.locator("text=greet").first
        if greet_method.is_visible():
            greet_method.click()
            time.sleep(0.3)
            page.screenshot(path=f"{SCREENSHOTS_DIR}/14-greet-form.png")
            print("    ✓ Screenshot: 14-greet-form.png")

            # Fill in the name field
            name_input = page.locator("input[name='name']").first
            if name_input.is_visible():
                name_input.fill("Claude")
                time.sleep(0.3)
                page.screenshot(path=f"{SCREENSHOTS_DIR}/15-greet-filled.png")
                print("    ✓ Screenshot: 15-greet-filled.png")

                # Execute
                run_btn = page.locator("button:has-text('Run'), button[type='submit']").first
                if run_btn.is_visible():
                    run_btn.click()
                    time.sleep(1)
                    page.screenshot(path=f"{SCREENSHOTS_DIR}/16-greet-result.png")
                    print("    ✓ Screenshot: 16-greet-result.png")

        browser.close()

    print("\n" + "="*60)
    print("Visual tests complete!")
    print("="*60)
    print(f"\nScreenshots saved to: {SCREENSHOTS_DIR}")
    print("\nFiles created:")
    for f in sorted(os.listdir(SCREENSHOTS_DIR)):
        if f.endswith('.png'):
            size = os.path.getsize(f"{SCREENSHOTS_DIR}/{f}")
            print(f"  - {f} ({size/1024:.1f} KB)")

if __name__ == "__main__":
    test_beam_ui()
