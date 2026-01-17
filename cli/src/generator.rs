use anyhow::{anyhow, Context, Result};
use indicatif::{ProgressBar, ProgressStyle};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;

use crate::distros::{find_version, Distro, DistroVersion};
use crate::docker::DockerClient;
use crate::output::{JsonResult, Output};

/// Result of symbol generation
#[derive(Debug, Serialize)]
pub struct GenerationResult {
    pub kernel_version: String,
    pub distro: String,
    pub distro_version: String,
    pub symbol_file: String,
    pub file_size: u64,
}

/// Symbol generator using Docker
pub struct SymbolGenerator {
    docker: DockerClient,
}

impl SymbolGenerator {
    /// Create a new symbol generator
    pub async fn new() -> Result<Self> {
        let docker = DockerClient::new().await?;
        Ok(Self { docker })
    }

    /// Generate a Volatility3 symbol file
    pub async fn generate(
        &self,
        kernel: &str,
        distro_str: &str,
        version: &str,
        output_dir: Option<&str>,
        output: &Output,
    ) -> Result<()> {
        // Parse distro
        let distro = Distro::from_str(distro_str)
            .ok_or_else(|| anyhow!("Unknown distribution: {}", distro_str))?;

        // Find version
        let distro_version = find_version(distro, version)
            .ok_or_else(|| anyhow!("Unsupported version {} for {}", version, distro.display_name()))?;

        output.info(&format!(
            "Generating symbol for {} {} kernel {}",
            distro.display_name(),
            version,
            kernel
        ));

        // Determine output directory
        let output_path = match output_dir {
            Some(dir) => PathBuf::from(dir),
            None => std::env::current_dir().context("Failed to get current directory")?,
        };

        // Ensure output directory exists
        std::fs::create_dir_all(&output_path)
            .context("Failed to create output directory")?;

        // Generate symbol filename
        let symbol_filename = self.get_symbol_filename(kernel, &distro_version);
        let symbol_path = output_path.join(&symbol_filename);

        // Check if symbol already exists
        if symbol_path.exists() {
            output.warning(&format!("Symbol file already exists: {}", symbol_path.display()));
            return Ok(());
        }

        // Pull Docker image
        output.progress(&format!("Pulling image {}...", distro_version.docker_image));
        self.docker.pull_image(&distro_version.docker_image).await?;
        output.success("Image ready");

        // Generate shell script
        let script = self.generate_script(kernel, &distro_version);

        // Create progress bar for non-JSON mode
        let progress = if !output.is_json() {
            let pb = ProgressBar::new_spinner();
            pb.set_style(
                ProgressStyle::default_spinner()
                    .template("{spinner:.cyan} {msg}")
                    .unwrap(),
            );
            pb.enable_steady_tick(Duration::from_millis(100));
            Some(pb)
        } else {
            None
        };

        // Run container
        output.progress("Running symbol generation in container...");

        let exit_code = self
            .docker
            .run_container(
                &distro_version.docker_image,
                &script,
                &output_path,
                |log| {
                    // Parse progress from log lines
                    let trimmed = log.trim();
                    if trimmed.starts_with(">>>") || trimmed.starts_with("===") {
                        if let Some(pb) = &progress {
                            pb.set_message(trimmed.to_string());
                        }
                        if output.is_json() {
                            output.progress(trimmed);
                        }
                    }
                },
            )
            .await?;

        // Clear progress bar
        if let Some(pb) = progress {
            pb.finish_and_clear();
        }

        // Check exit code
        if exit_code != 0 {
            output.error(&format!("Container exited with code {}", exit_code));
            return Err(anyhow!("Symbol generation failed"));
        }

        // Verify symbol file was created
        if !symbol_path.exists() {
            return Err(anyhow!("Symbol file was not created"));
        }

        let file_size = std::fs::metadata(&symbol_path)
            .context("Failed to get file metadata")?
            .len();

        output.success(&format!(
            "Symbol file created: {} ({} bytes)",
            symbol_path.display(),
            file_size
        ));

        // Output JSON result if in JSON mode
        if output.is_json() {
            output.result(JsonResult {
                success: true,
                data: Some(GenerationResult {
                    kernel_version: kernel.to_string(),
                    distro: distro.display_name().to_string(),
                    distro_version: version.to_string(),
                    symbol_file: symbol_path.to_string_lossy().to_string(),
                    file_size,
                }),
                error: None,
            });
        }

        Ok(())
    }

    /// Generate the symbol filename
    fn get_symbol_filename(&self, kernel: &str, version: &DistroVersion) -> String {
        let distro_prefix = match version.distro {
            Distro::Ubuntu => format!("Ubuntu_{}", version.codename.as_ref().unwrap_or(&version.version)),
            Distro::Debian => format!("Debian_{}", version.codename.as_ref().unwrap_or(&version.version)),
            Distro::Fedora => format!("Fedora_{}", version.version),
            Distro::CentOS => format!("CentOS_{}", version.version),
            Distro::RHEL => format!("RHEL_{}", version.version),
            Distro::Oracle => format!("Oracle_{}", version.version),
            Distro::Rocky => format!("Rocky_{}", version.version),
            Distro::Alma => format!("Alma_{}", version.version),
        };
        format!("{}_{}.json.xz", distro_prefix, kernel)
    }

