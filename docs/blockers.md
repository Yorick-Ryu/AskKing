# Blockers and External Setup

These are not code blockers, but they are required to fully validate the product on real devices.

## Need Owner Input

1. Apple Developer signing

   Needed from owner: Apple Developer Team ID, final bundle id, and Push Notifications capability enabled for the app id.

2. APNs key material

   Needed from owner: APNs token-auth `.p8` key, key id, team id, and app topic. The repository intentionally does not include secrets.

3. Network reachability

   Needed from owner: choose the validation path.

   - Local: keep the iPhone on the same LAN as the Mac relay URL.
   - Private remote: use VPN or Tailscale.
   - Public: deploy the Relay to AWS and use a public HTTPS URL.

4. Public domain/TLS

   Needed from owner: decide whether to use the generated API Gateway URL first or configure a custom domain and DNS record.

## Code Status

1. AWS Lambda + DynamoDB path exists.

   The Lambda entrypoint, DynamoDB store, and SAM template are present.

2. APNs Secrets Manager loading exists.

   Production Lambda can load the APNs `.p8` key from `ASKKING_APNS_KEY_SECRET_ID` / `ApnsKeySecretArn`. Local development can still use `ASKKING_APNS_KEY_PATH`.

3. Cloudflare Workers direct APNs delivery remains deferred.

   Cloudflare Workers direct APNs delivery still requires a separate HTTP/2 compatibility proof. Until that is done, AWS should be the first public deployment target.
