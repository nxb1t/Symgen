use serde::Serialize;

use crate::output::Output;

/// Supported Linux distributions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Distro {
    Ubuntu,
    Debian,
    Fedora,
    CentOS,
    RHEL,
    Oracle,
    Rocky,
    Alma,
}

impl Distro {
    /// Parse distro from string (case-insensitive)
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "ubuntu" => Some(Self::Ubuntu),
            "debian" => Some(Self::Debian),
            "fedora" => Some(Self::Fedora),
            "centos" => Some(Self::CentOS),
            "rhel" | "redhat" => Some(Self::RHEL),
            "oracle" | "oraclelinux" | "ol" => Some(Self::Oracle),
            "rocky" | "rockylinux" => Some(Self::Rocky),
            "alma" | "almalinux" => Some(Self::Alma),
            _ => None,
        }
    }

    /// Get the display name for this distro
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Ubuntu => "Ubuntu",
            Self::Debian => "Debian",
            Self::Fedora => "Fedora",
            Self::CentOS => "CentOS",
            Self::RHEL => "RHEL",
            Self::Oracle => "Oracle Linux",
            Self::Rocky => "Rocky Linux",
            Self::Alma => "AlmaLinux",
        }
    }

    /// Get all supported distros
    pub fn all() -> &'static [Self] {
        &[
            Self::Ubuntu,
            Self::Debian,
            Self::Fedora,
            Self::CentOS,
            Self::RHEL,
            Self::Oracle,
            Self::Rocky,
            Self::Alma,
        ]
    }
}

/// Distro version information
#[derive(Debug, Clone, Serialize)]
pub struct DistroVersion {
    pub distro: Distro,
    pub version: String,
    pub codename: Option<String>,
    pub docker_image: String,
}

/// Get supported versions for a distro
pub fn get_versions(distro: Distro) -> Vec<DistroVersion> {
    match distro {
        Distro::Ubuntu => vec![
            DistroVersion {
                distro,
                version: "20.04".to_string(),
                codename: Some("focal".to_string()),
                docker_image: "ubuntu:20.04".to_string(),
            },
            DistroVersion {
                distro,
                version: "22.04".to_string(),
                codename: Some("jammy".to_string()),
                docker_image: "ubuntu:22.04".to_string(),
            },
            DistroVersion {
                distro,
                version: "24.04".to_string(),
                codename: Some("noble".to_string()),
                docker_image: "ubuntu:24.04".to_string(),
            },
        ],
        Distro::Debian => vec![
            DistroVersion {
                distro,
                version: "10".to_string(),
                codename: Some("buster".to_string()),
                docker_image: "debian:10".to_string(),
            },
            DistroVersion {
                distro,
                version: "11".to_string(),
                codename: Some("bullseye".to_string()),
                docker_image: "debian:11".to_string(),
            },
            DistroVersion {
                distro,
                version: "12".to_string(),
                codename: Some("bookworm".to_string()),
                docker_image: "debian:12".to_string(),
            },
        ],
        Distro::Fedora => vec![
            DistroVersion {
                distro,
                version: "38".to_string(),
                codename: None,
                docker_image: "fedora:38".to_string(),
            },
            DistroVersion {
                distro,
                version: "39".to_string(),
                codename: None,
                docker_image: "fedora:39".to_string(),
            },
            DistroVersion {
                distro,
                version: "40".to_string(),
                codename: None,
                docker_image: "fedora:40".to_string(),
            },
        ],
        Distro::CentOS => vec![
            DistroVersion {
                distro,
                version: "7".to_string(),
                codename: None,
                docker_image: "centos:7".to_string(),
            },
            DistroVersion {
                distro,
                version: "8".to_string(),
                codename: Some("Stream 8".to_string()),
                docker_image: "quay.io/centos/centos:stream8".to_string(),
            },
            DistroVersion {
                distro,
                version: "9".to_string(),
                codename: Some("Stream 9".to_string()),
                docker_image: "quay.io/centos/centos:stream9".to_string(),
            },
        ],
        Distro::RHEL => vec![
            DistroVersion {
                distro,
                version: "8".to_string(),
                codename: None,
                docker_image: "redhat/ubi8:latest".to_string(),
            },
            DistroVersion {
                distro,
                version: "9".to_string(),
                codename: None,
                docker_image: "redhat/ubi9:latest".to_string(),
            },
        ],
        Distro::Oracle => vec![
            DistroVersion {
                distro,
                version: "8".to_string(),
                codename: None,
                docker_image: "oraclelinux:8".to_string(),
            },
            DistroVersion {
                distro,
                version: "9".to_string(),
                codename: None,
                docker_image: "oraclelinux:9".to_string(),
            },
        ],
        Distro::Rocky => vec![
            DistroVersion {
                distro,
                version: "8".to_string(),
                codename: None,
                docker_image: "rockylinux:8".to_string(),
            },
            DistroVersion {
                distro,
                version: "9".to_string(),
                codename: None,
                docker_image: "rockylinux:9".to_string(),
            },
        ],
        Distro::Alma => vec![
            DistroVersion {
                distro,
                version: "8".to_string(),
                codename: None,
                docker_image: "almalinux:8".to_string(),
            },
            DistroVersion {
                distro,
                version: "9".to_string(),
                codename: None,
                docker_image: "almalinux:9".to_string(),
            },
        ],
    }
}

/// Find distro version by version string
pub fn find_version(distro: Distro, version: &str) -> Option<DistroVersion> {
    get_versions(distro)
        .into_iter()
        .find(|v| v.version == version)
}

/// List all supported distros and versions
pub fn list_distros(output: &Output) {
    if output.is_json() {
        #[derive(Serialize)]
        struct DistroList {
            distros: Vec<DistroInfo>,
        }

        #[derive(Serialize)]
        struct DistroInfo {
            name: String,
            versions: Vec<VersionInfo>,
        }

        #[derive(Serialize)]
        struct VersionInfo {
            version: String,
            codename: Option<String>,
            docker_image: String,
        }

        let distros: Vec<DistroInfo> = Distro::all()
            .iter()
            .map(|d| DistroInfo {
                name: d.display_name().to_string(),
                versions: get_versions(*d)
                    .into_iter()
                    .map(|v| VersionInfo {
                        version: v.version,
                        codename: v.codename,
                        docker_image: v.docker_image,
                    })
                    .collect(),
            })
            .collect();

        let list = DistroList { distros };
        println!("{}", serde_json::to_string_pretty(&list).unwrap());
    } else {
        println!("\nSupported Distributions and Versions:\n");

        for distro in Distro::all() {
            println!("  {}:", distro.display_name());
            for version in get_versions(*distro) {
                if let Some(codename) = &version.codename {
                    println!("    - {} ({})", version.version, codename);
                } else {
                    println!("    - {}", version.version);
                }
            }
            println!();
        }

        println!("Example usage:");
        println!("  symgen generate -k 5.15.0-91-generic -d ubuntu -r 22.04");
        println!("  symgen generate -k 6.1.0-18-amd64 -d debian -r 12");
        println!("  symgen generate -k 6.5.6-300.fc39.x86_64 -d fedora -r 39");
    }
}
