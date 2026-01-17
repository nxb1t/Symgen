from sqlalchemy import Column, Integer, BigInteger, String, DateTime, func, Text, Enum as SQLEnum
from app.database import Base
import enum


class SymGenStatus(str, enum.Enum):
    PENDING = "pending"
    PULLING_IMAGE = "pulling_image"
    RUNNING = "running"
    DOWNLOADING_KERNEL = "downloading_kernel"
    GENERATING_SYMBOL = "generating_symbol"
    COMPLETED = "completed"
    FAILED = "failed"


class LinuxDistro(str, enum.Enum):
    UBUNTU = "ubuntu"
    DEBIAN = "debian"


class UbuntuVersion(str, enum.Enum):
    UBUNTU_20_04 = "20.04"
    UBUNTU_22_04 = "22.04"
    UBUNTU_24_04 = "24.04"


class DebianVersion(str, enum.Enum):
    DEBIAN_10 = "10"  # Buster
    DEBIAN_11 = "11"  # Bullseye
    DEBIAN_12 = "12"  # Bookworm


class SymbolGeneration(Base):
    """Tracks Linux symbol generation jobs using Docker containers."""
    __tablename__ = "symbol_generations"

    id = Column(Integer, primary_key=True, index=True)
    # Kernel info
    kernel_version = Column(String, nullable=False)  # e.g., "5.15.0-91-generic" or "5.10.0-28-amd64"
    # Linux distribution info
    distro = Column(SQLEnum(LinuxDistro, values_callable=lambda x: [e.value for e in x]), default=LinuxDistro.UBUNTU)
    ubuntu_version = Column(SQLEnum(UbuntuVersion, values_callable=lambda x: [e.value for e in x]), nullable=True)
    debian_version = Column(SQLEnum(DebianVersion, values_callable=lambda x: [e.value for e in x]), nullable=True)
    # Job status
    status = Column(SQLEnum(SymGenStatus, values_callable=lambda x: [e.value for e in x]), default=SymGenStatus.PENDING)
    status_message = Column(String, nullable=True)  # Human-readable progress
    error_message = Column(Text, nullable=True)
    # Docker container info
    container_id = Column(String, nullable=True)
    # Generated symbol info
    symbol_filename = Column(String, nullable=True)  # e.g., "Ubuntu_jammy_5.15.0-91-generic.json.xz"
    symbol_file_path = Column(String, nullable=True)
    symbol_file_size = Column(BigInteger, nullable=True)
    # Download tracking
    download_count = Column(Integer, default=0)
    # Timestamps
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
