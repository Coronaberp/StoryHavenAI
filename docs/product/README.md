# Product research

Structured competitive comparisons, written by the `/product-lens` skill (`.claude/skills/product-lens/SKILL.md`, not git-tracked). One file per feature area, e.g. `memory-and-retrieval.md`, `onboarding.md`, `moderation.md`.

## Convention

Each file compares StoryHaven's approach to a feature area against comparable platforms across the same fixed set of dimensions: UX, architecture, memory/retrieval, onboarding, business model, and documentation. Every claim about a competitor cites where it came from (a specific page, changelog entry, or public statement) rather than asserting it from general impression — this is a research artifact, not a marketing comparison.

## Exposure rule

This directory is git-tracked and this repo is public. Describe StoryHaven's own side of a comparison only in product/architecture-pattern terms (e.g. "session-scoped typed-fact extraction with decay-weighted ranking"), never in infra-specific terms (no host paths, container/network names, ports, domains, credentials). See `docs/ai/architecture.md` for the same rule applied to the architecture docs.
