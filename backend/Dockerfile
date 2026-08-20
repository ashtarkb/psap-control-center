FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/kubeconfigs /app/billing_csvs && \
    chmod 0775 /app/kubeconfigs /app/billing_csvs

ENV KUBECONFIG_STORAGE_PATH=/app/kubeconfigs
ENV BILLING_CSV_STORAGE_PATH=/app/billing_csvs
ENV DATABASE_URL=sqlite+aiosqlite:///./data/pasp_control_center.db

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
