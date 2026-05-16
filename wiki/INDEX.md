# Photon Wiki

Architecture decisions, research findings, and system documentation.

## Index

| File | Topic |
|------|-------|
| [LLM-RUNTIME.md](LLM-RUNTIME.md) | Runtime playbook for LLM agents: UI bridge, tags, heartbeat contract, and reconnect/debug patterns |
| [daemon-architecture.md](daemon-architecture.md) | How Beam, CLI, and MCP stdio communicate through the single global daemon, including event replay, sendCommand retry behavior, and encrypted constructor-env replay for stateful daemon photons |
