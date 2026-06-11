# Photon Wiki

Architecture decisions, research findings, and system documentation.

## Index

| File | Topic |
|------|-------|
| [LLM-RUNTIME.md](LLM-RUNTIME.md) | Runtime playbook for LLM agents: UI bridge, tags, heartbeat contract, and reconnect/debug patterns |
| [daemon-architecture.md](daemon-architecture.md) | How Beam, CLI, and MCP stdio communicate through the single global daemon, including event replay, sendCommand retry behavior, and encrypted constructor-env replay for stateful daemon photons |
| [conformance-and-enforcement.md](conformance-and-enforcement.md) | Structural guarantees: schema-driven cross-transport conformance matrix, unified tools/call handling, closed format registry, explicit-baseDir lint enforcement, always-inject capability policy |
