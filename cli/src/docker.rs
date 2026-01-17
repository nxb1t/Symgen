use anyhow::{Context, Result};
use bollard::container::{
    Config, CreateContainerOptions, LogsOptions, RemoveContainerOptions, WaitContainerOptions,
};
use bollard::image::CreateImageOptions;
use bollard::models::{HostConfig, Mount, MountTypeEnum};
use bollard::Docker;
use futures::StreamExt;
use std::path::Path;

/// Docker client wrapper for symbol generation
pub struct DockerClient {
    client: Docker,
}

impl DockerClient {
    /// Create a new Docker client
    pub async fn new() -> Result<Self> {
        let client = Docker::connect_with_local_defaults()
            .context("Failed to connect to Docker. Is Docker running?")?;

        // Verify connection
        client
            .ping()
            .await
            .context("Failed to ping Docker daemon")?;

        Ok(Self { client })
    }

    /// Pull a Docker image if not present
    pub async fn pull_image(&self, image: &str) -> Result<()> {
        // Check if image exists locally
        if self.client.inspect_image(image).await.is_ok() {
            return Ok(());
        }

        let options = CreateImageOptions {
            from_image: image,
            platform: "linux/amd64",
            ..Default::default()
        };

        let mut stream = self.client.create_image(Some(options), None, None);

        while let Some(result) = stream.next().await {
            result.context("Failed to pull image")?;
        }

        Ok(())
    }

    /// Run a container with the given script and return logs
    pub async fn run_container(
        &self,
        image: &str,
        script: &str,
        output_dir: &Path,
        on_log: impl Fn(&str),
    ) -> Result<i64> {
        let container_name = format!("symgen-{}", uuid::Uuid::new_v4());
        
        // Create temp script file in output directory
        let script_path = output_dir.join("generate.sh");
        std::fs::write(&script_path, script).context("Failed to write script")?;
        
        // Make script executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&script_path)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&script_path, perms)?;
        }

        let output_dir_str = output_dir
            .to_str()
            .context("Invalid output directory path")?;

        // Container configuration
        let config = Config {
            image: Some(image.to_string()),
            cmd: Some(vec!["bash".to_string(), "/work/generate.sh".to_string()]),
            working_dir: Some("/work".to_string()),
            host_config: Some(HostConfig {
                mounts: Some(vec![Mount {
                    target: Some("/work".to_string()),
                    source: Some(output_dir_str.to_string()),
                    typ: Some(MountTypeEnum::BIND),
                    read_only: Some(false),
                    ..Default::default()
                }]),
                memory: Some(8 * 1024 * 1024 * 1024), // 8GB
                cpu_period: Some(100000),
                cpu_quota: Some(200000), // 2 CPUs
                ..Default::default()
            }),
            ..Default::default()
        };

        let platform = "linux/amd64".to_string();
        let options = CreateContainerOptions {
            name: &container_name,
            platform: Some(&platform),
        };

        // Create container
        let container = self
            .client
            .create_container(Some(options), config)
            .await
            .context("Failed to create container")?;

        // Start container
        self.client
            .start_container::<String>(&container.id, None)
            .await
            .context("Failed to start container")?;

        // Stream logs
        let log_options = LogsOptions::<String> {
            follow: true,
            stdout: true,
            stderr: true,
            ..Default::default()
        };

        let mut log_stream = self.client.logs(&container.id, Some(log_options));

        while let Some(result) = log_stream.next().await {
            match result {
                Ok(output) => {
                    let log_line = output.to_string();
                    on_log(&log_line);
                }
                Err(e) => {
                    tracing::warn!("Log stream error: {}", e);
                    break;
                }
            }
        }

        // Wait for container to finish
        let mut wait_stream = self
            .client
            .wait_container(&container.id, None::<WaitContainerOptions<String>>);

        let exit_code = if let Some(result) = wait_stream.next().await {
            result.context("Failed to wait for container")?.status_code
        } else {
            -1
        };

        // Remove container
        let remove_options = RemoveContainerOptions {
            force: true,
            ..Default::default()
        };

        self.client
            .remove_container(&container.id, Some(remove_options))
            .await
            .ok(); // Ignore removal errors

        // Clean up script
        std::fs::remove_file(&script_path).ok();

        Ok(exit_code)
    }
}
