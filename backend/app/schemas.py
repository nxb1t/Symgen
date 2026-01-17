from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List
from app.models import SymGenStatus, UbuntuVersion, DebianVersion, LinuxDistro


# ============================================================
# Symbol Generation Schemas
# ============================================================

class SymGenCreate(BaseModel):
    """Request to create a new symbol generation job."""
    kernel_version: str  # e.g., "5.15.0-91-generic" or "5.10.0-28-amd64"
    distro: LinuxDistro = LinuxDistro.UBUNTU
    ubuntu_version: Optional[UbuntuVersion] = None
    debian_version: Optional[DebianVersion] = None


class SymGenResponse(BaseModel):
    """Response for a symbol generation job."""
    id: int
    kernel_version: str
    distro: LinuxDistro = LinuxDistro.UBUNTU
    ubuntu_version: Optional[UbuntuVersion] = None
    debian_version: Optional[DebianVersion] = None
    status: SymGenStatus
    status_message: Optional[str] = None
    error_message: Optional[str] = None
    symbol_filename: Optional[str] = None
    symbol_file_size: Optional[int] = None
    download_count: int = 0
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class SymGenListResponse(BaseModel):
    """Paginated response for symbol generation jobs."""
    items: List[SymGenResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class GeneratedSymbolResponse(BaseModel):
    """Public symbol info for the symbol portal."""
    id: int
    kernel_version: str
    distro: LinuxDistro = LinuxDistro.UBUNTU
    ubuntu_version: Optional[UbuntuVersion] = None
    debian_version: Optional[DebianVersion] = None
    symbol_filename: str
    symbol_file_size: int
    download_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class SymbolPortalResponse(BaseModel):
    """Paginated response for the public symbol portal."""
    items: List[GeneratedSymbolResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class KernelParseResponse(BaseModel):
    """Response for kernel banner parsing."""
    kernel_version: Optional[str] = None
    distro: Optional[LinuxDistro] = None
    ubuntu_version: Optional[UbuntuVersion] = None
    debian_version: Optional[DebianVersion] = None
    success: bool
    message: str


class MetricsResponse(BaseModel):
    """System metrics response."""
    total_jobs: int
    completed_jobs: int
    failed_jobs: int
    in_progress_jobs: int
    total_symbols: int
    total_storage_bytes: int
    total_storage_formatted: str
    total_downloads: int
    avg_completion_time_seconds: Optional[float] = None
    avg_completion_time_formatted: Optional[str] = None
    fastest_job_seconds: Optional[float] = None
    slowest_job_seconds: Optional[float] = None
