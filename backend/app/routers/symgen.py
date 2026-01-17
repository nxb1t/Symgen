"""
Symbol Generation Router

API endpoints for generating and downloading Volatility3 Linux symbols.
"""

import os
import math
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.database import get_db
from app.models import SymbolGeneration, SymGenStatus, UbuntuVersion, DebianVersion, LinuxDistro
from app.schemas import (
    SymGenCreate, SymGenResponse, SymGenListResponse, 
    GeneratedSymbolResponse, SymbolPortalResponse, KernelParseResponse,
    MetricsResponse
)
from app.services.symgen import (
    symbol_generator, parse_kernel_version,
    get_symbol_filename, SYMBOLS_DIR
)
from app.websocket import manager

router = APIRouter(prefix="/api/symgen", tags=["symgen"])


# ============================================================
# Symbol Generation Endpoints
# ============================================================

@router.get("/status")
def get_symgen_status():
    """Check if symbol generation is available (Docker connected)."""
    return {
        "available": symbol_generator.is_available(),
        "message": "Docker is connected" if symbol_generator.is_available() 
                   else "Docker is not available. Make sure Docker socket is mounted."
    }


@router.get("/metrics", response_model=MetricsResponse)
def get_metrics(db: Session = Depends(get_db)):
    """Get system metrics including storage usage and completion times."""
    from sqlalchemy import func
    
    # Job counts
    total_jobs = db.query(SymbolGeneration).count()
    completed_jobs = db.query(SymbolGeneration).filter(
        SymbolGeneration.status == SymGenStatus.COMPLETED
    ).count()
    failed_jobs = db.query(SymbolGeneration).filter(
        SymbolGeneration.status == SymGenStatus.FAILED
    ).count()
    in_progress_jobs = db.query(SymbolGeneration).filter(
        SymbolGeneration.status.in_([
            SymGenStatus.PENDING, SymGenStatus.PULLING_IMAGE,
            SymGenStatus.RUNNING, SymGenStatus.DOWNLOADING_KERNEL,
            SymGenStatus.GENERATING_SYMBOL
        ])
    ).count()
    
    # Storage metrics
    storage_result = db.query(
        func.count(SymbolGeneration.id),
        func.coalesce(func.sum(SymbolGeneration.symbol_file_size), 0)
    ).filter(
        SymbolGeneration.status == SymGenStatus.COMPLETED,
        SymbolGeneration.symbol_file_size.isnot(None)
    ).first()
    
    total_symbols = storage_result[0] if storage_result else 0
    total_storage_bytes = int(storage_result[1]) if storage_result else 0
    
    # Format storage size
    def format_bytes(size_bytes: int) -> str:
        size = float(size_bytes)
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} PB"
    
    total_storage_formatted = format_bytes(total_storage_bytes)
    
    # Total downloads
    downloads_result = db.query(
        func.coalesce(func.sum(SymbolGeneration.download_count), 0)
    ).scalar()
    total_downloads = int(downloads_result) if downloads_result else 0
    
    # Completion time metrics (only for completed jobs with both timestamps)
    completed_with_times = db.query(SymbolGeneration).filter(
        SymbolGeneration.status == SymGenStatus.COMPLETED,
        SymbolGeneration.started_at.isnot(None),
        SymbolGeneration.completed_at.isnot(None)
    ).all()
    
    completion_times = []
    for job in completed_with_times:
        if job.started_at and job.completed_at:
            delta = (job.completed_at - job.started_at).total_seconds()
            if delta > 0:
                completion_times.append(delta)
    
    avg_completion_time_seconds = None
    avg_completion_time_formatted = None
    fastest_job_seconds = None
    slowest_job_seconds = None
    
    if completion_times:
        avg_completion_time_seconds = sum(completion_times) / len(completion_times)
        fastest_job_seconds = min(completion_times)
        slowest_job_seconds = max(completion_times)
        
        # Format average time
        def format_duration(seconds: float) -> str:
            if seconds < 60:
                return f"{seconds:.0f}s"
            elif seconds < 3600:
                mins = seconds / 60
                return f"{mins:.1f}m"
            else:
                hours = seconds / 3600
                return f"{hours:.1f}h"
        
        avg_completion_time_formatted = format_duration(avg_completion_time_seconds)
    
    return MetricsResponse(
        total_jobs=total_jobs,
        completed_jobs=completed_jobs,
        failed_jobs=failed_jobs,
        in_progress_jobs=in_progress_jobs,
        total_symbols=total_symbols,
        total_storage_bytes=total_storage_bytes,
        total_storage_formatted=total_storage_formatted,
        total_downloads=total_downloads,
        avg_completion_time_seconds=avg_completion_time_seconds,
        avg_completion_time_formatted=avg_completion_time_formatted,
        fastest_job_seconds=fastest_job_seconds,
        slowest_job_seconds=slowest_job_seconds
    )


