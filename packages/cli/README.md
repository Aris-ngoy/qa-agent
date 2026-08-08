# @yoqa/cli

CLI for [YoQA](https://yoqa.ai) — drive a local runner over HTTP from your terminal or CI.

```bash
npm install -g @yoqa/cli
# or
npx @yoqa/cli health
```

After a global install, the `yoqa` command is on your PATH.

Requires a running YoQA runner (desktop app, or `bun run runner` from a monorepo checkout) at `http://127.0.0.1:7420` by default.

See [CLI docs](https://docs.yoqa.ai/docs/cli).
