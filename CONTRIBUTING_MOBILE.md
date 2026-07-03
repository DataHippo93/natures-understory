# Contributing - Mobile-first rules

Clark uses this app on his phone every day. Every new page must render well
on a 375px viewport (iPhone SE) without horizontal scroll or text that is
too small to read. Follow the rules below and you get responsive behavior
for free.

## The four rules

### 1. Wrap every page in `<Page>`

```tsx
import { Page, PageHeader } from '@/components/ui/page';

export default function MyPage() {
  return (
    <Page>
      <PageHeader title="My Page" description="What this page does" />
      {/* sections */}
    </Page>
  );
}
```

`<Page>` provides consistent vertical rhythm and a responsive max width.
`<PageHeader>` stacks title/actions on mobile and splits them at `sm`.

### 2. Use `<Section>`, `<StatGrid>`, and `<DataTable>` for common shapes

- `<Section title="...">` - semantic wrapper with responsive spacing.
- `<StatGrid><Stat ... /></StatGrid>` - 1 col mobile, 2 sm, 3 or 4 lg by
  default. No manual grid classes needed for the common case.
- `<DataTable columns={...} rows={...} />` - renders a real table on >=md,
  stacks rows as mobile cards below that. Pass `mobileMode="scroll"` for
  wide numeric tables that need to stay tabular.

### 3. Use `<FormField>` + `<Input>` (or `.u-input` on a native input)

Every input must have `font-size >= 16px`, otherwise iOS Safari zooms the
whole viewport on focus. Buttons must be at least 44 by 44px - use
`.u-tap-target` or ensure padding gets you there.

### 4. Never hardcode pixel widths

No `w-[800px]`, no `min-w-[600px]` on anything above the fold. Use Tailwind
`max-w-*` classes and let the layout fluid down. If a table is too wide,
use `<DataTable mobileMode="scroll">` rather than capping the page.

## Utility classes (globals.css)

| class            | what it does                                   |
|------------------|----------------------------------------------------|
| `.u-input`       | 16px font, 44px min-height, 6px radius          |
| `.u-tap-target`  | 44 by 44 minimum, use on icon buttons           |
| `.u-safe-x`      | padding left/right using `env(safe-area-inset-*)` |
| `.u-safe-bottom` | bottom padding respecting iOS home indicator     |

## Testing

Before opening a PR, resize your browser to 375px wide and click through
the pages you touched. If content overflows horizontally, a table stops
fitting, or a button is under 44px, fix it before merging, not after.

The `<AppShell>` in `app/layout.tsx` already handles the mobile top bar and
sidebar drawer. You should never need to write those again.

## Anti-patterns to avoid

- Raw `<table>` on any page. Use `<DataTable>`.
- Inline `style={{ minWidth: '...' }}` on containers.
- `text-xs` (12px) for anything a user actually reads.
- Icon buttons without `.u-tap-target` or equivalent padding.
- Sticky headers without safe-area padding on the top.
