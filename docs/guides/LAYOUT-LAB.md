# Photon Layout Lab

Photon's visual formats are rendered by the same standalone renderer in a
custom Photon UI, Beam, and an MCP App. The Layout Lab composes those real
renderers in plain HTML and checks the resulting geometry in Chromium. This
keeps layout feedback local and deterministic; Cloudflare is only needed for
the final deployment smoke test.

## Run it

```bash
bun run test:layout-lab
```

The command builds Photon first, then renders representative compositions at
320, 480, and 768 pixels in both light and dark themes. It writes an ignored
artifact directory:

```text
artifacts/layout-lab/
  index.html             # human gallery; click a screenshot to enlarge it
  manifest.json          # deterministic measurements and failures
  llm-review-input.json  # screenshots + measurements for advisory review
  screenshots/
```

Open `artifacts/layout-lab/index.html` locally after the run. No Beam server,
network access, or Cloudflare deployment is required.

## What is checked

The machine gate checks every generated composition for:

- non-zero visible nodes;
- no horizontal overflow at the selected viewport;
- children staying inside their parent width;
- no sibling overlap;
- declared stack/grid gaps being preserved.

The fixture set includes a consultation-style search result, a nested
dashboard, and a grid containing every format in `FORMAT_CATALOG`. A format
example is passed through the real renderer; the lab does not replace the
renderer with test-only markup.

The `llm-review-input.json` file is intentionally advisory. An image-capable
reviewer can use it to comment on hierarchy, density, alignment, clipping,
contrast, and perceived polish. CI should gate on the deterministic manifest;
LLM observations should become a fixture or geometry assertion before they
become a release blocker.

## Narrow or expand the loop

```bash
PHOTON_LAYOUT_VIEWPORTS=360,680 bun run test:layout-lab
PHOTON_LAYOUT_THEMES=dark bun run test:layout-lab
PHOTON_LAYOUT_ARTIFACT_DIR=/tmp/photon-layout-lab bun run test:layout-lab
```

When adding or changing a visual component, add a composition that places it
next to the components it is likely to interact with. This catches the class
of bugs that isolated renderer tests miss: flex direction changes, grid items
touching, content escaping a card, and controls whose native affordance is
misaligned.
