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
from typing import Optional, Tuple

import docker
from docker.errors import ImageNotFound, ContainerError, APIError
from sqlalchemy.orm import Session

from app.models import SymbolGeneration, SymGenStatus, UbuntuVersion, DebianVersion, LinuxDistro
from app.database import SessionLocal

logger = logging.getLogger(__name__)

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


def ensure_directories():
    """Ensure required directories exist."""
    os.makedirs(SYMBOLS_DIR, exist_ok=True)


def parse_kernel_version(banner: str) -> Optional[Tuple[str, LinuxDistro, Optional[UbuntuVersion], Optional[DebianVersion]]]:
    """
    Parse kernel version and distro from kernel banner.
    
    Example Ubuntu banner:
    "Linux version 5.15.0-91-generic (buildd@lcy02-amd64-086) 
     (gcc (Ubuntu 11.4.0-1ubuntu1~22.04) 11.4.0, GNU ld (GNU Binutils for Ubuntu) 2.38)"
    
    Example Debian banner:
    "Linux version 5.10.0-28-amd64 (debian-kernel@lists.debian.org)
     (gcc-10 (Debian 10.2.1-6) 10.2.1 20210110, GNU ld (GNU Binutils for Debian) 2.35.2)"
    
    Returns:
        Tuple of (kernel_version, distro, ubuntu_version, debian_version) or None
    """
    if not banner:
        return None
    
    banner_lower = banner.lower()
    
    # Detect if it's Debian or Ubuntu
    is_debian = "debian" in banner_lower
    is_ubuntu = "ubuntu" in banner_lower
    
    # Extract kernel version - different patterns for Ubuntu vs Debian
    kernel_version = None
    
    if is_debian:
        # Debian pattern: 5.10.0-28-amd64, 6.1.0-18-amd64
        kernel_match = re.search(r'Linux version (\d+\.\d+\.\d+-\d+-amd64)', banner)
        if not kernel_match:
            kernel_match = re.search(r'(\d+\.\d+\.\d+-\d+-amd64)', banner)
    else:
        # Ubuntu pattern: 5.15.0-91-generic
        kernel_match = re.search(r'Linux version (\d+\.\d+\.\d+-\d+-[a-z]+)', banner)
        if not kernel_match:
            kernel_match = re.search(r'(\d+\.\d+\.\d+-\d+-generic)', banner)
    
    if not kernel_match:
        return None
    
    kernel_version = kernel_match.group(1)
    
    # Determine distro and version
    if is_debian:
        distro = LinuxDistro.DEBIAN
        ubuntu_version = None
        debian_version = None
        
        # Detect Debian version
        if "buster" in banner_lower or "debian 10" in banner_lower:
            debian_version = DebianVersion.DEBIAN_10
        elif "bullseye" in banner_lower or "debian 11" in banner_lower:
            debian_version = DebianVersion.DEBIAN_11
        elif "bookworm" in banner_lower or "debian 12" in banner_lower:
            debian_version = DebianVersion.DEBIAN_12
        else:
            # Guess based on kernel version
            major_minor = kernel_version.split('-')[0]
            if major_minor.startswith("4.19."):
                debian_version = DebianVersion.DEBIAN_10
            elif major_minor.startswith("5.10."):
                debian_version = DebianVersion.DEBIAN_11
            elif major_minor.startswith("6.1."):
                debian_version = DebianVersion.DEBIAN_12
        
        return kernel_version, distro, None, debian_version
    else:
        # Ubuntu
        distro = LinuxDistro.UBUNTU
        ubuntu_version = None
        
        if "~22.04" in banner or "jammy" in banner_lower:
            ubuntu_version = UbuntuVersion.UBUNTU_22_04
        elif "~20.04" in banner or "focal" in banner_lower:
            ubuntu_version = UbuntuVersion.UBUNTU_20_04
        elif "~24.04" in banner or "noble" in banner_lower:
            ubuntu_version = UbuntuVersion.UBUNTU_24_04
        else:
            # Guess based on kernel version
            major_minor = kernel_version.split('-')[0]
            if major_minor.startswith("5.4."):
                ubuntu_version = UbuntuVersion.UBUNTU_20_04
            elif major_minor.startswith("5.15.") or major_minor.startswith("5.19."):
                ubuntu_version = UbuntuVersion.UBUNTU_22_04
            elif major_minor.startswith("6."):
                ubuntu_version = UbuntuVersion.UBUNTU_24_04
        
        return kernel_version, distro, ubuntu_version, None