    /// Generate the shell script for symbol generation
    fn generate_script(&self, kernel: &str, version: &DistroVersion) -> String {
        match version.distro {
            Distro::Ubuntu => self.generate_ubuntu_script(kernel, version.codename.as_deref().unwrap_or("jammy")),
            Distro::Debian => self.generate_debian_script(kernel, version.codename.as_deref().unwrap_or("bookworm")),
            Distro::Fedora => self.generate_fedora_script(kernel, &version.version),
            Distro::CentOS => self.generate_rhel_script(kernel, &version.version, "CentOS"),
            Distro::RHEL => self.generate_rhel_script(kernel, &version.version, "RHEL"),
            Distro::Oracle => self.generate_oracle_script(kernel, &version.version),
            Distro::Rocky => self.generate_rhel_script(kernel, &version.version, "Rocky"),
            Distro::Alma => self.generate_rhel_script(kernel, &version.version, "Alma"),
        }
    }

    fn generate_ubuntu_script(&self, kernel: &str, codename: &str) -> String {
        format!(
            r#"#!/bin/bash
set -e

echo "=== Starting symbol generation for Ubuntu kernel {kernel} ==="

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
echo ">>> Installing kernel debug symbols for {kernel}..."
if ! apt-get install -y -qq linux-image-{kernel}-dbgsym 2>/dev/null; then
    echo "ERROR: Could not find/install debug symbols for kernel {kernel}"
    exit 1
fi

# Install linux-modules package to get System.map
echo ">>> Installing linux-modules for System.map..."
apt-get install -y -qq linux-modules-{kernel} 2>/dev/null || true

# Find vmlinux file from installed location
echo ">>> Looking for vmlinux..."
VMLINUX="/usr/lib/debug/boot/vmlinux-{kernel}"
if [ ! -f "$VMLINUX" ]; then
    # Try alternative location
    VMLINUX=$(find /usr/lib/debug -name "vmlinux-{kernel}" -type f 2>/dev/null | head -1)
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
if [ -f "/boot/System.map-{kernel}" ]; then
    SYSTEM_MAP="/boot/System.map-{kernel}"
    echo ">>> Found System.map: $SYSTEM_MAP"
else
    echo ">>> No System.map found, continuing without it..."
fi

# Generate symbol file (output to the mounted volume)
echo ">>> Generating Volatility3 symbol file..."
SYMBOL_FILE="$OUTPUT_DIR/Ubuntu_{codename}_{kernel}.json"

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
"#
        )
    }

    fn generate_debian_script(&self, kernel: &str, codename: &str) -> String {
        format!(
            r#"#!/bin/bash
set -e

echo "=== Starting symbol generation for Debian kernel {kernel} ==="

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
echo ">>> Installing kernel debug symbols for {kernel}..."
# Debian uses linux-image-<version>-dbg package naming
if ! apt-get install -y -qq linux-image-{kernel}-dbg 2>/dev/null; then
    # Try alternative package name
    echo ">>> Trying alternative package name..."
    if ! apt-get install -y -qq linux-image-{kernel}-unsigned-dbg 2>/dev/null; then
        echo "ERROR: Could not find/install debug symbols for kernel {kernel}"
        echo ">>> Available debug packages:"
        apt-cache search linux-image | grep dbg || true
        exit 1
    fi
fi

# Install linux-image package to get System.map
echo ">>> Installing linux-image for System.map..."
apt-get install -y -qq linux-image-{kernel} 2>/dev/null || true

# Find vmlinux file from installed location
echo ">>> Looking for vmlinux..."
VMLINUX="/usr/lib/debug/boot/vmlinux-{kernel}"
if [ ! -f "$VMLINUX" ]; then
    # Try alternative locations
    VMLINUX=$(find /usr/lib/debug -name "vmlinux-{kernel}" -type f 2>/dev/null | head -1)
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
if [ -f "/boot/System.map-{kernel}" ]; then
    SYSTEM_MAP="/boot/System.map-{kernel}"
    echo ">>> Found System.map: $SYSTEM_MAP"
else
    echo ">>> No System.map found, continuing without it..."
fi

# Generate symbol file (output to the mounted volume)
echo ">>> Generating Volatility3 symbol file..."
SYMBOL_FILE="$OUTPUT_DIR/Debian_{codename}_{kernel}.json"

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
"#
        )
    }