@router.post("/generate", response_model=SymGenResponse)
async def create_symbol_generation(
    request: SymGenCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Start a new symbol generation job.
    
    Spins up a Linux Docker container (Ubuntu or Debian), downloads kernel debug symbols,
    and generates a Volatility3 symbol file.
    """
    if not symbol_generator.is_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Docker is not available. Symbol generation requires Docker access."
        )
    
    # Validate distro-specific version is provided
    if request.distro == LinuxDistro.UBUNTU and not request.ubuntu_version:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ubuntu_version is required when distro is Ubuntu"
        )
    if request.distro == LinuxDistro.DEBIAN and not request.debian_version:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="debian_version is required when distro is Debian"
        )
    
    # Build base query for this kernel+distro+version combination
    def build_job_query():
        query = db.query(SymbolGeneration).filter(
            SymbolGeneration.kernel_version == request.kernel_version,
            SymbolGeneration.distro == request.distro
        )
        if request.distro == LinuxDistro.UBUNTU:
            query = query.filter(SymbolGeneration.ubuntu_version == request.ubuntu_version)
        else:
            query = query.filter(SymbolGeneration.debian_version == request.debian_version)
        return query
    
    # Check for existing completed job
    completed_job = build_job_query().filter(
        SymbolGeneration.status == SymGenStatus.COMPLETED
    ).first()
    
    if completed_job:
        # Verify the symbol file still exists
        if completed_job.symbol_file_path and os.path.exists(completed_job.symbol_file_path):
            return completed_job
        # Symbol file missing, mark job as failed so user can retry
        completed_job.status = SymGenStatus.FAILED
        completed_job.error_message = "Symbol file was deleted"
        db.commit()
    
    # Check for in-progress job
    in_progress = build_job_query().filter(
        SymbolGeneration.status.in_([
            SymGenStatus.PENDING, SymGenStatus.PULLING_IMAGE,
            SymGenStatus.RUNNING, SymGenStatus.DOWNLOADING_KERNEL,
            SymGenStatus.GENERATING_SYMBOL
        ])
    ).first()
    
    if in_progress:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Symbol generation for kernel {request.kernel_version} is already in progress (job #{in_progress.id})"
        )
    
    # Create new job
    job = SymbolGeneration(
        kernel_version=request.kernel_version,
        distro=request.distro,
        ubuntu_version=request.ubuntu_version,
        debian_version=request.debian_version,
        status=SymGenStatus.PENDING,
        status_message="Job created, waiting to start...",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    
    # Broadcast job creation via WebSocket immediately (works from async context)
    await manager.broadcast({
        "type": "job_update",
        "job": {
            "id": job.id,
            "kernel_version": job.kernel_version,
            "distro": job.distro.value if job.distro else None,
            "ubuntu_version": job.ubuntu_version.value if job.ubuntu_version else None,
            "debian_version": job.debian_version.value if job.debian_version else None,
            "status": job.status.value if job.status else None,
            "status_message": job.status_message,
            "error_message": job.error_message,
            "symbol_filename": job.symbol_filename,
            "symbol_file_size": job.symbol_file_size,
            "download_count": job.download_count,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            "created_at": job.created_at.isoformat() if job.created_at else None,
        }
    }, channel="symgen")
    
    # Start generation in background
    background_tasks.add_task(
        symbol_generator.generate_symbol,
        job.id,
        request.kernel_version,
        request.distro,
        request.ubuntu_version,
        request.debian_version
    )
    
    return job


@router.post("/parse-banner", response_model=KernelParseResponse)
def parse_kernel_banner(banner: str):
    """
    Parse kernel version and distro from a kernel banner string.
    Useful for auto-detecting kernel info from memory dumps.
    """
    if not banner or not banner.strip():
        return KernelParseResponse(
            success=False,
            message="No banner provided"
        )
    
    parsed = parse_kernel_version(banner)
    if not parsed:
        return KernelParseResponse(
            success=False,
            message="Could not parse kernel version from banner"
        )
    
    kernel_version, distro, ubuntu_version, debian_version = parsed
    
    return KernelParseResponse(
        kernel_version=kernel_version,
        distro=distro,
        ubuntu_version=ubuntu_version,
        debian_version=debian_version,
        success=True,
        message="Successfully parsed kernel information"
    )


@router.get("/jobs", response_model=SymGenListResponse)
def list_generation_jobs(
    page: int = 1,
    page_size: int = 10,
    status_filter: Optional[SymGenStatus] = None,
    db: Session = Depends(get_db)
):
    """List all symbol generation jobs with pagination."""
    query = db.query(SymbolGeneration)
    
    if status_filter:
        query = query.filter(SymbolGeneration.status == status_filter)
    
    total = query.count()
    total_pages = math.ceil(total / page_size) if total > 0 else 1
    
    jobs = query.order_by(desc(SymbolGeneration.created_at))\
                .offset((page - 1) * page_size)\
                .limit(page_size)\
                .all()
    
    return SymGenListResponse(
        items=jobs,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages
    )


@router.get("/jobs/{job_id}", response_model=SymGenResponse)
def get_generation_job(
    job_id: int,
    db: Session = Depends(get_db)
):
    """Get details of a specific symbol generation job."""
    job = db.query(SymbolGeneration).filter(SymbolGeneration.id == job_id).first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Symbol generation job not found"
        )
    return job


@router.post("/jobs/{job_id}/cancel")
def cancel_generation_job(
    job_id: int,
    db: Session = Depends(get_db)
):
    """Cancel a running symbol generation job."""
    job = db.query(SymbolGeneration).filter(SymbolGeneration.id == job_id).first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Symbol generation job not found"
        )
    
    if job.status in (SymGenStatus.COMPLETED, SymGenStatus.FAILED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot cancel job with status: {job.status.value}"
        )
    
    success = symbol_generator.cancel_job(job_id)
    
    return {
        "success": success,
        "message": "Job cancelled" if success else "Failed to cancel job"
    }


@router.delete("/jobs/{job_id}")
def delete_generation_job(
    job_id: int,
    db: Session = Depends(get_db)
):
    """Delete a symbol generation job and its associated files."""
    job = db.query(SymbolGeneration).filter(SymbolGeneration.id == job_id).first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Symbol generation job not found"
        )
    
    success = symbol_generator.delete_job(job_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete job"
        )
    
    return {
        "success": True,
        "message": "Job and associated files deleted successfully"
    }


# ============================================================
# Symbol Portal (Public Download) Endpoints
# ============================================================

@router.get("/portal", response_model=SymbolPortalResponse)
def list_available_symbols(
    page: int = 1,
    page_size: int = 20,
    distro: Optional[LinuxDistro] = None,
    ubuntu_version: Optional[UbuntuVersion] = None,
    debian_version: Optional[DebianVersion] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    List all completed/available symbols for download.
    
    This endpoint is public for the symbol portal.
    """
    query = db.query(SymbolGeneration).filter(
        SymbolGeneration.status == SymGenStatus.COMPLETED,
        SymbolGeneration.symbol_filename.isnot(None)
    )
    
    if distro:
        query = query.filter(SymbolGeneration.distro == distro)
    
    if ubuntu_version:
        query = query.filter(SymbolGeneration.ubuntu_version == ubuntu_version)
    
    if debian_version:
        query = query.filter(SymbolGeneration.debian_version == debian_version)
    
    if search:
        query = query.filter(SymbolGeneration.kernel_version.ilike(f"%{search}%"))
    
    total = query.count()
    total_pages = math.ceil(total / page_size) if total > 0 else 1
    
    symbols = query.order_by(desc(SymbolGeneration.created_at))\
                   .offset((page - 1) * page_size)\
                   .limit(page_size)\
                   .all()
    
    items = [
        GeneratedSymbolResponse(
            id=s.id,
            kernel_version=s.kernel_version,
            distro=s.distro or LinuxDistro.UBUNTU,
            ubuntu_version=s.ubuntu_version,
            debian_version=s.debian_version,
            symbol_filename=s.symbol_filename,
            symbol_file_size=s.symbol_file_size or 0,
            download_count=s.download_count,
            created_at=s.created_at
        )
        for s in symbols
    ]
    
    return SymbolPortalResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages
    )


