#!/bin/bash
# README Validation Test Suite
# Tests all claims and examples from README.md

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counter
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Get repository root early before changing directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXAMPLES_DIR="$REPO_ROOT/examples"

# Test working directory
TEST_DIR="/tmp/photon-test-$$"
mkdir -p "$TEST_DIR"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Photon README Validation Test Suite${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# Helper functions
test_start() {
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -e "\n${YELLOW}[TEST $TESTS_RUN]${NC} $1"
}

test_pass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "  ${GREEN}✓ PASS${NC} $1"
}

test_fail() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo -e "  ${RED}✗ FAIL${NC} $1"
}

# Get photon command (either global or local)
PHOTON_CMD="node dist/cli.js"
if command -v photon &> /dev/null; then
    PHOTON_CMD="photon"
fi

echo -e "${BLUE}Using command:${NC} $PHOTON_CMD\n"

# ============================================================================
# SECTION 1: Installation & Help
# ============================================================================

test_start "photon --help should display help"
if $PHOTON_CMD --help > /dev/null 2>&1; then
    test_pass "Help command works"
else
    test_fail "Help command failed"
fi

test_start "photon --version should display version"
if $PHOTON_CMD --version > /dev/null 2>&1; then
    VERSION=$($PHOTON_CMD --version 2>&1)
    test_pass "Version command works: $VERSION"
else
    test_fail "Version command failed"
fi

# ============================================================================
# SECTION 2: Quick Start - Init Command
# ============================================================================

# Note: photon init creates files in ~/.photon/ by default, not current directory
# Clean up any existing test file first
rm -f ~/.photon/test-readme-calc.photon.ts

test_start "photon init should create .photon.ts file in ~/.photon/"
if $PHOTON_CMD init test-readme-calc > /dev/null 2>&1; then
    if [ -f ~/.photon/test-readme-calc.photon.ts ]; then
        test_pass "test-readme-calc.photon.ts created in ~/.photon/"
    else
        test_fail "test-readme-calc.photon.ts not found in ~/.photon/"
    fi
else
    test_fail "init command failed"
fi

test_start "Created .photon.ts should contain class definition"
if [ -f ~/.photon/test-readme-calc.photon.ts ]; then
    if grep -q "class.*{" ~/.photon/test-readme-calc.photon.ts; then
        test_pass "Contains class definition"
    else
        test_fail "Does not contain class definition"
    fi
fi

test_start "Created .photon.ts should contain async method"
if [ -f ~/.photon/test-readme-calc.photon.ts ]; then
    if grep -q "async" ~/.photon/test-readme-calc.photon.ts; then
        test_pass "Contains async method"
    else
        test_fail "Does not contain async method"
    fi
fi

test_start "photon init with --working-dir should create file in custom directory"
cd "$TEST_DIR"
if $PHOTON_CMD --working-dir "$TEST_DIR" init local-calc > /dev/null 2>&1; then
    if [ -f "$TEST_DIR/local-calc.photon.ts" ]; then
        test_pass "File created in custom working directory"
    else
        test_fail "File not created in custom directory"
    fi
else
    test_fail "init with --working-dir failed"
fi

# ============================================================================
# SECTION 3: Validation Command
# ============================================================================

test_start "photon validate should validate successfully"
if $PHOTON_CMD validate test-readme-calc > /dev/null 2>&1; then
    test_pass "Validation successful"
else
    test_fail "Validation failed"
fi

test_start "photon --working-dir validate should work"
if $PHOTON_CMD --working-dir "$TEST_DIR" validate local-calc > /dev/null 2>&1; then
    test_pass "Validation with working-dir successful"
else
    test_fail "Validation with working-dir failed"
fi

# ============================================================================
# SECTION 4: Get Commands
# ============================================================================

test_start "photon get should list Photons"
if $PHOTON_CMD get > /dev/null 2>&1; then
    OUTPUT=$($PHOTON_CMD get 2>&1)
    if echo "$OUTPUT" | grep -q "test-readme-calc"; then
        test_pass "Lists test-readme-calc Photon"
    else
        test_fail "Does not list test-readme-calc"
    fi
else
    test_fail "get command failed"
fi

test_start "photon get <name> should show details"
if $PHOTON_CMD get test-readme-calc > /dev/null 2>&1; then
    OUTPUT=$($PHOTON_CMD get test-readme-calc 2>&1)
    if echo "$OUTPUT" | grep -qi "tool\|method"; then
        test_pass "Shows photon details"
    else
        test_fail "Does not show details"
    fi
else
    test_fail "get <name> failed"
