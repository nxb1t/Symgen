use anyhow::Result;
use clap::Parser;
use tracing_subscriber::EnvFilter;

mod banner;
mod cli;
mod docker;
mod distros;
mod generator;
mod output;

use cli::{Cli, Commands};
use generator::SymbolGenerator;
use output::Output;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn")),
        )
        .with_target(false)
        .init();

    let cli = Cli::parse();
    let output = Output::new(cli.json);

    match cli.command {
        Commands::Generate {
            banner,
            kernel,
            distro,
            distro_version,
            output_dir,
        } => {
            // Determine kernel, distro, and version from banner or explicit args
            let (kernel_ver, distro_str, version_str) = if let Some(banner_str) = banner {
                // Parse the banner to extract kernel info
                match banner::parse_banner(&banner_str) {
                    Some(result) => {
                        let k = result.kernel_version;
                        let d = result.distro.ok_or_else(|| {
                            anyhow::anyhow!("Could not detect distribution from banner. Please specify -d/--distro manually.")
                        })?;
                        let v = result.distro_version.ok_or_else(|| {
                            anyhow::anyhow!("Could not detect distribution version from banner. Please specify -r/--release manually.")
                        })?;
                        output.info(&format!("Parsed banner: {} {} kernel {}", d, v, k));
                        (k, d, v)
                    }
                    None => {
                        output.error("Failed to parse kernel banner. Could not extract kernel version.");
                        return Err(anyhow::anyhow!("Banner parsing failed"));
                    }
                }
            } else {
                // Use explicit arguments (already validated as required by clap)
                (
                    kernel.expect("kernel is required when banner is not provided"),
                    distro.expect("distro is required when banner is not provided"),
                    distro_version.expect("distro_version is required when banner is not provided"),
                )
            };

            let generator = SymbolGenerator::new().await?;
            generator
                .generate(&kernel_ver, &distro_str, &version_str, output_dir.as_deref(), &output)
                .await?;
        }
        Commands::List => {
            output.info("Listing supported distributions and versions...");
            distros::list_distros(&output);
        }
        Commands::Check => {
            let generator = SymbolGenerator::new().await;
            match generator {
                Ok(_) => output.success("Docker is available and connected"),
                Err(e) => output.error(&format!("Docker check failed: {}", e)),
            }
        }
    }

    Ok(())
}
