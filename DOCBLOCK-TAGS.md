# Supported Docblock Tags

Photon uses JSDoc-style docblock tags to extract metadata, configure tools, and generate documentation. This page lists all supported tags, their placement, and usage.

| Tag | Level | Usage | Example |
|---|---|---|---|
| `@version` | `class` | Specifies the version of the Photon. Defaults to current Photon runtime version if omitted. | `* @version 1.0.0` |
| `@author` | `class` | Specifies the author of the Photon. | `* @author Jane Doe` |
| `@description` | `class` | (Implicit) The first paragraph of the class-level JSDoc is used as the Photon description. | `/** \n * My Tool - Description here \n */` |
| `@license` | `class` | Specifies the license of the Photon. | `* @license MIT` |
| `@repository` | `class` | Direct link to the source repository. | `* @repository https://github.com/user/repo` |
| `@homepage` | `class` | Direct link to the project homepage. | `* @homepage https://example.com` |
| `@dependencies` | `class` | Lists NPM dependencies to be auto-installed on first run. | `* @dependencies axios@^1.0.0, lodash` |
| `@mcps` | `class` | Lists MCP dependencies (used for diagram generation). | `* @mcps filesystem, git` |
| `@photons` | `class` | Lists Photon dependencies (used for diagram generation). | `* @photons calculator` |
| `@stateful` | `class` | Set to `true` if the Photon maintains state between calls (used for workflows). | `* @stateful true` |
| `@idleTimeout` | `class` | Specifies the idle timeout in milliseconds before the Photon process is terminated. | `* @idleTimeout 300000` |
| `@param` | `method` | Describes a tool parameter. Photon extracts the description for MCP/CLI help. | `* @param name User name` |
| `@example` | `method` | Provides a code example for using the tool. Used in documentation generation. | `* @example \n * await tool.greet({ name: 'World' })` |
| `@format` | `method` | Hints the output format for the CLI and Web interfaces. | `* @format table` |
| `@ui` | `method` | Links a tool method to a UI template defined at the class level. | `* @ui my-view` |
| `@mcp` | `class` | Declares an MCP dependency for injection into the constructor. | `* @mcp fs filesystem` |
| `@photon` | `class` | Declares a Photon dependency for injection into the constructor. | `* @photon auth auth-service` |
| `@ui` | `class` | Defines a UI template asset for MCP Apps. | `* @ui my-view ./ui/view.html` |
| `@prompt` | `class` | Defines a static prompt asset. | `* @prompt greet ./prompts/greet.txt` |
| `@resource` | `class` | Defines a static resource asset. | `* @resource data ./data.json` |
| `{@min N}` | `param` | Defines the minimum value for a numeric parameter. | `* @param age Age {@min 0}` |
| `{@max N}` | `param` | Defines the maximum value for a numeric parameter. | `* @param score Score {@max 100}` |
| `{@format type}` | `param` | Defines the data format (e.g., `email`, `uuid`, `date-time`) for validation. | `* @param email Email {@format email}` |
| `{@pattern regex}` | `param` | Defines a regex pattern the parameter must match. | `* @param zip Zip code {@pattern ^[0-9]{5}$}` |
| `{@example value}` | `param` | Provides a specific example value for a parameter. | `* @param city City {@example London}` |

## Return Format Values (`@format`)

The `@format` tag supports structural, content, and code formatting hints:

| Type | Values | Description |
|---|---|---|
| **Structural** | `primitive`, `table`, `tree`, `list`, `none` | Hints at the data shape (literal, array of objects, hierarchy, etc.) |
| **Content** | `json`, `markdown`, `yaml`, `xml`, `html` | Specifies the syntax for highlighting or rendering. |
| **Code** | `code`, `code:lang` | Renders output as a code block (e.g., `code:javascript`). |

## Note on Formatting
- **Class-level tags** must be placed in the main JSDoc comment at the top of your `.photon.ts` file.
- **Method-level tags** must be placed in the JSDoc comment immediately preceding the tool method.
- **Inline tags** are placed within the `@param` description text and are used to add validation constraints or example values.
