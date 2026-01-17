"""
Symbol Generation Service

Generates Volatility3 Linux symbols using Docker containers.
Spins up Ubuntu/Debian containers, downloads kernel debug symbols from ddebs,
and uses dwarf2json to create symbol files.
"""

import os
import re
import asyncio
import logging
import shutil
import glob as glob_module
import threading
import queue
from datetime import datetime
from typing import Optional, Tuple, Dict, Any
from collections import deque

import docker
from docker.errors import ImageNotFound, ContainerError, APIError
from sqlalchemy.orm import Session

from app.models import (
    SymbolGeneration, SymGenStatus, LinuxDistro,
    UbuntuVersion, DebianVersion, FedoraVersion, CentOSVersion,
    RHELVersion, OracleVersion, RockyVersion, AlmaVersion
)
from app.database import SessionLocal
from app.websocket import manager as ws_manager

logger = logging.getLogger(__name__)

# Maximum concurrent jobs
MAX_CONCURRENT_JOBS = 2

# Directory paths
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/app/uploads")
SYMBOLS_DIR = os.path.join(UPLOAD_DIR, "symbols")  # Centralized symbol storage

# Docker volume name for uploads (must match docker-compose.yml)
DOCKER_VOLUME_NAME = os.getenv("DOCKER_VOLUME_NAME", "symgen_storage")

# Ubuntu base images
UBUNTU_IMAGES = {
    UbuntuVersion.UBUNTU_20_04: "ubuntu:20.04",
    UbuntuVersion.UBUNTU_22_04: "ubuntu:22.04",
    UbuntuVersion.UBUNTU_24_04: "ubuntu:24.04",
}

# Ubuntu codenames for ddebs repository
UBUNTU_CODENAMES = {
    UbuntuVersion.UBUNTU_20_04: "focal",
    UbuntuVersion.UBUNTU_22_04: "jammy",
    UbuntuVersion.UBUNTU_24_04: "noble",
}

# Debian base images
DEBIAN_IMAGES = {
    DebianVersion.DEBIAN_10: "debian:10",
    DebianVersion.DEBIAN_11: "debian:11",
    DebianVersion.DEBIAN_12: "debian:12",
}

# Debian codenames
DEBIAN_CODENAMES = {
    DebianVersion.DEBIAN_10: "buster",
    DebianVersion.DEBIAN_11: "bullseye",
    DebianVersion.DEBIAN_12: "bookworm",
}

# Fedora base images
FEDORA_IMAGES = {
    FedoraVersion.FEDORA_38: "fedora:38",
    FedoraVersion.FEDORA_39: "fedora:39",
    FedoraVersion.FEDORA_40: "fedora:40",
}

# CentOS base images (Stream versions)
CENTOS_IMAGES = {
    CentOSVersion.CENTOS_7: "centos:7",
    CentOSVersion.CENTOS_8: "quay.io/centos/centos:stream8",
    CentOSVersion.CENTOS_9: "quay.io/centos/centos:stream9",
}

# RHEL base images (using UBI - Universal Base Image)
RHEL_IMAGES = {
    RHELVersion.RHEL_8: "redhat/ubi8:latest",
    RHELVersion.RHEL_9: "redhat/ubi9:latest",
}

# Oracle Linux base images
ORACLE_IMAGES = {
    OracleVersion.ORACLE_8: "oraclelinux:8",
    OracleVersion.ORACLE_9: "oraclelinux:9",
}

# Rocky Linux base images
ROCKY_IMAGES = {
    RockyVersion.ROCKY_8: "rockylinux:8",
    RockyVersion.ROCKY_9: "rockylinux:9",
}

# AlmaLinux base images
ALMA_IMAGES = {
    AlmaVersion.ALMA_8: "almalinux:8",
    AlmaVersion.ALMA_9: "almalinux:9",
}


class JobQueue:
    """
    Manages a queue of symbol generation jobs with limited concurrency.
    Only MAX_CONCURRENT_JOBS jobs run at a time, others wait in queue.
    """
    
    def __init__(self, max_concurrent: int = MAX_CONCURRENT_JOBS):
        self.max_concurrent = max_concurrent
        self._running_jobs: Dict[int, asyncio.Task] = {}  # job_id -> task
        self._pending_queue: deque = deque()  # Queue of (job_id, args, kwargs)
        self._lock = asyncio.Lock()
        self._generator = None  # Will be set by SymbolGenerator
        logger.info(f"JobQueue initialized with max_concurrent={max_concurrent}")
    
    def set_generator(self, generator: 'SymbolGenerator'):
        """Set the symbol generator instance."""
        self._generator = generator
    
    @property
    def running_count(self) -> int:
        """Number of currently running jobs."""
        return len(self._running_jobs)
    
    @property
    def queued_count(self) -> int:
        """Number of jobs waiting in queue."""
        return len(self._pending_queue)
    
    def get_queue_position(self, job_id: int) -> Optional[int]:
        """Get position in queue (1-based), or None if not queued."""
        for i, (queued_id, _, _) in enumerate(self._pending_queue):
            if queued_id == job_id:
                return i + 1
        return None
    
    def is_job_running(self, job_id: int) -> bool:
        """Check if a job is currently running."""
        return job_id in self._running_jobs
    
    async def submit_job(self, job_id: int, *args, **kwargs) -> bool:
        """
        Submit a job to the queue.
        Returns True if job started immediately, False if queued.
        """
        async with self._lock:
            if self.running_count < self.max_concurrent:
                # Start immediately
                await self._start_job(job_id, args, kwargs)
                return True
            else:
                # Add to queue
                self._pending_queue.append((job_id, args, kwargs))
                queue_pos = len(self._pending_queue)
                logger.info(f"Job {job_id} queued at position {queue_pos}")
                
                # Update job status to show queue position
                self._update_queued_status(job_id, queue_pos)
                return False
    
    def _update_queued_status(self, job_id: int, position: int):
        """Update job status to show it's queued."""
        db = SessionLocal()
        try:
            job = db.query(SymbolGeneration).filter(SymbolGeneration.id == job_id).first()
            if job:
                job.status_message = f"Queued (position {position} of {self.queued_count})"
                db.commit()
        finally:
            db.close()
    
    async def _start_job(self, job_id: int, args: tuple, kwargs: dict):
        """Start a job and track it."""
        if not self._generator:
            logger.error("Generator not set on JobQueue")
            return
        
        # Create task for the job
        task = asyncio.create_task(
            self._run_job_wrapper(job_id, args, kwargs)
        )
        self._running_jobs[job_id] = task
        logger.info(f"Job {job_id} started. Running: {self.running_count}, Queued: {self.queued_count}")
    
    async def _run_job_wrapper(self, job_id: int, args: tuple, kwargs: dict):
        """Wrapper to run job and handle completion."""
        try:
            await self._generator._execute_generation(job_id, *args, **kwargs)
        except Exception as e:
            logger.exception(f"Job {job_id} failed with exception")
        finally:
            await self._on_job_complete(job_id)
    
    async def _on_job_complete(self, job_id: int):
        """Handle job completion - remove from running and start next queued job."""
        async with self._lock:
            # Remove from running
            if job_id in self._running_jobs:
                del self._running_jobs[job_id]
            
            logger.info(f"Job {job_id} completed. Running: {self.running_count}, Queued: {self.queued_count}")
            
            # Start next queued job if any
            if self._pending_queue and self.running_count < self.max_concurrent:
                next_job_id, next_args, next_kwargs = self._pending_queue.popleft()
                logger.info(f"Starting queued job {next_job_id}")
                
                # Update queue positions for remaining jobs
                for i, (queued_id, _, _) in enumerate(self._pending_queue):
                    self._update_queued_status(queued_id, i + 1)
                
                await self._start_job(next_job_id, next_args, next_kwargs)
    
    async def cancel_job(self, job_id: int) -> bool:
        """Cancel a job (running or queued)."""
        async with self._lock:
            # Check if running
            if job_id in self._running_jobs:
                task = self._running_jobs[job_id]
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                return True
            
            # Check if queued
            for i, (queued_id, _, _) in enumerate(self._pending_queue):
                if queued_id == job_id:
                    del self._pending_queue[i]
                    # Update positions for remaining jobs
                    for j, (qid, _, _) in enumerate(self._pending_queue):
                        self._update_queued_status(qid, j + 1)
                    return True
            
            return False


