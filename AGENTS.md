# Symgen - Agent Guidelines

Guidelines for AI coding agents working on this Volatility3 Linux Symbol Generator.

## Project Structure

```
/frontend          # Next.js 16 + React 19 + TypeScript
/backend           # FastAPI + SQLAlchemy + Docker SDK
/docker-compose.yml
```

## Commands

### Frontend (`/frontend/`)

```bash
npm install          # Install dependencies
npm run dev          # Dev server with Turbopack (http://localhost:3000)
npm run build        # Production build (RUN AFTER CHANGES)
npm run lint         # Check for lint errors
npm run lint:fix     # Auto-fix lint errors
```

### Backend (`/backend/`)

```bash
python -m venv venv && source venv/bin/activate  # Create/activate venv
pip install -r requirements.txt                   # Install dependencies
uvicorn app.main:app --reload --port 8000        # Dev server
```

### Docker

```bash
docker-compose up -d      # Start all services
docker-compose down       # Stop all services
docker-compose logs -f    # View logs
```

## Code Style

### TypeScript/React

**Strict TypeScript**: `strict: true` and `noUncheckedIndexedAccess: true` are enabled.

**Import Order**:
```tsx
"use client";                              // 1. Directive (if needed)
import { useState } from "react";          // 2. React/Next.js
import { motion } from "motion/react";     // 3. Third-party
import { Button } from "@/components/ui/button";  // 4. Internal
import { cn } from "@/lib/utils";          // 5. Utilities
```

**Components**:
- Page components: `export default function PageName()`
- Helper components: arrow functions
- Set `displayName` for `forwardRef` components

**Styling**:
- Use Tailwind CSS utilities
- Use `cn()` for conditional classes: `cn("base", condition && "active")`
- Mobile-first: `sm:`, `md:`, `lg:` prefixes

**Animations** (motion/react):
```tsx
const fadeIn = { hidden: { opacity: 0 }, visible: { opacity: 1 } };
<motion.div variants={fadeIn} initial="hidden" animate="visible" />
```

### Python/FastAPI

**Import Order**:
```python
import os                          # 1. Standard library
from fastapi import HTTPException  # 2. Third-party
from app.models import Job         # 3. Local modules
```

**Type Hints**: Always use for function parameters and return values.

**Schemas**: Define in `app/schemas.py` using Pydantic models.

**Routes**: Use `async def` for I/O operations.

## Naming Conventions

| Type | TypeScript | Python |
|------|------------|--------|
| Components/Classes | `PascalCase` | `PascalCase` |
| Functions/Methods | `camelCase` | `snake_case` |
| Variables | `camelCase` | `snake_case` |
| Constants | `UPPER_SNAKE` | `UPPER_SNAKE` |
| Files | `kebab-case.tsx` | `snake_case.py` |

## Error Handling

**Frontend**:
```tsx
try {
  const data = await symgenApi.generate(...);
  toast.success("Started");
} catch (err) {
  const error = err as { response?: { data?: { detail?: string } } };
  toast.error(error.response?.data?.detail || "Error");
}
```

**Backend**:
```python
from fastapi import HTTPException
raise HTTPException(status_code=400, detail="Invalid kernel version")
```

## Key Files

### Frontend
- `app/page.tsx` - Landing page
- `app/generator/page.tsx` - Main generator UI
- `components/navbar.tsx` - Shared navbar
- `components/ui/` - UI components (button, card, badge, animated-beam)
- `lib/api.ts` - API client with types
- `lib/websocket.ts` - WebSocket client

### Backend
- `app/main.py` - FastAPI entry point
- `app/routers/symgen.py` - API endpoints
- `app/services/symgen.py` - Symbol generation logic
- `app/models.py` - SQLAlchemy models
- `app/schemas.py` - Pydantic schemas

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/symgen/status` | Docker availability |
| GET | `/api/symgen/metrics` | System metrics |
| POST | `/api/symgen/generate` | Start generation |
| POST | `/api/symgen/parse-banner` | Parse kernel banner |
| GET | `/api/symgen/jobs` | List jobs |
| GET | `/api/symgen/jobs/{id}` | Job details |
| DELETE | `/api/symgen/jobs/{id}` | Delete job |
| GET | `/api/symgen/download/{id}` | Download symbol |
| WS | `/api/symgen/ws` | Real-time updates |

## Important Notes

1. **Always run `npm run build`** after frontend changes to verify TypeScript compiles
2. **Use existing UI components** from `/frontend/components/ui/`
3. **Docker volume**: `symgen_storage` must be accessible to spawned containers
4. **Animations**: Import from `motion/react`, not `framer-motion`
5. **Icons**: Use `lucide-react` for all icons
6. **Toasts**: Use `sonner` for notifications
7. **API types**: Keep `lib/api.ts` types in sync with backend schemas

## Dependencies

**Frontend**: next@16, react@19, motion@12, tailwindcss@3, lucide-react, sonner, axios

**Backend**: fastapi, uvicorn, sqlalchemy, docker, pydantic@2, psycopg2-binary
