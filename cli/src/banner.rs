use serde::Serialize;

/// Result of parsing a kernel banner
#[derive(Debug, Serialize)]
pub struct BannerParseResult {
    pub kernel_version: String,
    pub distro: Option<String>,
    pub distro_version: Option<String>,
    /// Suggested symgen command to generate the symbol
    pub suggested_command: Option<String>,
}

/// Parse a kernel banner string to extract kernel version and distro information.
///
/// Supports various banner formats:
/// - Ubuntu: "Linux version 5.15.0-91-generic (buildd@...) (gcc (Ubuntu 11.4.0-1ubuntu1~22.04)..."
/// - Debian: "Linux version 5.10.0-28-amd64 (debian-kernel@...) (gcc-10 (Debian 10.2.1-6)..."
/// - Fedora: "Linux version 6.5.6-300.fc39.x86_64 (mockbuild@...) (gcc (GCC) 13.2.1..."
/// - RHEL/CentOS: "Linux version 4.18.0-513.el8.x86_64 (mockbuild@...) (gcc (GCC) 8.5.0..."
pub fn parse_banner(banner: &str) -> Option<BannerParseResult> {
    if banner.is_empty() {
        return None;
    }

    let banner_lower = banner.to_lowercase();

    // Detect distribution
    let is_ubuntu = banner_lower.contains("ubuntu");
    let is_debian = banner_lower.contains("debian");
    let is_fedora = banner_lower.contains("fedora") || banner_lower.contains(".fc");
    let is_rhel = banner_lower.contains("red hat") || banner_lower.contains(".el");
    let is_centos = banner_lower.contains("centos");
    let is_rocky = banner_lower.contains("rocky");
    let is_alma = banner_lower.contains("alma");
    let is_oracle = banner_lower.contains("oracle") || banner_lower.contains(".ol");

    // Extract kernel version based on detected distro
    let kernel_version = extract_kernel_version(banner, &banner_lower, 
        is_ubuntu, is_debian, is_fedora, is_rhel, is_centos, is_rocky, is_alma, is_oracle)?;

    // Determine distro and version
    let (distro, distro_version) = determine_distro_version(
        banner, &banner_lower, &kernel_version,
        is_ubuntu, is_debian, is_fedora, is_rhel, is_centos, is_rocky, is_alma, is_oracle
    );

    // Generate suggested command
    let suggested_command = if let (Some(ref d), Some(ref v)) = (&distro, &distro_version) {
        Some(format!(
            "symgen generate -k {} -d {} -V {}",
            kernel_version,
            d.to_lowercase(),
            v
        ))
    } else {
        None
    };

    Some(BannerParseResult {
        kernel_version,
        distro,
        distro_version,
        suggested_command,
    })
}

fn extract_kernel_version(
    banner: &str,
    _banner_lower: &str,
    is_ubuntu: bool,
    is_debian: bool,
    is_fedora: bool,
    is_rhel: bool,
    is_centos: bool,
    is_rocky: bool,
    is_alma: bool,
    is_oracle: bool,
) -> Option<String> {
    use regex::Regex;

    if is_debian {
        // Debian pattern: 5.10.0-28-amd64, 6.1.0-18-amd64
        let re = Regex::new(r"Linux version (\d+\.\d+\.\d+-\d+-amd64)").ok()?;
        if let Some(cap) = re.captures(banner) {
            return Some(cap[1].to_string());
        }
        let re = Regex::new(r"(\d+\.\d+\.\d+-\d+-amd64)").ok()?;
        if let Some(cap) = re.captures(banner) {
            return Some(cap[1].to_string());
        }
    } else if is_ubuntu {
        // Ubuntu pattern: 5.15.0-91-generic
        let re = Regex::new(r"Linux version (\d+\.\d+\.\d+-\d+-[a-z]+)").ok()?;
        if let Some(cap) = re.captures(banner) {
            return Some(cap[1].to_string());
        }
        let re = Regex::new(r"(\d+\.\d+\.\d+-\d+-generic)").ok()?;
        if let Some(cap) = re.captures(banner) {
            return Some(cap[1].to_string());
        }
    } else if is_fedora {
        // Fedora pattern: 6.5.6-300.fc39.x86_64
        let re = Regex::new(r"Linux version (\d+\.\d+\.\d+-\d+\.fc\d+\.[a-z0-9_]+)").ok()?;
        if let Some(cap) = re.captures(banner) {
            return Some(cap[1].to_string());
        }
        let re = Regex::new(r"(\d+\.\d+\.\d+-\d+\.fc\d+\.[a-z0-9_]+)").ok()?;
        if let Some(cap) = re.captures(banner) {
            return Some(cap[1].to_string());
        }
    } else if is_rhel || is_centos || is_rocky || is_alma || is_oracle {
        // RHEL-based pattern: 4.18.0-513.el8.x86_64, 5.14.0-362.el9.x86_64
        let re = Regex::new(r"Linux version (\d+\.\d+\.\d+-[\d.]+\.el\d+[a-z0-9_.]*)").ok()?;
        if let Some(cap) = re.captures(banner) {
            return Some(cap[1].to_string());
        }
        let re = Regex::new(r"(\d+\.\d+\.\d+-[\d.]+\.el\d+[a-z0-9_.]*)").ok()?;
        if let Some(cap) = re.captures(banner) {
            return Some(cap[1].to_string());
        }
        // Oracle UEK pattern: 5.15.0-100.96.32.el8uek.x86_64
        let re = Regex::new(r"(\d+\.\d+\.\d+-[\d.]+\.el\d+uek[a-z0-9_.]*)").ok()?;
        if let Some(cap) = re.captures(banner) {
            return Some(cap[1].to_string());
        }
    }

    // Generic fallback
    let re = Regex::new(r"Linux version (\d+\.\d+\.\d+[^\s]*)").ok()?;
    if let Some(cap) = re.captures(banner) {
        return Some(cap[1].to_string());
    }
    let re = Regex::new(r"(\d+\.\d+\.\d+-\d+-[a-z]+)").ok()?;
    if let Some(cap) = re.captures(banner) {
        return Some(cap[1].to_string());
    }

    None
}