# Global job queue instance
job_queue = JobQueue()


def ensure_directories():
    """Ensure required directories exist."""
    os.makedirs(SYMBOLS_DIR, exist_ok=True)


def parse_kernel_version(banner: str) -> Optional[dict]:
    """
    Parse kernel version and distro from kernel banner.
    
    Example Ubuntu banner:
    "Linux version 5.15.0-91-generic (buildd@lcy02-amd64-086) 
     (gcc (Ubuntu 11.4.0-1ubuntu1~22.04) 11.4.0, GNU ld (GNU Binutils for Ubuntu) 2.38)"
    
    Example Debian banner:
    "Linux version 5.10.0-28-amd64 (debian-kernel@lists.debian.org)
     (gcc-10 (Debian 10.2.1-6) 10.2.1 20210110, GNU ld (GNU Binutils for Debian) 2.35.2)"
    
    Example Fedora banner:
    "Linux version 6.5.6-300.fc39.x86_64 (mockbuild@...) 
     (gcc (GCC) 13.2.1 20230918 (Red Hat 13.2.1-3)..."
    
    Example RHEL/CentOS banner:
    "Linux version 4.18.0-513.el8.x86_64 (mockbuild@...) 
     (gcc (GCC) 8.5.0 20210514 (Red Hat 8.5.0-18)..."
    
    Returns:
        Dict with kernel_version, distro, and version fields, or None
    """
    if not banner:
        return None
    
    banner_lower = banner.lower()
    
    # Detect distribution
    is_debian = "debian" in banner_lower
    is_ubuntu = "ubuntu" in banner_lower
    is_fedora = "fedora" in banner_lower or ".fc" in banner_lower
    is_rhel = "red hat" in banner_lower or ".el" in banner_lower
    is_centos = "centos" in banner_lower
    is_rocky = "rocky" in banner_lower
    is_alma = "alma" in banner_lower
    is_oracle = "oracle" in banner_lower or ".ol" in banner_lower
    
    # Extract kernel version based on detected distro
    kernel_version = None
    
    if is_debian:
        # Debian pattern: 5.10.0-28-amd64, 6.1.0-18-amd64
        kernel_match = re.search(r'Linux version (\d+\.\d+\.\d+-\d+-amd64)', banner)
        if not kernel_match:
            kernel_match = re.search(r'(\d+\.\d+\.\d+-\d+-amd64)', banner)
    elif is_ubuntu:
        # Ubuntu pattern: 5.15.0-91-generic
        kernel_match = re.search(r'Linux version (\d+\.\d+\.\d+-\d+-[a-z]+)', banner)
        if not kernel_match:
            kernel_match = re.search(r'(\d+\.\d+\.\d+-\d+-generic)', banner)
    elif is_fedora:
        # Fedora pattern: 6.5.6-300.fc39.x86_64
        kernel_match = re.search(r'Linux version (\d+\.\d+\.\d+-\d+\.fc\d+\.[a-z0-9_]+)', banner)
        if not kernel_match:
            kernel_match = re.search(r'(\d+\.\d+\.\d+-\d+\.fc\d+\.[a-z0-9_]+)', banner)
    elif is_rhel or is_centos or is_rocky or is_alma or is_oracle:
        # RHEL-based pattern: 4.18.0-513.el8.x86_64, 5.14.0-362.el9.x86_64
        kernel_match = re.search(r'Linux version (\d+\.\d+\.\d+-[\d.]+\.el\d+[a-z0-9_.]*)', banner)
        if not kernel_match:
            kernel_match = re.search(r'(\d+\.\d+\.\d+-[\d.]+\.el\d+[a-z0-9_.]*)', banner)
        if not kernel_match:
            # Oracle Linux pattern: 5.15.0-100.96.32.el8uek.x86_64
            kernel_match = re.search(r'(\d+\.\d+\.\d+-[\d.]+\.el\d+uek[a-z0-9_.]*)', banner)
    else:
        # Generic pattern
        kernel_match = re.search(r'Linux version (\d+\.\d+\.\d+[^\s]*)', banner)
        if not kernel_match:
            kernel_match = re.search(r'(\d+\.\d+\.\d+-\d+-[a-z]+)', banner)
    
    if not kernel_match:
        return None
    
    kernel_version = kernel_match.group(1)
    
    # Build result dict
    result = {
        "kernel_version": kernel_version,
        "distro": None,
        "ubuntu_version": None,
        "debian_version": None,
        "fedora_version": None,
        "centos_version": None,
        "rhel_version": None,
        "oracle_version": None,
        "rocky_version": None,
        "alma_version": None,
    }
    
    # Determine distro and version
    if is_debian:
        result["distro"] = LinuxDistro.DEBIAN
        
        if "buster" in banner_lower or "debian 10" in banner_lower:
            result["debian_version"] = DebianVersion.DEBIAN_10
        elif "bullseye" in banner_lower or "debian 11" in banner_lower:
            result["debian_version"] = DebianVersion.DEBIAN_11
        elif "bookworm" in banner_lower or "debian 12" in banner_lower:
            result["debian_version"] = DebianVersion.DEBIAN_12
        else:
            major_minor = kernel_version.split('-')[0]
            if major_minor.startswith("4.19."):
                result["debian_version"] = DebianVersion.DEBIAN_10
            elif major_minor.startswith("5.10."):
                result["debian_version"] = DebianVersion.DEBIAN_11
            elif major_minor.startswith("6.1."):
                result["debian_version"] = DebianVersion.DEBIAN_12
                
    elif is_ubuntu:
        result["distro"] = LinuxDistro.UBUNTU
        
        if "~22.04" in banner or "jammy" in banner_lower:
            result["ubuntu_version"] = UbuntuVersion.UBUNTU_22_04
        elif "~20.04" in banner or "focal" in banner_lower:
            result["ubuntu_version"] = UbuntuVersion.UBUNTU_20_04
        elif "~24.04" in banner or "noble" in banner_lower:
            result["ubuntu_version"] = UbuntuVersion.UBUNTU_24_04
        else:
            major_minor = kernel_version.split('-')[0]
            if major_minor.startswith("5.4."):
                result["ubuntu_version"] = UbuntuVersion.UBUNTU_20_04
            elif major_minor.startswith("5.15.") or major_minor.startswith("5.19."):
                result["ubuntu_version"] = UbuntuVersion.UBUNTU_22_04
            elif major_minor.startswith("6."):
                result["ubuntu_version"] = UbuntuVersion.UBUNTU_24_04
                
    elif is_fedora:
        result["distro"] = LinuxDistro.FEDORA
        
        # Extract Fedora version from kernel (e.g., fc39 -> 39)
        fc_match = re.search(r'\.fc(\d+)\.', kernel_version)
        if fc_match:
            fc_ver = fc_match.group(1)
            if fc_ver == "38":
                result["fedora_version"] = FedoraVersion.FEDORA_38
            elif fc_ver == "39":
                result["fedora_version"] = FedoraVersion.FEDORA_39
            elif fc_ver == "40":
                result["fedora_version"] = FedoraVersion.FEDORA_40
                
    elif is_centos:
        result["distro"] = LinuxDistro.CENTOS
        
        el_match = re.search(r'\.el(\d+)', kernel_version)
        if el_match:
            el_ver = el_match.group(1)
            if el_ver == "7":
                result["centos_version"] = CentOSVersion.CENTOS_7
            elif el_ver == "8":
                result["centos_version"] = CentOSVersion.CENTOS_8
            elif el_ver == "9":
                result["centos_version"] = CentOSVersion.CENTOS_9
                
    elif is_rocky:
        result["distro"] = LinuxDistro.ROCKY
        
        el_match = re.search(r'\.el(\d+)', kernel_version)
        if el_match:
            el_ver = el_match.group(1)
            if el_ver == "8":
                result["rocky_version"] = RockyVersion.ROCKY_8
            elif el_ver == "9":
                result["rocky_version"] = RockyVersion.ROCKY_9
                
    elif is_alma:
        result["distro"] = LinuxDistro.ALMA
        
        el_match = re.search(r'\.el(\d+)', kernel_version)
        if el_match:
            el_ver = el_match.group(1)
            if el_ver == "8":
                result["alma_version"] = AlmaVersion.ALMA_8
            elif el_ver == "9":
                result["alma_version"] = AlmaVersion.ALMA_9
                
    elif is_oracle:
        result["distro"] = LinuxDistro.ORACLE
        
        el_match = re.search(r'\.el(\d+)', kernel_version)
        if el_match:
            el_ver = el_match.group(1)
            if el_ver == "8":
                result["oracle_version"] = OracleVersion.ORACLE_8
            elif el_ver == "9":
                result["oracle_version"] = OracleVersion.ORACLE_9
                
    elif is_rhel:
        result["distro"] = LinuxDistro.RHEL
        
        el_match = re.search(r'\.el(\d+)', kernel_version)
        if el_match:
            el_ver = el_match.group(1)
            if el_ver == "8":
                result["rhel_version"] = RHELVersion.RHEL_8
            elif el_ver == "9":
                result["rhel_version"] = RHELVersion.RHEL_9
                
    return result


