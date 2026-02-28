# Photon CSV Format Specification

**Version 1.0** — A backward-compatible extension to standard CSV that embeds column metadata in an optional format row.

## Overview

Photon CSV is standard RFC 4180 CSV with one addition: an optional **format row** as the first line that encodes column types, alignment, width, wrapping, and sort hints using a compact dash-based syntax inspired by Markdown table separators.

Any tool that reads standard CSV will simply see the format row as a regular data row with dashes — it degrades gracefully. Tools that understand the format row can extract rich column metadata without external schema files.

```
:---#:,:---:,:---M+:,:---$:
ID,Name,Description,Price
1,Widget,"A **useful** widget",9.99
2,Gadget,"A _fancy_ gadget",19.99
```

## Format Row Syntax

The format row is **row 0** (the very first line). The header row follows as **row 1**. If no format row is present, row 0 is treated as headers (standard CSV behavior).

### Detection

A row is a format row if **every cell** matches this pattern:

```
[<>]? :? -{2,} [type]? [modifiers]* :?
```

In regex: `/^[<>]?:?-{2,}[^,]*:?$/` (after stripping `+` modifiers)

### Cell Anatomy

```
  :---#w120+*:
  │ │  ││   ││
  │ │  ││   │└─ right/center align marker
  │ │  ││   └── required field
  │ │  ││ └──── wrap enabled
  │ │  │└────── width in pixels
  │ │  └─────── type indicator
  │ └────────── dashes (minimum 2)
  └──────────── left/center align marker
```

### Alignment

| Pattern | Alignment | Example |
|---------|-----------|---------|
| `:---` | Left (default) | `:---` |
| `---:` | Right | `---:` |
| `:---:` | Center | `:---:` |
| `---` | Left | `---` |

### Type Indicators

| Indicator | Type | Description |
|-----------|------|-------------|
| *(none)* | `text` | Plain text (default) |
| `#` | `number` | Numeric values |
| `$` | `currency` | Currency values |
| `%` | `percent` | Percentage values |
| `D` | `date` | Date values |
| `?` | `bool` | Boolean/checkbox |
| `=` | `select` | Single select from options |
| `~` | `formula` | Formula column |
| `M` | `markdown` | Inline markdown rendering |
| `T` | `longtext` | Long text with wrapping |

### Modifiers

| Modifier | Meaning | Example |
|----------|---------|---------|
| `w{N}` | Column width in pixels | `---#w120` = number, 120px wide |
| `+` | Enable text wrapping | `---M+` = markdown with wrap |
| `*` | Required field | `---#*` = required number |
| `>` (prefix) | Sort ascending | `>---#` = number, sort asc |
| `<` (prefix) | Sort descending | `<---$` = currency, sort desc |

Modifiers can be combined: `:---M+w200*:` = centered, markdown, wrapped, 200px, required.

## Examples

### Basic — Numbers and Currency

```csv
:---,:---#:,:---$:
Product,Quantity,Price
Widget,42,9.99
Gadget,17,24.50
```

### Rich — Mixed Types with Wrapping

```csv
:---,:---?,:---M+w300:,:---$:
Task,Done,Notes,Budget
Design,true,"**Phase 1** complete\nMoving to _phase 2_",5000
Backend,false,"`API` endpoints [spec](https://...)",8000
```

### Sorted — Pre-sorted Data

```csv
>---,:---#:
Name,Score
Alice,95
Bob,87
Charlie,72
```

## Visual Formulas

Cells can contain formula functions that render as visualizations instead of scalar values. These are standard cell values starting with `=`:

| Formula | Renders | Example |
|---------|---------|---------|
| `=PIE(labels, values)` | Pie chart overlay | `=PIE(A1:A5, B1:B5)` |
| `=BAR(labels, values)` | Bar chart overlay | `=BAR(A1:A5, B1:B5)` |
| `=LINE(labels, values)` | Line chart overlay | `=LINE(A1:A10, B1:B10)` |
| `=SPARKLINE(range)` | Inline sparkline | `=SPARKLINE(B1:B10)` |
| `=GAUGE(value, min, max)` | Gauge meter | `=GAUGE(B1, 0, 100)` |

Visual formulas are evaluated by the host application. In plain CSV readers, they appear as text (e.g., `=PIE(A1:A5, B1:B5)`). In Photon's spreadsheet UI, they render as interactive Chart.js overlays anchored to their cell.

## Scalar Formulas

Standard formulas evaluate to scalar values and are stored in cells with a `=` prefix:

| Formula | Description | Example |
|---------|-------------|---------|
| `=SUM(range)` | Sum of numbers | `=SUM(B1:B10)` |
| `=AVG(range)` | Average | `=AVG(B1:B10)` |
| `=MAX(range)` | Maximum | `=MAX(B1:B10)` |
| `=MIN(range)` | Minimum | `=MIN(B1:B10)` |
| `=COUNT(range)` | Count of numbers | `=COUNT(B1:B10)` |
| `=IF(cond, true, false)` | Conditional | `=IF(A1>10, "high", "low")` |
| `=LEN(text)` | String length | `=LEN(A1)` |
| `=ABS(number)` | Absolute value | `=ABS(A1)` |
| `=ROUND(number, digits)` | Round | `=ROUND(A1, 2)` |
| `=CONCAT(a, b, ...)` | Join strings | `=CONCAT(A1, " ", B1)` |

Cell references use A1 notation. Ranges use `A1:B2` notation. Column-only ranges (`A:B`) span all rows.

## Markdown in Cells

Cells in `markdown` (`M`) columns support inline Markdown:

| Syntax | Renders |
|--------|---------|
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `` `code` `` | `code` |
| `[text](url)` | [text](url) |
| `\n` | Line break |

Full block-level Markdown (headings, lists, tables) is not supported — cells use inline rendering only.

## Streaming

CSV files can be streamed append-only. The format row and header row are written once at the top; subsequent rows are appended. Consumers that understand the format can:

1. Read the format row to learn column metadata
2. Read the header row for column names
3. Tail the file for new rows (`tail -f` or `fs.watch`)

The Photon spreadsheet's `tail` command watches the physical file. For non-file streams, the `push` tool accepts rows programmatically and emits to all connected UIs in real-time.

## Compatibility

| Reader | Behavior |
|--------|----------|
| Standard CSV parser | Sees format row as data row with dashes — harmless |
| Excel / Google Sheets | Ignores format row (shows as text) |
| Photon Spreadsheet | Parses format row, applies formatting, renders visual formulas |
| pandas `read_csv` | `skiprows=[0]` to skip format row |

The format is designed to be **zero-cost to ignore** — any tool that doesn't understand it simply sees an extra row of dashes.

## MIME Type

Photon CSV files use the standard `text/csv` MIME type. The format row is detectable by content inspection, not by file extension or MIME type.

## Grammar (ABNF)

```abnf
format-row   = format-cell *("," format-cell)
format-cell  = [sort-prefix] [left-align] dashes [type] *modifier [right-align]

sort-prefix  = ">" / "<"
left-align   = ":"
right-align  = ":"
dashes       = 2*"-"
type         = "#" / "$" / "%" / "D" / "?" / "=" / "~" / "M" / "T"
modifier     = wrap / width / required
wrap         = "+"
width        = "w" 1*DIGIT
required     = "*"
```
