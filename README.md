# PSAP Control Center

A cluster management and reservation platform for the Performance and Scale for AI Platforms (PSAP) team. Provides observability into OpenShift cluster health, a reservation system with calendar views, kubeconfig management, and Hearth GPU discovery integration.

**Live instance**: [control-center.apps.psap-automation.ibm.rhperfscale.org](https://control-center.apps.psap-automation.ibm.rhperfscale.org)

## Features

- **Cluster Registry** — Add clusters via kubeconfig upload or kubeadmin credentials. Live health monitoring, node topology visualization, OCP details, operators, and workloads.
- **Reservation System** — Full-cluster or partial GPU reservations with type-aware conflict detection. Color-coded calendar, cancellation tracking, and historical preservation when clusters are removed.
- **GPU Allocation & DRA** — Live GPU status via DRA (`resource.k8s.io`) with automatic fallback to legacy node capacity counting. Per-GPU-type breakdowns, ConfigMap-driven vendor abstraction.
- **Namespace Enforcement** — GPU reservations automatically provision isolated Kubernetes namespaces with `ResourceQuota` and optional DRA `ResourceClaimTemplate`. Namespaces are cleaned up on completion, cancellation, or deletion.
- **Calendar Views** — Weekly preview with overlapping reservation display (index-based opacity for distinguishing coexisting reservations), plus full month/week/day calendar.
- **Hearth Integration** — Connect to a Hearth management cluster to discover GPU inventory via FournosCluster CRDs.
- **View-Only Public Access** — Anyone can browse clusters, reservations, and status. Modifications require sign-in.
- **Structured Logging** — Consistent log format across backend and frontend, configurable via `LOG_LEVEL`.

## Tech Stack

| Layer    | Technology                                              |
| -------- | ------------------------------------------------------- |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query |
| Backend  | Python, FastAPI, SQLAlchemy (async), Kubernetes client  |
| Database | SQLite (dev) / PostgreSQL (prod)                        |
| Deploy   | OpenShift (binary builds), Docker Compose (local)       |

## Quick Start

### Docker Compose

```bash
git clone https://github.com/openshift-psap/psap-control-center.git
cd psap-control-center
cp .env.example .env    # Edit credentials as needed
docker-compose up -d
```

- UI: http://localhost:3000
- API docs: http://localhost:8000/docs

### Local Development

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
ADMIN_USERNAME=admin ADMIN_PASSWORD=admin \
  uvicorn app.main:app --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

- Frontend: http://localhost:3000 (Vite proxies /api to :8000)
- Backend: http://localhost:8000

### OpenShift Deployment

See [deploy/README.md](deploy/README.md) for the full OCP deployment guide.

## Authentication

| Action | Auth Required |
| ------ | ------------- |
| Viewing clusters, reservations, calendar, status | No |
| Creating, editing, deleting clusters or reservations | Yes (HTTP Basic Auth) |

Credentials are configured via `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables. On OCP these are stored in a Kubernetes Secret.

Sign in via the **Sign In** button in the top-right corner of the UI.

## Configuration

| Variable                 | Default                           | Description                        |
| ------------------------ | --------------------------------- | ---------------------------------- |
| `ADMIN_USERNAME`         | `admin`                           | Admin username for write access    |
| `ADMIN_PASSWORD`         | `admin`                           | Admin password for write access    |
| `DATABASE_URL`           | `sqlite+aiosqlite:///./psap...db` | Async database connection string   |
| `SECRET_KEY`             | (change in production)            | Application secret key             |
| `KUBECONFIG_STORAGE_PATH`| `./kubeconfigs`                   | Directory for kubeconfig files     |
| `LOG_LEVEL`              | `INFO`                            | Backend log level (ERROR/WARN/INFO/DEBUG) |
| `MLFLOW_BASE_URL`        | (optional)                        | MLFlow server URL                  |
| `VITE_LOG_LEVEL`         | `INFO`                            | Frontend log level                 |

## Documentation

| Document | Description |
| -------- | ----------- |
| [Architecture](docs/ARCHITECTURE.md) | System design, data model, API surface, deployment topology |
| [User Guide](docs/USER_GUIDE.md) | How to use the application |
| [Contributing](docs/CONTRIBUTING.md) | Branch workflow, code standards, PR process |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common issues and solutions |
| [OCP Deployment](deploy/README.md) | Step-by-step OpenShift deployment guide |

## API

Interactive documentation is available at `/docs` (Swagger) and `/redoc` when the backend is running.

Key endpoints:

| Endpoint | Method | Auth | Description |
| -------- | ------ | ---- | ----------- |
| `/api/v1/clusters` | GET | No | List clusters |
| `/api/v1/clusters` | POST | Yes | Add a cluster |
| `/api/v1/clusters/{id}/topology` | GET | No | Node topology |
| `/api/v1/clusters/{id}/gpu-status` | GET | No | Live GPU allocation (DRA/legacy) |
| `/api/v1/reservations` | GET | No | List reservations |
| `/api/v1/reservations` | POST | Yes | Create reservation (full-cluster or GPU) |
| `/api/v1/reservations/{id}` | PUT | Yes | Update reservation |
| `/api/v1/reservations/{id}/cancel` | POST | Yes | Cancel reservation |
| `/api/v1/reservations/calendar` | GET | No | Calendar events |
| `/api/v1/reservations/cluster/{id}/current` | GET | No | Multi-occupant cluster occupancy |
| `/api/v1/hearth/clusters` | GET | No | Hearth GPU inventory |
| `/api/v1/auth/check` | GET | Yes | Verify credentials |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the complete API reference.

## License

[Apache License 2.0](LICENSE)

## Related Projects

- [TOPSAIL](https://github.com/openshift-psap/topsail) — Test Orchestrator for Performance and Scalability of AI pLatforms
- [Performance Dashboard](https://github.com/openshift-psap/performance-dashboard) — RHAIIS benchmark analysis
