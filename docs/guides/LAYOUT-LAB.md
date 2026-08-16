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
  manifest.json          # deterministic measurements, failures, provenance
  llm-review-input.json  # screenshots + measurements for advisory review
  screenshots/
```

Open `artifacts/layout-lab/index.html` locally after the run. No Beam server,
network access, or Cloudflare deployment is required.

## What is checked

The fixtures use the shared Photon style contract from
`src/auto-ui/style-contract.ts`: `--photon-*` tokens plus the layout primitives
`photon-stack`, `photon-grid`, `photon-split`, `photon-cluster`, and
`photon-surface`. The standalone renderer installs the same contract in custom
UI and MCP App iframes, and Beam imports it into its Lit theme. That keeps the
lab aligned with the real runtime instead of testing a separate CSS island.

The machine gate checks every generated composition for:

- non-zero visible nodes;
- no horizontal overflow at the selected viewport;
- no clipped vertical overflow inside constrained containers;
- children staying inside their parent width;
- children staying inside their parent height;
- no sibling overlap;
- declared stack/grid gaps being preserved.

The fixture set includes a consultation-style search result, a nested
dashboard, the canonical Photon form bundle (including date and numeric
stepper controls), and a grid containing every format in `FORMAT_CATALOG`. A
format example is passed through the real renderer and forms use the real
`invoke-form` custom element; the lab does not replace the runtime with
test-only markup. The form fixture waits for Lit readiness, checks its custom
controls, runs required-field validation, and verifies a valid submit payload.

The manifest records the source commit (including a `-dirty` suffix for
uncommitted changes), browser version, Node version, relative screenshot paths,
and every check result. Old screenshots are removed before each run.

The `llm-review-input.json` file is intentionally advisory and does not mark a
scenario approved. An image-capable reviewer can use it to comment on
hierarchy, density, alignment, clipping, contrast, and perceived polish. CI
gates on the deterministic manifest; LLM observations should become a fixture
or geometry assertion before they become a release blocker.

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

If a layout issue points to a missing primitive, fix it in the style contract
first and then consume that primitive from the renderer or Beam component. Avoid
adding one-off layout CSS inside a single format unless the behavior is truly
specific to that format.
