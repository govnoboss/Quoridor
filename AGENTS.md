# AI DEVELOPMENT INSTRUCTIONS — PlayQuor

## Documentation is the primary knowledge base

Before performing any development task, read `docs/AI_CONTEXT.md`.

The documentation inside `docs/` contains technical knowledge about the project architecture, modules, methods, game logic, networking, database, frontend and other systems.

## Rules

1. Use AI_CONTEXT.md as the entry point for understanding the project.
2. Identify which documentation files are relevant to the current task.
3. Read only the relevant documentation instead of scanning the entire repository.
4. Use documented method signatures, dependencies and workflows when planning changes.
5. Do not assume that documentation is always correct.
6. If documentation conflicts with source code, the actual implementation is the source of truth.
7. Before making changes, verify the relevant implementation.
8. Do not unnecessarily explore unrelated modules.
9. Never invent methods, events, database fields or functionality.
10. If important information is missing, investigate only the relevant source files.

## Documentation maintenance

Whenever a code change modifies:
- Public method signatures
- Module responsibilities
- API endpoints
- Socket.IO events
- Database structures
- Game rules or algorithms
- Important application workflows

Update the corresponding documentation.

Keep AI_CONTEXT.md compact. Do not duplicate detailed technical information already documented elsewhere.

## Development workflow

For every task:

1. Understand the request.
2. Read AI_CONTEXT.md.
3. Identify relevant documentation.
4. Inspect the necessary source code.
5. Explain the planned changes.
6. Implement only the requested changes.
7. Test the implementation.
8. Update documentation if necessary.

Avoid unnecessary refactoring and architectural changes. If multiple documentation sources describe the same subsystem, use the AI documentation as the primary reference. Treat older documentation as historical unless explicitly referenced by AI_CONTEXT.md.
