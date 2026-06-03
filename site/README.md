# CXS Website

Small Sites/Vinext landing page for CXS.

## Local Development

```bash
npm install
npm run dev
npm run build
```

The site is intentionally separate from the root `@act0r/cxs` CLI package. It
does not publish or install the CLI, and it does not update the global CXS
skill.

## Hosting

`.openai/hosting.json` stores the Sites project metadata and optional logical
bindings. This static product page does not require D1 or R2.
