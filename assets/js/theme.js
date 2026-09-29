/* Shared Tailwind theme – design tokens live as CSS variables in each page's :root. */
tailwind.config = {
  theme: {
    extend: {
      fontFamily: { sans: ['"Be Vietnam Pro"', 'system-ui', 'sans-serif'] },
      colors: {
        primary:   { DEFAULT: 'var(--color-primary)', hover: 'var(--color-primary-hover)', soft: 'var(--color-primary-soft)' },
        secondary: 'var(--color-secondary)',
        accent:    { DEFAULT: 'var(--color-accent)', hover: 'var(--color-accent-hover)', soft: 'var(--color-accent-soft)' },
        bg:        'var(--color-bg)',
        card:      'var(--color-card)',
        fg:        'var(--color-fg)',
        muted:     { DEFAULT: 'var(--color-muted)', fg: 'var(--color-muted-fg)' },
        line:      'var(--color-border)',
        success:   { DEFAULT: 'var(--color-success)', soft: 'var(--color-success-soft)' },
        danger:    'var(--color-destructive)',
      }
    }
  }
}