def get_symbol_filename(kernel_version: str, distro: LinuxDistro, 
                        ubuntu_version: Optional[UbuntuVersion] = None,
                        debian_version: Optional[DebianVersion] = None) -> str:
    """Generate symbol filename."""
    if distro == LinuxDistro.DEBIAN and debian_version:
        codename = DEBIAN_CODENAMES[debian_version]
        return f"Debian_{codename}_{kernel_version}.json.xz"
    elif distro == LinuxDistro.UBUNTU and ubuntu_version:
        codename = UBUNTU_CODENAMES[ubuntu_version]
        return f"Ubuntu_{codename}_{kernel_version}.json.xz"
    else:
        # Fallback
        return f"Linux_{kernel_version}.json.xz"


def check_existing_symbol(kernel_version: str, distro: LinuxDistro,
                          ubuntu_version: Optional[UbuntuVersion] = None,
                          debian_version: Optional[DebianVersion] = None) -> Optional[str]:
    """Check if symbol already exists."""
    filename = get_symbol_filename(kernel_version, distro, ubuntu_version, debian_version)
    
    # Check centralized symbols directory
    symbol_path = os.path.join(SYMBOLS_DIR, filename)
    if os.path.exists(symbol_path):
        return symbol_path
    
    return None


class SymbolGenerator:
    """Handles Docker-based symbol generation."""
    
    def __init__(self):
        self.docker_client = None
        self._connect_docker()
    
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
    
    def _broadcast_job_update(self, job: SymbolGeneration):
        """Log job update - WebSocket broadcast handled by polling on frontend."""
        status_value = job.status.value if job.status else None
        logger.info(f"[SymGen] Job {job.id} status updated: {status_value}")
    
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

    async def generate_symbol(self, job_id: int, kernel_version: str,
                              distro: LinuxDistro,
                              ubuntu_version: Optional[UbuntuVersion] = None,
                              debian_version: Optional[DebianVersion] = None) -> bool:
        """
        Generate a Volatility3 symbol file using Docker.
        
        Args:
            job_id: Database ID of the SymbolGeneration job
            kernel_version: Kernel version (e.g., "5.15.0-91-generic" or "5.10.0-28-amd64")
            distro: Linux distribution (Ubuntu or Debian)
            ubuntu_version: Ubuntu version enum (if distro is Ubuntu)
            debian_version: Debian version enum (if distro is Debian)
            
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
            
            # Get image and codename based on distro
            if distro == LinuxDistro.DEBIAN and debian_version:
                image = DEBIAN_IMAGES[debian_version]
                codename = DEBIAN_CODENAMES[debian_version]
            elif distro == LinuxDistro.UBUNTU and ubuntu_version:
                image = UBUNTU_IMAGES[ubuntu_version]
                codename = UBUNTU_CODENAMES[ubuntu_version]
            else:
                self._update_status(db, job_id, SymGenStatus.FAILED,
                                  error="Invalid distro configuration")
                return False
            
            symbol_filename = get_symbol_filename(kernel_version, distro, ubuntu_version, debian_version)
            
            # Check if symbol already exists
            existing = check_existing_symbol(kernel_version, distro, ubuntu_version, debian_version)
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
            
            # Generate script in the output directory based on distro
            if distro == LinuxDistro.DEBIAN:
                script = self._generate_debian_script(kernel_version, codename)
            else:
                script = self._generate_ubuntu_script(kernel_version, codename)
            
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
    
    def cancel_job(self, job_id: int) -> bool:
        """Cancel a running symbol generation job."""
        db = SessionLocal()
        try:
            job = db.query(SymbolGeneration).filter(SymbolGeneration.id == job_id).first()
            if not job:
                return False
            
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