    fn generate_fedora_script(&self, kernel: &str, fedora_version: &str) -> String {
        format!(
            r#"#!/bin/bash
set -e

echo "=== Starting symbol generation for Fedora {fedora_version} kernel {kernel} ==="

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
echo ">>> Installing kernel debug symbols for {kernel}..."
if ! dnf -y -q install kernel-debuginfo-{kernel} 2>/dev/null; then
    # Try with common suffix variants
    if ! dnf -y -q install kernel-debuginfo-common-x86_64-{kernel} kernel-debuginfo-{kernel} 2>/dev/null; then
        echo "ERROR: Could not find/install debug symbols for kernel {kernel}"
        echo ">>> Available debug packages:"
        dnf search kernel-debuginfo 2>/dev/null | head -20 || true
        exit 1
    fi
fi

# Find vmlinux file (exclude .py/.pyc files and search in kernel module path)
echo ">>> Looking for vmlinux..."
VMLINUX=$(find /usr/lib/debug -path "*{kernel}*/vmlinux" -type f 2>/dev/null | head -1)
if [ -z "$VMLINUX" ]; then
    VMLINUX=$(find /usr/lib/debug -name "vmlinux" -type f 2>/dev/null | grep "{kernel}" | head -1)
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
if [ -f "/boot/System.map-{kernel}" ]; then
    SYSTEM_MAP="/boot/System.map-{kernel}"
    echo ">>> Found System.map: $SYSTEM_MAP"
else
    echo ">>> No System.map found, continuing without it..."
fi

# Generate symbol file
echo ">>> Generating Volatility3 symbol file..."
SYMBOL_FILE="$OUTPUT_DIR/Fedora_{fedora_version}_{kernel}.json"

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
"#
        )
    }

    fn generate_rhel_script(&self, kernel: &str, rhel_version: &str, distro_name: &str) -> String {
        format!(
            r#"#!/bin/bash
set -e

echo "=== Starting symbol generation for {distro_name} {rhel_version} kernel {kernel} ==="

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
debuginfo-install -y kernel-{kernel} 2>/dev/null || true

# Alternative: try to install kernel-debuginfo directly
echo ">>> Installing kernel debug symbols for {kernel}..."
if ! yum -y -q install kernel-debuginfo-{kernel} 2>/dev/null; then
    if ! dnf -y -q install kernel-debuginfo-{kernel} 2>/dev/null; then
        # Try common package
        yum -y -q install kernel-debuginfo-common-x86_64-{kernel} kernel-debuginfo-{kernel} 2>/dev/null || \
        dnf -y -q install kernel-debuginfo-common-x86_64-{kernel} kernel-debuginfo-{kernel} 2>/dev/null || true
    fi
fi

# Find vmlinux file
echo ">>> Looking for vmlinux..."
VMLINUX=$(find /usr/lib/debug -name "vmlinux-{kernel}*" -type f 2>/dev/null | head -1)
if [ -z "$VMLINUX" ]; then
    VMLINUX=$(find /usr/lib/debug -name "vmlinux*" -path "*{kernel}*" -type f 2>/dev/null | head -1)
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
if [ -f "/boot/System.map-{kernel}" ]; then
    SYSTEM_MAP="/boot/System.map-{kernel}"
    echo ">>> Found System.map: $SYSTEM_MAP"
else
    echo ">>> No System.map found, continuing without it..."
fi

# Generate symbol file
echo ">>> Generating Volatility3 symbol file..."
SYMBOL_FILE="$OUTPUT_DIR/{distro_name}_{rhel_version}_{kernel}.json"

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
"#
        )
    }

    fn generate_oracle_script(&self, kernel: &str, oracle_version: &str) -> String {
        format!(
            r#"#!/bin/bash
set -e

echo "=== Starting symbol generation for Oracle Linux {oracle_version} kernel {kernel} ==="

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
baseurl=https://oss.oracle.com/ol{oracle_version}/debuginfo/
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
echo ">>> Installing kernel debug symbols for {kernel}..."

# Detect kernel type and install appropriate debuginfo
if echo "{kernel}" | grep -q "uek"; then
    echo ">>> Detected UEK kernel..."
    dnf -y install kernel-uek-debuginfo-{kernel} 2>&1 | tail -10 || true
else
    echo ">>> Detected RHCK kernel..."
    dnf -y install kernel-debuginfo-{kernel} kernel-debuginfo-common-x86_64-{kernel} 2>&1 | tail -10 || true
fi

# Find vmlinux file
echo ">>> Looking for vmlinux..."
VMLINUX=$(find /usr/lib/debug -name "vmlinux-{kernel}*" -type f 2>/dev/null | head -1)
if [ -z "$VMLINUX" ]; then
    VMLINUX=$(find /usr/lib/debug -name "vmlinux*" -path "*{kernel}*" -type f 2>/dev/null | head -1)
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
if [ -f "/boot/System.map-{kernel}" ]; then
    SYSTEM_MAP="/boot/System.map-{kernel}"
    echo ">>> Found System.map: $SYSTEM_MAP"
else
    echo ">>> No System.map found, continuing without it..."
fi

# Generate symbol file
echo ">>> Generating Volatility3 symbol file..."
SYMBOL_FILE="$OUTPUT_DIR/Oracle_{oracle_version}_{kernel}.json"

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
"#
        )
    }
}