def get_symbol_filename(
    kernel_version: str,
    distro: LinuxDistro,
    ubuntu_version: Optional[UbuntuVersion] = None,
    debian_version: Optional[DebianVersion] = None,
    fedora_version: Optional[FedoraVersion] = None,
    centos_version: Optional[CentOSVersion] = None,
    rhel_version: Optional[RHELVersion] = None,
    oracle_version: Optional[OracleVersion] = None,
    rocky_version: Optional[RockyVersion] = None,
    alma_version: Optional[AlmaVersion] = None,
) -> str:
    """Generate symbol filename."""
    if distro == LinuxDistro.DEBIAN and debian_version:
        codename = DEBIAN_CODENAMES[debian_version]
        return f"Debian_{codename}_{kernel_version}.json.xz"
    elif distro == LinuxDistro.UBUNTU and ubuntu_version:
        codename = UBUNTU_CODENAMES[ubuntu_version]
        return f"Ubuntu_{codename}_{kernel_version}.json.xz"
    elif distro == LinuxDistro.FEDORA and fedora_version:
        return f"Fedora_{fedora_version.value}_{kernel_version}.json.xz"
    elif distro == LinuxDistro.CENTOS and centos_version:
        return f"CentOS_{centos_version.value}_{kernel_version}.json.xz"
    elif distro == LinuxDistro.RHEL and rhel_version:
        return f"RHEL_{rhel_version.value}_{kernel_version}.json.xz"
    elif distro == LinuxDistro.ORACLE and oracle_version:
        return f"Oracle_{oracle_version.value}_{kernel_version}.json.xz"
    elif distro == LinuxDistro.ROCKY and rocky_version:
        return f"Rocky_{rocky_version.value}_{kernel_version}.json.xz"
    elif distro == LinuxDistro.ALMA and alma_version:
        return f"Alma_{alma_version.value}_{kernel_version}.json.xz"
    else:
        # Fallback
        return f"Linux_{kernel_version}.json.xz"


def check_existing_symbol(
    kernel_version: str,
    distro: LinuxDistro,
    ubuntu_version: Optional[UbuntuVersion] = None,
    debian_version: Optional[DebianVersion] = None,
    fedora_version: Optional[FedoraVersion] = None,
    centos_version: Optional[CentOSVersion] = None,
    rhel_version: Optional[RHELVersion] = None,
    oracle_version: Optional[OracleVersion] = None,
    rocky_version: Optional[RockyVersion] = None,
    alma_version: Optional[AlmaVersion] = None,
) -> Optional[str]:
    """Check if symbol already exists."""
    filename = get_symbol_filename(
        kernel_version, distro, ubuntu_version, debian_version,
        fedora_version, centos_version, rhel_version, oracle_version,
        rocky_version, alma_version
    )
    
    # Check centralized symbols directory
    symbol_path = os.path.join(SYMBOLS_DIR, filename)
    if os.path.exists(symbol_path):
        return symbol_path
    
    return None


