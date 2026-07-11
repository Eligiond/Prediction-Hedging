# AGENTS.md

## Project overview
Prediction-Hedging is currently a very early-stage hackathon project. Based on the existing README, the intended product is a prediction and hedging market platform for individuals that ingests portfolio data and suggests safer hedging strategies around calls.

## Repository status
The repository is minimally initialized at the moment.

Current known files:
- README.md

Expect the codebase, tooling, and architecture to evolve quickly.

## Working assumptions for agents
- Treat this repository as an early prototype unless newer files establish stronger conventions.
- Prefer small, reversible changes.
- Document any new setup, scripts, or architectural decisions in README.md or adjacent docs.
- If you introduce a framework, runtime, or package manager, keep the choice explicit and consistent.
- Avoid broad refactors unless requested.

## File and change conventions
- Put new top-level app or service code in clearly named directories.
- Keep configuration files close to the tool they configure.
- When adding non-trivial logic, include brief comments only where intent is not obvious from code.
- Preserve unrelated user changes.

## Validation
- Validate changes with the smallest relevant checks available.
- If no automated checks exist yet, state that clearly and describe what you verified manually.

## Documentation expectations
When making meaningful changes, update documentation for:
- local setup
- run commands
- environment variables
- notable architecture decisions

## Priority for future contributors
Until the repository has more structure, optimize for clarity, speed of iteration, and explicit documentation over premature abstraction.
