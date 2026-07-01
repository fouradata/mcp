# Fixtures

Each `*.json` here is a captured response from `https://api.foura.ai/api/{single,proxy,browser}/`.
Unit tests load them and assert that the tool `outputSchema.parse()` succeeds against a real-shape body.

To refresh a fixture, capture a fresh response from the corresponding endpoint and update the JSON.
