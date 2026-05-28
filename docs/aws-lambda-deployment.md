# AWS Lambda Deployment

This is the public-deployment MVP path for AskKing. It runs the same Hono API as the local Relay, replacing SQLite with DynamoDB.

## Build

```sh
pnpm install
pnpm build
```

## Deploy With SAM

```sh
sam build -t infra/aws-sam/template.yaml
sam deploy --guided \
  --parameter-overrides \
    PublicBaseUrl=https://your-api.example.com \
    AdminToken=replace-with-long-random-token \
    ApnsEnabled=1 \
    ApnsKeyId=... \
    ApnsTeamId=... \
    ApnsTopic=app.askking.relay \
    ApnsKeySecretArn=arn:aws:secretsmanager:...:secret:askking/apns-... \
    ApnsProduction=1
```

The SAM template uses the repository root as `CodeUri` and `dist/lambda.handler` as the Lambda handler, so run `pnpm build` before `sam build`. If using the generated API Gateway URL first, set `PublicBaseUrl` to the `ApiEndpoint` output after the first deploy and redeploy.

## Tables

The template creates:

- `ClientsTable`: Codex client token hash keyed records.
- `DevicesTable`: iOS session token hash keyed records.
- `PairingCodesTable`: short-lived pairing codes with DynamoDB TTL.
- `ApprovalsTable`: approval requests with DynamoDB TTL.
- `CompletionsTable`: completion events with DynamoDB TTL.

## Operational Bootstrap

For first deployment, use admin endpoints over HTTPS:

```sh
curl -H "authorization: Bearer $ASKKING_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"Public Codex","defaultProjectName":"AskKing"}' \
  https://your-api.example.com/api/admin/clients

curl -H "authorization: Bearer $ASKKING_ADMIN_TOKEN" \
  -X POST \
  https://your-api.example.com/api/admin/pairing-code
```

Use the returned client token in `ASKKING_CLIENT_TOKEN`, and enter the pairing code in the iOS app.

## APNs

The Lambda adapter uses the same APNs sender as local mode. For production, provide:

```sh
ASKKING_APNS_ENABLED=1
ASKKING_APNS_KEY_ID=...
ASKKING_APNS_TEAM_ID=...
ASKKING_APNS_TOPIC=...
ASKKING_APNS_KEY_SECRET_ID=arn:aws:secretsmanager:...:secret:askking/apns-...
ASKKING_APNS_PRODUCTION=1
```

Create the APNs key secret before deployment:

```sh
aws secretsmanager create-secret \
  --name askking/apns \
  --secret-string file:///path/to/AuthKey_XXXX.p8
```

Pass the returned `ARN` as `ApnsKeySecretArn`. The local relay can still use `ASKKING_APNS_KEY_PATH=/path/to/AuthKey_XXXX.p8`; production should use Secrets Manager instead of packaging the key into the artifact.

## Hook Wait Behavior

Lambda timeout is set to 65 seconds. The hook adapter still polls in short chunks, so long approval windows do not require one Lambda invocation to stay open for 5 to 10 minutes.
