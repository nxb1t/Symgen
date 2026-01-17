use clap::{Parser, Subcommand};

/// Volatility3 Linux Symbol Generator
///
/// Generate symbol files for Linux kernel memory forensics.
/// Supports Ubuntu, Debian, Fedora, CentOS, RHEL, Oracle, Rocky, and AlmaLinux.
#[derive(Parser, Debug)]
#[command(name = "symgen")]
#[command(author, version, about, long_about = None)]
#[command(propagate_version = true)]
pub struct Cli {
    /// Output in JSON format
    #[arg(long, global = true)]
    pub json: bool,

    /// Verbose output
    #[arg(short, long, global = true)]
    pub verbose: bool,

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Generate a Volatility3 symbol file for a Linux kernel
    #[command(alias = "gen", after_help = "EXAMPLES:
    # Generate from kernel banner (auto-detects distro, release, and kernel):
    symgen generate -b \"Linux version 5.15.0-91-generic (buildd@...) (gcc (Ubuntu 11.4.0-1ubuntu1~22.04) ...)\"

    # Generate with explicit parameters:
    symgen generate -k 5.15.0-91-generic -d ubuntu -r 22.04
    symgen generate -k 6.1.0-18-amd64 -d debian -r 12
    symgen generate -k 5.14.0-427.el9 -d rocky -r 9")]
    Generate {
        /// Kernel banner string (from /proc/version or volatility banner output).
        /// Auto-detects kernel version, distribution, and version.
        /// Example: "Linux version 5.15.0-91-generic ... (gcc (Ubuntu 11.4.0-1ubuntu1~22.04) ...)"
        #[arg(short, long, conflicts_with_all = ["kernel", "distro", "version"])]
        banner: Option<String>,

        /// Kernel version (e.g., 5.15.0-91-generic, 6.1.0-18-amd64)
        #[arg(short, long, required_unless_present = "banner")]
        kernel: Option<String>,

        /// Linux distribution (ubuntu, debian, fedora, centos, rhel, oracle, rocky, alma)
        #[arg(short, long, required_unless_present = "banner")]
        distro: Option<String>,

        /// Distribution version (e.g., 22.04 for Ubuntu, 12 for Debian, 40 for Fedora)
        #[arg(short = 'r', long = "release", required_unless_present = "banner")]
        distro_version: Option<String>,

        /// Output directory for the symbol file (default: current directory)
        #[arg(short, long)]
        output_dir: Option<String>,
    },

    /// List supported distributions and versions
    List,

    /// Check if Docker is available
    Check,
}
