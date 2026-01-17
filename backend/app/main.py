"""
Symgen - Volatility3 Linux Symbol Generator

A standalone application for generating Volatility3 Linux symbols using Docker containers.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from app.routers import symgen

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    logger.info("Starting Symgen application...")
    
    # Create database tables
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created/verified")
    
    yield
    
    # Shutdown
    logger.info("Shutting down Symgen application...")


app = FastAPI(
    title="Symgen",
    description="Volatility3 Linux Symbol Generator - Generate Linux kernel symbols automatically using Docker containers",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify allowed origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(symgen.router)


@app.get("/")
def root():
    """Root endpoint with application info."""
    return {
        "name": "Symgen",
        "description": "Volatility3 Linux Symbol Generator",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": {
            "status": "/api/symgen/status",
            "generate": "/api/symgen/generate",
            "jobs": "/api/symgen/jobs",
            "portal": "/api/symgen/portal",
            "distros": "/api/symgen/distros",
            "websocket": "/api/symgen/ws"
        }
    }


@app.get("/health")
def health_check():
    """Health check endpoint."""
    from app.services.symgen import symbol_generator
    return {
        "status": "healthy",
        "docker_available": symbol_generator.is_available()
    }
