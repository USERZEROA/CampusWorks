# Cluster configuration

These manifests require administrator-supplied secrets, a built application image, and a transaction-capable MongoDB replica set. No cluster changes are made by local verification.

The included single-node database is a reference topology, not a high-availability database. For a production managed replica set, omit the MongoDB manifests and use its authorized connection string.

Before applying the application:

1. Apply `namespace.yaml`.
2. Create `mongo-auth` out of band with `MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD`, and a randomly generated `replica-key` (use a key file with at least 32 random bytes encoded as base64). Never commit these values.
3. Create `campusworks-app` out of band with `MONGODB_URI` (including `replicaSet=rs0`), a random 32+ character `SESSION_SECRET`, the exact public `PUBLIC_ORIGIN`, approved `ADMIN_EMAILS`, and configured `GITLAB_*` settings. Use URL-encoded credentials in the connection string.
4. Create the bootstrap ConfigMap: `kubectl -n campusworks create configmap campusworks-mongo-bootstrap --from-file=ops/init-mongo-replica.js`.
5. Apply `mongo.yaml`, wait for its database pod, apply `mongo-init.yaml`, and wait for the job to complete.
6. Apply `app.yaml` after making `campusworks:latest` available to the cluster.

Demo login and demo seeding are disabled in the application manifest. Missing authentication configuration leaves sign-in unavailable rather than granting demonstration administration. Configure a trusted HTTPS ingress before enabling proxy-derived secure-cookie behavior. AI settings are optional server secrets; absent configuration leaves assistance explicitly unavailable.

The application readiness endpoint verifies database topology and required indexes. A database ping alone does not authorize the application to accept transactional writes.