fn determine_distro_version(
    banner: &str,
    banner_lower: &str,
    kernel_version: &str,
    is_ubuntu: bool,
    is_debian: bool,
    is_fedora: bool,
    is_rhel: bool,
    is_centos: bool,
    is_rocky: bool,
    is_alma: bool,
    is_oracle: bool,
) -> (Option<String>, Option<String>) {
    use regex::Regex;

    if is_ubuntu {
        let version = if banner.contains("~24.04") || banner_lower.contains("noble") {
            Some("24.04".to_string())
        } else if banner.contains("~22.04") || banner_lower.contains("jammy") {
            Some("22.04".to_string())
        } else if banner.contains("~20.04") || banner_lower.contains("focal") {
            Some("20.04".to_string())
        } else {
            // Guess from kernel version
            let major_minor = kernel_version.split('-').next().unwrap_or("");
            if major_minor.starts_with("5.4.") {
                Some("20.04".to_string())
            } else if major_minor.starts_with("5.15.") || major_minor.starts_with("5.19.") {
                Some("22.04".to_string())
            } else if major_minor.starts_with("6.") {
                Some("24.04".to_string())
            } else {
                None
            }
        };
        return (Some("Ubuntu".to_string()), version);
    }

    if is_debian {
        let version = if banner_lower.contains("buster") || banner_lower.contains("debian 10") {
            Some("10".to_string())
        } else if banner_lower.contains("bullseye") || banner_lower.contains("debian 11") {
            Some("11".to_string())
        } else if banner_lower.contains("bookworm") || banner_lower.contains("debian 12") {
            Some("12".to_string())
        } else {
            // Guess from kernel version
            let major_minor = kernel_version.split('-').next().unwrap_or("");
            if major_minor.starts_with("4.19.") {
                Some("10".to_string())
            } else if major_minor.starts_with("5.10.") {
                Some("11".to_string())
            } else if major_minor.starts_with("6.1.") {
                Some("12".to_string())
            } else {
                None
            }
        };
        return (Some("Debian".to_string()), version);
    }

    if is_fedora {
        // Extract Fedora version from kernel (e.g., fc39 -> 39)
        let re = Regex::new(r"\.fc(\d+)\.").ok();
        let version = re.and_then(|r| {
            r.captures(kernel_version)
                .map(|cap| cap[1].to_string())
        });
        return (Some("Fedora".to_string()), version);
    }

    // RHEL-based distros - extract version from .el suffix
    let el_version = Regex::new(r"\.el(\d+)")
        .ok()
        .and_then(|r| r.captures(kernel_version).map(|cap| cap[1].to_string()));

    if is_centos {
        return (Some("CentOS".to_string()), el_version);
    }

    if is_rocky {
        return (Some("Rocky".to_string()), el_version);
    }

    if is_alma {
        return (Some("Alma".to_string()), el_version);
    }

    if is_oracle {
        return (Some("Oracle".to_string()), el_version);
    }

    if is_rhel {
        return (Some("RHEL".to_string()), el_version);
    }

    (None, None)
}