class SymbolGenerator:
    """Handles Docker-based symbol generation with job queue."""
    
    def __init__(self):
        self.docker_client = None
        self._connect_docker()
        # Register with job queue
        job_queue.set_generator(self)
    
    def _connect_docker(self):
        """Connect to Docker daemon."""
        try:
            self.docker_client = docker.from_env()
            self.docker_client.ping()
            logger.info("Connected to Docker daemon")
        except Exception as e:
            logger.error(f"Failed to connect to Docker: {e}")
            self.docker_client = None
    
    def is_available(self) -> bool:
        """Check if Docker is available."""
        if not self.docker_client:
            self._connect_docker()
        return self.docker_client is not None
    
    def get_queue_status(self) -> Dict[str, int]:
        """Get current queue status."""
        return {
            "running": job_queue.running_count,
            "queued": job_queue.queued_count,
            "max_concurrent": job_queue.max_concurrent,
        }
    
    def _broadcast_job_update(self, job: SymbolGeneration):
        """Broadcast job update via WebSocket for real-time UI updates."""
        status_value = job.status.value if job.status else None
        logger.info(f"[SymGen] Job {job.id} status updated: {status_value}")
        
        # Broadcast via WebSocket for live updates
        ws_manager.broadcast_sync({
            "type": "job_update",
            "job": {
                "id": job.id,
                "kernel_version": job.kernel_version,
                "distro": job.distro.value if job.distro else None,
                "ubuntu_version": job.ubuntu_version.value if job.ubuntu_version else None,
                "debian_version": job.debian_version.value if job.debian_version else None,
                "fedora_version": job.fedora_version.value if job.fedora_version else None,
                "centos_version": job.centos_version.value if job.centos_version else None,
                "rhel_version": job.rhel_version.value if job.rhel_version else None,
                "oracle_version": job.oracle_version.value if job.oracle_version else None,
                "rocky_version": job.rocky_version.value if job.rocky_version else None,
                "alma_version": job.alma_version.value if job.alma_version else None,
                "status": status_value,
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
    
    def _update_status(self, db: Session, job_id: int, status: SymGenStatus, 
                       message: str = None, error: str = None):
        """Update job status in database."""
        job = db.query(SymbolGeneration).filter(SymbolGeneration.id == job_id).first()
        if job:
            job.status = status
            if message:
                job.status_message = message
            if error:
                job.error_message = error
            if status == SymGenStatus.RUNNING and not job.started_at:
                job.started_at = datetime.utcnow()
            if status in (SymGenStatus.COMPLETED, SymGenStatus.FAILED):
                job.completed_at = datetime.utcnow()
            db.commit()
            
            # Log status update
            self._broadcast_job_update(job)
    
    async def _monitor_container(self, db: Session, job_id: int, container) -> int:
        """
        Monitor container logs and update status based on progress markers.
        Returns the container exit code.
        """
        current_status = SymGenStatus.DOWNLOADING_KERNEL
        last_message = ""
        
        # Progress markers in the container script output
        status_markers = {
            ">>> Updating package lists": (SymGenStatus.DOWNLOADING_KERNEL, "Updating package lists..."),
            ">>> Installing required packages": (SymGenStatus.DOWNLOADING_KERNEL, "Installing required packages..."),
            ">>> Adding ddebs repository": (SymGenStatus.DOWNLOADING_KERNEL, "Adding debug symbol repository..."),
            ">>> Installing kernel debug symbols": (SymGenStatus.DOWNLOADING_KERNEL, "Downloading kernel debug symbols (this may take a while)..."),
            ">>> Looking for vmlinux": (SymGenStatus.GENERATING_SYMBOL, "Locating kernel debug information..."),
            ">>> Found vmlinux": (SymGenStatus.GENERATING_SYMBOL, "Found kernel debug symbols..."),
            ">>> Setting up dwarf2json": (SymGenStatus.GENERATING_SYMBOL, "Setting up symbol generator..."),
            ">>> Generating Volatility3 symbol file": (SymGenStatus.GENERATING_SYMBOL, "Generating symbol file (this may take a while)..."),
            ">>> Compressing symbol file": (SymGenStatus.GENERATING_SYMBOL, "Compressing symbol file..."),
            "=== Symbol generation completed": (SymGenStatus.GENERATING_SYMBOL, "Symbol generation completed, finalizing..."),
        }
        
        try:
            # Stream logs with a timeout
            log_stream = container.logs(stream=True, follow=True)
            buffer = ""
            
            # Use a thread to read logs since it's blocking
            log_queue = queue.Queue()
            stop_event = threading.Event()
            
            def read_logs():
                try:
                    for chunk in log_stream:
                        if stop_event.is_set():
                            break
                        log_queue.put(chunk.decode('utf-8'))
                except Exception as e:
                    logger.debug(f"Log stream ended: {e}")
                finally:
                    log_queue.put(None)  # Signal end
            
            log_thread = threading.Thread(target=read_logs, daemon=True)
            log_thread.start()
            
            # Process logs with timeout
            timeout_seconds = 1800  # 30 minutes total
            start_time = datetime.utcnow()
            
            while True:
                # Check timeout
                elapsed = (datetime.utcnow() - start_time).total_seconds()
                if elapsed > timeout_seconds:
                    logger.error(f"Container timeout after {elapsed}s")
                    container.kill()
                    return -1
                
                # Check if container finished
                container.reload()
                if container.status in ('exited', 'dead'):
                    break
                
                # Get logs from queue with small timeout
                try:
                    chunk = log_queue.get(timeout=2.0)
                    if chunk is None:
                        break
                    buffer += chunk
                    
                    # Process buffer line by line
                    while '\n' in buffer:
                        line, buffer = buffer.split('\n', 1)
                        line = line.strip()
                        if not line:
                            continue
                        
                        # Check for progress markers
                        for marker, (new_status, message) in status_markers.items():
                            if marker in line:
                                if new_status != current_status or message != last_message:
                                    current_status = new_status
                                    last_message = message
                                    logger.info(f"[Job {job_id}] Status: {new_status.value} - {message}")
                                    self._update_status(db, job_id, new_status, message=message)
                                break
                        
                        # Check for errors
                        if line.startswith("ERROR:"):
                            logger.warning(f"[Job {job_id}] Container error: {line}")
                            
                except queue.Empty:
                    # No new logs, check container status
                    pass
                
                # Yield to event loop
                await asyncio.sleep(0.1)
            
            stop_event.set()
            
            # Get final exit code
            container.reload()
            return container.attrs.get('State', {}).get('ExitCode', -1)
            
        except Exception as e:
            logger.exception(f"Error monitoring container for job {job_id}")
            return -1
    
    def _generate_ubuntu_script(self, kernel_version: str, codename: str) -> str:
        """Generate the shell script to run inside Ubuntu container."""
        return f'''#!/bin/bash
set -e

echo "=== Starting symbol generation for Ubuntu kernel {kernel_version} ==="

# Save output directory (the mounted volume)
OUTPUT_DIR="$PWD"

# Configure apt for non-interactive mode
export DEBIAN_FRONTEND=noninteractive

# Update package lists
echo ">>> Updating package lists..."
apt-get update -qq

# Install required packages
echo ">>> Installing required packages..."
apt-get install -y -qq wget xz-utils ubuntu-dbgsym-keyring

# Add Ubuntu proposed repository for newer kernel packages
echo ">>> Adding proposed repository..."
cat > /etc/apt/sources.list.d/proposed.sources << 'EOF'
Types: deb
URIs: http://archive.ubuntu.com/ubuntu/
Suites: {codename}-proposed
Components: main restricted universe multiverse
Signed-by: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF

# Add ddebs repository for debug symbols (using official DEB822 format)
echo ">>> Adding ddebs repository..."
cat > /etc/apt/sources.list.d/ddebs.sources << 'EOF'
Types: deb
URIs: http://ddebs.ubuntu.com/
Suites: {codename} {codename}-updates {codename}-proposed
Components: main restricted universe multiverse
Signed-by: /usr/share/keyrings/ubuntu-dbgsym-keyring.gpg
EOF

# Update with new repos
apt-get update -qq

# Install kernel debug symbols package
echo ">>> Installing kernel debug symbols for {kernel_version}..."
if ! apt-get install -y -qq linux-image-{kernel_version}-dbgsym 2>/dev/null; then
    echo "ERROR: Could not find/install debug symbols for kernel {kernel_version}"
    exit 1
fi

# Install linux-modules package to get System.map
echo ">>> Installing linux-modules for System.map..."
apt-get install -y -qq linux-modules-{kernel_version} 2>/dev/null || true

# Find vmlinux file from installed location
echo ">>> Looking for vmlinux..."
VMLINUX="/usr/lib/debug/boot/vmlinux-{kernel_version}"
if [ ! -f "$VMLINUX" ]; then
    # Try alternative location
    VMLINUX=$(find /usr/lib/debug -name "vmlinux-{kernel_version}" -type f 2>/dev/null | head -1)
fi

if [ -z "$VMLINUX" ] || [ ! -f "$VMLINUX" ]; then
    echo "ERROR: vmlinux not found in debug package"
    echo ">>> Searching for any vmlinux files..."
    find /usr/lib/debug -name "vmlinux*" -type f 2>/dev/null || true
    exit 1
fi
echo ">>> Found vmlinux: $VMLINUX"

# Download and setup dwarf2json
echo ">>> Setting up dwarf2json..."
wget -q https://github.com/volatilityfoundation/dwarf2json/releases/download/v0.8.0/dwarf2json-linux-amd64 -O /usr/local/bin/dwarf2json
chmod +x /usr/local/bin/dwarf2json

# Check for System.map (installed with linux-modules package)
SYSTEM_MAP=""
if [ -f "/boot/System.map-{kernel_version}" ]; then
    SYSTEM_MAP="/boot/System.map-{kernel_version}"
    echo ">>> Found System.map: $SYSTEM_MAP"
else
    echo ">>> No System.map found, continuing without it..."
fi

# Generate symbol file (output to the mounted volume)
echo ">>> Generating Volatility3 symbol file..."
SYMBOL_FILE="$OUTPUT_DIR/Ubuntu_{codename}_{kernel_version}.json"

if [ -n "$SYSTEM_MAP" ]; then
    /usr/local/bin/dwarf2json linux --elf "$VMLINUX" --system-map "$SYSTEM_MAP" > "$SYMBOL_FILE"
else
    /usr/local/bin/dwarf2json linux --elf "$VMLINUX" > "$SYMBOL_FILE"
fi

# Compress the symbol file
echo ">>> Compressing symbol file..."
xz -9 "$SYMBOL_FILE"

echo "=== Symbol generation completed successfully ==="
ls -la "$OUTPUT_DIR"
'''

    def _generate_debian_script(self, kernel_version: str, codename: str) -> str:
        """Generate the shell script to run inside Debian container."""
        return f'''#!/bin/bash
set -e

echo "=== Starting symbol generation for Debian kernel {kernel_version} ==="

# Save output directory (the mounted volume)
OUTPUT_DIR="$PWD"

# Configure apt for non-interactive mode
export DEBIAN_FRONTEND=noninteractive

# Update package lists
echo ">>> Updating package lists..."
apt-get update -qq

# Install required packages
echo ">>> Installing required packages..."
apt-get install -y -qq wget xz-utils ca-certificates

# Add Debian debug repository
echo ">>> Adding debug repository..."
echo "deb http://deb.debian.org/debian-debug {codename}-debug main" > /etc/apt/sources.list.d/debug.list

# Update with new repo
apt-get update -qq

# Install kernel debug symbols package
echo ">>> Installing kernel debug symbols for {kernel_version}..."
# Debian uses linux-image-<version>-dbg package naming
if ! apt-get install -y -qq linux-image-{kernel_version}-dbg 2>/dev/null; then
    # Try alternative package name
    echo ">>> Trying alternative package name..."
    if ! apt-get install -y -qq linux-image-{kernel_version}-unsigned-dbg 2>/dev/null; then
        echo "ERROR: Could not find/install debug symbols for kernel {kernel_version}"
        echo ">>> Available debug packages:"
        apt-cache search linux-image | grep dbg || true
        exit 1
    fi
fi

# Install linux-image package to get System.map
echo ">>> Installing linux-image for System.map..."
apt-get install -y -qq linux-image-{kernel_version} 2>/dev/null || true

# Find vmlinux file from installed location
echo ">>> Looking for vmlinux..."
VMLINUX="/usr/lib/debug/boot/vmlinux-{kernel_version}"
if [ ! -f "$VMLINUX" ]; then
    # Try alternative locations
    VMLINUX=$(find /usr/lib/debug -name "vmlinux-{kernel_version}" -type f 2>/dev/null | head -1)
fi

if [ -z "$VMLINUX" ] || [ ! -f "$VMLINUX" ]; then
    echo "ERROR: vmlinux not found in debug package"
    echo ">>> Searching for any vmlinux files..."
    find /usr/lib/debug -name "vmlinux*" -type f 2>/dev/null || true
    exit 1
fi
echo ">>> Found vmlinux: $VMLINUX"

# Download and setup dwarf2json
echo ">>> Setting up dwarf2json..."
wget -q https://github.com/volatilityfoundation/dwarf2json/releases/download/v0.8.0/dwarf2json-linux-amd64 -O /usr/local/bin/dwarf2json
chmod +x /usr/local/bin/dwarf2json

# Check for System.map (installed with linux-image package)
SYSTEM_MAP=""
if [ -f "/boot/System.map-{kernel_version}" ]; then
    SYSTEM_MAP="/boot/System.map-{kernel_version}"
    echo ">>> Found System.map: $SYSTEM_MAP"
else
    echo ">>> No System.map found, continuing without it..."
fi

# Generate symbol file (output to the mounted volume)
echo ">>> Generating Volatility3 symbol file..."
SYMBOL_FILE="$OUTPUT_DIR/Debian_{codename}_{kernel_version}.json"

if [ -n "$SYSTEM_MAP" ]; then
    /usr/local/bin/dwarf2json linux --elf "$VMLINUX" --system-map "$SYSTEM_MAP" > "$SYMBOL_FILE"
else
    /usr/local/bin/dwarf2json linux --elf "$VMLINUX" > "$SYMBOL_FILE"
fi

# Compress the symbol file
echo ">>> Compressing symbol file..."
xz -9 "$SYMBOL_FILE"

echo "=== Symbol generation completed successfully ==="
ls -la "$OUTPUT_DIR"
'''

    def _generate_fedora_script(self, kernel_version: str, fedora_version: str) -> str:
        """Generate the shell script to run inside Fedora container."""
        return f'''#!/bin/bash
set -e

echo "=== Starting symbol generation for Fedora {fedora_version} kernel {kernel_version} ==="

# Save output directory (the mounted volume)
OUTPUT_DIR="$PWD"

# Update package lists
echo ">>> Updating package lists..."
dnf -y -q update

# Install required packages
echo ">>> Installing required packages..."
dnf -y -q install wget xz findutils

# Enable debuginfo repository
echo ">>> Adding debug repository..."
dnf -y -q install dnf-plugins-core
dnf config-manager --set-enabled fedora-debuginfo updates-debuginfo || true

# Install kernel debug symbols
echo ">>> Installing kernel debug symbols for {kernel_version}..."
if ! dnf -y -q install kernel-debuginfo-{kernel_version} 2>/dev/null; then
    # Try with common suffix variants
    if ! dnf -y -q install kernel-debuginfo-common-x86_64-{kernel_version} kernel-debuginfo-{kernel_version} 2>/dev/null; then
        echo "ERROR: Could not find/install debug symbols for kernel {kernel_version}"
        echo ">>> Available debug packages:"
        dnf search kernel-debuginfo 2>/dev/null | head -20 || true
        exit 1
    fi
fi

# Find vmlinux file (exclude .py/.pyc files and search in kernel module path)
echo ">>> Looking for vmlinux..."
VMLINUX=$(find /usr/lib/debug -path "*{kernel_version}*/vmlinux" -type f 2>/dev/null | head -1)
if [ -z "$VMLINUX" ]; then
    VMLINUX=$(find /usr/lib/debug -name "vmlinux" -type f 2>/dev/null | grep "{kernel_version}" | head -1)
fi

if [ -z "$VMLINUX" ] || [ ! -f "$VMLINUX" ]; then
    echo "ERROR: vmlinux not found in debug package"
    echo ">>> Searching for vmlinux files..."
    find /usr/lib/debug -name "vmlinux" -type f 2>/dev/null || true
    exit 1
fi
echo ">>> Found vmlinux: $VMLINUX"

# Download and setup dwarf2json
echo ">>> Setting up dwarf2json..."
wget -q https://github.com/volatilityfoundation/dwarf2json/releases/download/v0.8.0/dwarf2json-linux-amd64 -O /usr/local/bin/dwarf2json
chmod +x /usr/local/bin/dwarf2json

# Check for System.map
SYSTEM_MAP=""
if [ -f "/boot/System.map-{kernel_version}" ]; then
    SYSTEM_MAP="/boot/System.map-{kernel_version}"
    echo ">>> Found System.map: $SYSTEM_MAP"
else
    echo ">>> No System.map found, continuing without it..."
fi

# Generate symbol file
echo ">>> Generating Volatility3 symbol file..."
SYMBOL_FILE="$OUTPUT_DIR/Fedora_{fedora_version}_{kernel_version}.json"

if [ -n "$SYSTEM_MAP" ]; then
    /usr/local/bin/dwarf2json linux --elf "$VMLINUX" --system-map "$SYSTEM_MAP" > "$SYMBOL_FILE"
else
    /usr/local/bin/dwarf2json linux --elf "$VMLINUX" > "$SYMBOL_FILE"
fi

# Compress the symbol file
echo ">>> Compressing symbol file..."
xz -9 "$SYMBOL_FILE"

echo "=== Symbol generation completed successfully ==="
ls -la "$OUTPUT_DIR"
'''

    def _generate_rhel_script(self, kernel_version: str, rhel_version: str, distro_name: str = "RHEL") -> str:
        """Generate the shell script for RHEL-based distros (RHEL, CentOS, Oracle, Rocky, Alma)."""
        return f'''#!/bin/bash
set -e

echo "=== Starting symbol generation for {distro_name} {rhel_version} kernel {kernel_version} ==="

# Save output directory (the mounted volume)
OUTPUT_DIR="$PWD"

# Update package lists
echo ">>> Updating package lists..."
yum -y -q update 2>/dev/null || dnf -y -q update

# Install required packages
echo ">>> Installing required packages..."
yum -y -q install wget xz findutils 2>/dev/null || dnf -y -q install wget xz findutils

# Enable debuginfo repository
echo ">>> Adding debug repository..."
yum -y -q install yum-utils 2>/dev/null || dnf -y -q install dnf-plugins-core
debuginfo-install -y kernel-{kernel_version} 2>/dev/null || true

# Alternative: try to install kernel-debuginfo directly
echo ">>> Installing kernel debug symbols for {kernel_version}..."
if ! yum -y -q install kernel-debuginfo-{kernel_version} 2>/dev/null; then
    if ! dnf -y -q install kernel-debuginfo-{kernel_version} 2>/dev/null; then
        # Try common package
        yum -y -q install kernel-debuginfo-common-x86_64-{kernel_version} kernel-debuginfo-{kernel_version} 2>/dev/null || \
        dnf -y -q install kernel-debuginfo-common-x86_64-{kernel_version} kernel-debuginfo-{kernel_version} 2>/dev/null || true
    fi
fi

# Find vmlinux file
echo ">>> Looking for vmlinux..."
VMLINUX=$(find /usr/lib/debug -name "vmlinux-{kernel_version}*" -type f 2>/dev/null | head -1)
if [ -z "$VMLINUX" ]; then
    VMLINUX=$(find /usr/lib/debug -name "vmlinux*" -path "*{kernel_version}*" -type f 2>/dev/null | head -1)
fi

if [ -z "$VMLINUX" ] || [ ! -f "$VMLINUX" ]; then
    echo "ERROR: vmlinux not found in debug package"
    echo ">>> Searching for any vmlinux files..."
    find /usr/lib/debug -name "vmlinux*" -type f 2>/dev/null || true
    exit 1
fi
echo ">>> Found vmlinux: $VMLINUX"

# Download and setup dwarf2json
echo ">>> Setting up dwarf2json..."
wget -q https://github.com/volatilityfoundation/dwarf2json/releases/download/v0.8.0/dwarf2json-linux-amd64 -O /usr/local/bin/dwarf2json
chmod +x /usr/local/bin/dwarf2json

# Check for System.map
SYSTEM_MAP=""
if [ -f "/boot/System.map-{kernel_version}" ]; then
    SYSTEM_MAP="/boot/System.map-{kernel_version}"
    echo ">>> Found System.map: $SYSTEM_MAP"
else
    echo ">>> No System.map found, continuing without it..."
fi

# Generate symbol file
echo ">>> Generating Volatility3 symbol file..."
SYMBOL_FILE="$OUTPUT_DIR/{distro_name}_{rhel_version}_{kernel_version}.json"

if [ -n "$SYSTEM_MAP" ]; then
    /usr/local/bin/dwarf2json linux --elf "$VMLINUX" --system-map "$SYSTEM_MAP" > "$SYMBOL_FILE"
else
    /usr/local/bin/dwarf2json linux --elf "$VMLINUX" > "$SYMBOL_FILE"
fi

# Compress the symbol file
echo ">>> Compressing symbol file..."
xz -9 "$SYMBOL_FILE"

echo "=== Symbol generation completed successfully ==="
ls -la "$OUTPUT_DIR"
'''

    def _generate_oracle_script(self, kernel_version: str, oracle_version: str) -> str:
        """Generate the shell script for Oracle Linux with proper debuginfo repos."""
        # Determine repo suffix based on version
        repo_suffix = oracle_version  # e.g., "8" or "9"
        
        return f'''#!/bin/bash
set -e

echo "=== Starting symbol generation for Oracle Linux {oracle_version} kernel {kernel_version} ==="

# Save output directory (the mounted volume)
OUTPUT_DIR="$PWD"

# Update package lists
echo ">>> Updating package lists..."
dnf -y -q makecache

# Install required packages
echo ">>> Installing required packages..."
dnf -y -q install wget xz findutils dnf-plugins-core

# Add Oracle Linux debuginfo repository from oss.oracle.com (correct location)
echo ">>> Adding Oracle Linux debuginfo repository..."
cat > /etc/yum.repos.d/ol_debuginfo.repo << 'REPOEOF'
[ol_debuginfo]
name=Oracle Linux {oracle_version} Debuginfo
baseurl=https://oss.oracle.com/ol{repo_suffix}/debuginfo/
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-oracle
gpgcheck=1
enabled=1
REPOEOF

# Refresh metadata with new repos
echo ">>> Refreshing repository metadata..."
dnf -y makecache 2>&1 | tail -5

# List available debuginfo repos
echo ">>> Available debuginfo repos:"
dnf repolist | grep -i debug || true

# Try to install kernel debug symbols
echo ">>> Installing kernel debug symbols for {kernel_version}..."

# Detect kernel type and install appropriate debuginfo
if echo "{kernel_version}" | grep -q "uek"; then
    echo ">>> Detected UEK kernel..."
    dnf -y install kernel-uek-debuginfo-{kernel_version} 2>&1 | tail -10 || true
else
    echo ">>> Detected RHCK kernel..."
    dnf -y install kernel-debuginfo-{kernel_version} kernel-debuginfo-common-x86_64-{kernel_version} 2>&1 | tail -10 || true
fi

# Find vmlinux file
echo ">>> Looking for vmlinux..."
VMLINUX=$(find /usr/lib/debug -name "vmlinux-{kernel_version}*" -type f 2>/dev/null | head -1)
if [ -z "$VMLINUX" ]; then
    VMLINUX=$(find /usr/lib/debug -name "vmlinux*" -path "*{kernel_version}*" -type f 2>/dev/null | head -1)
fi

if [ -z "$VMLINUX" ] || [ ! -f "$VMLINUX" ]; then
    echo "ERROR: vmlinux not found in debug package"
    echo ">>> Searching for any vmlinux files..."
    find /usr/lib/debug -name "vmlinux*" -type f 2>/dev/null || true
    echo ">>> Listing installed debuginfo packages..."
    rpm -qa | grep -i debuginfo || true
    exit 1
fi
echo ">>> Found vmlinux: $VMLINUX"

# Download and setup dwarf2json
echo ">>> Setting up dwarf2json..."
wget -q https://github.com/volatilityfoundation/dwarf2json/releases/download/v0.8.0/dwarf2json-linux-amd64 -O /usr/local/bin/dwarf2json
chmod +x /usr/local/bin/dwarf2json

# Check for System.map
SYSTEM_MAP=""
if [ -f "/boot/System.map-{kernel_version}" ]; then
    SYSTEM_MAP="/boot/System.map-{kernel_version}"
    echo ">>> Found System.map: $SYSTEM_MAP"
else
    echo ">>> No System.map found, continuing without it..."
fi

# Generate symbol file
echo ">>> Generating Volatility3 symbol file..."
SYMBOL_FILE="$OUTPUT_DIR/Oracle_{oracle_version}_{kernel_version}.json"

if [ -n "$SYSTEM_MAP" ]; then
    /usr/local/bin/dwarf2json linux --elf "$VMLINUX" --system-map "$SYSTEM_MAP" > "$SYMBOL_FILE"
else
    /usr/local/bin/dwarf2json linux --elf "$VMLINUX" > "$SYMBOL_FILE"
fi

# Compress the symbol file
echo ">>> Compressing symbol file..."
xz -9 "$SYMBOL_FILE"

echo "=== Symbol generation completed successfully ==="
ls -la "$OUTPUT_DIR"
'''

    async def generate_symbol(
        self,
        job_id: int,
        kernel_version: str,
        distro: LinuxDistro,
        ubuntu_version: Optional[UbuntuVersion] = None,
        debian_version: Optional[DebianVersion] = None,
        fedora_version: Optional[FedoraVersion] = None,
        centos_version: Optional[CentOSVersion] = None,
        rhel_version: Optional[RHELVersion] = None,
        oracle_version: Optional[OracleVersion] = None,
        rocky_version: Optional[RockyVersion] = None,
        alma_version: Optional[AlmaVersion] = None,
    ) -> bool:
        """
        Submit a symbol generation job to the queue.
        
        Jobs are queued and only MAX_CONCURRENT_JOBS run at a time.
        
        Args:
            job_id: Database ID of the SymbolGeneration job
            kernel_version: Kernel version (e.g., "5.15.0-91-generic" or "5.10.0-28-amd64")
            distro: Linux distribution
            *_version: Version enum for the specific distro
            
        Returns:
            True if job was submitted successfully
        """
        # Submit to job queue
        started = await job_queue.submit_job(
            job_id,
            kernel_version,
            distro,
            ubuntu_version,
            debian_version,
            fedora_version,
            centos_version,
            rhel_version,
            oracle_version,
            rocky_version,
            alma_version,
        )
        
        if started:
            logger.info(f"Job {job_id} started immediately")
        else:
            logger.info(f"Job {job_id} added to queue (position {job_queue.get_queue_position(job_id)})")
        
        return True
    
    async def _execute_generation(
        self,
        job_id: int,
        kernel_version: str,
        distro: LinuxDistro,
        ubuntu_version: Optional[UbuntuVersion] = None,
        debian_version: Optional[DebianVersion] = None,
        fedora_version: Optional[FedoraVersion] = None,
        centos_version: Optional[CentOSVersion] = None,
        rhel_version: Optional[RHELVersion] = None,
        oracle_version: Optional[OracleVersion] = None,
        rocky_version: Optional[RockyVersion] = None,
        alma_version: Optional[AlmaVersion] = None,
    ) -> bool:
        """
        Actually execute the symbol generation in Docker.
        This is called by the JobQueue when the job is ready to run.
        
        Args:
            job_id: Database ID of the SymbolGeneration job
            kernel_version: Kernel version (e.g., "5.15.0-91-generic" or "5.10.0-28-amd64")
            distro: Linux distribution
            *_version: Version enum for the specific distro
            
        Returns:
            True if successful, False otherwise
        """
        ensure_directories()
        
        db = SessionLocal()
        container = None
        
        try:
            if not self.is_available():
                self._update_status(db, job_id, SymGenStatus.FAILED,
                                  error="Docker is not available")
                return False
            
            # Get image and script based on distro
            image = None
            script = None
            
            if distro == LinuxDistro.DEBIAN and debian_version:
                image = DEBIAN_IMAGES[debian_version]
                codename = DEBIAN_CODENAMES[debian_version]
                script = self._generate_debian_script(kernel_version, codename)
            elif distro == LinuxDistro.UBUNTU and ubuntu_version:
                image = UBUNTU_IMAGES[ubuntu_version]
                codename = UBUNTU_CODENAMES[ubuntu_version]
                script = self._generate_ubuntu_script(kernel_version, codename)
            elif distro == LinuxDistro.FEDORA and fedora_version:
                image = FEDORA_IMAGES[fedora_version]
                script = self._generate_fedora_script(kernel_version, fedora_version.value)
            elif distro == LinuxDistro.CENTOS and centos_version:
                image = CENTOS_IMAGES[centos_version]
                script = self._generate_rhel_script(kernel_version, centos_version.value, "CentOS")
            elif distro == LinuxDistro.RHEL and rhel_version:
                image = RHEL_IMAGES[rhel_version]
                script = self._generate_rhel_script(kernel_version, rhel_version.value, "RHEL")
            elif distro == LinuxDistro.ORACLE and oracle_version:
                image = ORACLE_IMAGES[oracle_version]
                script = self._generate_oracle_script(kernel_version, oracle_version.value)
            elif distro == LinuxDistro.ROCKY and rocky_version:
                image = ROCKY_IMAGES[rocky_version]
                script = self._generate_rhel_script(kernel_version, rocky_version.value, "Rocky")
            elif distro == LinuxDistro.ALMA and alma_version:
                image = ALMA_IMAGES[alma_version]
                script = self._generate_rhel_script(kernel_version, alma_version.value, "Alma")
            
            if not image or not script:
                self._update_status(db, job_id, SymGenStatus.FAILED,
                                  error="Invalid distro configuration")
                return False
            
            symbol_filename = get_symbol_filename(
                kernel_version, distro, ubuntu_version, debian_version,
                fedora_version, centos_version, rhel_version, oracle_version,
                rocky_version, alma_version
            )
            
            # Check if symbol already exists
            existing = check_existing_symbol(
                kernel_version, distro, ubuntu_version, debian_version,
                fedora_version, centos_version, rhel_version, oracle_version,
                rocky_version, alma_version
            )
            if existing:
                logger.info(f"Symbol already exists: {existing}")
                job = db.query(SymbolGeneration).filter(SymbolGeneration.id == job_id).first()
                if job:
                    job.status = SymGenStatus.COMPLETED
                    job.status_message = "Symbol already exists"
                    job.symbol_filename = symbol_filename
                    job.symbol_file_path = existing
                    job.symbol_file_size = os.path.getsize(existing)
                    job.completed_at = datetime.utcnow()
                    db.commit()
                    self._broadcast_job_update(job)  # Broadcast COMPLETED status
                return True
            
            # Pull image if needed
            self._update_status(db, job_id, SymGenStatus.PULLING_IMAGE,
                              message=f"Pulling {image}...")
            
            try:
                # Check if image exists (we'll always pull with platform to ensure correct arch)
                self.docker_client.images.get(image)
                logger.info(f"Image {image} found locally")
            except ImageNotFound:
                pass
            
            # Always pull to ensure we have the amd64 version
            logger.info(f"Pulling image {image} for linux/amd64 platform...")
            self.docker_client.images.pull(image, platform="linux/amd64")
            
            # Create temp output directory inside the uploads volume
            temp_subdir = f"symbols/temp_{job_id}"
            output_dir = os.path.join(UPLOAD_DIR, temp_subdir)
            os.makedirs(output_dir, exist_ok=True)
            
            # Script was already generated above based on distro
            script_path = os.path.join(output_dir, "generate.sh")
            with open(script_path, 'w') as f:
                f.write(script)
            os.chmod(script_path, 0o755)
            
            # Start container
            self._update_status(db, job_id, SymGenStatus.RUNNING,
                              message="Starting container...")
            
            logger.info(f"Starting container for job {job_id}")
            
            # Mount the Docker volume and use subdirectory for this job
            # The volume is mounted at /uploads in the symgen container
            # Our work directory will be /uploads/symbols/temp_{job_id}
            work_dir_in_container = f"/uploads/{temp_subdir}"
            
            container = self.docker_client.containers.run(
                image,
                command=["bash", f"{work_dir_in_container}/generate.sh"],
                volumes={
                    DOCKER_VOLUME_NAME: {'bind': '/uploads', 'mode': 'rw'},
                },
                working_dir=work_dir_in_container,
                platform="linux/amd64",
                detach=True,
                remove=False,
                mem_limit='8g',
                cpu_period=100000,
                cpu_quota=200000,  # 2 CPUs max
            )
            
            # Update container ID
            job = db.query(SymbolGeneration).filter(SymbolGeneration.id == job_id).first()
            if job:
                job.container_id = container.id[:12]
                db.commit()
            
            # Monitor container with real-time status updates
            self._update_status(db, job_id, SymGenStatus.DOWNLOADING_KERNEL,
                              message="Downloading kernel debug symbols...")
            
            # Stream logs and update status based on progress markers
            exit_code = await self._monitor_container(db, job_id, container)
            
            # Get full logs for debugging
            logs = container.logs().decode('utf-8')
            logger.info(f"Container logs for job {job_id}:\n{logs}")
            
            if exit_code != 0:
                self._update_status(db, job_id, SymGenStatus.FAILED,
                                  error=f"Container exited with code {exit_code}: {logs[-2000:]}")
                return False
            
            # Find generated symbol file
            self._update_status(db, job_id, SymGenStatus.GENERATING_SYMBOL,
                              message="Processing symbol file...")
            
            symbol_files = glob_module.glob(os.path.join(output_dir, "*.json.xz"))
            if not symbol_files:
                self._update_status(db, job_id, SymGenStatus.FAILED,
                                  error="No symbol file was generated")
                return False
            
            generated_file = symbol_files[0]
            final_path = os.path.join(SYMBOLS_DIR, symbol_filename)
            
            # Move to final location
            shutil.move(generated_file, final_path)
            
            # Update job as completed
            file_size = os.path.getsize(final_path)
            job = db.query(SymbolGeneration).filter(SymbolGeneration.id == job_id).first()
            if job:
                job.status = SymGenStatus.COMPLETED
                job.status_message = "Symbol generated successfully"
                job.symbol_filename = symbol_filename
                job.symbol_file_path = final_path
                job.symbol_file_size = file_size
                job.completed_at = datetime.utcnow()
                db.commit()
                self._broadcast_job_update(job)  # Broadcast COMPLETED status
            
            logger.info(f"Symbol generation completed: {symbol_filename}")
            return True
            
        except Exception as e:
            logger.exception(f"Symbol generation failed for job {job_id}")
            self._update_status(db, job_id, SymGenStatus.FAILED, error=str(e))
            return False
            
        finally:
            # Cleanup
            if container:
                try:
                    container.remove(force=True)
                except Exception:
                    pass
            
            # Cleanup temp directory
            temp_dir = os.path.join(SYMBOLS_DIR, f"temp_{job_id}")
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
            
            db.close()
    
    async def cancel_job_async(self, job_id: int) -> bool:
        """Cancel a job (async version for queue cancellation)."""
        # Try to cancel from queue first
        await job_queue.cancel_job(job_id)
        return self.cancel_job(job_id)
    
    def cancel_job(self, job_id: int) -> bool:
        """Cancel a running symbol generation job."""
        db = SessionLocal()
        try:
            job = db.query(SymbolGeneration).filter(SymbolGeneration.id == job_id).first()
            if not job:
                return False
            
            # Try to cancel from queue (sync version - checks if queued)
            queue_pos = job_queue.get_queue_position(job_id)
            if queue_pos:
                # Job is queued, will be removed by async cancel
                logger.info(f"Job {job_id} is queued at position {queue_pos}, marking as cancelled")
            
            if job.container_id and self.is_available():
                try:
                    container = self.docker_client.containers.get(job.container_id)
                    container.kill()
                    container.remove(force=True)
                except Exception as e:
                    logger.warning(f"Failed to stop container: {e}")
            
            job.status = SymGenStatus.FAILED
            job.error_message = "Cancelled by user"
            job.completed_at = datetime.utcnow()
            db.commit()
            return True
            
        finally:
            db.close()
    
    def delete_job(self, job_id: int) -> bool:
        """Delete a symbol generation job and its associated files."""
        db = SessionLocal()
        try:
            job = db.query(SymbolGeneration).filter(SymbolGeneration.id == job_id).first()
            if not job:
                return False
            
            # If job is still running, cancel it first
            if job.status in (SymGenStatus.PENDING, SymGenStatus.PULLING_IMAGE,
                            SymGenStatus.RUNNING, SymGenStatus.DOWNLOADING_KERNEL,
                            SymGenStatus.GENERATING_SYMBOL):
                if job.container_id and self.is_available():
                    try:
                        container = self.docker_client.containers.get(job.container_id)
                        container.kill()
                        container.remove(force=True)
                    except Exception as e:
                        logger.warning(f"Failed to stop container: {e}")
            
            # Delete symbol file if it exists
            if job.symbol_file_path and os.path.exists(job.symbol_file_path):
                try:
                    os.remove(job.symbol_file_path)
                    logger.info(f"Deleted symbol file: {job.symbol_file_path}")
                except Exception as e:
                    logger.warning(f"Failed to delete symbol file: {e}")
            
            # Clean up temp directory if it exists
            temp_dir = os.path.join(SYMBOLS_DIR, f"temp_{job_id}")
            if os.path.exists(temp_dir):
                try:
                    shutil.rmtree(temp_dir, ignore_errors=True)
                    logger.info(f"Deleted temp directory: {temp_dir}")
                except Exception as e:
                    logger.warning(f"Failed to delete temp directory: {e}")
            
            # Delete the database record
            db.delete(job)
            db.commit()
            logger.info(f"Deleted symbol generation job {job_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to delete job {job_id}: {e}")
            db.rollback()
            return False
        finally:
            db.close()


# Global instance
symbol_generator = SymbolGenerator()