fi

test_start "photon get <name> --mcp should generate config"
if OUTPUT=$($PHOTON_CMD get test-readme-calc --mcp 2>&1); then
    if echo "$OUTPUT" | grep -q "mcpServers"; then
        test_pass "Generates MCP config with mcpServers"
    else
        test_fail "MCP config missing mcpServers"
    fi
    if echo "$OUTPUT" | grep -q "test-readme-calc"; then
        test_pass "Config includes photon name"
    else
        test_fail "Config missing photon name"
    fi
else
    test_fail "get --mcp command failed"
fi

test_start "photon get --mcp should generate config for all Photons"
if OUTPUT=$($PHOTON_CMD get --mcp 2>&1); then
    if echo "$OUTPUT" | grep -q "mcpServers"; then
        test_pass "Generates config for all"
    else
        test_fail "Config generation failed"
    fi
else
    test_fail "get --mcp failed"
fi

# ============================================================================
# SECTION 5: Working Directory Flag
# ============================================================================

test_start "photon --working-dir should work with custom directory"
CUSTOM_DIR="$TEST_DIR/custom-mcps"
mkdir -p "$CUSTOM_DIR"
if $PHOTON_CMD --working-dir "$CUSTOM_DIR" init test-mcp > /dev/null 2>&1; then
    if [ -f "$CUSTOM_DIR/test-mcp.photon.ts" ]; then
        test_pass "Created file in custom directory"
    else
        test_fail "File not in custom directory"
    fi
else
    test_fail "Working directory flag failed"
fi

# ============================================================================
# SECTION 6: Examples - Test All Example MCPs
# ============================================================================

if [ -d "$EXAMPLES_DIR" ]; then
    test_start "Example: math.photon.ts should validate"
    if [ -f "$EXAMPLES_DIR/math.photon.ts" ]; then
        if $PHOTON_CMD --working-dir "$EXAMPLES_DIR" validate math > /dev/null 2>&1; then
            test_pass "math example validates"
        else
            test_fail "math example validation failed"
        fi
    else
        test_fail "math.photon.ts not found"
    fi

    test_start "Example: text.photon.ts should validate"
    if [ -f "$EXAMPLES_DIR/text.photon.ts" ]; then
        if $PHOTON_CMD --working-dir "$EXAMPLES_DIR" validate text > /dev/null 2>&1; then
            test_pass "text example validates"
        else
            test_fail "text example validation failed"
        fi
    else
        test_fail "text.photon.ts not found"
    fi

    test_start "Example: workflow.photon.ts should validate"
    if [ -f "$EXAMPLES_DIR/workflow.photon.ts" ]; then
        if $PHOTON_CMD --working-dir "$EXAMPLES_DIR" validate workflow > /dev/null 2>&1; then
            test_pass "workflow example validates"
        else
            test_fail "workflow example validation failed"
        fi
    else
        test_fail "workflow.photon.ts not found"
    fi

    test_start "Example: content.photon.ts should validate"
    if [ -f "$EXAMPLES_DIR/content.photon.ts" ]; then
        if $PHOTON_CMD --working-dir "$EXAMPLES_DIR" validate content > /dev/null 2>&1; then
            test_pass "content example validates"
        else
            test_fail "content example validation failed"
        fi
    else
        test_fail "content.photon.ts not found"
    fi
else
    test_fail "Examples directory not found at $EXAMPLES_DIR"
fi

# ============================================================================
# SECTION 7: Marketplace Commands
# ============================================================================

test_start "photon marketplace list should work"
if $PHOTON_CMD marketplace list > /dev/null 2>&1; then
    test_pass "marketplace list works"
else
    test_fail "marketplace list failed"
fi

test_start "photon search should accept queries"
if $PHOTON_CMD search test > /dev/null 2>&1; then
    test_pass "search command works"
else
    test_fail "search command failed"
fi

# ============================================================================
# SECTION 8: Constructor Environment Variable Mapping
# ============================================================================

test_start "Constructor parameters should map to environment variables"
cat > "$TEST_DIR/config-test.photon.ts" <<'EOF'
export default class ConfigTest {
  constructor(
    private apiKey: string,
    private baseUrl: string = "https://api.example.com"
  ) {}

  async test(params: {}) {
    return { apiKey: this.apiKey, baseUrl: this.baseUrl };
  }
}
EOF

if $PHOTON_CMD --working-dir "$TEST_DIR" validate config-test > /dev/null 2>&1; then
    OUTPUT=$($PHOTON_CMD --working-dir "$TEST_DIR" get config-test 2>&1)
    if echo "$OUTPUT" | grep -q "CONFIG_TEST_API_KEY"; then
        test_pass "Env var CONFIG_TEST_API_KEY detected"
    else
        test_fail "Env var mapping failed"
    fi
