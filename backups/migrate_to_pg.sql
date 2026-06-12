
CREATE TABLE IF NOT EXISTS clusters (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    api_server_url VARCHAR(512),
    kubeconfig_path VARCHAR(512) NOT NULL,
    color VARCHAR(7) NOT NULL,
    status VARCHAR(50),
    last_health_check TIMESTAMP,
    node_count VARCHAR(20),
    gpu_count VARCHAR(20),
    gpu_type VARCHAR(255),
    gpu_allocation_mode VARCHAR(20),
    cluster_version VARCHAR(50),
    metadata_info JSON,
    tags JSON,
    is_active BOOLEAN,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_clusters_name ON clusters (name);

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    team VARCHAR(255),
    hashed_password VARCHAR(255),
    is_active BOOLEAN,
    is_admin BOOLEAN,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username);

CREATE TABLE IF NOT EXISTS reservations (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    cluster_id VARCHAR(36) REFERENCES clusters(id) ON DELETE SET NULL,
    cluster_name VARCHAR(255),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    user_name VARCHAR(255) NOT NULL,
    user_email VARCHAR(255),
    team VARCHAR(255),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    status VARCHAR(9) NOT NULL,
    reservation_type VARCHAR(20) NOT NULL DEFAULT 'cluster',
    gpu_count INTEGER,
    enforce_isolation BOOLEAN NOT NULL DEFAULT FALSE,
    enforcement_namespace VARCHAR(255),
    enforcement_status VARCHAR(50),
    purpose TEXT,
    notes TEXT,
    color VARCHAR(7),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_reservations_end_time ON reservations (end_time);
CREATE INDEX IF NOT EXISTS ix_reservations_user_name ON reservations (user_name);
CREATE INDEX IF NOT EXISTS ix_reservations_cluster_id ON reservations (cluster_id);
CREATE INDEX IF NOT EXISTS ix_reservations_start_time ON reservations (start_time);

CREATE TABLE IF NOT EXISTS gpu_pod_history (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    cluster_id VARCHAR(36) NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    pod_name VARCHAR(512) NOT NULL,
    namespace VARCHAR(255) NOT NULL,
    gpu_count INTEGER NOT NULL DEFAULT 1,
    node VARCHAR(255),
    first_seen TIMESTAMP NOT NULL,
    last_seen TIMESTAMP NOT NULL,
    finished_at TIMESTAMP,
    CONSTRAINT uq_cluster_ns_pod UNIQUE (cluster_id, namespace, pod_name)
);
CREATE INDEX IF NOT EXISTS ix_gpu_pod_history_cluster_id ON gpu_pod_history (cluster_id);


-- clusters
INSERT INTO clusters (id, name, description, api_server_url, kubeconfig_path, color, status, last_health_check, node_count, gpu_count, gpu_type, gpu_allocation_mode, cluster_version, metadata_info, tags, is_active, created_at, updated_at) VALUES ('4362f5d1-c16e-4a95-a930-5468539c1da6', 'Fire-athena - 8xH200 - LLM-D', '', 'https://api.psap-fire-athena.ibm.rhperfscale.org:6443', '/app/kubeconfigs/Fire-athena_-_8xH200_-_LLM-D.kubeconfig', '#3B82F6', 'healthy', '2026-06-12 01:50:05.011981', '6', '16', 'NVIDIA H200 (140GB)', 'legacy', 'v1.33.6', NULL, 'null', TRUE, '2026-06-11 15:48:26.049713', '2026-06-12 01:50:07.516566');
INSERT INTO clusters (id, name, description, api_server_url, kubeconfig_path, color, status, last_health_check, node_count, gpu_count, gpu_type, gpu_allocation_mode, cluster_version, metadata_info, tags, is_active, created_at, updated_at) VALUES ('faf76763-fbc2-480b-b164-ace3ecd2a5eb', 'Hera - 8xH200 - RHAIIS', '', 'https://api.psap-llmd-h200.ibm-rh-ai.rhperfscale.org:6443', '/app/kubeconfigs/Hera_-_8xH200_-_RHAIIS.kubeconfig', '#10B981', 'healthy', '2026-06-12 01:50:10.235668', '6', '8', 'Unknown GPU', 'legacy', 'v1.32.9', NULL, 'null', TRUE, '2026-06-11 15:49:24.300788', '2026-06-12 01:50:11.885703');
INSERT INTO clusters (id, name, description, api_server_url, kubeconfig_path, color, status, last_health_check, node_count, gpu_count, gpu_type, gpu_allocation_mode, cluster_version, metadata_info, tags, is_active, created_at, updated_at) VALUES ('ccd70cef-c54e-49bd-852b-70668b88a86c', 'Janus - 2x8xH200 - LLM-D', '', 'https://api.psap-de-h200-cluster.ibm.rhperfscale.org:6443', '/app/kubeconfigs/Janus_-_2x8xH200_-_LLM-D.kubeconfig', '#8B5CF6', 'healthy', '2026-06-12 01:50:14.629770', '5', '16', 'NVIDIA H200', 'dra', 'v1.34.6', NULL, 'null', TRUE, '2026-06-11 15:50:12.737654', '2026-06-12 01:50:17.789093');
INSERT INTO clusters (id, name, description, api_server_url, kubeconfig_path, color, status, last_health_check, node_count, gpu_count, gpu_type, gpu_allocation_mode, cluster_version, metadata_info, tags, is_active, created_at, updated_at) VALUES ('9147a90c-0dfd-408d-a43e-508230f9d3b8', 'Poseidon - 4x8xH100', '', 'https://api.psap-gpu.ibm-rh-ai.rhperfscale.org:6443', '/app/kubeconfigs/Poseidon_-_4x8xH100.kubeconfig', '#F97316', 'healthy', '2026-06-12 01:50:54.543968', '7', '32', 'NVIDIA H100 80GB HBM3', 'dra', 'v1.34.5', NULL, 'null', TRUE, '2026-06-11 15:51:08.900485', '2026-06-12 01:50:57.068268');
INSERT INTO clusters (id, name, description, api_server_url, kubeconfig_path, color, status, last_health_check, node_count, gpu_count, gpu_type, gpu_allocation_mode, cluster_version, metadata_info, tags, is_active, created_at, updated_at) VALUES ('e922820c-92c9-4518-bb22-af0274232594', 'Zeus - 8xH200 - RHAIIS', '', 'https://api.psap-rhaiis-h200.ibm-rh-ai.rhperfscale.org:6443', '/app/kubeconfigs/Zeus_-_8xH200_-_RHAIIS.kubeconfig', '#EC4899', 'healthy', '2026-06-12 01:51:15.739851', '5', '8', 'NVIDIA H200 (140GB)', 'legacy', 'v1.33.6', NULL, 'null', TRUE, '2026-06-11 15:52:09.120084', '2026-06-12 01:51:17.407134');
INSERT INTO clusters (id, name, description, api_server_url, kubeconfig_path, color, status, last_health_check, node_count, gpu_count, gpu_type, gpu_allocation_mode, cluster_version, metadata_info, tags, is_active, created_at, updated_at) VALUES ('f93e74db-cf7e-4d81-801b-1037f8ae3935', 'Agentic-CPT-Cluster-8XA100', '', 'https://api.agentic-team-cpt.ibm.rhperfscale.org:6443', '/app/kubeconfigs/Agentic-CPT-Cluster-8XA100.kubeconfig', '#14B8A6', 'healthy', '2026-06-12 01:50:00.325899', '5', '8', 'NVIDIA A100 SXM4 80GB (80GB)', 'legacy', 'v1.33.6', NULL, 'null', TRUE, '2026-06-11 15:56:56.045655', '2026-06-12 01:50:02.360924');

-- users

-- reservations
INSERT INTO reservations (id, cluster_id, cluster_name, title, description, user_name, user_email, team, start_time, end_time, status, reservation_type, gpu_count, enforce_isolation, enforcement_namespace, enforcement_status, purpose, notes, color, created_at, updated_at) VALUES ('3d008c4f-f6d2-4c66-9ac2-a77568df2a22', '9147a90c-0dfd-408d-a43e-508230f9d3b8', 'Poseidon - 4x8xH100', 'dra-composite-driver/dynamo experiments - Thameem', NULL, 'Thameem', NULL, 'PSAP', '2026-06-11 18:32:00.000000', '2026-06-30 18:32:00.000000', 'ACTIVE', 'cluster', NULL, FALSE, NULL, NULL, 'dra-composite-driver/dynamo experiments', NULL, '#F97316', '2026-06-11 18:32:52.247838', '2026-06-11 18:32:52.247840');
INSERT INTO reservations (id, cluster_id, cluster_name, title, description, user_name, user_email, team, start_time, end_time, status, reservation_type, gpu_count, enforce_isolation, enforcement_namespace, enforcement_status, purpose, notes, color, created_at, updated_at) VALUES ('34779de5-fc4b-424e-bf63-94f56a6cfe80', 'faf76763-fbc2-480b-b164-ace3ecd2a5eb', 'Hera - 8xH200 - RHAIIS', 'Harshith reservation', NULL, 'Harshith', NULL, 'RHAIIS', '2026-06-11 18:32:00.000000', '2026-06-21 18:32:00.000000', 'ACTIVE', 'gpu', 2, FALSE, NULL, NULL, 'Hera auto profiling agentic use case', NULL, '#10B981', '2026-06-11 18:32:59.343380', '2026-06-11 18:32:59.343381');
INSERT INTO reservations (id, cluster_id, cluster_name, title, description, user_name, user_email, team, start_time, end_time, status, reservation_type, gpu_count, enforce_isolation, enforcement_namespace, enforcement_status, purpose, notes, color, created_at, updated_at) VALUES ('466e38cf-bccf-42eb-a6ce-36f493e74be7', 'faf76763-fbc2-480b-b164-ace3ecd2a5eb', 'Hera - 8xH200 - RHAIIS', 'MLPerf Endpoints', NULL, 'hpothina', NULL, NULL, '2026-06-11 18:50:00.000000', '2026-06-13 04:01:00.000000', 'ACTIVE', 'gpu', 4, FALSE, NULL, NULL, NULL, NULL, '#10B981', '2026-06-11 18:52:12.277506', '2026-06-11 18:52:12.277507');
INSERT INTO reservations (id, cluster_id, cluster_name, title, description, user_name, user_email, team, start_time, end_time, status, reservation_type, gpu_count, enforce_isolation, enforcement_namespace, enforcement_status, purpose, notes, color, created_at, updated_at) VALUES ('004e7fcf-363e-4b17-9d7a-3749c7e67474', 'faf76763-fbc2-480b-b164-ace3ecd2a5eb', 'Hera - 8xH200 - RHAIIS', 'Debug-Profiling', NULL, 'Naveen', NULL, 'PSAP', '2026-06-11 19:00:00.000000', '2026-06-16 19:00:00.000000', 'ACTIVE', 'gpu', 2, FALSE, NULL, NULL, 'Investigations', NULL, '#10B981', '2026-06-11 19:00:58.431579', '2026-06-11 19:00:58.431581');
INSERT INTO reservations (id, cluster_id, cluster_name, title, description, user_name, user_email, team, start_time, end_time, status, reservation_type, gpu_count, enforce_isolation, enforcement_namespace, enforcement_status, purpose, notes, color, created_at, updated_at) VALUES ('ff088562-0637-4a6c-a4b8-82e25a1440e1', 'ccd70cef-c54e-49bd-852b-70668b88a86c', 'Janus - 2x8xH200 - LLM-D', 'Mooncake KV Cache Offloading', NULL, 'Ramesh Doddaiah', NULL, NULL, '2026-06-11 19:21:00.000000', '2026-06-18 19:21:00.000000', 'ACTIVE', 'cluster', NULL, FALSE, NULL, NULL, 'Mooncake KV Cache Offloading', NULL, '#8B5CF6', '2026-06-11 19:21:28.732785', '2026-06-11 19:21:28.732786');
INSERT INTO reservations (id, cluster_id, cluster_name, title, description, user_name, user_email, team, start_time, end_time, status, reservation_type, gpu_count, enforce_isolation, enforcement_namespace, enforcement_status, purpose, notes, color, created_at, updated_at) VALUES ('c2be75dc-9d36-46f6-a334-a96a1832e1ed', 'e922820c-92c9-4518-bb22-af0274232594', 'Zeus - 8xH200 - RHAIIS', 'automation ', NULL, 'Mehul ', NULL, 'PSAP', '2026-06-12 17:00:00.000000', '2026-06-15 16:59:00.000000', 'SCHEDULED', 'gpu', 1, FALSE, NULL, NULL, NULL, NULL, '#EC4899', '2026-06-11 20:01:15.996235', '2026-06-11 20:01:15.996237');
INSERT INTO reservations (id, cluster_id, cluster_name, title, description, user_name, user_email, team, start_time, end_time, status, reservation_type, gpu_count, enforce_isolation, enforcement_namespace, enforcement_status, purpose, notes, color, created_at, updated_at) VALUES ('ddfafbb1-cbfd-4627-8ce3-510924e6be13', 'e922820c-92c9-4518-bb22-af0274232594', 'Zeus - 8xH200 - RHAIIS', 'automation ', NULL, 'Mehul ', NULL, 'PSAP', '2026-06-12 17:00:00.000000', '2026-06-15 16:59:00.000000', 'SCHEDULED', 'gpu', 1, FALSE, NULL, NULL, NULL, NULL, '#EC4899', '2026-06-11 20:01:20.501502', '2026-06-11 20:01:20.501504');

-- gpu_pod_history
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('b99a05e8-212f-4a38-81a8-6e8d942f8469', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-14b-kserve-7f486c5c9f-6fg2l', 'aiconfigurator', 1, 'psap-fire-athena-bnfx9-worker-gpu-h200-66lrw', '2026-06-11 21:58:01.093719', '2026-06-11 23:50:06.244354', '2026-06-11 23:50:06.244354');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('4081e424-80ab-4574-bffb-34a6560eaabe', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-14b-kserve-7f486c5c9f-b4jr4', 'aiconfigurator', 1, 'psap-fire-athena-bnfx9-worker-gpu-h200-66lrw', '2026-06-11 21:58:01.093719', '2026-06-11 23:50:06.244354', '2026-06-11 23:50:06.244354');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('0da7d4a0-3ca6-4333-aac8-6300c1b30219', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-14b-kserve-7f486c5c9f-b6jg7', 'aiconfigurator', 1, 'psap-fire-athena-bnfx9-worker-gpu-h200-66lrw', '2026-06-11 21:58:01.093719', '2026-06-11 23:50:06.244354', '2026-06-11 23:50:06.244354');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('5bbfb899-786d-4619-977e-392bf85aa223', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-14b-kserve-7f486c5c9f-f4hr7', 'aiconfigurator', 1, 'psap-fire-athena-bnfx9-worker-gpu-h200-66lrw', '2026-06-11 21:58:01.093719', '2026-06-11 23:50:06.244354', '2026-06-11 23:50:06.244354');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('e160e1f7-a2ad-4d16-80b6-8db46d9ac367', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-14b-kserve-7f486c5c9f-jtnw9', 'aiconfigurator', 1, 'psap-fire-athena-bnfx9-worker-gpu-h200-66lrw', '2026-06-11 21:58:01.093719', '2026-06-11 23:50:06.244354', '2026-06-11 23:50:06.244354');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('8d1bfd1f-b916-4f70-b236-629232000dc4', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-14b-kserve-7f486c5c9f-k4bs9', 'aiconfigurator', 1, 'psap-fire-athena-bnfx9-worker-gpu-h200-66lrw', '2026-06-11 21:58:01.093719', '2026-06-11 23:50:06.244354', '2026-06-11 23:50:06.244354');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('50f571d6-e3f0-4eb7-944d-a8444dd830c7', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-14b-kserve-7f486c5c9f-sjtmw', 'aiconfigurator', 1, 'psap-fire-athena-bnfx9-worker-gpu-h200-66lrw', '2026-06-11 21:58:01.093719', '2026-06-11 23:50:06.244354', '2026-06-11 23:50:06.244354');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('5ae22956-f6f4-4c13-aa73-0e4e43e84420', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-14b-kserve-7f486c5c9f-tg7n6', 'aiconfigurator', 1, 'psap-fire-athena-bnfx9-worker-gpu-h200-66lrw', '2026-06-11 21:58:01.093719', '2026-06-11 23:50:06.244354', '2026-06-11 23:50:06.244354');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('ce1fa82b-37ce-4f13-99d7-4c11953ec2e5', 'faf76763-fbc2-480b-b164-ace3ecd2a5eb', 'hpothina-airbnb-235b-tp4', 'hpothina-rhaiis', 4, 'psap-llmd-h200-gpu-qdndv', '2026-06-11 21:58:02.773573', '2026-06-12 01:59:21.920260', NULL);
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('c6f0e7bf-8db0-4eed-b761-ca1d9854c828', 'faf76763-fbc2-480b-b164-ace3ecd2a5eb', 'vllm-pod-nmiriyal', 'naveen-rhaiis', 2, 'psap-llmd-h200-gpu-qdndv', '2026-06-11 21:58:02.773573', '2026-06-12 01:59:21.920260', NULL);
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('4c9cf46f-427c-4a87-8a5f-f0563b23d5b8', 'ccd70cef-c54e-49bd-852b-70668b88a86c', 'vllm-benchmark', 'benchflow', 8, 'psap-de-h200-cluster-6mgmp-gpu-h200-22mkm', '2026-06-11 21:58:09.143034', '2026-06-12 01:59:20.156568', NULL);
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('2e7a31a1-69d9-4145-adff-42325e2c4301', 'e922820c-92c9-4518-bb22-af0274232594', 'deepseek-v4-pro-7335cf31-predictor-c7f7d8f88-4g7g9', 'kserve-e2e-perf', 8, 'psap-rhaiis-h200-gpu-worker-1-k5pc4', '2026-06-11 21:58:10.924648', '2026-06-11 22:45:58.541085', '2026-06-11 22:45:58.541085');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('8b782c7d-d9e6-4b22-a730-33b422d09fbb', 'faf76763-fbc2-480b-b164-ace3ecd2a5eb', 'nemotron3super-120b-fp8-5b92f045-predictor-7fd885967c-b5q6s', 'kserve-e2e-perf', 2, 'psap-llmd-h200-gpu-qdndv', '2026-06-11 22:37:37.541095', '2026-06-11 23:11:15.441924', '2026-06-11 23:11:15.441924');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('fe3c73f6-ffa4-40c9-afc1-b97f39677f43', 'e922820c-92c9-4518-bb22-af0274232594', 'deepseek-v4-pro-899bd527-predictor-5fb4d67586-dw46n', 'kserve-e2e-perf', 8, 'psap-rhaiis-h200-gpu-worker-1-k5pc4', '2026-06-11 22:46:21.028817', '2026-06-12 00:02:23.562711', '2026-06-12 00:02:23.562711');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('3875f8c5-a54b-4d7e-b381-767e1204cff8', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-8b-kserve-84bbb94f47-5m9l9', 'aiconfigurator', 1, NULL, '2026-06-11 23:09:22.727421', '2026-06-11 23:10:52.052610', '2026-06-11 23:10:52.052610');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('47178301-8f10-4e2b-a8e4-2ad63a00534e', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-8b-kserve-84bbb94f47-5rqdt', 'aiconfigurator', 1, NULL, '2026-06-11 23:09:22.727421', '2026-06-11 23:10:52.052610', '2026-06-11 23:10:52.052610');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('debdcedd-61c2-4c87-80e3-ca5bdb34fcb8', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-8b-kserve-84bbb94f47-ggnmh', 'aiconfigurator', 1, NULL, '2026-06-11 23:09:22.727421', '2026-06-11 23:10:52.052610', '2026-06-11 23:10:52.052610');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('c3d988d3-aca9-450a-ae5a-abb99b62c2d2', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-8b-kserve-84bbb94f47-m7pm7', 'aiconfigurator', 1, NULL, '2026-06-11 23:09:22.727421', '2026-06-11 23:10:52.052610', '2026-06-11 23:10:52.052610');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('01fa4a49-2e7d-408e-922f-dc068afe4a99', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-8b-kserve-84bbb94f47-n6qp6', 'aiconfigurator', 1, NULL, '2026-06-11 23:09:22.727421', '2026-06-11 23:10:52.052610', '2026-06-11 23:10:52.052610');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('622a9294-4594-43bb-b942-5dc114f041c5', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-8b-kserve-84bbb94f47-qrqpl', 'aiconfigurator', 1, NULL, '2026-06-11 23:09:22.727421', '2026-06-11 23:10:52.052610', '2026-06-11 23:10:52.052610');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('aa483128-dfc3-4c3a-bd45-985c7ad4aea6', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-8b-kserve-84bbb94f47-rlc9k', 'aiconfigurator', 1, NULL, '2026-06-11 23:09:22.727421', '2026-06-11 23:10:52.052610', '2026-06-11 23:10:52.052610');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('6b381e41-9c78-49ec-ab88-8ce075fafd90', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-8b-kserve-84bbb94f47-x88bv', 'aiconfigurator', 1, NULL, '2026-06-11 23:09:22.727421', '2026-06-11 23:10:52.052610', '2026-06-11 23:10:52.052610');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('5f0b5e32-f078-4462-9c87-86d1b9c0336c', 'faf76763-fbc2-480b-b164-ace3ecd2a5eb', 'nemotron3super-120b-fp8-6b09284f-predictor-7d858db456-drf6r', 'kserve-e2e-perf', 2, 'psap-llmd-h200-gpu-qdndv', '2026-06-11 23:11:51.939269', '2026-06-11 23:40:38.416470', '2026-06-11 23:40:38.416470');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('a6223b43-c81f-45c0-89c1-9d39550c4819', 'faf76763-fbc2-480b-b164-ace3ecd2a5eb', 'nemotron3super-120b-fp8-0d763238-predictor-6b469fdf45-4hqsc', 'kserve-e2e-perf', 2, 'psap-llmd-h200-gpu-qdndv', '2026-06-11 23:46:10.726692', '2026-06-12 00:27:42.038460', '2026-06-12 00:27:42.038460');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('58e482a7-24f5-4256-8252-0c2440b5297e', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-32b-fp8-tp4-kserve-65c59cff6c-4lzct', 'aiconfigurator', 4, 'psap-fire-athena-bnfx9-worker-gpu-h200-66lrw', '2026-06-11 23:50:06.244354', '2026-06-12 01:59:27.084666', NULL);
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('6e07f001-72e7-4460-ad6c-5c0542ed23b8', '4362f5d1-c16e-4a95-a930-5468539c1da6', 'qwen3-32b-fp8-tp4-kserve-65c59cff6c-ntw4p', 'aiconfigurator', 4, 'psap-fire-athena-bnfx9-worker-gpu-h200-66lrw', '2026-06-11 23:50:06.244354', '2026-06-12 01:59:27.084666', NULL);
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('8e6e542d-9f29-4281-b966-3405e5509edd', 'e922820c-92c9-4518-bb22-af0274232594', 'deepseek-v4-pro-ebba3421-predictor-566665f457-jq5lt', 'kserve-e2e-perf', 8, 'psap-rhaiis-h200-gpu-worker-1-k5pc4', '2026-06-12 00:02:23.562711', '2026-06-12 01:18:12.820910', '2026-06-12 01:18:12.820910');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('de630a81-4fc2-4b1e-a8ba-5f2a4555ed2a', 'faf76763-fbc2-480b-b164-ace3ecd2a5eb', 'nemotron3super-120b-fp8-5b94e061-predictor-9947f9859-rbtm2', 'kserve-e2e-perf', 2, 'psap-llmd-h200-gpu-qdndv', '2026-06-12 00:27:42.038460', '2026-06-12 01:11:11.751089', '2026-06-12 01:11:11.751089');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('91f2f84b-7797-40ea-b6bc-93dfd54fd015', 'faf76763-fbc2-480b-b164-ace3ecd2a5eb', 'nemotron3super-120b-fp8-232e240f-predictor-587b549d4d-h9h47', 'kserve-e2e-perf', 2, 'psap-llmd-h200-gpu-qdndv', '2026-06-12 01:11:11.751089', '2026-06-12 01:19:41.630034', '2026-06-12 01:19:41.630034');
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('02628e00-e524-4bac-96b1-d46be762949a', 'e922820c-92c9-4518-bb22-af0274232594', 'qwen3-5-397b-fp8-220c7f51-predictor-7c47556fff-xvgmq', 'kserve-e2e-perf', 4, 'psap-rhaiis-h200-gpu-worker-1-k5pc4', '2026-06-12 01:18:12.820910', '2026-06-12 01:59:08.621448', NULL);
INSERT INTO gpu_pod_history (id, cluster_id, pod_name, namespace, gpu_count, node, first_seen, last_seen, finished_at) VALUES ('f73aba35-7a37-4be3-ba2c-2aa0b7aab15a', 'faf76763-fbc2-480b-b164-ace3ecd2a5eb', 'nemotron3super-120b-fp8-a0c1cb30-predictor-668b7bcb87-cvbs4', 'kserve-e2e-perf', 2, 'psap-llmd-h200-gpu-qdndv', '2026-06-12 01:37:40.809816', '2026-06-12 01:59:21.920260', NULL);