@router.get("/download/{job_id}")
def download_symbol(
    job_id: int,
    db: Session = Depends(get_db)
):
    """
    Download a generated symbol file.
    
    This endpoint is public for the symbol portal.
    """
    job = db.query(SymbolGeneration).filter(SymbolGeneration.id == job_id).first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Symbol not found"
        )
    
    if job.status != SymGenStatus.COMPLETED or not job.symbol_file_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Symbol file is not available"
        )
    
    if not os.path.exists(job.symbol_file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Symbol file not found on disk"
        )
    
    # Increment download count
    job.download_count += 1
    db.commit()
    
    return FileResponse(
        path=job.symbol_file_path,
        filename=job.symbol_filename,
        media_type="application/x-xz"
    )


@router.get("/distros")
def get_supported_distros():
    """Get list of supported Linux distributions and their versions."""
    return {
        "distros": [
            {"value": d.value, "label": d.value.capitalize()}
            for d in LinuxDistro
        ],
        "ubuntu_versions": [
            {"value": v.value, "label": f"Ubuntu {v.value} LTS"}
            for v in UbuntuVersion
        ],
        "debian_versions": [
            {"value": v.value, "label": f"Debian {v.value} ({_get_debian_codename(v)})"}
            for v in DebianVersion
        ]
    }


def _get_debian_codename(version: DebianVersion) -> str:
    """Get Debian codename for display."""
    codenames = {
        DebianVersion.DEBIAN_10: "Buster",
        DebianVersion.DEBIAN_11: "Bullseye",
        DebianVersion.DEBIAN_12: "Bookworm",
    }
    return codenames.get(version, "")


@router.get("/ubuntu-versions")
def get_supported_ubuntu_versions():
    """Get list of supported Ubuntu versions (legacy endpoint)."""
    return {
        "versions": [
            {"value": v.value, "label": f"Ubuntu {v.value} LTS"}
            for v in UbuntuVersion
        ]
    }


# ============================================================
# WebSocket Endpoint for Real-time Updates
# ============================================================

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time symbol generation updates.
    
    Clients connect here to receive live updates about job status changes.
    Messages are JSON formatted:
    {
        "type": "job_update",
        "job": { ... job data ... }
    }
    """
    await manager.connect(websocket, channel="symgen")
    try:
        while True:
            # Keep connection alive, receive any client messages (ping/pong)
            data = await websocket.receive_text()
            # Echo back as heartbeat acknowledgment
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await manager.disconnect(websocket, channel="symgen")
    except Exception as e:
        await manager.disconnect(websocket, channel="symgen")
