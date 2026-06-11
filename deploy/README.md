# Deploying PSAP Control Center on OpenShift

This guide deploys the PSAP Control Center on an OpenShift (OCP) cluster
using container images hosted on [Quay.io](https://quay.io).

## Prerequisites

- `oc` CLI installed
- `podman` installed (for building and pushing images)
- Node.js and `npm` installed (for building frontend static assets)
- Credentials for the target OpenShift cluster
- A Quay.io account with push access to your organization

## Image Registry

Create two repositories under your Quay.io organization:

| Image | Repository |
| ----- | ---------- |
| Backend  | `quay.io/<your-org>/psap-control-center-backend` |
| Frontend | `quay.io/<your-org>/psap-control-center-frontend` |

Set both to **public** so the cluster can pull without an image pull secret.
If you prefer private repos, create a pull secret on the cluster and link it
to the `default` service account in the project namespace.

## Naming Convention

All OpenShift resources use the `psap-control-center-*` prefix:

| Resource    | Name                                |
| ----------- | ----------------------------------- |
| Namespace   | `psap-control-center`               |
| Secrets     | `psap-control-center-admin`         |
|             | `psap-control-center-config`        |
| PVCs        | `psap-control-center-data`          |
|             | `psap-control-center-kubeconfigs`   |
| Deployments | `psap-control-center-backend`       |
|             | `psap-control-center-frontend`      |
| Services    | `psap-control-center-backend`       |
|             | `psap-control-center-frontend`      |
| Route       | `psap-control-center`               |

## Deployment Steps

### 1. Log in to the cluster

```bash
oc login <cluster-api-url> --username=<user> --password=<pass>
```

### 2. Build and push images to Quay.io

Set your Quay organization (used throughout the remaining steps):

```bash
export QUAY_ORG=<your-org>
```

Log in to Quay.io:

```bash
podman login quay.io
```

Build both images for linux/amd64 and push:

```bash
# Backend
podman build --platform linux/amd64 \
  -t quay.io/${QUAY_ORG}/psap-control-center-backend:latest ./backend
podman push quay.io/${QUAY_ORG}/psap-control-center-backend:latest

# Frontend — build static assets locally, then package into the Nginx image
cd frontend && npm ci && npm run build && cd ..
podman build --platform linux/amd64 \
  -t quay.io/${QUAY_ORG}/psap-control-center-frontend:latest \
  -f - ./frontend <<'DOCKERFILE'
FROM nginxinc/nginx-unprivileged:alpine
COPY dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
DOCKERFILE
podman push quay.io/${QUAY_ORG}/psap-control-center-frontend:latest
```

> **Note:** The frontend is built locally (not inside the container) to avoid
> QEMU emulation issues when cross-compiling Node.js on Apple Silicon. If you
> are building on an x86_64 host, you can omit `--platform linux/amd64` and
> use the standard multi-stage `frontend/Dockerfile` directly.

### 3. Create the namespace

```bash
oc new-project psap-control-center
```

### 4. Create secrets

```bash
oc create secret generic psap-control-center-admin \
  --from-literal=ADMIN_USERNAME=admin \
  --from-literal=ADMIN_PASSWORD='<pick-a-secure-password>'

oc create secret generic psap-control-center-config \
  --from-literal=SECRET_KEY='<random-string>' \
  --from-literal=DATABASE_URL='sqlite+aiosqlite:///./data/psap_control_center.db' \
  --from-literal=LOG_LEVEL='INFO'
```

### 5. Create persistent volume claims

```bash
oc apply -f deploy/pvcs.yaml
```

Edit `deploy/pvcs.yaml` before applying if your cluster uses a non-default
storage class (e.g. `ocs-storagecluster-cephfs`).

### 6. Deploy the backend

```bash
oc create deployment psap-control-center-backend \
  --image=quay.io/${QUAY_ORG}/psap-control-center-backend:latest

oc set env deployment/psap-control-center-backend \
  --from=secret/psap-control-center-admin
oc set env deployment/psap-control-center-backend \
  --from=secret/psap-control-center-config
oc set env deployment/psap-control-center-backend \
  KUBECONFIG_STORAGE_PATH=/app/kubeconfigs

oc set volume deployment/psap-control-center-backend \
  --add --name=data --mount-path=/app/data \
  --claim-name=psap-control-center-data
oc set volume deployment/psap-control-center-backend \
  --add --name=kubeconfigs --mount-path=/app/kubeconfigs \
  --claim-name=psap-control-center-kubeconfigs

oc expose deployment psap-control-center-backend --port=8000
```

### 7. Deploy the frontend

```bash
oc create deployment psap-control-center-frontend \
  --image=quay.io/${QUAY_ORG}/psap-control-center-frontend:latest

oc expose deployment psap-control-center-frontend --port=8080
```

### 8. Create the route

```bash
APPS_DOMAIN=$(oc get ingresses.config/cluster -o jsonpath='{.spec.domain}' 2>/dev/null)

oc create route edge psap-control-center \
  --service=psap-control-center-frontend \
  --hostname=control-center.${APPS_DOMAIN}
```

If you lack permissions for `ingresses.config`, find the apps domain from
an existing route or from the cluster console URL and substitute manually:

```bash
oc create route edge psap-control-center \
  --service=psap-control-center-frontend \
  --hostname=control-center.<apps-domain>
```

### 9. Verify

```bash
oc get pods
oc get route psap-control-center
curl -k https://control-center.<apps-domain>/api/v1/health
```

## Rebuilding After Code Changes

```bash
# Backend
podman build --platform linux/amd64 \
  -t quay.io/${QUAY_ORG}/psap-control-center-backend:latest ./backend
podman push quay.io/${QUAY_ORG}/psap-control-center-backend:latest
oc rollout restart deployment/psap-control-center-backend

# Frontend
cd frontend && npm run build && cd ..
podman build --platform linux/amd64 \
  -t quay.io/${QUAY_ORG}/psap-control-center-frontend:latest \
  -f - ./frontend <<'DOCKERFILE'
FROM nginxinc/nginx-unprivileged:alpine
COPY dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
DOCKERFILE
podman push quay.io/${QUAY_ORG}/psap-control-center-frontend:latest
oc rollout restart deployment/psap-control-center-frontend
```

## Authentication

- **Viewing** (all GET endpoints): No authentication required
- **Modifying** (create, edit, delete): Requires sign-in with the admin
  credentials stored in the `psap-control-center-admin` secret

## Updating the Admin Password

```bash
oc delete secret psap-control-center-admin
oc create secret generic psap-control-center-admin \
  --from-literal=ADMIN_USERNAME=admin \
  --from-literal=ADMIN_PASSWORD='<new-password>'

oc rollout restart deployment/psap-control-center-backend
```

## Teardown

```bash
oc delete project psap-control-center
```

This removes all resources in the namespace.
