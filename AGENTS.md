# Symgen - Agent Guidelines

Guidelines for AI agents working on this Volatility3 Linux Symbol Generator.

## Project Structure

```
/cli               # Rust CLI (clap + tokio + bollard)
/frontend          # Next.js 16 + React 19 + TypeScript
/backend           # FastAPI + SQLAlchemy + Docker SDK
```

## Build & Run Commands

### CLI (`/cli/`)

```bash
cargo build --release          # Build release binary (cli/target/release/symgen)
cargo build                    # Debug build
cargo run -- generate --help   # Run with args
cargo fmt                      # Format code
cargo clippy                   # Lint
```

### Frontend (`/frontend/`)

```bash
npm install                    # Install dependencies
npm run dev                    # Dev server (http://localhost:3000)
npm run build                  # Production build - RUN AFTER CHANGES
npm run lint                   # ESLint check
npm run lint:fix               # Auto-fix lint errors
```

### Backend (`/backend/`)

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Docker

```bash
docker-compose up -d           # Start all services
docker-compose down            # Stop services
docker-compose logs -f         # View logs
```

**Note**: No test framework configured. Add pytest/vitest if needed.

## Code Style

### Rust (CLI)

**Imports** (grouped with blank lines):
```rust
use std::path::PathBuf;                    // 1. std library

use anyhow::{Context, Result};             // 2. External crates
use clap::Parser;

use crate::docker::DockerClient;           // 3. Local modules
```

**Error Handling**: Use `anyhow::Result` for functions, `?` operator for propagation.

**Naming**: `snake_case` for functions/variables, `PascalCase` for types/structs.

### TypeScript/React (Frontend)

**Imports** (grouped with blank lines):
```tsx
"use client";                                      // 1. Directive

import { useState, useCallback } from "react";     // 2. React/Next.js
import { toast } from "sonner";                    // 3. Third-party
import { Button } from "@/components/ui/button";   // 4. Internal components
import { cn } from "@/lib/utils";                  // 5. Utilities
import { symgenApi } from "@/lib/api";             // 6. API/types
```

**Components**: Use `@/` path alias. Set `displayName` for `forwardRef` components.

**Styling**: Tailwind CSS only, use `cn()` for conditional classes.

**Animations**: Import from `motion/react` (NOT framer-motion).

### Python/FastAPI (Backend)

**Imports** (grouped with blank lines):
```python
import os                              # 1. Standard library
from typing import Optional

from fastapi import APIRouter          # 2. Third-party
from sqlalchemy.orm import Session

from app.models import Job             # 3. Local modules
```

**Type Hints**: Required for all function parameters and return values.

**Async**: Use `async def` for route handlers with I/O operations.

## Naming Conventions

| Type | Rust | TypeScript | Python |
|------|------|------------|--------|
| Types/Classes | `PascalCase` | `PascalCase` | `PascalCase` |
| Functions | `snake_case` | `camelCase` | `snake_case` |
| Variables | `snake_case` | `camelCase` | `snake_case` |
| Constants | `UPPER_SNAKE` | `UPPER_SNAKE` | `UPPER_SNAKE` |
| Files | `snake_case.rs` | `kebab-case.tsx` | `snake_case.py` |

## Error Handling

**Rust**: `anyhow::bail!("message")` or `return Err(anyhow::anyhow!("message"))`

**TypeScript**: Catch axios errors, extract `error.response?.data?.detail`

**Python**: `raise HTTPException(status_code=400, detail="message")`

## Key Files

### CLI
- `src/main.rs` - Entry point, command handling
- `src/cli.rs` - Clap argument definitions
- `src/generator.rs` - Symbol generation logic
- `src/banner.rs` - Kernel banner parsing
- `src/docker.rs` - Docker client (bollard)

### Frontend
- `app/page.tsx` - Landing page
- `app/generator/page.tsx` - Generator UI
- `components/ui/` - Reusable components
- `lib/api.ts` - API client with types
- `lib/utils.ts` - Utility functions (`cn()`)

### Backend
- `app/main.py` - FastAPI entry point
- `app/routers/symgen.py` - Route handlers
- `app/services/symgen.py` - Business logic
- `app/models.py` - SQLAlchemy models
- `app/schemas.py` - Pydantic schemas

## Important Rules

1. **Run `npm run build`** after frontend changes to verify TypeScript compiles
2. **Run `cargo build`** after CLI changes to verify Rust compiles
3. **Use existing UI components** from `components/ui/` - don't duplicate
4. **Keep types in sync**: `lib/api.ts` ↔ `app/schemas.py`
5. **Icons**: Use `lucide-react` only
6. **Toasts**: Use `sonner` for notifications
7. **Docker**: CLI uses `bollard` crate, backend uses `docker` Python SDK

## Dependencies

**CLI**: clap, tokio, bollard, anyhow, serde, colored, indicatif, regex

**Frontend**: next@16, react@19, motion@12, tailwindcss, lucide-react, sonner, axios

**Backend**: fastapi, uvicorn, sqlalchemy, docker, pydantic@2
