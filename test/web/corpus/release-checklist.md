# Release checklist

Before tagging a release, in order.

## Prepare

- [x] Bump the version in `package.json`
- [x] Update the changelog
  - [x] Breaking changes first
  - [ ] Link each PR
- [ ] Run `bun test && bun run lint`

## Ship

1. [ ] Tag: `git tag v1.2.3`
2. [ ] Push the tag
3. [ ] Check the deploy at https://example.com/health

- [ ]

```sh
# Not a task, an example:
- [ ] this line is code
bun run build
```

> Note: never ship on a Friday.
