#!/usr/bin/env bash
set -euo pipefail

demo_repo=/tmp/driftcheck-demo
rm -rf "$demo_repo"
mkdir -p "$demo_repo/src/utils" "$demo_repo/src/features"

cat > /usr/local/bin/driftcheck <<'SH'
#!/usr/bin/env bash
exec node /tmp/driftcheck-source/dist/cli.js "$@"
SH
chmod +x /usr/local/bin/driftcheck

cat > "$demo_repo/package.json" <<'JSON'
{
  "name": "demo-app",
  "type": "module",
  "dependencies": {
    "date-fns": "^4.1.0",
    "zod": "^3.23.8"
  }
}
JSON

cat > "$demo_repo/src/utils/date.ts" <<'TS'
export function formatDateForDisplay(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new Error('Invalid date')
  }

  return value.toISOString().slice(0, 10)
}
TS

cat > "$demo_repo/src/features/user.ts" <<'TS'
export const normalizeUserName = (name: string): string => {
  return name.trim().toLowerCase()
}
TS

git -C "$demo_repo" init -q
git -C "$demo_repo" config user.email "demo@example.com"
git -C "$demo_repo" config user.name "Demo User"
git -C "$demo_repo" add .
git -C "$demo_repo" commit -qm "initial commit"

cat > "$demo_repo/src/features/invoice.ts" <<'TS'
import slugify from 'slugify'

export function formatDateForInvoice(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export const makeInvoiceSlug = (value: string): string => {
  return slugify(value)
}
TS
