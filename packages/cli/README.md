# @yoqa/cli

CLI for [Yoqa](https://yoqa.mintlify.app/docs/overview) — drive a local runner over HTTP from your terminal or CI.

```bash
npm install -g @yoqa/cli
# or
npx @yoqa/cli health
```

After a global install, the `yoqa` command is on your PATH.

The CLI talks to the local runner at `http://127.0.0.1:7420` by default. If nothing is listening, `yoqa` auto-starts `@yoqa/runner` (requires [Bun](https://bun.sh)). You can also run it in the foreground:

```bash
yoqa serve
```

Disable auto-start with `YOQA_NO_AUTOSTART=1`. Override the URL with `YOQA_RUNNER_HOST` / `YOQA_RUNNER_PORT` / `YOQA_RUNNER_URL`.

See [CLI docs](https://yoqa.mintlify.app/docs/cli).
