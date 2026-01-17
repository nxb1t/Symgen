# Symgen - Volatility3 Symbol Generator

A vibe-coded web application that automatically generates Volatility3 Linux kernel symbols using Docker containers.

![Symgen Screenshot](screen.png)

## Why I Created this ?

Traditionally, creating Volatility3 Linux symbols means spinning up a Linux VM, identifying the distro from kernel banners, installing matching debug symbols, and repeating the same time consuming steps over and over or manually downloading kernel. Instead of Vms I started using docker containers, which helped in much faster symbol creation but the workflow was still repetitive.

[https://www.hackthebox.com/blog/how-to-create-linux-symbol-tables-volatility](https://www.hackthebox.com/blog/how-to-create-linux-symbol-tables-volatility)

This project fully automates that process. Given a target kernel, it uses Docker to fetch the correct debug symbols, generate Volatility3 compatible JSON symbol files, and make them available through a simple web interface, saving time and eliminating manual setup.

There is an excellent collection of Volatility symbols by [Abyss-W4tcher](https://github.com/Abyss-W4tcher/volatility3-symbols) that contains most common kernels. However, there may still be edge cases where symbols are not present in the collection, in such situations this project can be used.

## Features

- **Automatic Symbol Generation**: Generate Volatility3 symbol files for Ubuntu and Debian kernels
- **Docker-based**: Uses Docker containers to download debug symbols and generate JSON files
- **Real-time Updates**: WebSocket support for live job status updates
- **Symbol Portal**: Download generated symbols for use in memory forensics
- **Multi-distro Support**: Ubuntu 20.04, 22.04, 24.04 and Debian 10, 11, 12

## Architecture

```
                    +-----------------+
                    |     Nginx       |
                    |   (Port 80)     |
                    +--------+--------+
                             |
            +----------------+----------------+
            |                                 |
   +--------v--------+              +--------v--------+
   |    Frontend     |              |     Backend     |
   |   (Next.js)     |              |   (FastAPI)     |
   |   Port 3000     |              |   Port 8000     |
   +-----------------+              +--------+--------+
                                             |
                              +--------------+---------------+
                              |                              |
                     +--------v--------+            +--------v--------+
                     |   PostgreSQL    |            |     Docker      |
                     |    Database     |            |     Socket      |
                     +-----------------+            +-----------------+
```

## Prerequisites

- Docker and Docker Compose
- Docker socket access for spawning symbol generation containers

## Quick Start

### Using Docker Compose (Recommended)

1. Clone the repository:
   ```bash
   git clone https://github.com/nxb1t/Symgen.git
   cd Symgen
   ```

2. Start the application:
   ```bash
   docker-compose up -d
   ```

3. Access the application at http://localhost

### Development Setup

#### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Usage

### Generating a Symbol

1. Open the web interface
2. Click "Generate Symbol"
3. Enter the kernel version (e.g., `5.15.0-91-generic`)
4. Select the Linux distribution (Ubuntu or Debian)
5. Select the version (e.g., Ubuntu 22.04)
6. Click "Generate"

### How It Works

1. The backend spins up a Docker container with the selected Linux distribution
2. Inside the container:
   - Updates package lists
   - Adds debug symbol repository (ddebs for Ubuntu, debian-debug for Debian)
   - Downloads kernel debug symbols (linux-image-*-dbgsym/dbg)
   - Downloads dwarf2json from the Volatility Foundation
   - Runs dwarf2json to generate the symbol file
   - Compresses the output with xz
3. The symbol file is saved and made available for download

### Symbol Filename Format

- Ubuntu: `Ubuntu_{codename}_{kernel_version}.json.xz`
  - Example: `Ubuntu_jammy_5.15.0-91-generic.json.xz`
- Debian: `Debian_{codename}_{kernel_version}.json.xz`
  - Example: `Debian_bookworm_6.1.0-18-amd64.json.xz`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/symgen/status` | Check Docker availability |
| GET | `/api/symgen/metrics` | Get system metrics (storage, completion times) |
| GET | `/api/symgen/distros` | List supported distros |
| POST | `/api/symgen/generate` | Start symbol generation |
| POST | `/api/symgen/parse-banner` | Parse kernel banner to extract info |
| GET | `/api/symgen/jobs` | List all jobs |
| GET | `/api/symgen/jobs/{id}` | Get job details |
| POST | `/api/symgen/jobs/{id}/cancel` | Cancel a running job |
| DELETE | `/api/symgen/jobs/{id}` | Delete job and files |
| GET | `/api/symgen/portal` | List available symbols |
| GET | `/api/symgen/download/{id}` | Download symbol file |
| WS | `/api/symgen/ws` | WebSocket for real-time updates |

## Configuration

### Environment Variables

#### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/symgen_db` | Database connection URL |
| `UPLOAD_DIR` | `/app/uploads` | Directory for generated symbols |
| `DOCKER_VOLUME_NAME` | `symgen_storage` | Docker volume name for symbol storage |

#### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `` (empty) | API URL (use empty for same-origin) |

## Using Generated Symbols

Copy the downloaded `.json.xz` file to your Volatility3 symbols directory:

```bash
# Linux
cp Ubuntu_jammy_5.15.0-91-generic.json.xz ~/.local/lib/python3.11/site-packages/volatility3/symbols/linux/

# Or to the framework directory
cp Ubuntu_jammy_5.15.0-91-generic.json.xz /path/to/volatility3/volatility3/symbols/linux/
```

Then run Volatility3:

```bash
vol -f memory.raw linux.pslist
```

## Troubleshooting

### Docker Not Available

If you see "Docker is not available", ensure:

1. Docker socket is mounted: `-v /var/run/docker.sock:/var/run/docker.sock`
2. The user has permissions to access the Docker socket

### Symbol Generation Fails

Common issues:

1. **Debug symbols not found**: The kernel version might not have debug symbols available in the repository
2. **Network issues**: The container needs internet access to download packages
3. **Disk space**: Ensure enough disk space for debug symbols (can be several GB)
4. **Volume not found**: If you see "No such file or directory" for generate.sh, ensure the `symgen_storage` volume exists:
   ```bash
   docker volume create symgen_storage
   ```
   Then restart the services: `docker-compose down && docker-compose up -d`

### Container Timeout

Symbol generation typically takes 5-15 minutes. The timeout is set to 30 minutes. If jobs consistently timeout:

1. Check network connectivity
2. Check available disk space
3. Try a different kernel version

## License

MIT License