else
    test_fail "Config test validation failed"
fi

# ============================================================================
# SECTION 9: Type Extraction from TypeScript
# ============================================================================

test_start "Schema extraction should handle complex types"
cat > "$TEST_DIR/types-test.photon.ts" <<'EOF'
export default class TypesTest {
  /**
   * Test complex types
   * @param name User name
   * @param age User age
   * @param tags Array of tags
   */
  async complexTypes(params: {
    name: string;
    age: number;
    tags: string[];
    optional?: boolean;
  }) {
    return params;
  }
}
EOF

if $PHOTON_CMD --working-dir "$TEST_DIR" validate types-test > /dev/null 2>&1; then
    # Validation success means types were extracted correctly
    test_pass "Complex types validated successfully"

    # Verify the tool shows up
    OUTPUT=$($PHOTON_CMD --working-dir "$TEST_DIR" get types-test 2>&1)
    if echo "$OUTPUT" | grep -q "complexTypes"; then
        test_pass "Complex type tool detected"
    else
        test_fail "Tool not detected"
    fi
else
    test_fail "Types test validation failed"
fi

# ============================================================================
# SECTION 10: JSDoc Descriptions
# ============================================================================

test_start "JSDoc descriptions should be extracted"
if $PHOTON_CMD --working-dir "$TEST_DIR" get types-test > /dev/null 2>&1; then
    OUTPUT=$($PHOTON_CMD --working-dir "$TEST_DIR" get types-test 2>&1)
    if echo "$OUTPUT" | grep -q "Test complex types"; then
        test_pass "Tool description extracted from JSDoc"
    else
        test_fail "JSDoc description not extracted"
    fi
else
    test_fail "JSDoc test failed"
fi

# ============================================================================
# SECTION 11: Private Methods (should not become tools)
# ============================================================================

test_start "Private methods (starting with _) should not be tools"
cat > "$TEST_DIR/private-test.photon.ts" <<'EOF'
export default class PrivateTest {
  async publicTool(params: {}) {
    return this._helperMethod();
  }

  async _helperMethod() {
    return "private";
  }
}
EOF

if $PHOTON_CMD --working-dir "$TEST_DIR" validate private-test > /dev/null 2>&1; then
    OUTPUT=$($PHOTON_CMD --working-dir "$TEST_DIR" get private-test 2>&1)
    if echo "$OUTPUT" | grep -q "publicTool" && ! echo "$OUTPUT" | grep -q "_helperMethod"; then
        test_pass "Private method excluded from tools"
    else
        test_fail "Private method handling incorrect"
    fi
else
    test_fail "Private method test validation failed"
fi

# ============================================================================
# SECTION 12: Return Value Formats
# ============================================================================

test_start "Different return value formats should be supported"
cat > "$TEST_DIR/return-test.photon.ts" <<'EOF'
export default class ReturnTest {
  async stringReturn(params: {}) {
    return "string result";
  }

  async objectReturn(params: {}) {
    return { result: 42, status: "ok" };
  }

  async successReturn(params: {}) {
    return { success: true, content: "success" };
  }
}
EOF

if $PHOTON_CMD --working-dir "$TEST_DIR" validate return-test > /dev/null 2>&1; then
    OUTPUT=$($PHOTON_CMD --working-dir "$TEST_DIR" get return-test 2>&1)
    if echo "$OUTPUT" | grep -q "stringReturn" && \
       echo "$OUTPUT" | grep -q "objectReturn" && \
       echo "$OUTPUT" | grep -q "successReturn"; then
        test_pass "All return format methods detected"
    else
        test_fail "Return format detection incomplete"
    fi
else
    test_fail "Return test validation failed"
fi

# ============================================================================
# Cleanup
# ============================================================================

cd /
rm -rf "$TEST_DIR"
rm -f ~/.photon/test-readme-calc.photon.ts

# ============================================================================
# Summary
# ============================================================================

echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Test Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

echo -e "  Total Tests:  $TESTS_RUN"
echo -e "  ${GREEN}Passed:       $TESTS_PASSED${NC}"

if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "  ${RED}Failed:       $TESTS_FAILED${NC}\n"
    exit 1
else
    echo -e "  ${RED}Failed:       $TESTS_FAILED${NC}\n"
    echo -e "${GREEN}✓ All README claims validated successfully!${NC}\n"
    exit 0
fi
